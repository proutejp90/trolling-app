import type { Catalog, CatalogLure, EngineContext, Rule, Threshold } from "../src";
import { lures as seedLures } from "../../../seed/lures";
import { rules as seedRules } from "../../../seed/rules";
import { thresholds as seedThresholds } from "../../../seed/thresholds";

export const rules: Rule[] = seedRules;
export const thresholds: Threshold[] = seedThresholds;

export function catalogFromSeed(): Catalog {
  return {
    lures: seedLures.map((l): CatalogLure => {
      const id = `${l.lure_type}:${l.name}`;
      return {
        id, lure_type: l.lure_type, name: l.name, is_house_brand: l.is_house_brand, size_in: l.size_in,
        speed_min_mph: l.speed_min_mph, speed_max_mph: l.speed_max_mph, active: true,
        finishes: l.finishes.map((f) => ({ ...f, id: `${id}/${f.name}`, active: true })),
      };
    }),
  };
}
export const catalog = catalogFromSeed();

/** Golden scenarios G1 to G3 and G6 to G10 predate the Presentation stage and describe a plug-only spread. */
export const PLUG_ONLY = { lure_types_available: ["plug" as const] };

export const ctx = (c: Partial<EngineContext> & { date: string }): EngineContext => ({
  shore: "east", temp_source_level: 5, ...c,
});

export const codes = (r: { fired: { code: string }[] }) => r.fired.map((f) => f.code);

/** Hourly wind from one direction for the most recent `hours` of the last 48, southwest before that. */
export const windFrom = (dir_deg: number, hours: number) =>
  Array.from({ length: 48 }, (_, i) => ({ hours_ago: i + 1, dir_deg: i < hours ? dir_deg : 225 }));

/** A profile that cools through 55 °F at `breakFt`, with its steepest drop there. */
export const profileWithBreakAt = (breakFt: number) => [
  { depth_ft: 0, temp_f: 68 },
  { depth_ft: breakFt - 10, temp_f: 65 },
  { depth_ft: breakFt, temp_f: 55 },
  { depth_ft: breakFt + 10, temp_f: 48 },
  { depth_ft: breakFt + 30, temp_f: 44 },
];
