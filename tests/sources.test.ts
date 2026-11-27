/** Parsers for the three sources, run on recorded responses. No network: fetch is stubbed to fail. */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stations } from "../seed/stations";
import { currentTime, fetchText } from "../src/server/fetcher";
import { fetchNdbc, parseNdbc } from "../src/server/sources/ndbc";
import { durationHours, parseGrid, parsePoint, parseStationList, parseStationObservations } from "../src/server/sources/nws";
import { parseSeagullObs } from "../src/server/sources/seagull";
import { hourly } from "../src/server/sources/types";
import { sunTimes } from "../src/server/sun";

const fixture = (path: string) => JSON.parse(readFileSync(`fixtures/${path}`, "utf8")) as { status: number; body: string };
const seagullMetas = stations.filter((s) => s.source === "seagull").map((s) => s.meta as Extract<(typeof stations)[number]["meta"], { dataset_id: number }>);

beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("a test tried to reach the network"); }); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.FIXTURES; delete process.env.FIXED_NOW; });

describe("fetcher", () => {
  it("replays a recorded response without touching the network", async () => {
    process.env.FIXTURES = "replay:autumn";
    const res = await fetchText("https://www.ndbc.noaa.gov/data/realtime2/45161.txt", { key: "ndbc/45161" });
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/^#YY/);
  });
  it("refuses to fetch when a fixture is missing", async () => {
    process.env.FIXTURES = "replay:autumn";
    await expect(fetchText("https://example.test/x", { key: "nope/missing" })).rejects.toThrow(/No fixture/);
  });
  it("pins the clock only in replay mode", () => {
    process.env.FIXED_NOW = "2026-10-14T14:00:00Z";
    expect(Math.abs(currentTime().getTime() - Date.now())).toBeLessThan(5000);
    process.env.FIXTURES = "replay:autumn";
    expect(currentTime().toISOString()).toBe("2026-10-14T14:00:00.000Z");
  });
});

describe("NDBC", () => {
  const rows = parseNdbc(fixture("autumn/ndbc/45161.json").body);
  it("reads the Muskegon buoy's rows in metric, with UTC times", () => {
    expect(rows.length).toBeGreaterThan(50);
    const last = rows.find((r) => r.observed_at.toISOString() === "2026-10-14T13:00:00.000Z")!;
    expect(last).toMatchObject({ wind_dir_deg: 30, wind_speed_ms: 5, air_temp_c: 14.5, water_temp_c: 15.8, wave_height_m: null, temp_profile: null });
  });
  it("turns MM into null, never zero", () => {
    expect(rows.every((r) => r.wave_height_m === null || r.wave_height_m > 0 || r.wave_height_m === 0)).toBe(true);
    const partial = parseNdbc("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS PTDY  TIDE\n#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi  hPa    ft\n2026 11 27 19 25  MM   MM   MM   2.4    12    MM 293     MM    MM   8.6    MM   MM   MM    MM\n");
    expect(partial[0]).toMatchObject({ wind_dir_deg: null, wind_speed_ms: null, wave_height_m: 2.4, water_temp_c: 8.6, air_temp_c: null });
  });
  it("keeps one reading per clock hour", () => {
    const h = hourly(rows);
    expect(new Set(h.map((r) => Math.floor(r.observed_at.getTime() / 3_600_000))).size).toBe(h.length);
    expect(h.length).toBeLessThan(rows.length);
  });
  it("reports a pulled buoy as no data, not an error", async () => {
    process.env.FIXTURES = "replay:winter";
    expect(await fetchNdbc("45161")).toBeNull();
  });
  it("returns nothing for text that is not an NDBC file", () => {
    expect(parseNdbc("<html>404</html>")).toEqual([]);
  });
});

