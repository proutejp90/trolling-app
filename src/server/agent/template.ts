/** Templated explanation: used first on every result, and whenever the agent is unavailable or fails a check. */
import type { EngineResult, SetupLureType, Tag } from "@recommender/engine";
import { REASONS, SPEED_CAVEAT, TYPE_SPEED_REASON } from "@/lib/reasons";
import type { Conditions } from "../conditions";
import type { Explanation, Reason } from "./schema";

export const groupsOf = (engine: EngineResult): SetupLureType[] => [...new Set(engine.setups.map((s) => s.lure_type))];
export const codesFor = (engine: EngineResult, type: SetupLureType): string[] =>
  [...new Set(engine.setups.filter((s) => s.lure_type === type).flatMap((s) => s.rule_codes))];
export const tagsOf = (engine: EngineResult, code: string): Tag[] => engine.fired.find((f) => f.code === code)?.tags ?? ["lore"];

/** The speed reason for types whose speed comes from a threshold, not a rule. Always written by the server. */
export const speedReason = (type: SetupLureType): Reason | null =>
  type === "plug" ? null : { text: TYPE_SPEED_REASON[type].text, rule_codes: [], tags: TYPE_SPEED_REASON[type].tags };

export function conditionsSummary(engine: EngineResult, conditions: Conditions): string {
  const location = REASONS[engine.fired.find((f) => f.stage === "location")?.code ?? ""] ?? "";
  const water = conditions.temp_station
    ? `${conditions.temp_station.name} read ${conditions.water_temp_surface_f} °F at the surface.`
    : conditions.messages[0] ?? "";
  return `${location} ${water}`.trim();
}

export function templateExplanation(engine: EngineResult, conditions: Conditions, confidenceReason: string): Explanation {
  return {
    source: "template", prompt_version: null, model: null,
    conditions_summary: conditionsSummary(engine, conditions),
    groups: groupsOf(engine).map((type) => {
      const speed = speedReason(type);
      return {
        lure_type: type,
        reasons: [
          ...codesFor(engine, type).filter((c) => REASONS[c]).map((c) => ({ text: REASONS[c]!, rule_codes: [c], tags: tagsOf(engine, c) })),
          ...(speed ? [speed] : []),
        ],
      };
    }),
    report_notes: [],
    confidence_reason: confidenceReason,
    caveats: [SPEED_CAVEAT],
  };
}
