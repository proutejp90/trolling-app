/** Each rule firing and not firing at its boundaries, plus properties that must hold for any context. */
import { describe, expect, it } from "vitest";
import { evaluate, type EngineContext, type Threshold } from "../src";
import { catalog, codes, ctx, rules, thresholds, windFrom } from "./helpers";

type C = Partial<EngineContext> & { date: string };
const fires = (code: string, c: C, th: Threshold[] = thresholds) => codes(evaluate(ctx(c), rules, th, catalog)).includes(code);
const day = { clarity: "clear" as const, sky: "bright" as const };
const at = (ft: number, extra: Partial<EngineContext> = {}): C => ({ date: "2026-07-15", ...day, lure_depth_ft: ft, ...extra });

const cases: [string, C[], C[]][] = [
  ["R01", [{ date: "2026-04-01" }, { date: "2026-05-31" }], [{ date: "2026-06-01" }, { date: "2026-03-31" }]],
  ["R02", [{ date: "2026-06-01" }, { date: "2026-07-31" }], [{ date: "2026-05-31" }, { date: "2026-08-01" }]],
  ["R03", [{ date: "2026-08-01" }, { date: "2026-08-31" }], [{ date: "2026-07-31" }, { date: "2026-09-01" }]],
  ["R04", [{ date: "2026-09-01" }, { date: "2026-10-31" }], [{ date: "2026-08-31" }, { date: "2026-11-01" }]],
  ["R05", [{ date: "2026-07-15", temp_source_level: 4, break_depth_ft: 40 }, { date: "2026-06-15", temp_source_level: 0, break_depth_ft: 62 }], [{ date: "2026-07-15" }, { date: "2026-07-15", temp_source_level: 5, break_depth_ft: 40 }]],
  ["R06", [{ date: "2026-07-01" }, { date: "2026-07-31" }], [{ date: "2026-08-01" }, { date: "2026-06-30" }, { date: "2026-07-15", temp_source_level: 4, break_depth_ft: 40 }]],
  ["R07", [{ date: "2026-08-01" }, { date: "2026-08-31" }], [{ date: "2026-07-31" }, { date: "2026-08-15", temp_source_level: 4, break_depth_ft: 40 }]],
  ["R08", [{ date: "2026-08-15", wind_history: windFrom(0, 24) }, { date: "2026-08-15", wind_history: windFrom(90, 30) }], [{ date: "2026-08-15", wind_history: windFrom(0, 23) }, { date: "2026-08-15", wind_history: windFrom(180, 48) }, { date: "2026-08-15", shore: "west", wind_history: windFrom(0, 48) }]],
  ["R09", [at(0), at(19.9)], [at(20)]],
  ["R10", [at(20), at(44.9)], [at(19.9), at(45)]],
  ["R11", [at(45), at(110)], [at(44.9), at(110.1)]],
  ["R12", [at(65.1), at(30, { sky: "overcast" }), at(30, { sky: "low_light" })], [at(65), at(30)]],
  ["R13", [at(60), at(30, { clarity: "stained" })], [at(59.9), at(10)]],
  ["R14", [at(30, { clarity: "stained" }), at(30, { clarity: "murky" })], [at(30), at(30, { clarity: "unknown" })]],
  ["R15", [at(30)], [at(30, { sky: "overcast" }), at(30, { clarity: "stained" })]],
  ["R16", [at(30, { mode: "staging" }), { date: "2026-09-15", lure_depth_ft: 30 }], [at(30, { mode: "offshore" })]],
  ["R17", [at(30, { mode: "staging" })], [at(30, { mode: "offshore", lure_types_available: ["plug"] })]],
  ["R18", [at(30, { mode: "offshore", lure_types_available: ["plug"] })], [at(30, { mode: "staging" })]],
  ["R19", [at(30), { date: "2026-04-10" }], [{ date: "2026-01-10" }]],
  ["P01", [at(54.9)], [at(55)]],
  ["P02", [at(55), at(100)], [at(54.9), at(100.1)]],
  ["P03", [at(100.1)], [at(100)]],
  ["P04", [at(30, { light_period: "before_sunrise" }), at(30, { light_period: "after_sunset" })], [at(30, { light_period: "day" }), at(30)]],
  ["P05", [at(30, { mode: "staging" }), { date: "2026-08-15", lure_depth_ft: 30, water_depth_ft: 70 }, { date: "2026-10-15", lure_depth_ft: 30, mode: "offshore", water_depth_ft: 40 }], [{ date: "2026-08-15", lure_depth_ft: 30, water_depth_ft: 70.1 }, at(30, { mode: "offshore", water_depth_ft: 50 })]],
  ["P06", [at(60, { hours_after_sunrise: 2.1 }), { date: "2026-08-15", lure_depth_ft: 60, hours_after_sunrise: 5 }], [at(60, { hours_after_sunrise: 2 }), { date: "2026-06-30", lure_depth_ft: 60, hours_after_sunrise: 5 }, at(60, { mode: "staging", hours_after_sunrise: 5 }), at(60)]],
  ["P07", [at(54.9, { wind_calm: true })], [at(55, { wind_calm: true }), at(30, { wind_calm: false }), at(30), at(30, { wind_calm: true, sky: "overcast" })]],
  ["P08", [], [at(30, { clarity: "stained" }), at(30, { clarity: "murky" })]], // seeded disabled
  ["P09", [], [at(30, { lure_temp_f: 75 })]], // warm_water_f has no value
  ["P10", [at(80.1)], [at(80)]],
  ["P11", [at(30)], [{ date: "2026-02-10" }]],
  ["P12", [at(30)], [{ date: "2026-02-10" }]],
];

