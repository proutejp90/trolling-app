/**
 * Server-side checks on what the agent wrote. Any failure rejects the whole
 * output: the app retries once, then shows the templated reasons.
 *
 * Lures, finishes, depths, speeds and tags never come from the agent, so they
 * cannot be wrong. What can go wrong is the prose: a number the engine did not
 * produce, a lure or color the setup does not carry, a promise of fish, advice
 * about safety, or a rule cited that did not fire.
 */
import type { EngineResult, SetupLureType } from "@recommender/engine";
import { REASONS, SPEED_CAVEAT, TYPE_NAME } from "@/lib/reasons";
import type { Conditions } from "../conditions";
import type { AgentOutput, Explanation, ReportRow } from "./schema";
import { codesFor, groupsOf, speedReason, tagsOf } from "./template";

const BANNED = [
  /guarantee/i, /\bwill catch\b/i, /\byou(?:'| wi)ll catch\b/i, /can(?:'|no)t miss/i, /\bsure(?:-| )fire\b/i, /\bsure thing\b/i,
  /\bnever fails?\b/i, /\balways works?\b/i, /\blimit out\b/i, /\bpromise/i, /\bno doubt\b/i, /\bcertain to\b/i, /\bfish will\b/i,
];
const SAFETY = [
  /\bsafe(?:ly|ty)?\b/i, /\bsmall craft\b/i, /\badvisor(?:y|ies)\b/i, /\bstay (?:in|off|ashore|home)\b/i, /\bhead (?:out|in|back)\b/i,
  /\blife ?jackets?\b/i, /\bnavigat/i, /\bdangerous\b/i, /\bhazard/i, /\bseaworth/i, /\bfog\b/i, /\blightning\b/i,
];
/** Words that name a lure type, a color or a finish. A sentence may use one only where the engine put it. */
const TACKLE = [
  "spoon", "spoons", "plug", "plugs", "fly", "flies", "flasher", "flashers", "dodger", "dodgers", "meat", "attractor", "attractors",
  "red", "orange", "yellow", "chartreuse", "green", "blue", "purple", "pink", "silver", "chrome", "gold", "copper", "white", "black",
  "glow", "uv", "ultraviolet", "fluorescent", "firetiger", "ladderback",
];
const words = (text: string) => text.toLowerCase().match(/[a-z]+/g) ?? [];
const numbers = (text: string) => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Every number the agent may state: only what the engine and the cached conditions produced. */
export function allowedNumbers(engine: EngineResult, conditions: Conditions, date: string, reports: ReportRow[], alsoFrom: string[] = []): Set<number> {
  const out = new Set<number>();
  const add = (...ns: (number | null | undefined)[]) => ns.forEach((n) => { if (typeof n === "number" && Number.isFinite(n)) { out.add(n); out.add(Math.round(n)); } });
  add(engine.depth_ft?.min, engine.depth_ft?.max, engine.water_depth_ft?.min, engine.water_depth_ft?.max);
  add(engine.spread_speed_mph?.min, engine.spread_speed_mph?.max, engine.lines, engine.setups.length);
  add(engine.attractor_size_in?.min, engine.attractor_size_in?.max);
  for (const s of engine.setups) {
    add(s.speed_mph.min, s.speed_mph.max, s.leader_in);
    for (const n of numbers(`${s.lure_name} ${s.attractor_name ?? ""}`)) add(n);
  }
  for (const type of groupsOf(engine)) add(engine.setups.filter((s) => s.lure_type === type).length);
  add(conditions.water_temp_surface_f, conditions.temp_station?.distance_mi, conditions.age_minutes, conditions.age_minutes === null ? null : Math.round(conditions.age_minutes / 60));
  add(conditions.forecast?.sky_cover_pct, conditions.forecast?.wind_speed_mph, conditions.wind_history.length);
  add(conditions.wind_history.filter((w) => w.dir_deg >= 315 || w.dir_deg <= 135).length);
  for (const p of conditions.temp_profile ?? []) add(p.depth_ft, p.temp_f);
  add(Number(date.slice(8, 10)), Number(date.slice(0, 4)));
  // Numbers in sentences the server itself wrote and handed to the agent may be repeated.
  for (const text of [...conditions.messages, ...engine.notes, ...engine.dropped_types.map((d) => d.reason), ...alsoFrom]) for (const n of numbers(text)) add(n);
  for (const r of reports) {
    add(r.water_depth_min_ft, r.water_depth_max_ft, r.lure_depth_min_ft, r.lure_depth_max_ft, r.water_temp_f, r.break_depth_ft);
    add(Number(r.report_date.slice(8, 10)), Number(r.report_date.slice(0, 4)));
  }
  return out;
}

export interface CheckResult { ok: boolean; problems: string[] }

