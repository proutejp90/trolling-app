import { describe, expect, it } from "vitest";
import { ruleSchema, thresholdSchema, SETUP_LURE_TYPES, type Condition } from "@recommender/engine";
import { lures } from "../seed/lures";
import { ports } from "../seed/ports";
import { rules } from "../seed/rules";
import { distanceMi } from "../seed/geo";
import { stations } from "../seed/stations";
import { thresholds } from "../seed/thresholds";

const thresholdNames = new Set(thresholds.map((t) => t.name));

function thresholdRefs(c: Condition): string[] {
  if ("all" in c) return c.all.flatMap(thresholdRefs);
  if ("any" in c) return c.any.flatMap(thresholdRefs);
  if ("not" in c) return thresholdRefs(c.not);
  return c.threshold ? [c.threshold.split(".")[0]!] : [];
}

describe("seed rules", () => {
  it("holds the 19 starter rules, R20 the owner added, and the 12 presentation rules, each valid and unique", () => {
    const codes = rules.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.filter((c) => c.startsWith("R")).sort()).toEqual(
      Array.from({ length: 20 }, (_, i) => `R${String(i + 1).padStart(2, "0")}`),
    );
    expect(codes.filter((c) => c.startsWith("P")).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
    );
    for (const r of rules) expect(() => ruleSchema.parse(r), r.code).not.toThrow();
  });

  it("references only thresholds that exist", () => {
    for (const r of rules) {
      const named = Object.entries(r.recommend)
        .filter(([k]) => k.endsWith("_threshold") || k === "tip_threshold")
        .map(([, v]) => v as string);
      for (const name of [...thresholdRefs(r.when), ...named]) {
        expect(thresholdNames.has(name), `${r.code} reads ${name}`).toBe(true);
      }
    }
  });

  it("tags every presentation rule Lore and ranks exclusions and caps highest", () => {
    const p = rules.filter((r) => r.code.startsWith("P"));
    for (const r of p) expect(r.tags, r.code).toEqual(["lore"]);
    const pr = Object.fromEntries(p.map((r) => [r.code, r.priority]));
    expect(pr.P03).toBe(pr.P11);
    for (const [hi, lo] of [["P03", "P05"], ["P05", "P04"], ["P04", "P06"], ["P06", "P02"], ["P02", "P01"], ["P01", "P07"]] as const) {
      expect(pr[hi]!, `${hi} over ${lo}`).toBeGreaterThan(pr[lo]!);
    }
  });

  it("seeds Lake Ontario-only evidence disabled and everything else enabled", () => {
    for (const r of rules) expect(r.enabled, r.code).toBe(r.lakes.includes("michigan"));
  });

  it("matches the spec's example shape for R10", () => {
    const r10 = rules.find((r) => r.code === "R10")!;
    expect(r10.stage).toBe("color");
    expect(r10.recommend).toEqual({ exclude_colors: ["red", "orange"], unless_finish: ["fluorescent"] });
    expect(r10.tags).toEqual(["science"]);
  });
});

describe("seed thresholds", () => {
  it("are valid, unique and carry the spec's seed values", () => {
    expect(thresholdNames.size).toBe(thresholds.length);
    for (const t of thresholds) expect(() => thresholdSchema.parse(t), t.name).not.toThrow();
    const v = Object.fromEntries(thresholds.map((t) => [t.name, t.value]));
    expect(v).toMatchObject({
      temp_band_f: { min: 45, max: 55 }, red_max_ft: 20, orange_max_ft: 30, yellow_max_ft: 45,
      green_max_ft: 65, blue_max_ft: 110, uv_max_ft: 60, glow_lead_ft: 65, murky_factor: 0.5,
      upwelling_wind_hours: 24, probe_max_age_h: 3, probe_max_miles: 5,
      min_personal_passes: 20, min_option_passes: 5,
      speed_spoon_mph: { min: 2.4, max: 3.0 }, speed_flasher_fly_mph: { min: 2.0, max: 2.5 },
      speed_meat_rig_mph: { min: 1.8, max: 2.2 },
    });
  });

  it("flags placeholders and owner estimates", () => {
    const flagged = new Set(thresholds.filter((t) => t.is_owner_estimate).map((t) => t.name));
    for (const name of ["murky_factor", "upwelling_wind_hours", "upwelling_shift_ft", "warm_water_f", "speed_meat_rig_mph", "min_personal_passes", "min_option_passes"]) {
      expect(flagged.has(name), name).toBe(true);
    }
    for (const t of thresholds) if (t.value === null) expect(t.is_owner_estimate, t.name).toBe(true);
  });
});

