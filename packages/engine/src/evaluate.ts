/**
 * The rules engine: a pure function. Context, rules, thresholds and catalog in;
 * fired rules and a spread of ranked setups out. No network, no LLM, no clock.
 *
 * Stages run in order and each narrows the next:
 * Location, Depth, Presentation, Speed, then Color per line.
 */
import type { Rule, Threshold } from "./schema";
import { evalCondition, readRange, readThreshold, referencesField, thresholdMap, type Fields, type ThresholdMap } from "./conditions";
import type {
  Catalog, CatalogFinish, CatalogLure, EngineContext, EngineResult, FiredRule, Mode, Range,
  RankedFinish, SetupLureType, SkippedRule, Tag,
} from "./types";

const TAG_WEIGHT: Record<Tag, number> = { science: 100, reports: 10, lore: 1 };
const TAG_ORDER: Tag[] = ["science", "reports", "lore"];
/** Used only when no rule ranks a lure type the angler has. */
const FALLBACK_ORDER: SetupLureType[] = ["spoon", "plug", "flasher_fly", "meat_rig"];
/** The thresholds a murky-water rule rescales: how deep each color still shows. */
const COLOR_BANDS = ["red_max_ft", "orange_max_ft", "yellow_max_ft", "green_max_ft", "blue_max_ft"];
const TYPE_LABEL: Record<SetupLureType, string> = { spoon: "Spoons", flasher_fly: "Flasher and fly", meat_rig: "Meat rigs", plug: "Plugs" };

const fmt = (r: Range) => `${r.min.toFixed(1)} to ${r.max.toFixed(1)} mph`;
const round1 = (n: number) => Math.round(n * 10) / 10;
const strongest = (tags: Tag[]) => TAG_ORDER.find((t) => tags.includes(t)) ?? "lore";
const overlap = (a: Range, b: Range): Range | null => {
  const r = { min: Math.max(a.min, b.min), max: Math.min(a.max, b.max) };
  return r.min <= r.max ? r : null;
};
const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asRange = (v: unknown): Range | null =>
  v && typeof v === "object" && typeof (v as Range).min === "number" && typeof (v as Range).max === "number" ? (v as Range) : null;

/** Higher priority first; ties go to the stronger tag. */
const byPriority = (a: Rule, b: Rule) =>
  b.priority - a.priority || TAG_ORDER.indexOf(strongest(a.tags)) - TAG_ORDER.indexOf(strongest(b.tags)) || a.code.localeCompare(b.code);

// ---------------------------------------------------------------------------
// Derived values
// ---------------------------------------------------------------------------

/** Wind from the north or east: 315° through 135°. */
const isNorthOrEast = (deg: number) => deg >= 315 || deg <= 135;

function deriveUpwelling(ctx: EngineContext, t: ThresholdMap): boolean {
  if (ctx.upwelling_likely !== undefined) return ctx.upwelling_likely;
  const need = readThreshold(t, "upwelling_wind_hours");
  if (ctx.shore !== "east" || need === null || !ctx.wind_history) return false;
  const hours = ctx.wind_history.filter((w) => w.hours_ago <= 48 && isNorthOrEast(w.dir_deg)).length;
  return hours >= need;
}

function sortedProfile(ctx: EngineContext) {
  return [...(ctx.temp_profile ?? [])].sort((a, b) => a.depth_ft - b.depth_ft);
}

/** The depth with the steepest temperature drop, taken as the middle of that step. */
function breakFromProfile(ctx: EngineContext): number | null {
  const p = sortedProfile(ctx);
  let best: { rate: number; depth: number } | null = null;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    if (b.depth_ft <= a.depth_ft) continue;
    const rate = (a.temp_f - b.temp_f) / (b.depth_ft - a.depth_ft);
    if (rate > 0 && (!best || rate > best.rate)) best = { rate, depth: (a.depth_ft + b.depth_ft) / 2 };
  }
  return best ? Math.round(best.depth) : null;
}

