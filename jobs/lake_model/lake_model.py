"""
NOAA lake model job: reads modeled water temperature off each port and posts it to the app.

The Lake Michigan and Huron Operational Forecast System (LMHOFS) writes one NetCDF file per
hour to NOAA's public archive on AWS. Checked 2026-11-28:

  https://noaa-nos-ofs-pds.s3.amazonaws.com/lmhofs/netcdf/YYYY/MM/DD/lmhofs.tCCz.YYYYMMDD.fields.{n|f}HHH.nc

  - Four runs a day, CC = 00, 06, 12, 18 (UTC). A run is complete on AWS about 3 h 15 min after CC.
  - nHHH is the nowcast (n000 to n006, the six hours up to CC); fHHH the forecast (f000 to f120).
  - Each file is about 188 MB: 90,806 nodes, 20 sigma layers, one time step.
  - `temp` is stored uncompressed, so the netCDF library can read a few nodes over HTTP byte
    ranges ("#mode=bytes") without downloading the file.

This is the one Python program in the repository. It holds no secret. On GitHub Actions it asks
GitHub for a short-lived signed token naming this repository and workflow, and the app accepts
that. (CRON_SECRET also works, for a run from anywhere else.) The app writes to the database.

Usage:
  python lake_model.py                      # newest complete run, post to SITE_URL
  python lake_model.py --dry-run --hours 0  # print what would be posted for the first forecast hour
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

BUCKET = "https://noaa-nos-ofs-pds.s3.amazonaws.com"
TARGETS_FT = {"near": 60, "mid": 120, "off": 200}
FT_PER_M = 3.28084
RUN_HOURS = (0, 6, 12, 18)
READY_AFTER = timedelta(hours=3, minutes=20)  # when a run's last file is on AWS


# ---------- pure functions, tested without the network ----------

def file_url(run_at: datetime, kind: str, hour: int) -> str:
    """kind is "n" for the nowcast or "f" for the forecast."""
    return (f"{BUCKET}/lmhofs/netcdf/{run_at:%Y/%m/%d}/"
            f"lmhofs.t{run_at:%H}z.{run_at:%Y%m%d}.fields.{kind}{hour:03d}.nc")


def latest_run(now: datetime) -> datetime:
    """The newest run whose files should all be on AWS by `now`."""
    t = now - READY_AFTER
    hour = max(h for h in RUN_HOURS if h <= t.hour)
    return t.replace(hour=hour, minute=0, second=0, microsecond=0)


def valid_time(run_at: datetime, kind: str, hour: int) -> datetime:
    """n006 and f000 are both the run time; n000 is six hours before it."""
    return run_at + timedelta(hours=hour - 6 if kind == "n" else hour)


def layer_depths_m(siglay: np.ndarray, bottom_m: float, surface_m: float = 0.0) -> np.ndarray:
    """Sigma layers run 0 at the surface to -1 at the bottom. Depth is positive down, to the layer's middle."""
    return -np.asarray(siglay, dtype=float) * (bottom_m + surface_m)


def break_depth_m(depths: np.ndarray, temps: np.ndarray) -> float | None:
    """
    Depth of the steepest temperature drop, taken at the midpoint between the two layers.
    None when the water does not cool with depth anywhere (a mixed or inverted column).
    """
    depths, temps = np.asarray(depths, float), np.asarray(temps, float)
    if len(depths) < 2:
        return None
    drop = (temps[:-1] - temps[1:]) / np.diff(depths)  # degrees lost per metre, positive when cooling
    k = int(np.argmax(drop))
    return None if drop[k] <= 0 else float((depths[k] + depths[k + 1]) / 2)


def band_depth_m(depths: np.ndarray, temps: np.ndarray, band_top_c: float) -> float | None:
    """
    Depth where the profile first cools to the top of the preferred band, interpolated between layers.
    0 when the surface is already that cold. None when the water never gets that cold.
    """
    depths, temps = np.asarray(depths, float), np.asarray(temps, float)
    if temps[0] <= band_top_c:
        return 0.0
    for k in range(len(temps) - 1):
        if temps[k] > band_top_c >= temps[k + 1]:
            share = (temps[k] - band_top_c) / (temps[k] - temps[k + 1])
            return float(depths[k] + share * (depths[k + 1] - depths[k]))
    return None


