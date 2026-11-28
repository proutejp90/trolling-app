/**
 * Phase 2 acceptance, against Postgres and the recorded fixtures: the refresh job
 * fills the cache, and a recommendation is built from the cache alone.
 * Skipped without DATABASE_URL. No test here reaches the network.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stations } from "../seed/stations";
import { buildFacts } from "../src/server/agent/prompt";
import { loadConditions } from "../src/server/conditions";
import { refreshAlerts, refreshConditions, storeReadings } from "../src/server/jobs/refresh";
import { recommend } from "../src/server/recommend";
import { loadRuleset } from "../src/server/ruleset";
import { parseSeagullObs } from "../src/server/sources/seagull";
import { hourly } from "../src/server/sources/types";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("live conditions from the cache", () => {
  let db: pg.Client;
  const clear = () => db.query("truncate public.observations, public.forecasts, public.marine_forecasts, public.recommendations cascade");
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
    expect(r).toMatchObject({ status: "ok", temp_source_level: 1, confidence: "high" }); // a buoy profile read minutes ago
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
    expect(r.confidence_reason).toBe("Depth comes from a buoy's temperature profile.");
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
    // Today at the port, towards evening: the forecast covers it, and wind history applies to today only.
    const c = await loadConditions(db, port, "2026-11-27", "evening", new Date(now), ruleset.thresholds);
    expect(c.forecast).not.toBeNull();
    expect(c).toMatchObject({ sky: "low_light", sky_source: "Forecast", is_today: true });
    expect(typeof c.wind_calm).toBe("boolean");
    expect(["Measured", "Forecast"]).toContain(c.wind_source);
    expect(c.wind_station).not.toBeNull(); // an airport or shore station, since the buoy's wind sensor is gone
    // Late November is out of season: the engine says so and nothing is asked.
    const r = await recommend({ port: "Muskegon", date: "2026-11-28" }, { db, now: new Date(now) });
    expect(r).toMatchObject({ status: "out_of_season", questions: [] });
  });

  it("forecast panel: stores the zone, the marine text and the alert, and shows them for today only", async () => {
    // The alert and marine forecast were recorded on the 28th, so the clock sits inside the alert's period.
    const now = new Date("2026-11-28T17:00:00Z");
    const summary = await refresh("november", now.toISOString());
    expect(summary.errors).toEqual([]);
    const zones = (await db.query("select name, marine_zone, time_zone from public.ports where active order by lat")).rows;
    expect(zones.every((z) => /^LMZ\d{3}$/.test(z.marine_zone) && z.time_zone === "America/Detroit")).toBe(true);
    expect(zones.find((z) => z.name === "Muskegon").marine_zone).toBe("LMZ847");

    const ruleset = await loadRuleset(db);
    const port = ruleset.ports.find((p) => p.name === "Muskegon")!;
    const today = (await loadConditions(db, port, "2026-11-28", "day", now, ruleset.thresholds)).forecast_panel;
    expect(today.alerts).toHaveLength(1);
    expect(today.alerts[0]!.headline).toBe("Small Craft Advisory issued November 28 at 3:30AM EST until November 28 at 7:00PM EST by NWS Grand Rapids MI");
    expect(today.alerts[0]).toMatchObject({ ends_at: "2026-11-28T19:00:00-05:00", url: "https://forecast.weather.gov/shmrn.php?mz=lmz847" });
    expect(today.marine?.text).toContain("Grand Haven to Whitehall MI-");
    expect(today.hours.length).toBeGreaterThan(12);
    expect(today.hours.some((h) => h.precip_pct !== null) && today.hours.some((h) => h.air_temp_f !== null)).toBe(true);
    expect(today).toMatchObject({ stale: false, alerts_stale: false, is_today: true });
    // Every hour shown falls on the 28th at the port.
    for (const h of today.hours) expect(new Date(h.valid_at).toLocaleDateString("en-CA", { timeZone: "America/Detroit" })).toBe("2026-11-28");

    // Tomorrow keeps the marine text and the hours but not today's alert (G38).
    const tomorrow = (await loadConditions(db, port, "2026-11-29", "day", now, ruleset.thresholds)).forecast_panel;
    expect(tomorrow.alerts).toEqual([]);
    expect(tomorrow.marine).not.toBeNull();
    // Four hours on, with no new fetch, the panel says it is stale (G31).
    const later = (await loadConditions(db, port, "2026-11-28", "day", new Date(now.getTime() + 4 * 3_600_000), ruleset.thresholds)).forecast_panel;
    expect(later).toMatchObject({ stale: true, alerts_stale: true });

    // G33 by construction: nothing about the alert or the marine forecast reaches the agent.
    const c = await loadConditions(db, port, "2026-11-28", "day", now, ruleset.thresholds);
    const rec = await recommend({ port: "Muskegon", date: "2026-07-15", time_of_day: "day", answers: { clarity: "clear", sky: "bright", wind: "breezy" } }, { db, now });
    const facts = JSON.stringify(buildFacts({ port: "Muskegon", date: "2026-11-28", engine: rec.engine, conditions: c, confidence: "low", confidenceReason: "x", depthSource: "month defaults", reports: [] }));
    expect(facts).not.toMatch(/small craft|advisory|knots|LMZ/i);
  });

  it("alerts refresh on their own between full refreshes", async () => {
    const now = new Date("2026-11-28T17:00:00Z");
    await refresh("november", now.toISOString());
    await db.query("update public.marine_forecasts set alerts = '[]', alerts_fetched_at = null");
    process.env.FIXTURES = "replay:november";
    const result = await refreshAlerts(db, new Date(now.getTime() + 15 * 60_000));
    expect(result.errors).toEqual([]);
    expect(result.zones).toBeGreaterThanOrEqual(5);
    const row = (await db.query("select m.alerts, m.forecast_text from public.marine_forecasts m join public.ports p on p.id = m.port_id where p.name = 'Muskegon'")).rows[0];
    expect(row.alerts).toHaveLength(1);
    expect(row.forecast_text).toContain("Grand Haven to Whitehall"); // the text from the full refresh is left alone
  });

  it("winter fixtures: no alert and no marine text, and the panel says nothing it does not have", async () => {
    const now = new Date("2026-04-10T14:00:00Z");
    const summary = await refresh("winter", now.toISOString());
    expect(summary.errors).toEqual([]);
    const ruleset = await loadRuleset(db);
    const panel = (await loadConditions(db, ruleset.ports.find((p) => p.name === "Muskegon")!, "2026-04-10", "day", now, ruleset.thresholds)).forecast_panel;
    expect(panel).toMatchObject({ alerts: [], marine: null, observed_waves: null });
  });

  it("asks only what the data could not answer", async () => {
    await refresh("winter", "2026-08-10T14:00:00Z");
    const now = new Date("2026-08-10T14:00:00Z");
    const first = await recommend({ port: "Muskegon", date: "2026-08-10" }, { db, now });
    // The time is never asked: today is now. No forecast and no buoy wind, so sky and wind are.
    expect(first.questions).toEqual(["clarity", "sky", "wind", "mode"]);
    expect(first.day).toMatchObject({ is_today: true, kind: "today", time_window: "now" });
    const second = await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "before_sunrise", answers: { clarity: "clear", mode: "offshore" } }, { db, now });
    expect(second.questions).toEqual(["wind"]); // before sunrise the light is low; no forecast, so wind is asked
    expect(second.sources.sky).toBe("time of day");
    // The angler's change always wins, even over the time of day, and is marked as theirs.
    const dark = await recommend({ port: "Muskegon", date: "2026-08-10", time_of_day: "before_sunrise", answers: { clarity: "clear", mode: "offshore", sky: "bright", wind: "calm" } }, { db, now });
    expect(dark.sources.sky).toBe("you");
    expect(dark.prefilled.find((p) => p.field === "sky")).toEqual({ field: "sky", value: "bright", source: "Your answer", data_value: "low_light", data_source: "Default" });
  });

  describe("day selection and prefilled conditions", () => {
    const now = new Date("2026-07-15T14:00:00Z"); // 10 a.m. at the port
    const forecastToday = async (skyPct: number, windMs: number) => {
      const port = (await db.query("select id from public.ports where name = 'Muskegon'")).rows[0].id;
      await db.query(
        `insert into public.forecasts (port_id, valid_at, fetched_at, sky_cover_pct, wind_dir_deg, wind_speed_ms)
         select $1, g, $2, $3, 200, $4 from generate_series(timestamptz '2026-07-15T04:00:00Z', timestamptz '2026-07-19T03:00:00Z', interval '1 hour') g`,
        [port, now, skyPct, windMs],
      );
    };
    const field = (r: Awaited<ReturnType<typeof recommend>>, f: string) => r.prefilled.find((p) => p.field === f);

    it("G34, G41, G44: today loads with no time chosen, sky and wind prefilled, and clarity the only question", async () => {
      await forecastToday(15, 1.5);
      const r = await recommend({ port: "Muskegon", date: "2026-07-15" }, { db, now });
      expect(r.day).toMatchObject({ is_today: true, kind: "today", time_window: "now", updated_at: now.toISOString() });
      expect(field(r, "sky")).toMatchObject({ value: "bright", source: "Forecast" });
      expect(field(r, "wind")).toMatchObject({ value: "calm", source: "Forecast" });
      expect(field(r, "lines")).toMatchObject({ value: 4, source: "Default" });
      expect(field(r, "time_window")).toMatchObject({ value: "now", source: "Default" });
      expect(r.questions).toEqual(["clarity"]);
    });

    it("G42, G43: an answer wins, is marked as the angler's, and is stored with what it replaced; without it the data returns", async () => {
      await forecastToday(15, 1.5);
      const changed = await recommend({ port: "Muskegon", date: "2026-07-15", answers: { clarity: "clear", sky: "overcast" } }, { db, now });
      expect(changed.status).toBe("ok");
      expect(field(changed, "sky")).toEqual({ field: "sky", value: "overcast", source: "Your answer", data_value: "bright", data_source: "Forecast" });
      expect(changed.inputs.sky).toBe("overcast");
      const stored = (await db.query("select context from public.recommendations where id = $1", [changed.recommendation_id])).rows[0].context;
      expect(stored.overrides).toEqual([{ field: "sky", answer: "overcast", replaced: "bright", replaced_source: "Forecast" }]);
      // Reset: the same request without the answer is the data default again.
      const reset = await recommend({ port: "Muskegon", date: "2026-07-15", answers: { clarity: "clear" } }, { db, now });
      expect(field(reset, "sky")).toMatchObject({ value: "bright", source: "Forecast" });
      expect((await db.query("select context from public.recommendations where id = $1", [reset.recommendation_id])).rows[0].context.overrides).toEqual([]);
      // An answer that matches the data is not an override.
      expect(field(await recommend({ port: "Muskegon", date: "2026-07-15", answers: { clarity: "clear", sky: "bright" } }, { db, now }), "sky")).toMatchObject({ source: "Forecast" });
    });

    it("G45: a remembered clarity answer is labeled as the angler's last answer", async () => {
      await forecastToday(15, 1.5);
      const r = await recommend({ port: "Muskegon", date: "2026-07-15", answers: { clarity: "stained", lines: 6 }, remembered: ["clarity", "lines"] }, { db, now });
      expect(field(r, "lines")).toMatchObject({ value: 6, source: "Your last answer" });
      expect(r.questions).toEqual(["clarity"]); // no date came with the clarity answer, so it cannot be trusted as recent
      expect(field(r, "clarity")).toMatchObject({ value: null, source: null });
      const at = (daysAgo: number) => recommend({ port: "Muskegon", date: "2026-07-15", answers: { clarity: "stained" }, remembered: ["clarity"], clarity_answered_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() }, { db, now });
      expect((await at(1)).questions).toEqual([]);
      expect(field(await at(1), "clarity")).toMatchObject({ value: "stained", source: "Your last answer" });
      expect((await at(3)).questions).toEqual([]); // at the limit
      expect((await at(3.1)).questions).toEqual(["clarity"]);
    });

    it("G35: three days ahead uses that day's forecast at first light, with confidence no higher than medium", async () => {
      await forecastToday(80, 6);
      const r = await recommend({ port: "Muskegon", date: "2026-07-18", answers: { clarity: "clear" } }, { db, now });
      expect(r.day).toMatchObject({ is_today: false, kind: "forecast", time_window: "first_light", days_to_trip: 3 });
      expect(field(r, "sky")).toMatchObject({ value: "low_light", source: "Forecast" }); // G46
      expect(field(r, "wind")).toMatchObject({ value: "breezy", source: "Forecast" });
      expect(["low", "medium"]).toContain(r.confidence);
      expect(r.conditions.messages[0]).toBe("Buoy readings apply to today only. Results use month defaults.");
      // A window the angler picks is theirs.
      const midday = await recommend({ port: "Muskegon", date: "2026-07-18", time_window: "midday", answers: { clarity: "clear" } }, { db, now });
      expect(field(midday, "time_window")).toMatchObject({ value: "midday", source: "Your answer", data_value: "first_light" });
      expect(field(midday, "sky")).toMatchObject({ value: "overcast", source: "Forecast" });
    });

    it("G36: eight days ahead uses month defaults, says the forecasts do not reach, and is low confidence", async () => {
      await forecastToday(15, 1.5);
      const r = await recommend({ port: "Muskegon", date: "2026-07-23", time_window: "midday", answers: { clarity: "clear", sky: "bright", wind: "calm" } }, { db, now });
      expect(r.day).toMatchObject({ kind: "beyond", days_to_trip: 8 });
      expect(r.conditions.messages[0]).toBe("Forecasts do not reach 8 days ahead. Results use month defaults.");
      expect(r).toMatchObject({ status: "ok", confidence: "low", temp_source_level: 5 });
    });

    it("G47: with no forecast in daylight, sky is asked and nothing is shown as measured", async () => {
      const r = await recommend({ port: "Muskegon", date: "2026-07-15", answers: { clarity: "clear" } }, { db, now });
      expect(r.questions).toEqual(["sky", "wind"]);
      expect(r.prefilled.filter((p) => p.source === "Measured")).toEqual([]);
      expect(field(r, "sky")).toMatchObject({ value: null, source: null });
    });
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