/** Depth where the profile first cools into the band going down, or null if it never does. */
function bandEntry(ctx: EngineContext, bandMax: number): number | null {
  const p = sortedProfile(ctx);
  if (!p.length) return null;
  if (p[0]!.temp_f <= bandMax) return p[0]!.depth_ft;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    if (a.temp_f > bandMax && b.temp_f <= bandMax) {
      return Math.round(a.depth_ft + ((a.temp_f - bandMax) / (a.temp_f - b.temp_f)) * (b.depth_ft - a.depth_ft));
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Color stage
// ---------------------------------------------------------------------------

interface ColorOutcome {
  ranked: (RankedFinish & { finish: CatalogFinish })[];
  excluded: { finish: CatalogFinish; rule_code: string }[];
}

function finishMatchesRanker(rec: Record<string, unknown>, f: CatalogFinish): boolean {
  const base =
    asArray<string>(rec.rank_first_finishes).some((t) => f.finish_types.includes(t as never)) ||
    asArray<string>(rec.rank_first_colors).includes(f.color_family) ||
    (f.pattern !== null && asArray<string>(rec.rank_first_patterns).includes(f.pattern));
  const backs = asArray<string>(rec.with_back_colors);
  if (!backs.length) return base;
  return base && f.pattern !== null && backs.some((c) => f.pattern === `${c} back`);
}

/** Returns the code of the first rule that excludes this finish, or null. Exclusions always beat rankings. */
function excludedBy(colorRules: Rule[], f: CatalogFinish, fields: Fields, t: ThresholdMap): string | null {
  for (const rule of colorRules) {
    const rec = rule.recommend;
    if (evalCondition(rule.when, { ...fields, finish_types: f.finish_types }, t).value !== true) continue;
    const excludeColors = asArray<string>(rec.exclude_colors);
    if (excludeColors.includes(f.color_family) && !asArray<string>(rec.unless_finish).some((x) => f.finish_types.includes(x as never))) return rule.code;
    const excludeFinishes = asArray<string>(rec.exclude_finishes);
    if (excludeFinishes.length && f.finish_types.every((x) => excludeFinishes.includes(x))) return rule.code;
    const allowColors = asArray<string>(rec.allow_colors), allowFinishes = asArray<string>(rec.allow_finishes);
    if ((allowColors.length || allowFinishes.length) &&
        !allowColors.includes(f.color_family) && !allowFinishes.some((x) => f.finish_types.includes(x as never))) return rule.code;
  }
  return null;
}

function colorStage(lure: CatalogLure, colorRules: Rule[], fields: Fields, t: ThresholdMap, requireFinishes: string[]): ColorOutcome {
  const ranked: ColorOutcome["ranked"] = [];
  const excluded: ColorOutcome["excluded"] = [];
  lure.finishes.filter((f) => f.active !== false).forEach((f, index) => {
    const by = excludedBy(colorRules, f, fields, t);
    if (by) return void excluded.push({ finish: f, rule_code: by });
    if (requireFinishes.length && !requireFinishes.some((x) => f.finish_types.includes(x as never))) return;
    let score = 0;
    const rule_codes: string[] = [];
    for (const rule of colorRules) {
      if (evalCondition(rule.when, { ...fields, finish_types: f.finish_types }, t).value !== true) continue;
      const weight = TAG_WEIGHT[strongest(rule.tags)];
      let hit = false;
      if (finishMatchesRanker(rule.recommend, f)) { score += weight; hit = true; }
      if (f.pattern !== null && asArray<string>(rule.recommend.prefer_patterns).includes(f.pattern)) { score += weight * 0.5; hit = true; }
      if (hit) rule_codes.push(rule.code);
    }
    ranked.push({ finish: f, finish_id: f.id, name: f.name, score: score - index * 1e-6, rule_codes });
  });
  ranked.sort((a, b) => b.score - a.score);
  return { ranked: ranked.map((r) => ({ ...r, score: Math.round(r.score * 10) / 10 })), excluded };
}

/** Line i takes the best unused finish from score tier i, so a spread shows the top picks of each tier. */
function pickAcrossTiers<T extends { score: number }>(ranked: T[], count: number): T[] {
  const tiers: T[][] = [];
  for (const r of ranked) {
    const last = tiers[tiers.length - 1];
    if (last && last[0]!.score === r.score) last.push(r); else tiers.push([r]);
  }
  const picks: T[] = [];
  for (let i = 0; picks.length < count && tiers.some((x) => x.length); i++) {
    const tier = tiers[i % tiers.length]!;
    const next = tier.shift();
    if (next) picks.push(next);
  }
  while (picks.length < count && picks.length) picks.push(picks[picks.length % Math.max(1, ranked.length)]!);
  return picks;
}

// ---------------------------------------------------------------------------
// evaluate
// ---------------------------------------------------------------------------

export function evaluate(context: EngineContext, rules: Rule[], thresholds: Threshold[], catalog: Catalog): EngineResult {
  const t = thresholdMap(thresholds);
  const month = Number(context.date.slice(5, 7));
  const fired: FiredRule[] = [];
  const skipped: SkippedRule[] = [];
  const notes: string[] = [];
  const upwelling = deriveUpwelling(context, t);
  const breakDepth = context.break_depth_ft ?? breakFromProfile(context);
  // The lake model sits between a buoy profile and a buoy's surface reading.
  const sourceRank = context.temp_source_level === "1m" ? 1.5 : context.temp_source_level;
  const hasTempData = sourceRank <= 4 && (breakDepth !== null || (context.temp_profile?.length ?? 0) >= 2);

  const fields: Fields = {
    month, shore: context.shore, mode: context.mode, temp_source_level: context.temp_source_level,
    has_temp_data: hasTempData, upwelling_likely: upwelling, water_depth_ft: context.water_depth_ft,
    lure_temp_f: context.lure_temp_f, sky: context.sky, wind_calm: context.wind_calm,
    // Unknown clarity is a value, not a gap: a finish allowed only in clear water stays out until clarity is known.
    clarity: context.clarity ?? "unknown",
    light_period: context.light_period, hours_after_sunrise: context.hours_after_sunrise,
  };

  const result: EngineResult = {
    status: "ok", month, mode: null, alternative_mode: null, location_note: null, depth_ft: null, depth_source: null,
    water_depth_ft: null, upwelling_likely: upwelling, spread_speed_mph: null,
    lines: context.lines_available ?? readThreshold(t, "default_lines") ?? 4,
    setups: [], finish_ranking: {}, excluded_finishes: [], dropped_types: [], dropped_lures: [],
    attractor_size_in: null, color_band_factor: 1, tips: [], notes, fired, skipped,
  };

  const live = rules.filter((r) => {
    if (!r.enabled) skipped.push({ code: r.code, reason: "disabled" });
    return r.enabled;
  });
  const stage = (name: Rule["stage"]) => live.filter((r) => r.stage === name).sort(byPriority);
  const fire = (r: Rule, note?: string) => {
    if (!fired.some((f) => f.code === r.code)) fired.push({ code: r.code, stage: r.stage, tags: r.tags, ...(note ? { note } : {}) });
  };
  /** Evaluates a stage's rules, recording why each one that did not fire was skipped. */
  const firing = (list: Rule[], extra: Fields = {}, record = true) =>
    list.filter((r) => {
      const v = evalCondition(r.when, { ...fields, ...extra }, t);
      if (v.value === true) return true;
      if (record && !skipped.some((s) => s.code === r.code)) skipped.push({ code: r.code, reason: v.value === null ? v.missing ?? "an input is missing" : "condition not met" });
      return false;
    });
  const unskip = (code: string) => {
    const i = skipped.findIndex((s) => s.code === code);
    if (i >= 0) skipped.splice(i, 1);
  };

  // --- Location --------------------------------------------------------------
  const location = firing(stage("location"))[0];
  if (!location) {
    result.status = "out_of_season";
    notes.push("The rules cover April through October. Nothing is recommended outside the season.");
    return result;
  }
  fire(location);
  const mode: Mode = context.mode ?? (location.recommend.mode as Mode);
  fields.mode = mode;
  result.mode = mode;
  result.alternative_mode = (location.recommend.alternative_mode as Mode | undefined) ?? null;
  result.location_note = (location.recommend.note as string | undefined) ?? null;

  // --- Depth -----------------------------------------------------------------
  let depth: Range | null = null;
  const depthRules = stage("depth");
  if (context.lure_depth_ft !== undefined) {
    depth = { min: context.lure_depth_ft, max: context.lure_depth_ft };
    result.depth_source = "angler";
    for (const r of depthRules) skipped.push({ code: r.code, reason: "the angler gave the lure depth" });
  } else {
    const firedDepth = firing(depthRules);
    const base = firedDepth.find((r) => r.recommend.depth_ft || r.recommend.depth_from);
    if (base?.recommend.depth_from) {
      const band = readRange(t, "temp_band_f");
      const start = (band ? bandEntry(context, band.max) : null) ?? breakDepth;
      const below = Number(base.recommend.extend_below_ft ?? 20);
      if (start !== null) {
        const coarse = (context.profile_resolution_ft ?? 0) / 2;
        depth = { min: Math.max(0, Math.round(start - coarse)), max: Math.round(start + coarse) + below };
        result.depth_source = base.code;
        fire(base);
      }
    } else if (base) {
      depth = { ...asRange(base.recommend.depth_ft)! };
      result.depth_source = base.code;
      result.water_depth_ft = asRange(base.recommend.water_depth_ft);
      fire(base);
    }
    for (const r of firedDepth) if (r !== base && (r.recommend.depth_ft || r.recommend.depth_from)) skipped.push({ code: r.code, reason: `a higher-priority depth rule applied (${base!.code})` });
    if (!depth && asRange(location.recommend.depth_ft)) {
      depth = { ...asRange(location.recommend.depth_ft)! };
      result.depth_source = location.code;
    }
    // Shifts apply to defaults. A measured break already reflects the upwelling.
    for (const r of firedDepth.filter((x) => x.recommend.shift_shallower_by_threshold)) {
      const name = r.recommend.shift_shallower_by_threshold as string;
      const shift = readThreshold(t, name);
      if (shift === null) { skipped.push({ code: r.code, reason: `threshold ${name} has no value` }); continue; }
      // A buoy profile and the lake model both already show an upwelling, so neither is shifted again.
      const measured = base?.recommend.depth_from !== undefined && sourceRank <= 1.5;
      if (depth && !measured) {
        depth = { min: Math.max(0, depth.min - shift), max: Math.max(0, depth.max - shift) };
        fire(r, `Depth range moved ${shift} ft shallower.`);
      } else {
        fire(r, measured ? (context.temp_source_level === "1m" ? "No shift applied: the depth comes from a modeled profile, which already shows it." : "No shift applied: the depth comes from a measured profile.") : undefined);
      }
    }
  }
  if (!depth) {
    result.status = "needs_input";
    result.question = { field: "break_depth_ft", text: "How deep is the temperature break, or what lure depth are you running? There is no depth default for this month without temperature data." };
    return result;
  }
  result.depth_ft = depth;
  const lureDepth = (depth.min + depth.max) / 2;
  fields.lure_depth_ft = lureDepth;

  // --- Tips ------------------------------------------------------------------
  for (const r of firing(stage("tip"))) {
    fire(r);
    result.tips.push({ text: String(r.recommend.tip), rule_code: r.code });
  }

  // --- Presentation ----------------------------------------------------------
  const available = new Set<SetupLureType>(context.lure_types_available ?? FALLBACK_ORDER);
  const pres = firing(stage("presentation"));
  pres.forEach((r) => fire(r));

  const excludedTypes = new Map<SetupLureType, string>();
  for (const r of pres) {
    for (const x of asArray<SetupLureType>(r.recommend.exclude)) if (!excludedTypes.has(x)) excludedTypes.set(x, r.code);
    const only = asArray<SetupLureType>(r.recommend.allow_only);
    if (only.length) for (const x of FALLBACK_ORDER) if (!only.includes(x) && !excludedTypes.has(x)) excludedTypes.set(x, r.code);
    const size = asRange(r.recommend.attractor_size_in);
    if (size) result.attractor_size_in = size;
    if (typeof r.recommend.note === "string") notes.push(r.recommend.note);
  }

  const order: SetupLureType[] = [];
  const typeRules = new Map<SetupLureType, Set<string>>();
  const credit = (type: SetupLureType, code: string) => {
    if (!typeRules.has(type)) typeRules.set(type, new Set());
    typeRules.get(type)!.add(code);
  };
  const requireFinishes = new Map<SetupLureType, string[]>();
  /** Lines a rule keeps or adds for a type that no rule ranks: exactly that many, taken from the type with the most. */
  const extras = new Map<SetupLureType, number>();
  const deepest = new Set<SetupLureType>();

  for (const r of pres) for (const x of asArray<SetupLureType>(r.recommend.rank_first)) {
    credit(x, r.code);
    if (!order.includes(x)) order.push(x);
    const req = asArray<string>(r.recommend.require_finishes);
    if (req.length) requireFinishes.set(x, req);
  }
  for (const r of pres) for (const x of asArray<SetupLureType>(r.recommend.rank_second)) {
    credit(x, r.code);
    if (!order.includes(x)) order.splice(Math.min(1, order.length), 0, x);
  }
  for (const r of pres) {
    const add = r.recommend.add as { lure_type: SetupLureType; position?: string } | undefined;
    if (add) {
      credit(add.lure_type, r.code);
      if (add.position === "deepest") deepest.add(add.lure_type);
      if (!order.includes(add.lure_type)) order.push(add.lure_type);
    }
    for (const [type, n] of Object.entries((r.recommend.keep_lines ?? {}) as Record<SetupLureType, number>)) {
      credit(type as SetupLureType, r.code);
      if (!order.includes(type as SetupLureType)) extras.set(type as SetupLureType, n);
    }
    const from = r.recommend.add_from_month as { month: number; lure_type: SetupLureType; lines: number; require_finishes?: string[] } | undefined;
    if (from && month >= from.month) {
      credit(from.lure_type, r.code);
      if (!order.includes(from.lure_type)) {
        extras.set(from.lure_type, from.lines);
        if (from.require_finishes?.length) requireFinishes.set(from.lure_type, from.require_finishes);
      }
    }
  }

  const drop = (lure_type: SetupLureType, reason: string, rule_code?: string) => {
    if (!result.dropped_types.some((d) => d.lure_type === lure_type)) result.dropped_types.push({ lure_type, reason, ...(rule_code ? { rule_code } : {}) });
  };
  for (const [type, code] of excludedTypes) {
    const explicit = pres.some((r) => r.code === code && asArray<string>(r.recommend.exclude).includes(type));
    if (available.has(type) && (explicit || order.includes(type) || extras.has(type))) drop(type, `${TYPE_LABEL[type]} are excluded by rule ${code}.`, code);
  }

  // --- Speed per lure type and usable lures ------------------------------------
  const speedRules = stage("speed");
  const typeSpeedRule = new Map<SetupLureType, string>();
  const typeBand = (type: SetupLureType): Range | null => {
    const rule = firing(speedRules, { lure_type: type }, false).find((r) => asRange(r.recommend.speed_mph));
    if (rule) { fire(rule); typeSpeedRule.set(type, rule.code); return asRange(rule.recommend.speed_mph); }
    return readRange(t, `speed_${type}_mph`);
  };
  const lureBand = (l: CatalogLure): Range | null =>
    l.speed_min_mph !== null && l.speed_max_mph !== null ? { min: l.speed_min_mph, max: l.speed_max_mph } : null;
  const mainType = (type: SetupLureType) => (type === "flasher_fly" ? "fly" : type);
  const needsAttractor = (type: SetupLureType) => type === "flasher_fly" || type === "meat_rig";
  const activeLures = (catalogType: string) => catalog.lures.filter((l) => l.lure_type === catalogType && l.active !== false && l.finishes.some((f) => f.active !== false));
  const attractors = () => {
    const all = activeLures("attractor");
    const size = result.attractor_size_in;
    const sized = size ? all.filter((l) => l.size_in !== null && l.size_in >= size.min && l.size_in <= size.max) : all;
    return sized.length ? sized : all;
  };

  interface Candidate { type: SetupLureType; band: Range; lures: CatalogLure[] }
  const candidate = (type: SetupLureType): Candidate | null => {
    const band = typeBand(type);
    if (!band) { drop(type, `${TYPE_LABEL[type]} have no speed range set.`); return null; }
    const all = activeLures(mainType(type));
    if (!all.length || (needsAttractor(type) && !attractors().length)) {
      drop(type, `The catalog has no active ${needsAttractor(type) && all.length ? "attractor" : TYPE_LABEL[type].toLowerCase()} to run.`);
      return null;
    }
    const lures = all.filter((l) => {
      const lb = lureBand(l);
      if (lb && !overlap(lb, band)) {
        if (!result.dropped_lures.some((d) => d.lure_id === l.id)) result.dropped_lures.push({ lure_id: l.id, name: l.name, reason: `Tested speed range ${fmt(lb)} does not overlap the ${TYPE_LABEL[type].toLowerCase()} speed of ${fmt(band)}.` });
        return false;
      }
      return true;
    });
    if (!lures.length) { drop(type, `No ${TYPE_LABEL[type].toLowerCase()} in the catalog hold their action at ${fmt(band)}.`); return null; }
    return { type, band, lures };
  };

  const usable = (type: SetupLureType) => available.has(type) && !excludedTypes.has(type);
  let ranked = order.filter(usable);
  const tried = new Set<SetupLureType>();
  const maxTypes = result.lines >= (readThreshold(t, "third_type_min_lines") ?? 6) ? 3 : 2;
  const chosen: Candidate[] = [];
  let spread: Range | null = null;

  const consider = (type: SetupLureType, fillOnly = false): boolean => {
    if (tried.has(type)) return false;
    tried.add(type);
    const c = candidate(type);
    if (!c) return false;
    const next: Range | null = spread ? overlap(spread, c.band) : c.band;
    if (!next) {
      drop(type, `${TYPE_LABEL[type]} run at ${fmt(c.band)}, which has no overlap with the spread speed of ${fmt(spread!)}. One spread cannot serve both.`);
      return false;
    }
    if (chosen.length >= maxTypes && !fillOnly) {
      drop(type, `${TYPE_LABEL[type]} rank below the ${maxTypes} lure types that fit on ${result.lines} lines.`);
      return false;
    }
    spread = next;
    chosen.push(c);
    return true;
  };

  for (const type of ranked) consider(type);
  const extraTypes: SetupLureType[] = [];
  if (chosen.length) for (const type of [...extras.keys()].filter(usable)) if (consider(type, true)) extraTypes.push(type);
  if (!chosen.length) {
    // No rule-ranked type can be run: fall back to whatever the angler has.
    ranked = FALLBACK_ORDER.filter((x) => usable(x) && !tried.has(x));
    for (const type of ranked) consider(type);
  }
  if (!chosen.length || !spread) {
    notes.push("No lure in the catalog fits these conditions.");
    return result;
  }

  // --- Lines -----------------------------------------------------------------
  const lines = new Map<SetupLureType, number>();
  const n = result.lines;
  const main = chosen.filter((c) => !extraTypes.includes(c.type));
  const first = main.length === 1 ? n : Math.ceil(n / 2);
  main.forEach((c, i) => {
    if (i === 0) lines.set(c.type, first);
    else if (i === main.length - 1) lines.set(c.type, n - [...lines.values()].reduce((a, b) => a + b, 0));
    else lines.set(c.type, Math.ceil((n - first) / 2));
  });
  for (const type of extraTypes) {
    lines.set(type, 0);
    while (lines.get(type)! < extras.get(type)!) {
      const donor = [...lines.entries()].filter(([x]) => x !== type).sort((a, b) => b[1] - a[1])[0];
      if (!donor || donor[1] <= 1) break;
      lines.set(donor[0], donor[1] - 1);
      lines.set(type, lines.get(type)! + 1);
    }
  }
  // Caps: exclusions and caps beat rankings.
  for (const r of pres) for (const [type, share] of Object.entries((r.recommend.cap_line_share ?? {}) as Record<SetupLureType, number>)) {
    const cap = Math.floor(n * share);
    const have = lines.get(type as SetupLureType) ?? 0;
    if (have <= cap) continue;
    credit(type as SetupLureType, r.code);
    let spare = have - cap;
    lines.set(type as SetupLureType, cap);
    const others = chosen.filter((c) => c.type !== type);
    if (!others.length) for (const x of FALLBACK_ORDER.filter((y) => usable(y) && !tried.has(y))) if (consider(x, true)) { others.push(chosen[chosen.length - 1]!); break; }
    if (others.length) { lines.set(others[0]!.type, (lines.get(others[0]!.type) ?? 0) + spare); spare = 0; }
    if (spare) notes.push(`${spare} line${spare === 1 ? "" : "s"} left open: ${TYPE_LABEL[type as SetupLureType].toLowerCase()} are capped at ${cap} of ${n} lines and nothing else fits the spread speed.`);
  }
  const finalSpread: Range = { min: round1((spread as Range).min), max: round1((spread as Range).max) };
  result.spread_speed_mph = finalSpread;

  // --- Color, per line --------------------------------------------------------
  const colorRules = stage("color");
  // Stained water shortens how deep each color carries. A rule that says so rescales the color
  // bands before any other color rule reads them, so it is evaluated first, on the unscaled bands.
  let ct = t;
  for (const r of colorRules) {
    const name = r.recommend.scale_color_bands_by_threshold as string | undefined;
    if (!name || evalCondition(r.when, fields, t).value !== true) continue;
    const factor = readThreshold(t, name);
    if (factor === null) { notes.push(`Rule ${r.code} could not rescale the color bands: threshold ${name} has no value.`); continue; }
    ct = new Map(ct);
    for (const band of COLOR_BANDS) {
      const depth = readThreshold(t, band);
      if (depth !== null) ct.set(band, depth * factor);
    }
    result.color_band_factor = factor;
  }
  const firedColor = colorRules.filter((r) => !referencesField(r.when, "finish_types") && evalCondition(r.when, fields, ct).value === true);
  firedColor.forEach((r) => fire(r));
  for (const r of colorRules) {
    if (firedColor.includes(r) || referencesField(r.when, "finish_types")) continue;
    const v = evalCondition(r.when, fields, ct);
    skipped.push({ code: r.code, reason: v.value === null ? v.missing ?? "an input is missing" : "condition not met" });
  }
  const preferSmaller = firedColor.some((r) => r.recommend.prefer_size === "smaller");
  const recordExclusions = (lure: CatalogLure, out: ColorOutcome) => {
    for (const e of out.excluded) {
      const rule = colorRules.find((r) => r.code === e.rule_code)!;
      fire(rule);
      unskip(rule.code);
      if (!result.excluded_finishes.some((x) => x.finish_id === e.finish.id)) result.excluded_finishes.push({ lure_id: lure.id, finish_id: e.finish.id, name: e.finish.name, rule_code: e.rule_code });
    }
  };
  /** Ranked finishes, or the closest match and the rule it breaks when every finish is filtered out. */
  const finishesFor = (lure: CatalogLure, require: string[]) => {
    const out = colorStage(lure, colorRules, fields, ct, require);
    recordExclusions(lure, out);
    if (out.ranked.length) return { ranked: out.ranked, breaks: null as string | null };
    const closest = out.excluded[0];
    if (!closest) return { ranked: [], breaks: null };
    notes.push(`No ${lure.name} finish passes the color rules. ${closest.finish.name} is the closest match and breaks rule ${closest.rule_code}.`);
    return { ranked: [{ finish: closest.finish, finish_id: closest.finish.id, name: closest.finish.name, score: 0, rule_codes: [] }], breaks: closest.rule_code };
  };

  const leaderFor = (attractor: CatalogLure): number | null => {
    const options = [{ size: 8, name: "leader_8in_flasher_in" }, { size: 11, name: "leader_11in_flasher_in" }];
    const size = attractor.size_in ?? 8;
    const nearest = options.sort((a, b) => Math.abs(a.size - size) - Math.abs(b.size - size))[0]!;
    return readThreshold(t, nearest.name);
  };

  const shared = [location.code, ...(result.depth_source && result.depth_source !== "angler" && result.depth_source !== location.code ? [result.depth_source] : []),
    ...fired.filter((f) => f.stage === "depth" && f.code !== result.depth_source).map((f) => f.code)];

  for (const c of chosen) {
    const count = lines.get(c.type) ?? 0;
    if (!count) continue;
    const lures = [...c.lures].filter((l) => { const lb = lureBand(l); return !lb || overlap(lb, finalSpread); });
    if (!lures.length) { drop(c.type, `No ${TYPE_LABEL[c.type].toLowerCase()} in the catalog hold their action at the spread speed of ${fmt(finalSpread)}.`); continue; }
    if (preferSmaller) lures.sort((a, b) => (a.size_in ?? 99) - (b.size_in ?? 99));
    const lure = lures[0]!;
    const { ranked: rankedFinishes, breaks } = finishesFor(lure, requireFinishes.get(c.type) ?? []);
    if (!rankedFinishes.length) { drop(c.type, `${lure.name} has no finish to run.`); continue; }
    result.finish_ranking[c.type] = rankedFinishes.map(({ finish_id, name, score, rule_codes }) => ({ finish_id, name, score, rule_codes }));
    const picks = pickAcrossTiers(rankedFinishes.map((r) => ({ ...r })), count);

    let attractor: CatalogLure | null = null;
    let attractorFinish: CatalogFinish | null = null;
    if (needsAttractor(c.type)) {
      attractor = attractors()[0]!;
      attractorFinish = finishesFor(attractor, []).ranked[0]?.finish ?? null;
    }
    const lb = lureBand(lure);
    const speed = (lb && overlap(lb, finalSpread)) || finalSpread;
    for (const pick of picks) {
      const colorCodes = [...new Set([...firedColor.filter((r) => r.recommend.allow_all_colors || r.recommend.exclude_colors || r.recommend.allow_colors).map((r) => r.code), ...pick.rule_codes])];
      result.setups.push({
        rank: result.setups.length + 1,
        lure_type: c.type, lure_id: lure.id, lure_name: lure.name,
        finish_id: pick.finish_id, finish_name: pick.name,
        attractor_id: attractor?.id ?? null, attractor_name: attractor?.name ?? null,
        attractor_finish_id: attractorFinish?.id ?? null, attractor_finish_name: attractorFinish?.name ?? null,
        leader_in: attractor && c.type === "flasher_fly" ? leaderFor(attractor) : null,
        depth_ft: { ...depth },
        speed_mph: { min: round1(speed.min), max: round1(speed.max) },
        position: deepest.has(c.type) ? "deepest" : null,
        rule_codes: [...new Set([...shared, ...(typeRules.get(c.type) ?? []), ...colorCodes, ...(typeSpeedRule.has(c.type) ? [typeSpeedRule.get(c.type)!] : [])])],
        breaks_rule: breaks,
      });
    }
  }
  return result;
}
