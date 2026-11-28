"""Tests for the lake model job. No network: the sample file is three real nodes cut from one NOAA run."""
from datetime import datetime, timezone
from pathlib import Path

import netCDF4
import numpy as np
import pytest

import lake_model as lm

SAMPLE = Path(__file__).resolve().parents[2] / "fixtures" / "lmhofs" / "muskegon-3-nodes.20261128.t12z.f000.nc"
utc = lambda *a: datetime(*a, tzinfo=timezone.utc)  # noqa: E731


def test_file_names_follow_noaas_pattern():
    run = utc(2026, 11, 28, 12)
    assert lm.file_url(run, "f", 3) == "https://noaa-nos-ofs-pds.s3.amazonaws.com/lmhofs/netcdf/2026/11/28/lmhofs.t12z.20261128.fields.f003.nc"
    assert lm.file_url(run, "n", 0).endswith("lmhofs.t12z.20261128.fields.n000.nc")


def test_latest_run_waits_for_the_files_to_reach_aws():
    assert lm.latest_run(utc(2026, 11, 28, 15, 19)) == utc(2026, 11, 28, 6)   # the 12Z run is not all there yet
    assert lm.latest_run(utc(2026, 11, 28, 15, 20)) == utc(2026, 11, 28, 12)
    assert lm.latest_run(utc(2026, 11, 28, 2, 0)) == utc(2026, 11, 27, 18)    # back across midnight


def test_valid_times():
    run = utc(2026, 11, 28, 12)
    assert lm.valid_time(run, "f", 0) == run
    assert lm.valid_time(run, "f", 120) == utc(2026, 12, 3, 12)
    assert lm.valid_time(run, "n", 0) == utc(2026, 11, 28, 6)
    assert lm.valid_time(run, "n", 6) == run


def test_layer_depths_use_the_bottom_depth_at_the_node():
    siglay = np.array([-0.025, -0.075, -0.975])
    assert lm.layer_depths_m(siglay, 60.0).tolist() == pytest.approx([1.5, 4.5, 58.5])
    assert lm.layer_depths_m(siglay, 60.0, surface_m=0.4).tolist() == pytest.approx([1.51, 4.53, 58.89])


def test_break_is_the_steepest_drop():
    depths = np.array([2.0, 6.0, 10.0, 14.0, 18.0])
    assert lm.break_depth_m(depths, np.array([20.0, 19.5, 14.0, 12.5, 12.0])) == 8.0   # between 6 m and 10 m
    assert lm.break_depth_m(depths, np.array([10.0, 10.0, 10.0, 10.0, 10.0])) is None  # mixed
    assert lm.break_depth_m(depths, np.array([4.0, 4.2, 4.5, 4.6, 4.8])) is None       # warmer with depth, as under ice
    assert lm.break_depth_m(np.array([2.0]), np.array([10.0])) is None


def test_band_depth_is_interpolated_between_layers():
    depths = np.array([2.0, 6.0, 10.0, 14.0])
    temps = np.array([20.0, 16.0, 12.0, 8.0])
    assert lm.band_depth_m(depths, temps, 14.0) == pytest.approx(8.0)    # halfway between 16 and 12
    assert lm.band_depth_m(depths, temps, 16.0) == pytest.approx(6.0)    # exactly at a layer
    assert lm.band_depth_m(depths, temps, 25.0) == 0.0                   # the surface is already that cold
    assert lm.band_depth_m(depths, temps, 5.0) is None                   # it never gets that cold


def test_g29_sample_file_gives_the_expected_profile_and_break():
    """G29: a saved NetCDF sample for one node returns the expected depth and temperature pairs and break depth."""
    with netCDF4.Dataset(SAMPLE) as d:
        h, siglay, temp = d["h"][:].data, d["siglay"][:].data, d["temp"][0].data
    off = lm.summarize(siglay[:, 2], temp[:, 2], float(h[2]), band_top_c=(55 - 32) * 5 / 9)
    assert len(off["profile"]) == 20
    assert float(h[2]) == pytest.approx(61.08, abs=0.01)                    # about 200 ft of water
    assert off["profile"][0] == {"depth_m": 1.53, "temp_c": 9.63}
    assert off["profile"][-1] == {"depth_m": 59.55, "temp_c": 5.56}
    depths = [p["depth_m"] for p in off["profile"]]
    assert depths == sorted(depths)
    assert off["surface_temp_c"] == 9.63
    # Late November: the whole column is under 55 F, so the band starts at the surface, and the
    # steepest drop is deep, about 130 ft down.
    assert off["band_depth_m"] == 0.0
    assert off["break_depth_m"] == 39.7
    # The near and mid nodes, over about 62 and 125 ft of water.
    near = lm.summarize(siglay[:, 0], temp[:, 0], float(h[0]), band_top_c=(55 - 32) * 5 / 9)
    mid = lm.summarize(siglay[:, 1], temp[:, 1], float(h[1]), band_top_c=(55 - 32) * 5 / 9)
    assert (near["break_depth_m"], mid["break_depth_m"]) == (13.14, 24.74)


def test_sample_points_walk_straight_offshore():
    # A made-up shelf running west from the port: one node every half mile, a foot deeper every tenth of a mile.
    port = {"id": "p", "lat": 43.0, "lon": -86.0, "shore": "east"}
    per_mile = 1 / (np.cos(np.radians(43.0)) * 69.17)
    out = np.arange(0, 30, 0.5)
    lat, lon, h = np.full(out.size, 43.0), -86.0 - out * per_mile, (out * 10) / lm.FT_PER_M
    points = lm.sample_points(port, lat, lon, h)
    assert [p["label"] for p in points] == ["near", "mid", "off"]
    assert [round(p["bottom_depth_m"] * lm.FT_PER_M) for p in points] == [60, 120, 200]
    assert all(p["lon"] < port["lon"] for p in points)
    # From the west shore the walk goes east.
    west = lm.sample_points({**port, "shore": "west"}, lat, -86.0 + out * per_mile, h)
    assert all(p["lon"] > port["lon"] for p in west)
    # Water that never gets deep enough gives no point for that depth.
    assert [p["label"] for p in lm.sample_points(port, lat, lon, np.minimum(h, 30))] == ["near"]