describe("each rule at its boundaries", () => {
  it("covers every seeded rule", () => {
    expect(cases.map(([c]) => c).sort()).toEqual(rules.map((r) => r.code).sort());
  });
  for (const [code, yes, no] of cases) {
    it(`${code} fires ${yes.length} time(s) and stays quiet ${no.length} time(s)`, () => {
      yes.forEach((c, i) => expect(fires(code, c), `${code} should fire, case ${i}`).toBe(true));
      no.forEach((c, i) => expect(fires(code, c), `${code} should not fire, case ${i}`).toBe(false));
    });
  }

  it("P09 fires once warm_water_f has a value, above it only", () => {
    const th = thresholds.map((t) => (t.name === "warm_water_f" ? { ...t, value: 60 } : t));
    expect(fires("P09", at(30, { lure_temp_f: 60.1 }), th)).toBe(true);
    expect(fires("P09", at(30, { lure_temp_f: 60 }), th)).toBe(false);
  });

  it("records why a rule was skipped", () => {
    const r = evaluate(ctx(at(30, { clarity: "stained", lure_temp_f: 75 })), rules, thresholds, catalog);
    expect(r.skipped).toContainEqual({ code: "P08", reason: "disabled" });
    expect(r.skipped).toContainEqual({ code: "P09", reason: "threshold warm_water_f has no value" });
  });

  it("a disabled rule changes the result", () => {
    const withR15 = evaluate(ctx(at(60, { lure_types_available: ["plug"] })), rules, thresholds, catalog);
    const without = evaluate(ctx(at(60, { lure_types_available: ["plug"] })), rules.map((r) => (r.code === "R15" ? { ...r, enabled: false } : r)), thresholds, catalog);
    expect(withR15.setups[0]!.finish_name).toMatch(/^Chrome/);
    expect(without.setups[0]!.finish_name).not.toMatch(/^Chrome/);
  });
});

describe("presentation details", () => {
  it("P02 keeps exactly one spoon line beside flasher and fly", () => {
    const r = evaluate(ctx(at(60)), rules, thresholds, catalog);
    expect(r.setups.map((s) => s.lure_type)).toEqual(["flasher_fly", "flasher_fly", "flasher_fly", "spoon"]);
    expect(r.spread_speed_mph).toEqual({ min: 2.4, max: 2.5 });
  });

  it("P04 runs glow spoons and, from July, one glow plug", () => {
    const july = evaluate(ctx(at(30, { light_period: "before_sunrise", sky: "low_light" })), rules, thresholds, catalog);
    expect(july.setups.map((s) => s.lure_type)).toEqual(["spoon", "spoon", "spoon", "plug"]);
    expect(july.setups.every((s) => /glow/i.test(s.finish_name))).toBe(true);
    const june = evaluate(ctx({ date: "2026-06-15", ...day, lure_depth_ft: 30, light_period: "before_sunrise" }), rules, thresholds, catalog);
    expect(june.setups.map((s) => s.lure_type)).toEqual(["spoon", "spoon", "spoon", "spoon"]);
  });

  it("seeds leaders at 23 inches behind an 8 inch flasher and 28 behind an 11 inch", () => {
    const shallow = evaluate(ctx(at(60)), rules, thresholds, catalog).setups.find((s) => s.lure_type === "flasher_fly")!;
    const deep = evaluate(ctx(at(90)), rules, thresholds, catalog).setups.find((s) => s.lure_type === "flasher_fly")!;
    expect([shallow.attractor_name, shallow.leader_in]).toEqual(["8 inch flasher", 23]);
    expect([deep.attractor_name, deep.leader_in]).toEqual(["11 inch flasher", 28]);
  });

  it("a third lure type appears only with 6 or more lines", () => {
    const c = { date: "2026-09-15", ...day, temp_source_level: 4 as const, break_depth_ft: 50, mode: "staging" as const };
    const four = evaluate(ctx(c), rules, thresholds, catalog);
    const six = evaluate(ctx({ ...c, lines_available: 6 }), rules, thresholds, catalog);
    expect(new Set(four.setups.map((s) => s.lure_type)).size).toBe(2);
    expect(six.setups.map((s) => s.lure_type)).toEqual(["plug", "plug", "plug", "meat_rig", "meat_rig", "flasher_fly"]);
  });

  it("says which rule the closest match breaks when no finish passes", () => {
    const redOnly = { lures: catalog.lures.filter((l) => l.lure_type === "plug").slice(0, 1).map((l) => ({ ...l, finishes: l.finishes.filter((f) => f.name === "Plain red") })) };
    const r = evaluate(ctx(at(30, { lure_types_available: ["plug"] })), rules, thresholds, redOnly);
    expect(r.setups[0]).toMatchObject({ finish_name: "Plain red", breaks_rule: "R10" });
    expect(r.notes.join(" ")).toMatch(/closest match and breaks rule R10/);
  });
});

