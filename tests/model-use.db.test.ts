/**
 * Phase 2b acceptance: the lake model in the fallback ladder (G24 to G27), against Postgres.
 * Model rows are hand-built in the job's shape; buoy data comes from the recorded fixtures.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stations } from "../seed/stations";
import { tripMoment } from "../src/server/conditions";
import { recordModelChecks, storeModel, type ModelUpload } from "../src/server/jobs/model";
import { refreshConditions, storeReadings } from "../src/server/jobs/refresh";
import { steepestDropM } from "../src/server/model";
import { recommend } from "../src/server/recommend";
import { loadRuleset } from "../src/server/ruleset";
import { parseSeagullObs } from "../src/server/sources/seagull";
import { hourly } from "../src/server/sources/types";

const url = process.env.DATABASE_URL;
const FT = 3.28084;

/**
 * A 20-layer column: `surfaceC` down to the break, 6 °C below it. At the default surface
 * temperature the water cools through 55 °F exactly halfway across the step, so the band
 * starts at the break, as in the spec's scenarios.
 */
function column(bottomM: number, breakM: number, surfaceC = 19.56) {
  const profile = Array.from({ length: 20 }, (_, k) => {
    const depth = Math.round(((k + 0.5) / 20) * bottomM * 100) / 100;
    return { depth_m: depth, temp_c: depth < breakM ? surfaceC : 6 };
  });
  const k = profile.findIndex((p) => p.temp_c === 6);
  const mid = k > 0 ? Math.round(((profile[k - 1]!.depth_m + profile[k]!.depth_m) / 2) * 100) / 100 : null;
  return { profile, surface_temp_c: surfaceC, break_depth_m: mid, band_depth_m: mid };
}

