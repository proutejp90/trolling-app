/**
 * Builds a recommendation: conditions from the cache, then the rules engine.
 * The agent joins in Phase 3; everything here works without it.
 */
import { z } from "zod";
import { evaluate, type EngineContext, type EngineResult } from "@recommender/engine";
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
}

export class UnknownPortError extends Error {}

export async function recommend(raw: RecommendInput, deps: { db: Queryable | null; now: Date }): Promise<Recommendation> {
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
  const sky = a.sky ?? conditions.sky ?? undefined;
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

  const questions: QuestionField[] = [];
  if (engine.status !== "out_of_season") {
    if (!input.time_of_day) questions.push("time_of_day");
    if (!a.clarity) questions.push("clarity");
    if (!sky && input.time_of_day) questions.push("sky");
    if (windCalm === undefined && input.time_of_day) questions.push("wind");
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
  if (deps.db && port.id && status === "ok") {
    const { rows } = await deps.db.query(
      `insert into public.recommendations (port_id, requested_for, context, engine_output, temp_source_level, confidence, used_fallback)
       values ($1, $2, $3, $4, $5, $6, true) returning id`,
      [port.id, input.date, JSON.stringify({ input, context, conditions: { ...conditions, readings: undefined } }), JSON.stringify(engine), level, confidence],
    );
    recommendation_id = rows[0].id;
  }

  return {
    status, questions, engine, conditions, temp_source_level: level,
    sources: {
      sky: a.sky ? "you" : conditions.sky === "low_light" ? "time of day" : conditions.sky ? "forecast" : null,
      wind: a.wind ? "you" : conditions.wind_calm !== null ? "forecast" : null,
      depth: engine.depth_source === "angler" ? "the lure depth you gave" : engine.depth_source === "R05" ? (level === 1 ? `the ${conditions.temp_station?.name} temperature profile` : "the break depth you gave") : engine.depth_source ? "month defaults" : "nothing yet",
    },
    confidence, confidence_reason, ruleset_source: ruleset.source, recommendation_id,
  };
}