def summarize(siglay: np.ndarray, temps_c: np.ndarray, bottom_m: float, band_top_c: float, surface_m: float = 0.0) -> dict:
    """One profile as the app stores it: depth and temperature pairs, the break and the band depth."""
    depths = layer_depths_m(siglay, bottom_m, surface_m)
    brk, band = break_depth_m(depths, temps_c), band_depth_m(depths, temps_c, band_top_c)
    return {
        "profile": [{"depth_m": round(float(d), 2), "temp_c": round(float(t), 2)} for d, t in zip(depths, temps_c)],
        "surface_temp_c": round(float(temps_c[0]), 2),
        "break_depth_m": None if brk is None else round(brk, 2),
        "band_depth_m": None if band is None else round(band, 2),
    }


def miles(lat_a: float, lon_a: float, lat_b, lon_b):
    """Flat-earth distance in statute miles. Good to a few yards over the distances used here."""
    dx = (np.asarray(lon_b) - lon_a) * math.cos(math.radians(lat_a)) * 69.17
    dy = (np.asarray(lat_b) - lat_a) * 69.05
    return np.sqrt(dx * dx + dy * dy)


def sample_points(port: dict, lat: np.ndarray, lon: np.ndarray, h: np.ndarray, max_miles: float = 40.0) -> list[dict]:
    """
    Three grid nodes on a line straight offshore from the port, over about 60, 120 and 200 ft of water.
    Offshore is west from the east shore and east from the west shore. For each target the walk stops at
    the first node at least that deep and takes it, or the node before it when that one is closer in depth.
    """
    toward = -1.0 if port["shore"] == "east" else 1.0
    per_mile = 1.0 / (math.cos(math.radians(port["lat"])) * 69.17)
    line: list[int] = []
    for step in range(int(max_miles * 10) + 1):
        there = port["lon"] + toward * step * 0.1 * per_mile
        gap = miles(port["lat"], there, lat, lon)
        node = int(gap.argmin())
        if gap[node] < 1.0 and (not line or line[-1] != node):
            line.append(node)
    points = []
    for label, target_ft in TARGETS_FT.items():
        target_m = target_ft / FT_PER_M
        for i, node in enumerate(line):
            if h[node] >= target_m:
                before = line[i - 1] if i else node
                best = before if abs(h[before] - target_m) < abs(h[node] - target_m) else node
                points.append({
                    "port_id": port["id"], "label": label, "node_index": best,
                    "lat": round(float(lat[best]), 5), "lon": round(float(lon[best]), 5), "bottom_depth_m": round(float(h[best]), 2),
                })
                break
    return points


# ---------- reading files and posting ----------

def read_grid(url: str):
    import netCDF4
    with netCDF4.Dataset(url + "#mode=bytes") as d:
        lon = d["lon"][:].data.astype(float)
        return d["lat"][:].data.astype(float), np.where(lon > 180, lon - 360, lon), d["h"][:].data.astype(float), d["siglay"][:].data.astype(float)


def read_temps(url: str, nodes: list[int]) -> tuple[np.ndarray, np.ndarray] | None:
    """Temperature (layers by nodes) and surface height at the nodes, or None when the file is not there."""
    import netCDF4
    order = sorted(set(nodes))
    try:
        with netCDF4.Dataset(url + "#mode=bytes") as d:
            temp = d["temp"][0, :, order].data.astype(float)
            zeta = d["zeta"][0, order].data.astype(float)
    except OSError:
        return None
    at = {n: i for i, n in enumerate(order)}
    pick = [at[n] for n in nodes]
    return temp[:, pick], zeta[pick]


