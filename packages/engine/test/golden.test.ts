/**
 * Golden scenarios G1 to G16 from the build spec's Testing and evals section.
 * G17 to G23 cover the angler's own data and arrive with Phases 5 and 5b.
 */
import { describe, expect, it } from "vitest";
import { evaluate, type Catalog, type EngineResult } from "../src";
import { catalog, codes, ctx, PLUG_ONLY, profileWithBreakAt, rules, thresholds, windFrom } from "./helpers";

const run = (c: Parameters<typeof ctx>[0], cat: Catalog = catalog) => evaluate(ctx(c), rules, thresholds, cat);
const finishOf = (id: string) => catalog.lures.flatMap((l) => l.finishes).find((f) => f.id === id)!;
const types = (r: EngineResult) => r.setups.map((s) => s.lure_type);
const isGlow = (id: string) => finishOf(id).finish_types.includes("glow");
const isChromeBack = (id: string) => finishOf(id).finish_types.includes("chrome") && /^(green|blue) back$/.test(finishOf(id).pattern ?? "");

describe("golden scenarios: rules R01 to R19", () => {
  it("G1: Aug 15, Muskegon, no temperature data, clear, bright, offshore", () => {
    const r = run({ date: "2026-08-15", clarity: "clear", sky: "bright", mode: "offshore", ...PLUG_ONLY });
    expect(r.status).toBe("ok");
    expect(codes(r)).toEqual(expect.arrayContaining(["R03", "R07", "R11", "R12", "R15", "R18"]));
    expect(r.depth_ft).toEqual({ min: 50, max: 90 });
    const ranking = r.finish_ranking.plug!;
    expect(isGlow(ranking[0]!.finish_id)).toBe(true);
    expect(isChromeBack(ranking.find((f) => !isGlow(f.finish_id))!.finish_id)).toBe(true);
    expect(isGlow(r.setups[0]!.finish_id)).toBe(true);
    expect(isChromeBack(r.setups[1]!.finish_id)).toBe(true);
    expect(r.spread_speed_mph).toEqual({ min: 2.4, max: 2.8 });
  });

  it("G2: Jul 10, Grand Haven, profile with break at 50 ft, clear, bright", () => {
    const r = run({ date: "2026-07-10", temp_source_level: 1, temp_profile: profileWithBreakAt(50), clarity: "clear", sky: "bright", ...PLUG_ONLY });
    expect(codes(r)).toEqual(expect.arrayContaining(["R02", "R05", "R11", "R15", "R18"]));
    expect(codes(r)).not.toContain("R12");
    expect(r.depth_ft).toEqual({ min: 50, max: 70 });
    expect(isChromeBack(r.finish_ranking.plug![0]!.finish_id)).toBe(true);
  });

  it("G3: May 5, South Haven, no temperature data, clear, overcast", () => {
    const r = run({ date: "2026-05-05", clarity: "clear", sky: "overcast", ...PLUG_ONLY });
    expect(codes(r)).toEqual(expect.arrayContaining(["R01", "R09", "R12", "R18"]));
    expect(r.depth_ft).toEqual({ min: 0, max: 30 });
    expect(r.excluded_finishes).toEqual([]); // all colors allowed
    expect(isGlow(r.finish_ranking.plug![0]!.finish_id)).toBe(true);
  });

  it("G4: Sep 20, Manistee, staging, murky, low light, angler gives lure depth 15 ft", () => {
    const r = run({ date: "2026-09-20", mode: "staging", clarity: "murky", sky: "low_light", lure_depth_ft: 15 });
    // The owner turned murky_factor on (2026-11-27). The spec's G4 lists R09, written before the
    // factor applied: at 0.5, red carries to 10 ft, so at 15 ft R10 fires in its place.
    expect(codes(r)).toEqual(expect.arrayContaining(["R04", "R10", "R12", "R14", "R16", "R17"]));
    expect(codes(r)).not.toContain("R09");
    expect(r.color_band_factor).toBe(0.5);
    expect(r.excluded_finishes.map((e) => e.name)).toEqual(expect.arrayContaining(["Plain red", "Plain orange"]));
    const ranking = r.finish_ranking.plug!.map((f) => finishOf(f.finish_id));
    expect(ranking[0]!.finish_types).toContain("glow");
    expect(ranking[0]!.pattern).toBe("ladderback"); // ladderback preferred
    const afterGlow = ranking.filter((f) => !f.finish_types.includes("glow"));
    expect(afterGlow.slice(0, 2).map((f) => f.name).sort()).toEqual(["Chartreuse", "Firetiger"]);
    expect(r.spread_speed_mph).toEqual({ min: 1.8, max: 2.2 });
  });

  it("G5: Sep 20, Manistee, staging, no depth given", () => {
    const r = run({ date: "2026-09-20", mode: "staging", clarity: "clear", sky: "bright" });
    expect(r.status).toBe("needs_input");
    expect(r.depth_ft).toBeNull();
    expect(r.question?.field).toBe("break_depth_ft");
    expect(r.question?.text).toMatch(/break|lure depth/i);
    expect(r.setups).toEqual([]);
  });

  it("G6: any context with lure depth 80 ft excludes every UV-only finish by R13", () => {
    for (const c of [
      { date: "2026-08-15", clarity: "clear" as const, sky: "bright" as const },
      { date: "2026-07-01", clarity: "stained" as const, sky: "overcast" as const },
      { date: "2026-09-10", clarity: "clear" as const, sky: "low_light" as const },
    ]) {
      const r = run({ ...c, lure_depth_ft: 80 });
      const uvOnly = catalog.lures.filter((l) => r.setups.some((s) => s.lure_id === l.id || s.attractor_id === l.id))
        .flatMap((l) => l.finishes).filter((f) => f.finish_types.every((t) => t === "uv"));
      for (const f of uvOnly) {
        expect(r.excluded_finishes.find((e) => e.finish_id === f.id)?.rule_code, f.id).toBe("R13");
      }
      expect(r.setups.length).toBeGreaterThan(0);
      expect(r.setups.some((s) => finishOf(s.finish_id).finish_types.every((t) => t === "uv"))).toBe(false);
    }
  });

  it("G7: lure depth 30 ft excludes plain red and allows fluorescent red (R10)", () => {
    const r = run({ date: "2026-07-10", clarity: "clear", sky: "bright", lure_depth_ft: 30, ...PLUG_ONLY });
    const lure = r.setups[0]!.lure_id;
    expect(r.excluded_finishes).toContainEqual(expect.objectContaining({ lure_id: lure, name: "Plain red", rule_code: "R10" }));
    expect(r.excluded_finishes.some((e) => e.name === "Fluorescent red")).toBe(false);
    expect(r.finish_ranking.plug!.some((f) => f.name === "Fluorescent red")).toBe(true);
  });

  it("G8: Aug, east-shore port, 30 hours of northeast wind", () => {
    const base = { date: "2026-08-15", clarity: "clear" as const, sky: "bright" as const, ...PLUG_ONLY };
    const calm = run(base);
    const windy = run({ ...base, wind_history: windFrom(45, 30) });
    expect(codes(windy)).toContain("R08");
    expect(codes(calm)).not.toContain("R08");
    expect(windy.depth_ft!.min).toBeLessThan(calm.depth_ft!.min);
    expect(windy.depth_ft!.max).toBeLessThan(calm.depth_ft!.max);
  });

  it("G9: offshore mode, plug with tested range 1.6 to 2.2 mph", () => {
    const slow: Catalog = { lures: catalog.lures.filter((l) => l.lure_type === "plug").slice(0, 1).map((l) => ({ ...l, speed_min_mph: 1.6, speed_max_mph: 2.2 })) };
    const r = run({ date: "2026-07-10", mode: "offshore", clarity: "clear", sky: "bright", ...PLUG_ONLY }, slow);
    expect(r.setups).toEqual([]);
    expect(r.dropped_lures).toHaveLength(1);
    expect(r.dropped_lures[0]!.reason).toMatch(/speed/i);
    expect(r.dropped_lures[0]!.reason).toMatch(/1\.6 to 2\.2/);
  });

  it("G10: Jan 15, any port, is out of season", () => {
    const r = run({ date: "2026-01-15", clarity: "clear", sky: "bright" });
    expect(r.status).toBe("out_of_season");
    expect(r.setups).toEqual([]);
  });
});

