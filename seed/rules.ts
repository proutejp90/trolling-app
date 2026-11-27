/**
 * Starter rules: R01 to R19 from the spec's Rules engine section, R20 added by the owner, and P01 to P12
 * from the Presentation stage. Rules are rows, so the owner edits them in admin
 * without a deploy; this file only seeds a fresh database.
 *
 * Context fields these conditions read (computed by the engine in Phase 1):
 *   month (1-12), shore, mode, temp_source_level (0-5), has_temp_data,
 *   upwelling_likely, lure_depth_ft (midpoint of the depth range), water_depth_ft,
 *   lure_temp_f, sky, wind_calm, clarity, light_period (before_sunrise, day,
 *   after_sunset), hours_after_sunrise, lure_type, finish_types
 */
import type { Condition, Rule } from "@recommender/engine";

type Tag = Rule["tags"][number];
const always: Condition = { all: [] };
const f = (field: string, op: "eq" | "ne" | "in" | "gt" | "gte" | "lt" | "lte" | "contains", value: string | number | boolean | (string | number)[]): Condition => ({ field, op, value });
const th = (field: string, op: "gt" | "gte" | "lt" | "lte", threshold: string): Condition => ({ field, op, threshold });

const rule = (
  code: string,
  stage: Rule["stage"],
  priority: number,
  when: Condition,
  recommend: Record<string, unknown>,
  tags: Tag[],
  source_note: string,
  opts: { enabled?: boolean; lakes?: string[] } = {},
): Rule => ({
  code, stage, priority, when, recommend, tags, source_note,
  lakes: opts.lakes ?? ["michigan"],
  species: "chinook",
  enabled: opts.enabled ?? true,
  version: 1,
});

const research = (section: string) => `Great Lakes Salmon Research: Recommender Logic, ${section}`;

