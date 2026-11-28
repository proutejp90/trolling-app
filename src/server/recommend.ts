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
import { buildConditions, loadConditions, type Conditions } from "./conditions";
import type { Queryable } from "./db";
import { bundledRuleset, loadRuleset, type Ruleset } from "./ruleset";

export const recommendInput = z.object({
  port: z.string().min(1).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time_of_day: z.enum(["before_sunrise", "early", "day", "after_sunset"]).optional(),
  answers: z.object({
    clarity: z.enum(["clear", "stained", "murky", "unknown"]).optional(),
    sky: z.enum(["bright", "overcast", "low_light"]).optional(),
    wind: z.enum(["calm", "breezy"]).optional(),
    mode: z.enum(["offshore", "staging"]).optional(),
    break_depth_ft: z.number().min(0).max(400).optional(),
    lure_depth_ft: z.number().min(0).max(400).optional(),
    lines: z.number().int().min(1).max(12).optional(),
  }).strict().default({}),
}).strict();
export type RecommendInput = z.input<typeof recommendInput>;

export type QuestionField = "time_of_day" | "clarity" | "sky" | "wind" | "mode" | "depth";

export interface Recommendation {
  status: "ok" | "needs_input" | "out_of_season";
  /** Only the questions the data could not answer. */
  questions: QuestionField[];
  engine: EngineResult;
  conditions: Conditions;
  /** 0 to 5: where the depth came from, after the angler's answers are counted. */
  temp_source_level: number;
  /** Where each input came from, for the result screen. */
  sources: { sky: "forecast" | "you" | "time of day" | null; wind: "forecast" | "you" | null; depth: string };
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
  return createHash("sha256").update(JSON.stringify([input.port.toLowerCase(), input.date, input.time_of_day ?? null, answers, now.toISOString().slice(0, 13)])).digest("hex").slice(0, 32);
}

export class UnknownPortError extends Error {}