describe("properties over random contexts", () => {
  // Small seeded generator so failures reproduce.
  let seed = 20261127;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const finishes = new Map(catalog.lures.flatMap((l) => l.finishes).map((f) => [f.id, f]));
  const typeBand = { spoon: [2.4, 3.0], flasher_fly: [2.0, 2.5], meat_rig: [1.8, 2.2] } as const;

  /** The color exclusions written out again, independent of the engine's rule interpreter. */
  const excluded = (id: string, depth: number, clarity: string | undefined) => {
    const f = finishes.get(id)!;
    const has = (x: string) => f.finish_types.includes(x as never);
    if (depth >= 20 && depth < 45 && ["red", "orange"].includes(f.color_family) && !has("fluorescent")) return "R10";
    if (depth >= 45 && depth <= 110 && !["green", "blue", "silver"].includes(f.color_family) && !has("chrome") && !has("glow")) return "R11";
    if (f.finish_types.every((x) => x === "uv") && !(depth < 60 && clarity === "clear")) return "R13";
    return null;
  };

  it("never puts an excluded finish, an excluded type or an impossible speed in a spread", () => {
    let checked = 0;
    for (let i = 0; i < 600; i++) {
      const month = 4 + Math.floor(rnd() * 7);
      const c = ctx({
        date: `2026-${String(month).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
        clarity: pick(["clear", "stained", "murky", "unknown", undefined] as const),
        sky: pick(["bright", "overcast", "low_light", undefined] as const),
        mode: pick(["offshore", "staging", undefined] as const),
        light_period: pick(["before_sunrise", "day", "after_sunset", undefined] as const),
        hours_after_sunrise: pick([0, 1, 3, 8, undefined] as const),
        wind_calm: pick([true, false, undefined] as const),
        lure_depth_ft: rnd() < 0.6 ? Math.round(rnd() * 140) : undefined,
        break_depth_ft: rnd() < 0.4 ? Math.round(20 + rnd() * 80) : undefined,
        temp_source_level: pick([0, 1, 3, 4, 5] as const),
        water_depth_ft: pick([40, 70, 150, undefined] as const),
        lines_available: pick([2, 3, 4, 6, 8, undefined] as const),
        wind_history: rnd() < 0.3 ? windFrom(pick([0, 45, 90, 180, 270]), 30) : undefined,
      });
      const r = evaluate(c, rules, thresholds, catalog);
      if (r.status !== "ok") { expect(r.setups).toEqual([]); continue; }
      checked++;
      const mid = (r.depth_ft!.min + r.depth_ft!.max) / 2;
      const label = JSON.stringify(c);
      expect(r.setups.length, label).toBeLessThanOrEqual(r.lines);
      expect(r.setups.filter((s) => s.lure_type === "meat_rig").length, label).toBeLessThanOrEqual(Math.floor(r.lines / 2));
      if (mid > 100) expect(r.setups.some((s) => s.lure_type === "spoon"), label).toBe(false);
      for (const s of r.setups) {
        expect(excluded(s.finish_id, mid, c.clarity), `${s.finish_name} at ${mid} ft ${label}`).toBeNull();
        if (s.attractor_finish_id) expect(excluded(s.attractor_finish_id, mid, c.clarity), label).toBeNull();
        expect(s.breaks_rule).toBeNull();
        expect(s.depth_ft).toEqual(r.depth_ft);
        expect(s.speed_mph.min, label).toBeGreaterThanOrEqual(r.spread_speed_mph!.min);
        expect(s.speed_mph.max, label).toBeLessThanOrEqual(r.spread_speed_mph!.max);
        expect(s.speed_mph.min, label).toBeLessThanOrEqual(s.speed_mph.max);
        if (s.lure_type !== "plug") {
          expect(r.spread_speed_mph!.min, label).toBeGreaterThanOrEqual(typeBand[s.lure_type][0]);
          expect(r.spread_speed_mph!.max, label).toBeLessThanOrEqual(typeBand[s.lure_type][1]);
        }
        expect((s.attractor_id !== null), label).toBe(s.lure_type === "flasher_fly" || s.lure_type === "meat_rig");
        for (const code of s.rule_codes) expect(codes(r), `${code} ${label}`).toContain(code);
      }
    }
    expect(checked).toBeGreaterThan(300);
  });
});