describe("seed catalog, ports and stations", () => {
  it("has an active placeholder for all four setup types", () => {
    const types = new Set(lures.map((l) => l.lure_type));
    for (const t of SETUP_LURE_TYPES) {
      if (t === "flasher_fly") expect(types.has("attractor") && types.has("fly")).toBe(true);
      else expect(types.has(t), t).toBe(true);
    }
    expect(types.has("attractor")).toBe(true); // meat rigs need one too
  });

  it("gives a shop link only to house-brand lures, and marks plugs house brand", () => {
    for (const l of lures) {
      if (l.shop_url) expect(l.is_house_brand, l.name).toBe(true);
      expect(l.is_house_brand, l.name).toBe(l.lure_type === "plug");
      expect(l.finishes.length, l.name).toBeGreaterThan(0);
    }
  });

  it("includes the finishes the color rules' boundary tests need", () => {
    const spoon = lures.find((l) => l.lure_type === "spoon")!.finishes;
    const has = (pred: (f: (typeof spoon)[number]) => boolean) => spoon.some(pred);
    expect(has((f) => f.color_family === "red" && !f.finish_types.includes("fluorescent"))).toBe(true);
    expect(has((f) => f.color_family === "red" && f.finish_types.includes("fluorescent"))).toBe(true);
    expect(has((f) => f.finish_types.length === 1 && f.finish_types[0] === "uv")).toBe(true);
    expect(has((f) => f.finish_types.includes("glow"))).toBe(true);
    expect(has((f) => f.finish_types.includes("chrome") && f.pattern === "green back")).toBe(true);
    expect(has((f) => f.pattern === "ladderback")).toBe(true);
    expect(has((f) => f.pattern === "firetiger")).toBe(true);
  });

  it("seeds Michigan-side ports inside Lake Michigan's bounds", () => {
    expect(ports.length).toBeGreaterThan(0);
    for (const p of ports) {
      expect(p.state).toBe("MI");
      expect(p.shore).toBe("east");
      expect(p.lat).toBeGreaterThan(41.6);
      expect(p.lat).toBeLessThan(46.1);
      expect(p.lon).toBeGreaterThan(-88.1);
      expect(p.lon).toBeLessThan(-84.7);
    }
  });

  it("seeds the Michigan-side NDBC stations the spec names, and Seagull buoys with temperature at depth", () => {
    const ndbc = stations.filter((s) => s.source === "ndbc").map((s) => s.external_id);
    // 45170 Michigan City is on the far side of the lake's midline from every seeded port.
    for (const id of ["45002", "45007", "45029", "45161", "45168"]) expect(ndbc, id).toContain(id);
    const profile = stations.filter((s) => s.source === "seagull" && s.has_temp_profile);
    expect(profile.length).toBeGreaterThanOrEqual(5);
    for (const s of profile) expect("params" in s.meta && s.meta.params.temps.length, s.name).toBeGreaterThanOrEqual(3);
  });

  it("measures distance in statute miles", () => {
    expect(distanceMi(43, -86, 44, -86)).toBeCloseTo(69.1, 0);
    expect(distanceMi(43, -86, 43, -86)).toBe(0);
  });
});
