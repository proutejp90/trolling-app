/**
 * Builds a recommendation: conditions from the cache, then the rules engine.
 * The agent joins in Phase 3; everything here works without it.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { evaluate, type EngineContext, type EngineResult } from "@recommender/engine";
import { agentConfigured, agentModel, callModel } from "./agent/client";
import { explain, type ModelCall } from "./agent/explain";
import type { Explanation } from "./agent/schema";
import { templateExplanation } from "./agent/template";
import { buildConditions, loadConditions, type Conditions, type DataSource, type DayKind, type TimeOfDay } from "./conditions";
import { confidenceFor } from "./confidence";
import type { Queryable } from "./db";
import { bundledRuleset, loadRuleset, type Ruleset } from "./ruleset";

export const recommendInput = z.object({
  port: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Today is always "now". Any other day takes one of the four windows and defaults to first light. */
  time_window: z.enum(["now", "first_light", "morning", "midday", "evening"]).optional(),
  /** The first quiz's windows. Still accepted. */
  time_of_day: z.enum(["before_sunrise", "early", "day", "after_sunset"]).optional(),
  /** Answers the device remembered from an earlier visit, so they are labeled "Your last answer". */
  remembered: z.array(z.enum(["clarity", "lines"])).max(2).optional(),
  /** When the remembered clarity answer was given. Past the age limit the server ignores it and asks again. */
  clarity_answered_at: z.string().datetime().optional(),
  answers: z.object({
    clarity: z.enum(["clear", "stained", "murky", "unknown"]).optional(),
    sky: z.enum(["bright", "overcast", "low_light"]).optional(),
    wind: z.enum(["calm", "breezy"]).optional(),
    mode: z.enum(["offshore", "staging"]).optional(),
    break_depth_ft: z.number().min(0).max(400).optional(),
    lure_depth_ft: z.number().min(0).max(400).optional(),
    lines: z.number().int().min(1).max(12).optional(),
    /** The water the angler fishes: the near, mid or offshore sample point. */
    water_point: z.enum(["near", "mid", "off"]).optional(),
  }).strict().default({}),
}).strict();
export type RecommendInput = z.input<typeof recommendInput>;

export type QuestionField = "clarity" | "sky" | "wind" | "mode" | "depth";

/** One condition as the Quick questions screen shows it: the value in use, where it came from, and what the data said. */
export interface Prefilled {
  field: "time_window" | "sky" | "wind" | "clarity" | "mode" | "lines" | "depth" | "water_point";
  value: string | number | null;
  source: DataSource | "Your answer" | "Your last answer" | null;
  /** What the data gave before any answer. Null when no source has this value. */
  data_value: string | number | null;
  data_source: DataSource | null;
}

export interface Recommendation {
  status: "ok" | "needs_input" | "out_of_season";
  /** Only the questions the data could not answer. */
  questions: QuestionField[];
  engine: EngineResult;
  conditions: Conditions;
  /** 0 to 5: where the depth came from, after the angler's answers are counted. */
  temp_source_level: number | "1m";
  /** Where each input came from, for the result screen. */
  /** Which day this is and what kind of data it has. */
  day: { is_today: boolean; kind: DayKind; time_window: TimeOfDay | null; days_to_trip: number; updated_at: string | null };
  /** Every condition in use, with its source. */
  prefilled: Prefilled[];
  sources: { sky: "forecast" | "you" | "time of day" | null; wind: "forecast" | "buoy" | "you" | null; depth: string; depth_kind: "buoy" | "model" | "break" | "lure" | "default" | null };
  /** The values the engine ran on, for the chips on the result screen. */
  inputs: { sky: "bright" | "overcast" | "low_light" | null; wind_calm: boolean | null; clarity: "clear" | "stained" | "murky" | "unknown" | null };
  /** What the catalog says about each finish in the spread, by finish id. */
  traits: Record<string, { glow: boolean; uv: boolean; house_brand: boolean }>;
  confidence: "low" | "medium" | "high";
  confidence_reason: string;
  ruleset_source: Ruleset["source"];
  recommendation_id: string | null;
  /** Reasons and summary. Templated here; POST /api/explain swaps in the agent's version. */
  explanation: Explanation;
  /** True when an agent explanation can be requested for this result. */
  agent_available: boolean;
}