describe("golden scenarios: Presentation stage", () => {
  it("G11: Aug 15, Muskegon, offshore, depth 50 to 90 ft, 10 a.m., clear, bright", () => {
    const r = run({ date: "2026-08-15", mode: "offshore", clarity: "clear", sky: "bright", light_period: "day", hours_after_sunrise: 3.5 });
    expect(codes(r)).toEqual(expect.arrayContaining(["P02", "P06"]));
    expect(r.depth_ft).toEqual({ min: 50, max: 90 });
    expect(types(r)).toEqual(["flasher_fly", "flasher_fly", "meat_rig", "meat_rig"]);
    expect(r.setups.filter((s) => s.lure_type === "meat_rig").every((s) => s.position === "deepest")).toBe(true);
    expect(r.dropped_types).toContainEqual(expect.objectContaining({ lure_type: "spoon", reason: expect.stringMatching(/speed/i) }));
    expect(r.spread_speed_mph).toEqual({ min: 2.0, max: 2.2 });
  });

  it("G12: Sep 20, Manistee, staging, lure depth 15 ft, low light", () => {
    const r = run({ date: "2026-09-20", mode: "staging", clarity: "clear", sky: "low_light", lure_depth_ft: 15 });
    expect(codes(r)).toEqual(expect.arrayContaining(["P01", "P05"]));
    expect(types(r)).toEqual(["plug", "plug", "meat_rig", "meat_rig"]);
    expect(r.spread_speed_mph).toEqual({ min: 1.8, max: 2.2 });
  });

  it("G13: May 5, South Haven, depth 0 to 30 ft, clear, bright, calm", () => {
    const r = run({ date: "2026-05-05", clarity: "clear", sky: "bright", wind_calm: true });
    expect(codes(r)).toEqual(expect.arrayContaining(["P01", "P07"]));
    expect(r.depth_ft).toEqual({ min: 0, max: 30 });
    expect(types(r)).toEqual(["spoon", "spoon", "spoon", "spoon"]);
    expect(r.setups.every((s) => s.attractor_id === null)).toBe(true);
    expect(r.spread_speed_mph).toEqual({ min: 2.4, max: 3.0 });
  });

  it("G14: Jul 20, lure depth 120 ft, midday", () => {
    const r = run({ date: "2026-07-20", clarity: "clear", sky: "bright", lure_depth_ft: 120, light_period: "day", hours_after_sunrise: 6 });
    expect(codes(r)).toEqual(expect.arrayContaining(["P03", "P06", "P10"]));
    expect(new Set(types(r))).toEqual(new Set(["flasher_fly", "meat_rig"]));
    expect(r.dropped_types).toContainEqual(expect.objectContaining({ lure_type: "spoon", rule_code: "P03" }));
    expect(r.attractor_size_in).toEqual({ min: 10, max: 12 });
    for (const s of r.setups) {
      const size = catalog.lures.find((l) => l.id === s.attractor_id)!.size_in!;
      expect(size).toBeGreaterThanOrEqual(10);
      expect(size).toBeLessThanOrEqual(12);
    }
  });

  it("G15: when meat ranks first, no more than 2 of 4 lines carry meat (P11)", () => {
    const r = run({ date: "2026-09-20", mode: "staging", clarity: "clear", sky: "bright", lure_depth_ft: 20, lure_types_available: ["meat_rig", "flasher_fly"] });
    expect(r.setups[0]!.lure_type).toBe("meat_rig");
    expect(codes(r)).toContain("P11");
    expect(types(r).filter((t) => t === "meat_rig")).toHaveLength(2);
    expect(r.setups).toHaveLength(4);
  });

  it("G16: catalog has no active lure of the first-ranked type", () => {
    const noSpoons: Catalog = { lures: catalog.lures.map((l) => (l.lure_type === "spoon" ? { ...l, active: false } : l)) };
    const r = run({ date: "2026-05-05", clarity: "clear", sky: "overcast" }, noSpoons);
    expect(codes(r)).toContain("P01"); // spoons rank first
    expect(r.dropped_types).toContainEqual(expect.objectContaining({ lure_type: "spoon", reason: expect.stringMatching(/no active/i) }));
    expect(r.setups).toHaveLength(4);
    expect(types(r)).not.toContain("spoon");
  });
});

describe("engine clarifications", () => {
  it("uses the midpoint of the depth range as the lure depth for color rules", () => {
    // 50 to 90 ft: the midpoint, 70, is over glow_lead_ft (65) although the top of the range is not.
    const r = run({ date: "2026-08-15", clarity: "clear", sky: "bright", ...PLUG_ONLY });
    expect(codes(r)).toContain("R12");
  });

  it("returns setups for every month from April to October", () => {
    for (let month = 4; month <= 10; month++) {
      const date = `2026-${String(month).padStart(2, "0")}-15`;
      let r = run({ date, clarity: "clear", sky: "bright", light_period: "day", hours_after_sunrise: 4 });
      if (r.status === "needs_input") r = run({ date, clarity: "clear", sky: "bright", light_period: "day", hours_after_sunrise: 4, temp_source_level: 4, break_depth_ft: 45 });
      expect(r.status, date).toBe("ok");
      expect(r.setups.length, date).toBeGreaterThan(0);
      expect(r.spread_speed_mph, date).not.toBeNull();
    }
  });

  it("returns out of season for November through March", () => {
    for (const m of ["11", "12", "01", "02", "03"]) expect(run({ date: `2026-${m}-10` }).status).toBe("out_of_season");
  });
});