export function checkAgentOutput(out: AgentOutput, engine: EngineResult, conditions: Conditions, date: string, reports: ReportRow[], alsoFrom: string[] = []): CheckResult {
  const problems: string[] = [];
  const fired = new Set(engine.fired.map((f) => f.code));
  const types = groupsOf(engine);
  const okNumbers = allowedNumbers(engine, conditions, date, reports, alsoFrom);
  const spreadWords = new Set(engine.setups.flatMap((s) => words(`${TYPE_NAME[s.lure_type]} ${s.lure_name} ${s.finish_name} ${s.attractor_name ?? ""} ${s.attractor_finish_name ?? ""}`)));
  const droppedWords = new Set(engine.dropped_types.flatMap((d) => words(TYPE_NAME[d.lure_type])));
  const reportWords = new Set(reports.flatMap((r) => words([...r.lures, ...r.colors].join(" "))));
  const plural = (set: Set<string>) => new Set([...set].flatMap((w) => [w, `${w}s`, w.replace(/s$/, ""), w === "fly" ? "flies" : w]));

  const prose = (label: string, text: string, tackleAllowed: Set<string>) => {
    for (const n of numbers(text)) if (!okNumbers.has(n)) problems.push(`${label}: states ${n}, which the engine did not produce`);
    for (const re of BANNED) if (re.test(text)) problems.push(`${label}: promises a catch (${re.source})`);
    for (const re of SAFETY) if (re.test(text)) problems.push(`${label}: gives safety or navigation advice (${re.source})`);
    const allowed = plural(tackleAllowed);
    for (const w of words(text)) if (TACKLE.includes(w) && !allowed.has(w)) problems.push(`${label}: mentions "${w}", which is not part of this setup`);
  };

  // Groups: exactly the lure types in the spread, each once.
  const seen = out.groups.map((g) => g.lure_type);
  if (new Set(seen).size !== seen.length || seen.length !== types.length || !types.every((t) => seen.includes(t))) {
    problems.push(`groups must be exactly ${types.join(", ") || "none"}; got ${seen.join(", ") || "none"}`);
  }
  for (const g of out.groups) {
    const groupCodes = new Set(codesFor(engine, g.lure_type as SetupLureType));
    const groupWords = new Set(engine.setups.filter((s) => s.lure_type === g.lure_type).flatMap((s) => words(`${TYPE_NAME[s.lure_type]} ${s.lure_name} ${s.finish_name} ${s.attractor_name ?? ""} ${s.attractor_finish_name ?? ""}`)));
    for (const [i, r] of g.reasons.entries()) {
      const label = `${g.lure_type} reason ${i + 1}`;
      for (const code of r.rule_codes) {
        if (!fired.has(code)) problems.push(`${label}: cites ${code}, which did not fire`);
        else if (!groupCodes.has(code)) problems.push(`${label}: cites ${code}, which did not shape this setup`);
      }
      // One reason, one evidence tag: rules with different evidence cannot share a sentence.
      const tagSets = new Set(r.rule_codes.filter((c) => fired.has(c)).map((c) => tagsOf(engine, c).join("+")));
      if (tagSets.size > 1) problems.push(`${label}: mixes rules with different evidence tags (${r.rule_codes.join(", ")})`);
      const ruleWords = new Set(r.rule_codes.flatMap((c) => words(REASONS[c] ?? "")));
      prose(label, r.text, new Set([...groupWords, ...ruleWords, ...droppedWords]));
    }
  }
  // Outside the per-lure reasons, the agent may also name a lure type the engine considered and left out.
  const anywhere = new Set([...spreadWords, ...droppedWords]);
  prose("conditions summary", out.conditions_summary, anywhere);
  if ((out.conditions_summary.match(/[.!?](\s|$)/g) ?? []).length > 2) problems.push("conditions summary: more than two sentences");
  prose("confidence reason", out.confidence_reason, anywhere);
  out.caveats.forEach((c, i) => prose(`caveat ${i + 1}`, c, anywhere));
  const reportDates = new Set(reports.map((r) => r.report_date));
  out.report_notes.forEach((n, i) => {
    if (!reportDates.has(n.report_date)) problems.push(`report note ${i + 1}: cites a report dated ${n.report_date} that was not provided`);
    prose(`report note ${i + 1}`, n.text, new Set([...anywhere, ...reportWords]));
  });
  if (/[!]/.test(JSON.stringify(out))) problems.push("uses an exclamation mark");
  return { ok: problems.length === 0, problems };
}

/** Attaches the engine's tags and the server's own lines to checked agent prose. */
export function assemble(out: AgentOutput, engine: EngineResult, meta: { prompt_version: string; model: string }): Explanation {
  return {
    source: "agent", ...meta,
    conditions_summary: out.conditions_summary,
    groups: groupsOf(engine).map((type) => {
      const g = out.groups.find((x) => x.lure_type === type)!;
      const speed = speedReason(type);
      return {
        lure_type: type,
        reasons: [...g.reasons.map((r) => ({ text: r.text, rule_codes: r.rule_codes, tags: tagsOf(engine, r.rule_codes[0]!) })), ...(speed ? [speed] : [])],
      };
    }),
    report_notes: out.report_notes,
    confidence_reason: out.confidence_reason,
    // The fixed line about speed at the lure is always present, whatever the agent wrote.
    caveats: [SPEED_CAVEAT, ...out.caveats.filter((c) => c !== SPEED_CAVEAT)],
  };
}