def read_step(job: tuple) -> list[dict] | None:
    """One file: every sample point's profile at that hour. Runs in its own process."""
    run_iso, kind, hr, points, columns, band_top_c = job
    run_at = datetime.fromisoformat(run_iso)
    got = read_temps(file_url(run_at, kind, hr), [p["node_index"] for p in points])
    if got is None:
        return None
    temps, zeta = got
    when = valid_time(run_at, kind, hr).strftime("%Y-%m-%dT%H:%M:%SZ")
    return [{"port_id": p["port_id"], "label": p["label"], "valid_at": when, "is_forecast": kind == "f" and hr > 0,
             **summarize(np.array(columns[i]), temps[:, i], p["bottom_depth_m"], band_top_c, float(zeta[i]))}
            for i, p in enumerate(points)]


def credential(site: str) -> str | None:
    """CRON_SECRET when it is set; otherwise a token from GitHub, good for a few minutes, so it is asked for per call."""
    secret = os.environ.get("CRON_SECRET")
    if secret:
        return secret
    url, bearer = os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"), os.environ.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not url or not bearer:
        return None
    req = urllib.request.Request(f"{url}&audience={urllib.parse.quote(site, safe='')}", headers={"authorization": f"bearer {bearer}"})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read())["value"]


def call(site: str, method: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(f"{site}/api/jobs/model", data=data, method=method,
                                 headers={"authorization": f"Bearer {credential(site)}", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return json.loads(res.read())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="print the first batch and post nothing")
    parser.add_argument("--hours", type=int, default=120, help="last forecast hour to read (0 to 120)")
    parser.add_argument("--ports", help="JSON file of ports to use in a dry run, in place of the app's list")
    args = parser.parse_args()

    site = os.environ.get("SITE_URL", "").rstrip("/")
    if args.ports:
        setup = json.load(open(args.ports))
    elif site and credential(site):
        setup = call(site, "GET")
    else:
        print("SITE_URL is not set, or there is neither a GitHub token nor CRON_SECRET. Nothing to do.", file=sys.stderr)
        return 0 if not args.dry_run else 1
    band_top_c = (setup["temp_band_top_f"] - 32) * 5 / 9

    run_at = latest_run(datetime.now(timezone.utc))
    lat, lon, h, siglay = read_grid(file_url(run_at, "f", 0))
    points = [p for port in setup["ports"] for p in sample_points(port, lat, lon, h)]
    nodes = [p["node_index"] for p in points]
    print(f"run {run_at:%Y-%m-%d %H}Z, {len(setup['ports'])} ports, {len(points)} points", file=sys.stderr)

    # The six nowcast hours before the run, then the forecast. n006 is the same moment as f000, so it is left out.
    steps = [("n", hr) for hr in range(0, 6)] + [("f", hr) for hr in range(0, args.hours + 1)]

    # The netCDF library is not safe across threads, so each file is read in its own process.
    columns = [siglay[:, p["node_index"]].tolist() for p in points]
    jobs = [(run_at.isoformat(), kind, hr, points, columns, band_top_c) for kind, hr in steps]
    with ProcessPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(read_step, jobs))
    missing = [f"{k}{hr:03d}" for (k, hr), r in zip(steps, results) if r is None]
    profiles = [row for r in results if r for row in r]
    if missing:
        print(f"missing files: {', '.join(missing)}", file=sys.stderr)
    if not profiles:
        print("No profiles read. The run may not be on AWS yet.", file=sys.stderr)
        return 1

    run = run_at.strftime("%Y-%m-%dT%H:%M:%SZ")
    if args.dry_run:
        print(json.dumps({"run_at": run, "points": points, "profiles": profiles[: len(points)]}, indent=1))
        return 0
    batch = len(points) * 24  # a day of hours per request keeps each body small
    stored = 0
    for i in range(0, len(profiles), batch):
        stored += call(site, "POST", {"run_at": run, "points": points if i == 0 else [], "profiles": profiles[i:i + batch]})["profiles"]
    print(f"stored {stored} profiles", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