describe.skipIf(!url)("lake model in the recommendation", () => {
  let db: pg.Client, muskegon: string, ludington: string;
  const clear = () => db.query("truncate public.observations, public.forecasts, public.marine_forecasts, public.recommendations, public.model_points cascade");
  const hour = (d: Date) => new Date(Math.round(d.getTime() / 3_600_000) * 3_600_000);

  /** Three sample points for a port, with one profile each at every time given. */
  async function model(port: string, runAt: Date, times: { at: Date; breakFt: number; surfaceC?: number }[], where = { lat: 43.2, lon: -86.42 }) {
    const bottoms = { near: 60 / FT, mid: 200 / FT, off: 250 / FT };
    const upload: ModelUpload = {
      run_at: runAt.toISOString(),
      points: (["near", "mid", "off"] as const).map((label, i) => ({ port_id: port, label, lat: where.lat, lon: where.lon - i * 0.03, node_index: 100 + i, bottom_depth_m: Math.round(bottoms[label] * 100) / 100 })),
      profiles: times.flatMap((t) => (["near", "mid", "off"] as const).map((label) => ({
        port_id: port, label, valid_at: hour(t.at).toISOString(), is_forecast: t.at > runAt, ...column(bottoms[label], Math.min(t.breakFt / FT, bottoms[label] * 0.8), t.surfaceC),
      }))),
    };
    await storeModel(db, upload, runAt);
  }
  const answers = { clarity: "clear" as const, sky: "bright" as const, wind: "breezy" as const };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    const ids = (await db.query("select name, id from public.ports where name in ('Muskegon', 'Ludington')")).rows;
    muskegon = ids.find((r) => r.name === "Muskegon").id; ludington = ids.find((r) => r.name === "Ludington").id;
  });
  afterAll(async () => { await clear(); await db.end(); });
  beforeEach(async () => { vi.stubGlobal("fetch", () => { throw new Error("a test tried to reach the network"); }); await clear(); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.FIXTURES; });

  it("G24: with the buoys out, a May day uses the modeled profile, fires R05, and is medium confidence", async () => {
    const now = new Date("2026-05-10T14:00:00Z");
    process.env.FIXTURES = "replay:winter";
    expect((await refreshConditions(db, now)).errors).toEqual([]);
    await model(muskegon, new Date(now.getTime() - 3 * 3_600_000), [{ at: now, breakFt: 40 }]);

    const r = await recommend({ port: "Muskegon", date: "2026-05-10", answers }, { db, now });
    expect(r).toMatchObject({ status: "ok", temp_source_level: "1m", confidence: "medium" });
    expect(r.engine.fired.map((f) => f.code)).toContain("R05");
    // The mid point sits over 200 ft, 10 ft a layer: the break is 35 to 45 ft and the range runs 20 ft below it.
    expect(r.conditions.model).toMatchObject({ point: "mid", is_forecast: false, age_hours: 3 });
    expect(r.conditions.model!.points.find((p) => p.label === "mid")).toMatchObject({ water_depth_ft: 200, layer_ft: 10, break_ft: { min: 35, max: 45 } });
    expect(r.engine.depth_ft).toEqual({ min: 35, max: 65 });
    // Labeled modeled everywhere it is said.
    expect(r.confidence_reason).toBe("Depth comes from NOAA's lake model, run 3 hours ago. It is modeled, not measured.");
    expect(r.conditions.messages[0]).toBe("Measured water data is unavailable until buoys return. Depth comes from NOAA's lake model.");
    expect(r.sources).toMatchObject({ depth: "NOAA's lake model", depth_kind: "model" });
    expect(r.prefilled.find((p) => p.field === "depth")).toMatchObject({ source: "Modeled" });
    expect(r.prefilled.find((p) => p.field === "water_point")).toMatchObject({ value: "mid", source: "Default" });
    expect(r.conditions.temp_station).toBeNull(); // no buoy is credited with a modeled number
  });

  it("uses the sample point the angler fishes", async () => {
    const now = new Date("2026-05-10T14:00:00Z");
    await model(muskegon, new Date(now.getTime() - 3 * 3_600_000), [{ at: now, breakFt: 40 }]);
    const near = await recommend({ port: "Muskegon", date: "2026-05-10", answers: { ...answers, water_point: "near" } }, { db, now });
    expect(near.conditions.model!.point).toBe("near");
    expect(near.prefilled.find((p) => p.field === "water_point")).toMatchObject({ value: "near", source: "Your answer", data_value: "mid" });
    // 60 ft of water is 3 ft a layer, so the range is tighter than at the mid point.
    expect(near.engine.depth_ft!.max - near.engine.depth_ft!.min).toBeLessThan(30);
  });

  it("G25: a buoy profile beats the model, and the difference between them is recorded", async () => {
    const now = new Date("2026-07-15T16:00:00Z");
    const fixture = JSON.parse(readFileSync("fixtures/ludington-july-2026.json", "utf8"));
    const metas = stations.filter((s) => s.source === "seagull").map((s) => s.meta as never);
    const buoy = (await db.query("select id, lat, lon from public.stations where source = 'seagull' and external_id = '62'")).rows[0];
    const readings = hourly(parseSeagullObs(fixture.body, metas).get(62)!);
    await storeReadings(db, buoy.id, readings);
    const newest = readings.filter((x) => x.observed_at <= now && (x.temp_profile?.length ?? 0) >= 3).at(-1)!;
    const measured = steepestDropM(newest.temp_profile!)!;
    // The model, at a point beside the buoy, puts the break 12 ft deeper than the buoy measures it.
    const modeledFt = measured * FT + 12;
    await model(ludington, new Date(now.getTime() - 3 * 3_600_000), [...new Set([newest.observed_at, now].map((t) => hour(t).getTime()))].map((t) => ({ at: new Date(t), breakFt: modeledFt })), { lat: Number(buoy.lat), lon: Number(buoy.lon) });

    const r = await recommend({ port: "Ludington", date: "2026-07-15", answers }, { db, now });
    expect(r).toMatchObject({ temp_source_level: 1, confidence: "high" }); // confidence follows the buoy
    expect(r.sources.depth).toBe("the Ludington buoy temperature profile");
    expect(r.conditions.model).not.toBeNull(); // still shown on the Conditions screen, labeled modeled

    const thresholds = (await loadRuleset(db)).thresholds;
    expect(await recordModelChecks(db, thresholds, now)).toBeGreaterThanOrEqual(1);
    const check = (await db.query("select c.* from public.model_checks c join public.model_points mp on mp.id = c.model_point_id where mp.label = 'mid'")).rows[0];
    expect(check.measured_source).toBe("buoy");
    expect(Number(check.measured_break_m)).toBeCloseTo(measured, 1);
    const diffFt = (Number(check.modeled_break_m) - Number(check.measured_break_m)) * FT;
    expect(diffFt).toBeGreaterThan(7); // 12 ft, within one 10 ft model layer
    expect(diffFt).toBeLessThan(17);
    // Running the check again adds nothing.
    expect(await recordModelChecks(db, thresholds, now)).toBe(0);
    // A sample point more than five miles from the buoy is not compared with it.
    await db.query("truncate public.model_checks");
    await db.query("update public.model_points set lat = lat + 0.2");
    expect(await recordModelChecks(db, thresholds, now)).toBe(0);
  });

  it("G26: a run fifteen hours old is skipped, the ladder falls to the next level, and the result says so", async () => {
    const now = new Date("2026-05-10T14:00:00Z");
    await model(muskegon, new Date(now.getTime() - 15 * 3_600_000), [{ at: now, breakFt: 40 }]);
    const r = await recommend({ port: "Muskegon", date: "2026-05-10", answers }, { db, now });
    expect(r.temp_source_level).toBe(5);
    expect(r.conditions.model).toBeNull();
    expect(r.conditions.messages).toContain("NOAA's lake model was last run 15 hours ago, so it was not used.");
    expect(r.confidence).toBe("low");
  });

  it("G27: three days ahead uses the forecast profile for that time, labeled forecast, with today's break beside it", async () => {
    const now = new Date("2026-05-10T14:00:00Z");
    const port = (await loadRuleset(db)).ports.find((p) => p.name === "Muskegon")!;
    const trip = tripMoment(port, "2026-05-13", "first_light", now)!;
    await model(muskegon, new Date(now.getTime() - 3 * 3_600_000), [{ at: now, breakFt: 40 }, { at: trip, breakFt: 60 }]);
    const r = await recommend({ port: "Muskegon", date: "2026-05-13", answers }, { db, now });
    expect(r).toMatchObject({ status: "ok", temp_source_level: "1m", confidence: "medium" });
    expect(r.day).toMatchObject({ kind: "forecast", time_window: "first_light" });
    expect(r.conditions.model).toMatchObject({ is_forecast: true, break_today_ft: { min: 35, max: 45 } });
    expect(r.conditions.model!.points.find((p) => p.label === "mid")!.break_ft).toEqual({ min: 55, max: 65 });
    expect(r.engine.depth_ft).toEqual({ min: 55, max: 85 });
    expect(r.confidence_reason).toBe("Depth comes from NOAA's lake model forecast for this time. It is modeled, not measured.");
    expect(r.conditions.messages[0]).toBe("Water temperature is NOAA's lake model forecast for that day. It is modeled, not measured.");
    // Six days ahead is beyond the forecast horizon: month defaults, whatever the model holds.
    const beyond = await recommend({ port: "Muskegon", date: "2026-05-16", answers }, { db, now });
    expect(beyond).toMatchObject({ temp_source_level: 5, confidence: "low" });
  });

  it("a break depth the angler gives beats the model", async () => {
    const now = new Date("2026-05-10T14:00:00Z");
    await model(muskegon, new Date(now.getTime() - 3 * 3_600_000), [{ at: now, breakFt: 40 }]);
    const r = await recommend({ port: "Muskegon", date: "2026-05-10", answers: { ...answers, break_depth_ft: 70 } }, { db, now });
    expect(r).toMatchObject({ temp_source_level: 4, confidence: "low" });
    expect(r.engine.depth_ft).toEqual({ min: 70, max: 90 });
    expect(r.sources.depth_kind).toBe("break");
  });

  it("in August the water fished settles offshore or staging, so it is not asked", async () => {
    const now = new Date("2026-08-10T14:00:00Z");
    await model(muskegon, new Date(now.getTime() - 3 * 3_600_000), [{ at: now, breakFt: 50 }]);
    const mid = await recommend({ port: "Muskegon", date: "2026-08-10", answers }, { db, now });
    expect(mid.questions).toEqual([]);
    expect(mid.engine.mode).toBe("offshore"); // 200 ft of water
    const near = await recommend({ port: "Muskegon", date: "2026-08-10", answers: { ...answers, water_point: "near" } }, { db, now });
    expect(near.engine.mode).toBe("staging"); // 60 ft of water, under the 70 ft line
    // The angler's own choice still wins.
    expect((await recommend({ port: "Muskegon", date: "2026-08-10", answers: { ...answers, water_point: "near", mode: "offshore" } }, { db, now })).engine.mode).toBe("offshore");
  });

  it("reads an upwelling from the model: no extra shift, and the result records it", async () => {
    const now = new Date("2026-08-10T14:00:00Z");
    // Yesterday warm with the cold layer at 50 ft; today 10 °F colder at the surface with it at 20 ft.
    await model(muskegon, new Date(now.getTime() - 3 * 3_600_000), [{ at: new Date(now.getTime() - 24 * 3_600_000), breakFt: 50, surfaceC: 25 }, { at: now, breakFt: 20 }]);
    const r = await recommend({ port: "Muskegon", date: "2026-08-10", answers }, { db, now });
    expect(r.conditions.model!.upwelling).toBe(true);
    expect(r.engine.upwelling_likely).toBe(true);
    expect(r.engine.fired.find((f) => f.code === "R08")?.note).toMatch(/modeled profile/);
    expect(r.engine.depth_ft).toEqual({ min: 15, max: 45 }); // the model's own break, not shifted again
  });
});