export async function recommend(raw: RecommendInput, deps: { db: Queryable | null; now: Date; store?: boolean }): Promise<Recommendation> {
  const input = recommendInput.parse(raw);
  const ruleset = deps.db ? await loadRuleset(deps.db) : bundledRuleset();
  const port = ruleset.ports.find((p) => p.id === input.port || p.name.toLowerCase() === input.port.toLowerCase());
  if (!port) throw new UnknownPortError(`Unknown port: ${input.port}`);
  const a = input.answers;
  const month = Number(input.date.slice(5, 7));

  const conditions = deps.db && port.id
    ? await loadConditions(deps.db, port, input.date, input.time_of_day ?? null, deps.now, ruleset.thresholds)
    : buildConditions({ port, date: input.date, timeOfDay: input.time_of_day ?? null, now: deps.now, observations: [], forecasts: [], thresholds: ruleset.thresholds, connected: false });

  // The angler's answer beats the forecast: they are looking at the sky.
  // The one exception is the dark: before sunrise and after sunset the light is low whatever was answered.
  const dark = conditions.light_period === "before_sunrise" || conditions.light_period === "after_sunset";
  const sky = dark ? "low_light" : a.sky ?? conditions.sky ?? undefined;
  const windCalm = a.wind ? a.wind === "calm" : conditions.wind_calm ?? undefined;
  const useAnglerBreak = conditions.temp_source_level !== 1 && a.break_depth_ft !== undefined;
  const level = conditions.temp_source_level === 1 ? 1 : useAnglerBreak ? 4 : conditions.temp_source_level;

  const context: EngineContext = {
    date: input.date, shore: port.shore, temp_source_level: level as EngineContext["temp_source_level"],
    ...(conditions.temp_profile ? { temp_profile: conditions.temp_profile } : {}),
    ...(useAnglerBreak ? { break_depth_ft: a.break_depth_ft } : {}),
    ...(a.lure_depth_ft !== undefined ? { lure_depth_ft: a.lure_depth_ft } : {}),
    ...(conditions.wind_history.length ? { wind_history: conditions.wind_history } : {}),
    ...(sky ? { sky } : {}), ...(windCalm !== undefined ? { wind_calm: windCalm } : {}),
    ...(a.clarity ? { clarity: a.clarity } : {}),
    ...(conditions.light_period ? { light_period: conditions.light_period } : {}),
    ...(conditions.hours_after_sunrise !== null ? { hours_after_sunrise: conditions.hours_after_sunrise } : {}),
    ...(a.mode && month === 8 ? { mode: a.mode } : {}),
    ...(a.lines ? { lines_available: a.lines } : {}),
  };
  const engine = evaluate(context, ruleset.rules, ruleset.thresholds, ruleset.catalog);

  // Clarity is asked only when it would change the spread: the engine is run once per answer and compared.
  const spreadOf = (e: EngineResult) => JSON.stringify(e.setups.map((x) => [x.lure_id, x.finish_id, x.attractor_finish_id]));
  const clarityMatters = !a.clarity && engine.status === "ok" &&
    new Set((["clear", "stained", "murky", "unknown"] as const).map((clarity) => spreadOf(evaluate({ ...context, clarity }, ruleset.rules, ruleset.thresholds, ruleset.catalog)))).size > 1;

  const questions: QuestionField[] = [];
  if (engine.status !== "out_of_season") {
    if (!input.time_of_day) questions.push("time_of_day");
    if (!a.clarity && (clarityMatters || engine.status !== "ok")) questions.push("clarity");
    // With a forecast for part of the date, sky and wind wait for the time: the forecast may answer them.
    // With none, they are asked at once, so nothing is added to the form after the angler starts tapping.
    const knowWhetherToAsk = Boolean(input.time_of_day) || !conditions.forecast_covers_date;
    if (!sky && knowWhetherToAsk) questions.push("sky");
    if (windCalm === undefined && knowWhetherToAsk) questions.push("wind");
    if (month === 8 && !a.mode) questions.push("mode");
    if (engine.status === "needs_input") questions.push("depth");
  }
  const status = engine.status === "out_of_season" ? "out_of_season" : questions.length ? "needs_input" : "ok";

  // Confidence is computed here, in code. The agent only ever writes the reason.
  const ageHours = conditions.age_minutes === null ? null : conditions.age_minutes / 60;
  const freshHours = Number(ruleset.thresholds.find((t) => t.name === "obs_fresh_hours")?.value ?? 3);
  let confidence: Recommendation["confidence"], confidence_reason: string;
  if (engine.depth_source === "angler") {
    confidence = "low"; confidence_reason = "Depth is the lure depth you gave, not a measurement.";
  } else if (level >= 4) {
    confidence = "low";
    confidence_reason = level === 4 ? `Depth comes from the break depth you gave. ${conditions.messages[0] ?? ""}`.trim() : conditions.messages[0] ?? "Results use month defaults.";
  } else {
    // High also needs an agreeing fishing report from the last 21 days. Reports arrive in Phase 4.
    confidence = "medium";
    confidence_reason = `${level === 1 ? "Depth comes from a buoy's temperature profile" : "A buoy gives the surface temperature only"}${ageHours !== null && ageHours > freshHours ? `, read ${Math.round(ageHours)} hours ago` : ""}. No recent fishing report to check it against.`;
  }

  let recommendation_id: string | null = null;
  if (deps.db && port.id && status === "ok" && deps.store !== false) {
    const { rows } = await deps.db.query(
      `insert into public.recommendations (port_id, requested_for, cache_key, context, engine_output, temp_source_level, confidence, used_fallback)
       values ($1, $2, $3, $4, $5, $6, $7, true) returning id`,
      [port.id, input.date, cacheKey(input, deps.now), JSON.stringify({ input, context, conditions: { ...conditions, readings: undefined } }), JSON.stringify(engine), level, confidence],
    );
    recommendation_id = rows[0].id;
  }

  return {
    status, questions, engine, conditions, temp_source_level: level,
    sources: {
      sky: dark ? "time of day" : a.sky ? "you" : conditions.sky === "low_light" ? "time of day" : conditions.sky ? "forecast" : null,
      wind: a.wind ? "you" : conditions.wind_calm !== null ? "forecast" : null,
      depth: engine.depth_source === "angler" ? "the lure depth you gave" : engine.depth_source === "R05" ? (level === 1 ? `the ${conditions.temp_station?.name} temperature profile` : "the break depth you gave") : engine.depth_source ? "month defaults" : "nothing yet",
    },
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