/** Same port, date, hour and answers give the same key, so an explanation is reused for 30 minutes. */
export function cacheKey(input: RecommendInput, now: Date): string {
  const a = input.answers ?? {};
  const answers = Object.fromEntries(Object.entries(a).sort(([x], [y]) => x.localeCompare(y)));
  return createHash("sha256").update(JSON.stringify([input.port.toLowerCase(), input.date, input.time_window ?? input.time_of_day ?? null, answers, now.toISOString().slice(0, 13)])).digest("hex").slice(0, 32);
}

export class UnknownPortError extends Error {}

export async function recommend(raw: RecommendInput, deps: { db: Queryable | null; now: Date; store?: boolean }): Promise<Recommendation> {
  const input = recommendInput.parse(raw);
  const ruleset = deps.db ? await loadRuleset(deps.db) : bundledRuleset();
  const port = ruleset.ports.find((p) => p.id === input.port || p.name.toLowerCase() === input.port.toLowerCase());
  if (!port) throw new UnknownPortError(`Unknown port: ${input.port}`);
  const a = { ...input.answers };
  const month = Number(input.date.slice(5, 7));
  // A remembered clarity answer is offered again only while it is recent. Water clears and muddies in days.
  if (a.clarity && input.remembered?.includes("clarity")) {
    const maxDays = Number(ruleset.thresholds.find((t) => t.name === "clarity_answer_max_age_days")?.value ?? 3);
    const age = input.clarity_answered_at ? (deps.now.getTime() - new Date(input.clarity_answered_at).getTime()) / 86_400_000 : Infinity;
    if (age > maxDays) delete a.clarity;
  }

  // The time is never asked: today is now, and any other day starts at first light until the angler picks a window.
  const window: TimeOfDay = input.time_window ?? input.time_of_day ?? "now";
  const conditions = deps.db && port.id
    ? await loadConditions(deps.db, port, input.date, window, deps.now, ruleset.thresholds, a.water_point)
    : buildConditions({ port, date: input.date, timeOfDay: window, now: deps.now, observations: [], forecasts: [], thresholds: ruleset.thresholds, connected: false });

  // The angler's answer always wins: they are looking at the sky and the water.
  const sky = a.sky ?? conditions.sky ?? undefined;
  const windCalm = a.wind ? a.wind === "calm" : conditions.wind_calm ?? undefined;
  // A break depth the angler gives beats the model and a surface reading, but not a buoy's measured profile.
  const useAnglerBreak = conditions.temp_source_level !== 1 && a.break_depth_ft !== undefined;
  const level = conditions.temp_source_level === 1 ? 1 : useAnglerBreak ? 4 : conditions.temp_source_level;
  const modeled = level === "1m" ? conditions.model : null;
  const modelPoint = conditions.model?.points.find((p) => p.label === conditions.model!.point) ?? null;
  // In August the water fished settles offshore or staging, when the model gives its depth. Otherwise it is asked.
  const stagingMaxFt = Number(ruleset.thresholds.find((t) => t.name === "staging_water_max_ft")?.value ?? 70);
  const modeFromWater = month === 8 && !a.mode && modelPoint ? (modelPoint.water_depth_ft <= stagingMaxFt ? "staging" as const : "offshore" as const) : undefined;

  const context: EngineContext = {
    date: input.date, shore: port.shore, temp_source_level: level as EngineContext["temp_source_level"],
    ...(conditions.temp_profile && !useAnglerBreak ? { temp_profile: conditions.temp_profile } : {}),
    ...(modeled && modelPoint ? { profile_resolution_ft: modelPoint.layer_ft } : {}),
    // The model shows an upwelling directly. The wind rule is the fallback when it has nothing to compare.
    ...(modeled && modeled.upwelling !== null ? { upwelling_likely: modeled.upwelling } : {}),
    ...(useAnglerBreak ? { break_depth_ft: a.break_depth_ft } : {}),
    ...(a.lure_depth_ft !== undefined ? { lure_depth_ft: a.lure_depth_ft } : {}),
    ...(conditions.wind_history.length ? { wind_history: conditions.wind_history } : {}),
    ...(sky ? { sky } : {}), ...(windCalm !== undefined ? { wind_calm: windCalm } : {}),
    ...(a.clarity ? { clarity: a.clarity } : {}),
    ...(conditions.light_period ? { light_period: conditions.light_period } : {}),
    ...(conditions.hours_after_sunrise !== null ? { hours_after_sunrise: conditions.hours_after_sunrise } : {}),
    ...(a.mode && month === 8 ? { mode: a.mode } : modeFromWater ? { mode: modeFromWater } : {}),
    ...(a.lines ? { lines_available: a.lines } : {}),
  };
  const engine = evaluate(context, ruleset.rules, ruleset.thresholds, ruleset.catalog);

  // Clarity is asked only when it would change the spread: the engine is run once per answer and compared.
  const spreadOf = (e: EngineResult) => JSON.stringify(e.setups.map((x) => [x.lure_id, x.finish_id, x.attractor_finish_id]));
  const clarityMatters = !a.clarity && engine.status === "ok" &&
    new Set((["clear", "stained", "murky", "unknown"] as const).map((clarity) => spreadOf(evaluate({ ...context, clarity }, ruleset.rules, ruleset.thresholds, ruleset.catalog)))).size > 1;

  const questions: QuestionField[] = [];
  if (engine.status !== "out_of_season") {
    if (!a.clarity && (clarityMatters || engine.status !== "ok")) questions.push("clarity");
    // Asked only when no source supplied them.
    if (!sky) questions.push("sky");
    if (windCalm === undefined) questions.push("wind");
    if (month === 8 && !a.mode && !modeFromWater) questions.push("mode");
    if (engine.status === "needs_input") questions.push("depth");
  }
  const status = engine.status === "out_of_season" ? "out_of_season" : questions.length ? "needs_input" : "ok";

  // Confidence is computed here, in code. The agent only ever writes the reason.
  const ageHours = conditions.age_minutes === null ? null : conditions.age_minutes / 60;
  const threshold = (name: string, fallback: number) => Number(ruleset.thresholds.find((t) => t.name === name)?.value ?? fallback);
  const freshHours = threshold("obs_fresh_hours", 3), staleHours = threshold("obs_stale_hours", 6);
  // A lure depth the angler typed is their answer, level 4 on the ladder, whatever the buoys say.
  const confidenceLevel = engine.depth_source === "angler" ? 4 : (level as 1 | "1m" | 2 | 4 | 5);
  // Reports arrive in Phase 4 and the angler's log in Phase 5b, so nothing raises or lowers a step for agreement yet.
  const confidence = confidenceFor({ level: confidenceLevel, ageHours, freshHours, staleHours, dayKind: conditions.day_kind, evidence: null });
  const old = ageHours !== null && ageHours > freshHours ? `, read ${Math.round(ageHours)} hours ago` : "";
  const confidence_reason =
    engine.depth_source === "angler" ? "Depth is the lure depth you gave, not a measurement."
    : level === 4 ? `Depth comes from the break depth you gave. ${conditions.messages[0] ?? ""}`.trim()
    : level === 5 ? conditions.messages[0] ?? "Results use month defaults."
    : level === "1m" ? (conditions.model!.is_forecast ? "Depth comes from NOAA's lake model forecast for this time. It is modeled, not measured." : `Depth comes from NOAA's lake model, run ${Math.round(conditions.model!.age_hours)} hours ago. It is modeled, not measured.`)
    : level === 1 ? `Depth comes from a buoy's temperature profile${old}.${confidence === "high" ? "" : " No recent fishing report to check it against."}`
    : `A buoy gives the surface temperature only${old}. No recent fishing report to check it against.`;

  // Every condition in use, with where it came from. An answer that differs from the data is an override.
  const windValue = windCalm === undefined ? null : windCalm ? "calm" : "breezy";
  const dataWind = conditions.wind_calm === null ? null : conditions.wind_calm ? "calm" : "breezy";
  const remembered = (f: "clarity" | "lines") => (input.remembered?.includes(f) ? "Your last answer" as const : "Your answer" as const);
  const answered = <T,>(answer: T | undefined, data: T | null, dataSource: DataSource | null) => (answer !== undefined && answer !== data ? "Your answer" as const : dataSource);
  const depthKind = engine.depth_source === "angler" ? "lure" : engine.depth_source === "R05" ? (level === 1 ? "buoy" : level === "1m" ? "model" : "break") : engine.depth_source ? "default" : null;
  const defaultLines = threshold("lines_default", 4);
  const prefilled: Prefilled[] = [
    { field: "time_window", value: conditions.time_window, source: input.time_window && input.time_window !== "now" ? "Your answer" : "Default", data_value: conditions.is_today ? "now" : "first_light", data_source: "Default" },
    { field: "sky", value: sky ?? null, source: answered(a.sky, conditions.sky ?? null, conditions.sky_source), data_value: conditions.sky ?? null, data_source: conditions.sky_source },
    { field: "wind", value: windValue, source: answered(a.wind, dataWind, conditions.wind_source), data_value: dataWind, data_source: conditions.wind_source },
    { field: "clarity", value: a.clarity ?? null, source: a.clarity ? remembered("clarity") : null, data_value: null, data_source: null },
    ...(engine.mode ? [{ field: "mode" as const, value: engine.mode, source: a.mode && month === 8 ? "Your answer" as const : "Default" as const, data_value: month === 8 ? null : engine.mode, data_source: month === 8 ? null : "Default" as const }] : []),
    { field: "lines", value: a.lines ?? defaultLines, source: a.lines && a.lines !== defaultLines ? remembered("lines") : "Default", data_value: defaultLines, data_source: "Default" },
    { field: "depth", value: engine.depth_ft ? `${engine.depth_ft.min} to ${engine.depth_ft.max} ft down` : null, source: depthKind === "buoy" ? "Measured" : depthKind === "model" ? "Modeled" : depthKind === "default" ? "Default" : depthKind ? "Your answer" : null, data_value: null, data_source: null },
    // The water fished: one of the model's three sample points. Shown only when the model has them.
    ...(conditions.model ? [{ field: "water_point" as const, value: conditions.model.point, source: a.water_point && a.water_point !== "mid" ? "Your answer" as const : "Default" as const, data_value: "mid", data_source: "Default" as const }] : []),
  ];
  const overrides = prefilled.filter((p) => p.source === "Your answer" && p.data_value !== null && p.data_value !== p.value)
    .map((p) => ({ field: p.field, answer: p.value, replaced: p.data_value, replaced_source: p.data_source }));
  const updated = [conditions.observations_at, conditions.forecast_panel.fetched_at].filter((t): t is string => Boolean(t)).sort().at(-1) ?? null;

  let recommendation_id: string | null = null;
  if (deps.db && port.id && status === "ok" && deps.store !== false) {
    const { rows } = await deps.db.query(
      `insert into public.recommendations (port_id, requested_for, cache_key, context, engine_output, temp_source_level, confidence, used_fallback)
       values ($1, $2, $3, $4, $5, $6, $7, true) returning id`,
      [port.id, input.date, cacheKey(input, deps.now), JSON.stringify({ input, context, overrides, conditions: { ...conditions, readings: undefined } }), JSON.stringify(engine), String(level), confidence],
    );
    recommendation_id = rows[0].id;
  }

  return {
    status, questions, engine, conditions, temp_source_level: level,
    day: { is_today: conditions.is_today, kind: conditions.day_kind, time_window: conditions.time_window, days_to_trip: conditions.days_to_trip, updated_at: updated },
    prefilled,
    sources: {
      sky: a.sky ? "you" : conditions.sky === "low_light" ? "time of day" : conditions.sky ? "forecast" : null,
      wind: a.wind ? "you" : conditions.wind_source === "Measured" ? "buoy" : conditions.wind_calm !== null ? "forecast" : null,
      depth_kind: depthKind,
      depth: engine.depth_source === "angler" ? "the lure depth you gave" : engine.depth_source === "R05" ? (level === 1 ? `the ${conditions.temp_station?.name} temperature profile` : level === "1m" ? "NOAA's lake model" : "the break depth you gave") : engine.depth_source ? "month defaults" : "nothing yet",
    },
    inputs: { sky: sky ?? null, wind_calm: windCalm ?? null, clarity: a.clarity ?? null },
    traits: Object.fromEntries(engine.setups.map((x) => {
      const lure = ruleset.catalog.lures.find((l) => l.id === x.lure_id), finish = lure?.finishes.find((f) => f.id === x.finish_id);
      return [x.finish_id, { glow: Boolean(finish?.finish_types.includes("glow")), uv: Boolean(finish?.finish_types.includes("uv")), house_brand: Boolean(lure?.is_house_brand) }];
    })),
    confidence, confidence_reason, ruleset_source: ruleset.source, recommendation_id,
    explanation: templateExplanation(engine, conditions, confidence_reason),
    agent_available: status === "ok" && engine.setups.length > 0 && agentConfigured(),
  };
}