export const rules: Rule[] = [
  // Location
  rule("R01", "location", 10, f("month", "in", [4, 5]),
    { mode: "offshore", depth_ft: { min: 0, max: 30 }, note: "Near shore, top 30 ft. Southern and central ports favored." },
    ["science"], research("Location")),
  rule("R02", "location", 10, f("month", "in", [6, 7]),
    { mode: "offshore", note: "Fish are suspended and moving north." },
    ["science"], research("Location")),
  rule("R03", "location", 10, f("month", "eq", 8),
    { mode: "offshore", alternative_mode: "staging", note: "Offshore, with a staging alternative." },
    ["science"], research("Location")),
  rule("R04", "location", 10, f("month", "in", [9, 10]),
    { mode: "staging", note: "River mouths and pierheads." },
    ["science"], research("Location")),

  // Depth
  rule("R05", "depth", 30, f("has_temp_data", "eq", true),
    { depth_from: "temp_band_entry_or_break", extend_below_ft: 20 },
    ["science", "lore"], research("Depth") + ". Fires whenever a profile or a break depth is known: a buoy, a report, or the angler's own reading."),
  rule("R06", "depth", 10, { all: [f("has_temp_data", "eq", false), f("month", "eq", 7)] },
    { depth_ft: { min: 25, max: 70 } },
    ["reports"], "Michigan DNR weekly reports, July"),
  rule("R07", "depth", 10, { all: [f("has_temp_data", "eq", false), f("month", "eq", 8)] },
    { depth_ft: { min: 50, max: 90 }, water_depth_ft: { min: 90, max: 300 } },
    ["reports"], "Michigan DNR weekly reports, August"),
  rule("R08", "depth", 20, { all: [f("shore", "eq", "east"), f("upwelling_likely", "eq", true)] },
    { shift_shallower_by_threshold: "upwelling_shift_ft", note: "Fish may be closer to the pier." },
    ["science"], research("Upwelling") + "; docs/research/upwelling-shift.md"),

  // Color. Lure depth is the midpoint of the depth range.
  rule("R09", "color", 10, th("lure_depth_ft", "lt", "red_max_ft"),
    { allow_all_colors: true },
    ["science"], research("Color")),
  rule("R10", "color", 20, { all: [th("lure_depth_ft", "gte", "red_max_ft"), th("lure_depth_ft", "lt", "yellow_max_ft")] },
    { exclude_colors: ["red", "orange"], unless_finish: ["fluorescent"] },
    ["science"], "Light attenuation; see research doc, Color"),
  rule("R11", "color", 20, { all: [th("lure_depth_ft", "gte", "yellow_max_ft"), th("lure_depth_ft", "lte", "blue_max_ft")] },
    { allow_colors: ["green", "blue", "silver", "chartreuse"], allow_finishes: ["chrome", "glow", "fluorescent"] },
    ["science"], research("Color") + ". Chartreuse and fluorescent finishes added by the owner, 2026-11-27, so R14's stained-water picks survive at mid depths."),
  rule("R12", "color", 40, { any: [th("lure_depth_ft", "gt", "glow_lead_ft"), f("sky", "in", ["low_light", "overcast"])] },
    { rank_first_finishes: ["glow"] },
    ["science", "reports"], research("Color") + "; Michigan DNR weekly reports"),
  rule("R13", "color", 30, { all: [f("finish_types", "contains", "uv"), { not: { all: [th("lure_depth_ft", "lt", "uv_max_ft"), f("clarity", "eq", "clear")] } }] },
    { exclude_finishes: ["uv"], uv_only: true },
    ["science"], research("Color") + ". Excludes UV-only finishes unless the lure is above uv_max_ft in clear water."),
  rule("R14", "color", 30, f("clarity", "in", ["stained", "murky"]),
    { rank_first_colors: ["chartreuse"], rank_first_patterns: ["firetiger"], rank_first_finishes: ["glow"], scale_color_bands_by_threshold: "murky_factor" },
    ["lore"], research("Color, stained water")),
  rule("R15", "color", 30, { all: [f("clarity", "eq", "clear"), f("sky", "eq", "bright")] },
    { rank_first_finishes: ["chrome"], rank_first_colors: ["silver"], with_back_colors: ["green", "blue"], prefer_size: "smaller" },
    ["lore"], research("Color, clear water")),
  rule("R16", "color", 30, f("mode", "eq", "staging"),
    { rank_first_finishes: ["fluorescent", "glow"], prefer_patterns: ["ladderback"] },
    ["lore"], research("Staging fish")),

  rule("R20", "color", 20, th("lure_depth_ft", "gt", "blue_max_ft"),
    { allow_colors: ["silver"], allow_finishes: ["chrome", "glow"] },
    ["science"], "Light attenuation past the blue limit. Added by the owner, 2026-11-27: the starter rules said nothing below it, so every color came back."),

  // Speed
  rule("R17", "speed", 10, { all: [f("lure_type", "eq", "plug"), f("mode", "eq", "staging")] },
    { speed_mph: { min: 1.8, max: 3.0 } },
    ["lore"], research("Speed")),
  rule("R18", "speed", 10, { all: [f("lure_type", "eq", "plug"), f("mode", "eq", "offshore")] },
    { speed_mph: { min: 2.4, max: 2.8 } },
    ["lore"], research("Speed")),

  // Tip
  rule("R19", "tip", 10, always,
    { tip: "If a pass draws no bites, change speed by about 0.5 mph before changing color." },
    ["lore"], research("Speed")),

  // Presentation. All Lore. Priority: P03 and P11, then P05, P04, P06, P02, P01, then the rest.
  rule("P01", "presentation", 50, th("lure_depth_ft", "lt", "spoon_first_max_ft"),
    { rank_first: ["spoon"] },
    ["lore"], "Forum posters on both lakes", { lakes: ["michigan", "ontario"] }),
  rule("P02", "presentation", 60, { all: [th("lure_depth_ft", "gte", "spoon_first_max_ft"), th("lure_depth_ft", "lte", "spoon_exclude_min_ft")] },
    { rank_first: ["flasher_fly"], keep_lines: { spoon: 1 } },
    ["lore"], "Forum posters on both lakes", { lakes: ["michigan", "ontario"] }),
  rule("P03", "presentation", 100, th("lure_depth_ft", "gt", "spoon_exclude_min_ft"),
    { rank_first: ["flasher_fly"], allow_only: ["flasher_fly", "meat_rig"], exclude: ["spoon"] },
    ["lore"], "Lake Michigan angler and fly maker"),
  rule("P04", "presentation", 80, f("light_period", "in", ["before_sunrise", "after_sunset"]),
    { rank_first: ["spoon"], require_finishes: ["glow"], add_from_month: { month: 7, lure_type: "plug", lines: 1, require_finishes: ["glow"] } },
    ["lore"], "Lake Michigan forum and blog"),
  rule("P05", "presentation", 90, { any: [f("mode", "eq", "staging"), { all: [f("month", "in", [8, 9, 10]), th("water_depth_ft", "lte", "staging_water_max_ft")] }] },
    { rank_first: ["plug"], rank_second: ["meat_rig"] },
    ["lore"], "Lake Michigan captains at Grand Haven and Manistee"),
  rule("P06", "presentation", 70, { all: [f("month", "gte", 7), f("mode", "eq", "offshore"), th("hours_after_sunrise", "gt", "meat_min_hours_after_sunrise")] },
    { add: { lure_type: "meat_rig", position: "deepest", max_lines: 2 }, rank_second: ["meat_rig"] },
    ["lore"], "Lake Michigan and Lake Ontario posters", { lakes: ["michigan", "ontario"] }),
  rule("P07", "presentation", 40, { all: [f("sky", "eq", "bright"), f("wind_calm", "eq", true), th("lure_depth_ft", "lt", "spoon_first_max_ft")] },
    { no_attractors: true, allow_only: ["spoon", "plug"] },
    ["lore"], "Lake Michigan captain"),
  rule("P08", "presentation", 40, f("clarity", "in", ["stained", "murky"]),
    { require_min_lines: { flasher_fly: 1 } },
    ["lore"], "Lake Ontario poster. Lake Ontario-only evidence, so seeded disabled as a note.", { enabled: false, lakes: ["ontario"] }),
  rule("P09", "presentation", 40, th("lure_temp_f", "gt", "warm_water_f"),
    { move_lines: { from: "spoon", to: "flasher_fly", lines: 1 } },
    ["lore"], "Forum, lake not stated. Skipped while warm_water_f has no value."),
  rule("P10", "presentation", 40, th("lure_depth_ft", "gt", "big_attractor_min_ft"),
    { attractor_size_in: { min: 10, max: 12 }, note: "Deep setups fish better with fewer lines." },
    ["lore"], "Lake Michigan captain at Manistee"),
  rule("P11", "presentation", 100, always,
    { cap_line_share: { meat_rig: 0.5 } },
    ["lore"], "Lake Michigan forum"),
  rule("P12", "tip", 5, always,
    { tip_threshold: "no_bite_swap_minutes", tip: "After 45 minutes with no bites, swap one line to a plug." },
    ["lore"], "Posters on both lakes", { lakes: ["michigan", "ontario"] }),
];