describe("GLOS Seagull", () => {
  it("builds temperature profiles from kelvin readings at depth", () => {
    const byDataset = parseSeagullObs(fixture("ludington-july-2026.json").body, seagullMetas);
    const readings = byDataset.get(62)!;
    expect(readings.length).toBeGreaterThan(50);
    const r = readings.at(-1)!;
    expect(r.observed_at.toISOString()).toBe("2026-07-15T16:00:00.000Z");
    expect(r.temp_profile!.map((p) => p.depth_m)).toEqual([0, 3, 5, 8, 11, 13, 16, 19, 21]);
    for (const p of r.temp_profile!) { expect(p.temp_c).toBeGreaterThan(2); expect(p.temp_c).toBeLessThan(28); }
    expect(r.temp_profile![0]!.temp_c).toBeGreaterThan(r.temp_profile!.at(-1)!.temp_c); // warm on top in July
    expect(r.water_temp_c).toBe(r.temp_profile![0]!.temp_c);
    expect(r.wind_dir_deg).toBeGreaterThanOrEqual(0);
    expect(r.wind_speed_ms).toBeGreaterThanOrEqual(0);
  });
  it("reads the November recording and ignores datasets it has no parameter map for", () => {
    const byDataset = parseSeagullObs(fixture("november/seagull/obs.json").body, seagullMetas.filter((m) => m.dataset_id !== 199));
    expect(byDataset.has(199)).toBe(false);
    expect(byDataset.size).toBeGreaterThan(0);
  });
  it("answers an empty list with no readings", () => {
    expect(parseSeagullObs("[]", seagullMetas).size).toBe(0);
  });
});

describe("National Weather Service", () => {
  it("reads the grid and station links from a point", () => {
    const p = parsePoint(JSON.parse(fixture("november/nws/points/43.2270_-86.3410.json").body));
    expect(p).toMatchObject({ grid_id: "GRR", grid_x: 18, grid_y: 58 });
    expect(p.grid_url).toBe("https://api.weather.gov/gridpoints/GRR/18,58");
  });
  it("expands forecast intervals to hours and converts km/h to m/s", () => {
    const raw = JSON.parse(fixture("november/nws/grid/GRR-18-58.json").body);
    const hours = parseGrid(raw);
    expect(hours.length).toBeGreaterThan(100);
    for (let i = 1; i < 24; i++) expect(hours[i]!.valid_at.getTime() - hours[i - 1]!.valid_at.getTime()).toBe(3_600_000);
    const first = raw.properties.windSpeed.values[0];
    const at = hours.find((h) => h.valid_at.getTime() === new Date(first.validTime.split("/")[0]).getTime())!;
    expect(at.wind_speed_ms).toBeCloseTo(first.value / 3.6, 1);
    expect(hours.every((h) => h.sky_cover_pct === null || (h.sky_cover_pct >= 0 && h.sky_cover_pct <= 100))).toBe(true);
  });
  it("reads ISO durations", () => {
    expect([durationHours("PT1H"), durationHours("PT3H"), durationHours("P1DT10H"), durationHours("P2D")]).toEqual([1, 3, 34, 48]);
  });
  it("reads the observation stations for a grid, nearest first", () => {
    expect(parseStationList(JSON.parse(fixture("november/nws/stations/GRR-18-58.json").body))[0]).toMatchObject({ id: "KMKG" });
  });
  it("reads station wind in m/s and skips readings with no wind", () => {
    const obs = parseStationObservations(JSON.parse(fixture("november/nws/obs/KMKG.json").body));
    expect(obs.length).toBeGreaterThan(20);
    for (const o of obs) expect(o.wind_dir_deg !== null || o.wind_speed_ms !== null).toBe(true);
    expect(parseStationObservations(JSON.parse(fixture("winter/nws/obs/KMKG.json").body))).toEqual([]);
  });
});

describe("sun times", () => {
  it("puts Muskegon's mid-August sunrise and sunset within a few minutes of the almanac", () => {
    const s = sunTimes("2026-08-15", 43.227, -86.341)!;
    const minutes = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();
    expect(Math.abs(minutes(s.sunrise) - (10 * 60 + 50))).toBeLessThan(6); // about 6:50 a.m. EDT
    expect(Math.abs(minutes(s.sunset) - (0 * 60 + 48))).toBeLessThan(6); // about 8:48 p.m. EDT, which is 00:48 UTC
    expect(s.sunset.getTime() - s.sunrise.getTime()).toBeGreaterThan(13.5 * 3_600_000);
  });
});
