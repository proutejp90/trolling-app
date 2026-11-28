import type { CATALOG_LURE_TYPES, COLOR_FAMILIES, FINISH_TYPES, SETUP_LURE_TYPES, TAGS } from "./schema";

export type SetupLureType = (typeof SETUP_LURE_TYPES)[number];
export type CatalogLureType = (typeof CATALOG_LURE_TYPES)[number];
export type FinishType = (typeof FINISH_TYPES)[number];
export type Tag = (typeof TAGS)[number];
export type Mode = "offshore" | "staging";
export interface Range { min: number; max: number }

/** Everything the engine reads. All lengths in feet, speeds in mph, temperatures in °F. */
export interface EngineContext {
  /** Trip date, YYYY-MM-DD. */
  date: string;
  shore: "east" | "west";
  /** The angler's choice, when given. Otherwise the location rule sets it. */
  mode?: Mode;
  /** 0 the angler's probe, 1 buoy profile, "1m" NOAA's lake model, 2 buoy surface, 3 report, 4 the angler's answer, 5 month defaults. */
  temp_source_level: 0 | 1 | "1m" | 2 | 3 | 4 | 5;
  temp_profile?: { depth_ft: number; temp_f: number }[];
  /**
   * How coarse the profile is, in feet: one model layer's thickness. When set, the depth range
   * from the profile is widened by this much, half above the start and half below, so a modeled
   * break is never stated more finely than the model resolves it.
   */
  profile_resolution_ft?: number;
  break_depth_ft?: number;
  /** A lure depth the angler states outright. It replaces the Depth stage. */
  lure_depth_ft?: number;
  water_depth_ft?: number;
  lure_temp_f?: number;
  /** Hourly wind for the last 48 hours. */
  wind_history?: { hours_ago: number; dir_deg: number }[];
  /** Overrides the value derived from wind_history. */
  upwelling_likely?: boolean;
  sky?: "bright" | "overcast" | "low_light";
  wind_calm?: boolean;
  clarity?: "clear" | "stained" | "murky" | "unknown";
  light_period?: "before_sunrise" | "day" | "after_sunset";
  hours_after_sunrise?: number;
  lure_types_available?: SetupLureType[];
  lines_available?: number;
}

export interface CatalogFinish {
  id: string; name: string; base_color: string; finish_types: FinishType[];
  pattern: string | null; color_family: (typeof COLOR_FAMILIES)[number] | string; active?: boolean;
}
export interface CatalogLure {
  id: string; lure_type: CatalogLureType; name: string; is_house_brand?: boolean;
  size_in: number | null; speed_min_mph: number | null; speed_max_mph: number | null;
  active?: boolean; finishes: CatalogFinish[];
}
export interface Catalog { lures: CatalogLure[] }

export interface FiredRule { code: string; stage: string; tags: Tag[]; note?: string }
export interface SkippedRule { code: string; reason: string }

export interface RankedFinish { finish_id: string; name: string; score: number; rule_codes: string[] }

export interface Setup {
  rank: number;
  lure_type: SetupLureType;
  lure_id: string; lure_name: string;
  finish_id: string; finish_name: string;
  attractor_id: string | null; attractor_name: string | null;
  attractor_finish_id: string | null; attractor_finish_name: string | null;
  leader_in: number | null;
  depth_ft: Range;
  speed_mph: Range;
  /** Set when a rule places this line, for example meat on the deepest lines. */
  position: "deepest" | null;
  /** Codes of every rule that shaped this setup. */
  rule_codes: string[];
  /** Set when every finish was filtered out and this is the closest match. */
  breaks_rule: string | null;
}

export interface EngineResult {
  status: "ok" | "needs_input" | "out_of_season";
  question?: { field: "break_depth_ft"; text: string };
  month: number;
  mode: Mode | null;
  alternative_mode: Mode | null;
  location_note: string | null;
  depth_ft: Range | null;
  /** What set the depth: a rule code, or "angler" when the angler gave the lure depth. */
  depth_source: string | null;
  water_depth_ft: Range | null;
  upwelling_likely: boolean;
  spread_speed_mph: Range | null;
  lines: number;
  setups: Setup[];
  /** Finish ranking per lure type in the spread, best first, after exclusions. */
  finish_ranking: Partial<Record<SetupLureType, RankedFinish[]>>;
  excluded_finishes: { lure_id: string; finish_id: string; name: string; rule_code: string }[];
  dropped_types: { lure_type: SetupLureType; reason: string; rule_code?: string }[];
  dropped_lures: { lure_id: string; name: string; reason: string }[];
  attractor_size_in: Range | null;
  /** What the color depth bands were multiplied by. 1 in clear water; the murky factor in stained or murky water. */
  color_band_factor: number;
  tips: { text: string; rule_code: string }[];
  notes: string[];
  fired: FiredRule[];
  skipped: SkippedRule[];
}
