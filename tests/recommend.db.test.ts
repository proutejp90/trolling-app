/**
 * Phase 2 acceptance, against Postgres and the recorded fixtures: the refresh job
 * fills the cache, and a recommendation is built from the cache alone.
 * Skipped without DATABASE_URL. No test here reaches the network.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stations } from "../seed/stations";
import { loadConditions } from "../src/server/conditions";
import { refreshConditions, storeReadings } from "../src/server/jobs/refresh";
import { recommend } from "../src/server/recommend";
import { loadRuleset } from "../src/server/ruleset";
import { parseSeagullObs } from "../src/server/sources/seagull";
import { hourly } from "../src/server/sources/types";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("live conditions from the cache", () => {
  let db: pg.Client;
  const clear = () => db.query("truncate public.observations, public.forecasts, public.recommendations cascade");
  const refresh = (set: string, now: string) => { process.env.FIXTURES = `replay:${set}`; return refreshConditions(db, new Date(now)); };

  beforeAll(async () => { db = new pg.Client({ connectionString: url }); await db.connect(); });
  afterAll(async () => { await clear(); await db.end(); });
  beforeEach(async () => { vi.stubGlobal("fetch", () => { throw new Error("a test tried to reach the network"); }); await clear(); });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.FIXTURES; });

  it("autumn: a Muskegon recommendation uses cached buoy data and shows its age", async () => {
    const now = "2026-10-14T14:00:00Z";
    const summary = await refresh("autumn", now);
    expect(summary.errors).toEqual([]);
    expect(summary.stations.find((s) => s.id === "45161")).toMatchObject({ source: "ndbc", newest: "2026-10-14T13:40:00.000Z" });

    const r = await recommend({ port: "Muskegon", date: "2026-10-14", time_of_day: "day", answers: { clarity: "clear", sky: "bright", wind: "breezy" } }, { db, now: new Date(now) });
    expect(r.conditions.temp_station).toMatchObject({ name: "Muskegon Buoy, MI", source: "ndbc", distance_mi: 3.1 });
    expect(r.conditions).toMatchObject({ temp_source_level: 2, age_minutes: 20, stale: false, observations_at: "2026-10-14T13:40:00.000Z" });
    expect(r.conditions.water_temp_surface_f).toBeGreaterThan(55);
    expect(r.conditions.wind_history.length).toBeGreaterThanOrEqual(36);
    expect(r.conditions.readings[0]!.station).toMatch(/Muskegon/);
    // Surface temperature gives no depth, and October has no default: the app asks, and says why.
    expect(r.status).toBe("needs_input");
    expect(r.questions).toEqual(["depth"]);
    expect(r.conditions.messages).toContain("No buoy nearby reports temperature at depth right now, only at the surface.");

    const answered = await recommend({ port: "Muskegon", date: "2026-10-14", time_of_day: "day", answers: { clarity: "clear", sky: "bright", wind: "breezy", break_depth_ft: 60 } }, { db, now: new Date(now) });
    expect(answered).toMatchObject({ status: "ok", temp_source_level: 4, confidence: "low", ruleset_source: "database" });
    expect(answered.engine.depth_ft).toEqual({ min: 60, max: 80 });
    expect(answered.recommendation_id).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await db.query("select temp_source_level, confidence, requested_for::text from public.recommendations where id = $1", [answered.recommendation_id]);
    expect(stored.rows[0]).toEqual({ temp_source_level: 4, confidence: "low", requested_for: "2026-10-14" });
  });

  it("winter: with every buoy pulled it falls to level 5 and says so", async () => {
    const now = "2026-04-10T14:00:00Z";
    const summary = await refresh("winter", now);
    expect(summary.errors).toEqual([]);
    expect(summary.stations.filter((s) => s.readings > 0)).toEqual([]);
    expect(summary.stations.find((s) => s.id === "45161")?.note).toBe("no file: pulled for the season");

    const r = await recommend({ port: "Muskegon", date: "2026-04-10", time_of_day: "day", answers: { clarity: "clear", sky: "bright", wind: "breezy" } }, { db, now: new Date(now) });
    expect(r).toMatchObject({ status: "ok", temp_source_level: 5, confidence: "low" });
    expect(r.confidence_reason).toBe("Live water data is unavailable until buoys return. Results use month defaults.");
    expect(r.conditions.temp_station).toBeNull();
    expect(r.engine.depth_ft).toEqual({ min: 0, max: 30 });
    expect(r.sources.depth).toBe("month defaults");
    expect(r.engine.setups.length).toBeGreaterThan(0);
  });

  it("summer: a buoy's temperature profile sets the depth at level 1", async () => {
    const now = new Date("2026-07-15T16:00:00Z");
    const fixture = JSON.parse(readFileSync("fixtures/ludington-july-2026.json", "utf8")) as { body: string };
    const metas = stations.filter((s) => s.source === "seagull").map((s) => s.meta as never);
    const station = (await db.query("select id from public.stations where source = 'seagull' and external_id = '62'")).rows[0].id;
    await storeReadings(db, station, hourly(parseSeagullObs(fixture.body, metas).get(62)!));

    const r = await recommend({ port: "Ludington", date: "2026-07-15", time_of_day: "day", answers: { clarity: "clear", sky: "bright", wind: "breezy" } }, { db, now });
    expect(r).toMatchObject({ status: "ok", temp_source_level: 1, confidence: "medium" });
    expect(r.conditions.temp_station).toMatchObject({ name: "Ludington buoy", source: "seagull" });
    expect(r.conditions.age_minutes).toBe(0);
    expect(r.conditions.temp_profile!.length).toBeGreaterThanOrEqual(8);
    expect(r.engine.fired.map((f) => f.code)).toContain("R05");
    expect(r.engine.depth_source).toBe("R05");
    // The range starts where the measured profile cools to 55 °F and runs 20 ft below.
    const p = r.conditions.temp_profile!;
    const below = p.findIndex((x) => x.temp_f <= 55);
    expect(below).toBeGreaterThan(0);
    expect(r.engine.depth_ft!.min).toBeGreaterThanOrEqual(p[below - 1]!.depth_ft);
    expect(r.engine.depth_ft!.min).toBeLessThanOrEqual(p[below]!.depth_ft);
    expect(r.engine.depth_ft!.max - r.engine.depth_ft!.min).toBe(20);
    expect(r.sources.depth).toBe("the Ludington buoy temperature profile");
    expect(r.confidence_reason).toMatch(/^Depth comes from a buoy's temperature profile\. No recent fishing report/);
    // The buoy's own wind feeds the upwelling rule.
    expect(r.conditions.wind_station).toBe("Ludington buoy");
  });

  it("november: the forecast answers sky and wind, so the app does not ask", async () => {
    const now = "2026-11-27T20:30:00Z";
    const summary = await refresh("november", now);
    expect(summary.errors).toEqual([]);
    expect(summary.forecasts).toHaveLength(10);
    const ruleset = await loadRuleset(db);
    const port = ruleset.ports.find((p) => p.name === "Muskegon")!;
    const c = await loadConditions(db, port, "2026-11-28", "day", new Date(now), ruleset.thresholds);
    expect(c.forecast).not.toBeNull();
    expect(["bright", "overcast"]).toContain(c.sky);
    expect(typeof c.wind_calm).toBe("boolean");
    expect(c.wind_station).not.toBeNull(); // an airport or shore station, since the buoy's wind sensor is gone
    // Late November is out of season: the engine says so and nothing is asked.
    const r = await recommend({ port: "Muskegon", date: "2026-11-28" }, { db, now: new Date(now) });
    expect(r).toMatchObject({ status: "out_of_season", questions: [] });
  });

  it("asks only what the data could not answer", async () => {
    await refresh("winter", "2026-08-10T14:00:00Z");
    const now = new Date("2026-08-10T14:00:00Z");
    const first = await recommend({ port: "Muskegon", date: "2026-08-10" }, { db, now });
    // No forecast covers any part of the date, so sky and wind are asked at once and nothing is added later.
    expect(first.questions).toEqual(["time_of_day", "clarity", "sky", "wind", "mode"]);
    expect(first.conditions.forecast_covers_date).toBe(false);
    const second = await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "before_sunrise", answers: { clarity: "clear", mode: "offshore" } }, { db, now });
    expect(second.questions).toEqual(["wind"]); // before sunrise the light is low; no forecast, so wind is asked
    expect(second.sources.sky).toBe("time of day");
    // In the dark the light is low whatever the angler said about the sky earlier.
    const dark = await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "before_sunrise", answers: { clarity: "clear", mode: "offshore", sky: "bright", wind: "calm" } }, { db, now });
    expect(dark.sources.sky).toBe("time of day");
    expect(dark.engine).toEqual((await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "before_sunrise", answers: { clarity: "clear", mode: "offshore", wind: "calm" } }, { db, now })).engine);
  });

  it("one failing station does not stop the cycle", async () => {
    await db.query("insert into public.stations (source, external_id, name, lat, lon) values ('ndbc', 'ZZZZ9', 'No such buoy', 43, -86.4)");
    try {
      const summary = await refresh("autumn", "2026-10-14T14:00:00Z");
      expect(summary.errors).toEqual([expect.stringMatching(/^NDBC ZZZZ9: No fixture/)]);
      expect(summary.stations.find((s) => s.id === "45161")!.readings).toBeGreaterThan(30);
    } finally {
      await db.query("delete from public.stations where external_id = 'ZZZZ9'");
    }
  });

  it("rejects a port that is not in the list", async () => {
    await expect(recommend({ port: "Atlantis", date: "2026-07-15" }, { db, now: new Date() })).rejects.toThrow(/Unknown port/);
  });
});

describe.skipIf(!url)("explanations through the database", () => {
  let db: pg.Client;
  const now = new Date("2026-08-10T14:00:00Z");
  const input = { port: "Muskegon", date: "2026-08-10", time_of_day: "day" as const, answers: { clarity: "clear" as const, sky: "bright" as const, wind: "breezy" as const, mode: "offshore" as const } };
  const agentWords = {
    conditions_summary: "In August, Chinook are offshore and some begin to stage near river mouths.",
    groups: [
      { lure_type: "flasher_fly", reasons: [{ text: "At this depth, flasher and fly leads the spread.", rule_codes: ["P02"] }] },
      { lure_type: "meat_rig", reasons: [{ text: "Meat rigs go on the deepest lines once the sun is well up.", rule_codes: ["P06"] }] },
    ],
    report_notes: [], confidence_reason: "There is no live water data, so the depth is a month default.", caveats: [],
  };

  beforeAll(async () => { db = new pg.Client({ connectionString: url }); await db.connect(); });
  afterAll(async () => { await db.query("truncate public.recommendations cascade"); await db.end(); });
  beforeEach(async () => { await db.query("truncate public.observations, public.forecasts, public.recommendations cascade"); });

  it("shows templated reasons at once, then stores and reuses the agent's explanation for 30 minutes", async () => {
    const { explainRecommendation } = await import("../src/server/recommend");
    const rec = await recommend(input, { db, now });
    expect(rec.explanation.source).toBe("template");
    expect(rec.explanation.groups.map((g) => g.lure_type)).toEqual(["flasher_fly", "meat_rig"]);

    let calls = 0;
    const call = async () => { calls++; return agentWords; };
    const first = await explainRecommendation({ ...input, recommendation_id: rec.recommendation_id! }, { db, now, call, model: "test-model" });
    expect(first).toMatchObject({ cached: false, attempts: 1 });
    expect(first.explanation).toMatchObject({ source: "agent", model: "test-model" });
    const row = (await db.query("select used_fallback, model, prompt_version, latency_ms, agent_output from public.recommendations where id = $1", [rec.recommendation_id])).rows[0];
    expect(row).toMatchObject({ used_fallback: false, model: "test-model" });
    expect(row.prompt_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(row.agent_output.source).toBe("agent");

    const again = await explainRecommendation(input, { db, now: new Date(now.getTime() + 20 * 60_000), call, model: "test-model" });
    expect(again.cached).toBe(true);
    expect(calls).toBe(1);
    const later = await explainRecommendation(input, { db, now: new Date(now.getTime() + 61 * 60_000), call, model: "test-model" });
    expect(later.cached).toBe(false);
    expect(calls).toBe(2);
  });

  it("with the API key gone it still returns a usable result, and records the fallback", async () => {
    const { explainRecommendation } = await import("../src/server/recommend");
    const rec = await recommend(input, { db, now });
    const dead = async () => { throw new Error("401 invalid x-api-key"); };
    const r = await explainRecommendation({ ...input, recommendation_id: rec.recommendation_id! }, { db, now, call: dead, model: "test-model" });
    expect(r.explanation.source).toBe("template");
    expect(r.explanation.groups.every((g) => g.reasons.length > 0)).toBe(true);
    const row = (await db.query("select used_fallback, agent_output from public.recommendations where id = $1", [rec.recommendation_id])).rows[0];
    expect(row).toEqual({ used_fallback: true, agent_output: null });
    // No key configured at all: no call is attempted.
    const none = await explainRecommendation(input, { db, now, call: null, model: null });
    expect(none).toMatchObject({ attempts: 0, cached: false });
  });

  it("asks about clarity only when it would change the spread", async () => {
    const asked = await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "day", answers: { sky: "bright", wind: "breezy", mode: "offshore" } }, { db, now });
    expect(asked.questions).toContain("clarity");
    // A catalog where every answer gives the same spread: one glow finish per lure.
    await db.query("begin");
    try {
      await db.query("delete from public.lure_finishes where name <> 'Green glow'");
      const same = await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "day", answers: { sky: "bright", wind: "breezy", mode: "offshore" } }, { db, now });
      expect(same.questions).not.toContain("clarity");
      expect(same.status).toBe("ok");
    } finally {
      await db.query("rollback");
    }
  });
});