const explainInput = recommendInput.extend({ recommendation_id: z.string().uuid().optional() });
export { explainInput };

/**
 * The agent's explanation for a recommendation. The recommendation is rebuilt
 * here from the same inputs: nothing the browser sends is trusted as engine output.
 * Always answers: with the agent's words when they pass the checks, else the templates.
 */
export async function explainRecommendation(
  raw: z.input<typeof explainInput>,
  deps: { db: Queryable | null; now: Date; call?: ModelCall | null; model?: string | null },
): Promise<{ explanation: Explanation; cached: boolean; attempts: number; rejections: string[][] }> {
  const { recommendation_id, ...input } = explainInput.parse(raw);
  const rec = await recommend(input, { db: deps.db, now: deps.now, store: false });
  const call = deps.call === undefined ? (agentConfigured() ? callModel : null) : deps.call;
  const model = deps.model === undefined ? (agentConfigured() ? agentModel() : null) : deps.model;
  if (rec.status !== "ok" || !call) return { explanation: rec.explanation, cached: false, attempts: 0, rejections: [] };

  const key = cacheKey(input, deps.now);
  if (deps.db) {
    const hit = await deps.db.query(
      `select agent_output from public.recommendations
       where cache_key = $1 and agent_output is not null and not used_fallback and created_at > $2
       order by created_at desc limit 1`,
      [key, new Date(deps.now.getTime() - 30 * 60_000)],
    );
    if (hit.rows[0]) return { explanation: hit.rows[0].agent_output as Explanation, cached: true, attempts: 0, rejections: [] };
  }

  const result = await explain(
    { port: rec.conditions.port.name, date: input.date, engine: rec.engine, conditions: rec.conditions, confidence: rec.confidence, confidenceReason: rec.confidence_reason, depthSource: rec.sources.depth, reports: [] },
    { call, model },
  );
  const fromAgent = result.explanation.source === "agent";
  if (deps.db && recommendation_id) {
    await deps.db.query(
      `update public.recommendations
       set agent_output = $2, used_fallback = $3, model = $4, prompt_version = $5, latency_ms = $6
       where id = $1 and cache_key = $7`,
      [recommendation_id, fromAgent ? JSON.stringify(result.explanation) : null, !fromAgent, model, result.explanation.prompt_version, result.latency_ms, key],
    );
  }
  // Why answers were rejected is returned for diagnosis. It holds check messages only, never the model's text.
  return { explanation: result.explanation, cached: false, attempts: result.attempts, rejections: result.rejections };
}
