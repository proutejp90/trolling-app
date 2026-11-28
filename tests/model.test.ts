/** How the recommendation reads the lake model (G24 to G27). Hand-built rows in the job's shape. */
import { describe, expect, it } from "vitest";
import { asRange, modelView, toPoint, type ModelRow } from "../src/server/model";

const now = new Date("2026-05-10T14:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);
/** A column over 61 m (200 ft): warm above the break, cold below it. */
function row(label: ModelRow["label"], validAt: Date, opts: { breakM?: number; surfaceC?: number; bandM?: number | null; bottomM?: number; runAt?: Date } = {}): ModelRow {
  const bottom = opts.bottomM ?? 60.96, breakM = opts.breakM ?? 12.2, surface = opts.surfaceC ?? 14;
  const profile = Array.from({ length: 20 }, (_, k) => {
    const depth = ((k + 0.5) / 20) * bottom;
    return { depth_m: Math.round(depth * 100) / 100, temp_c: depth < breakM ? surface : 6 };
  });
  return { label, bottom_depth_m: bottom, run_at: opts.runAt ?? hours(-3), valid_at: validAt, is_forecast: validAt > now, profile, surface_temp_c: surface, break_depth_m: breakM, band_depth_m: opts.bandM === undefined ? breakM : opts.bandM };
}
const view = (rows: ModelRow[], over: Partial<Parameters<typeof modelView>[0]> = {}) =>
  modelView({ rows, tripTime: now, now, point: "mid", maxAgeHours: 12, upwellingDropF: 2, ...over });

describe("lake model view", () => {
  it("states a depth as a range one layer thick", () => {
    // 200 ft of water in 20 layers is 10 ft a layer: a break at 40 ft is 35 to 45.
    expect(asRange(12.19, 60.96)).toEqual({ min: 35, max: 45 });
    expect(asRange(0.5, 60.96)).toEqual({ min: 0, max: 7 }); // never above the surface
    expect(asRange(60.5, 60.96)).toEqual({ min: 193, max: 200 }); // never below the bottom
    // In 60 ft of water a layer is 3 ft, so the range is tighter.
    expect(asRange(6.1, 18.29)).toEqual({ min: 19, max: 22 });
  });

  it("G24: a run three hours old gives the profile at the chosen point, in feet and °F", () => {
    const { view: v, stale_hours } = view([row("near", now, { bottomM: 18.9 }), row("mid", now), row("off", now)]);
    expect(stale_hours).toBeNull();
    expect(v).toMatchObject({ point: "mid", age_hours: 3, is_forecast: false, break_today_ft: null });
    expect(v!.points.map((p) => p.label)).toEqual(["near", "mid", "off"]);
    const mid = v!.points[1]!;
    expect(mid).toMatchObject({ water_depth_ft: 200, layer_ft: 10, surface_temp_f: 57.2, break_ft: { min: 35, max: 45 } });
    expect(mid.profile).toHaveLength(20);
    expect(mid.profile[0]).toEqual({ depth_ft: 5, temp_f: 57.2 });
    expect(mid.profile[19]).toEqual({ depth_ft: 195, temp_f: 42.8 });
  });

  it("uses the point the angler picked, and mid when that one is missing", () => {
    const rows = [row("near", now, { bottomM: 18.9 }), row("mid", now), row("off", now)];
    expect(view(rows, { point: "off" }).view!.point).toBe("off");
    expect(view(rows.slice(1), { point: "near" }).view!.point).toBe("mid");
  });

  it("G26: a run fifteen hours old is skipped, and says how old it was", () => {
    const old = [row("mid", now, { runAt: hours(-15) })];
    expect(view(old)).toEqual({ view: null, stale_hours: 15 });
    expect(view([row("mid", now, { runAt: hours(-12) })]).view).not.toBeNull(); // at the limit
    expect(view([])).toEqual({ view: null, stale_hours: null });
  });

  it("G27: three days ahead uses the forecast for that time, with today's break beside it", () => {
    const trip = hours(72);
    const { view: v } = view([row("mid", now, { breakM: 12.2 }), row("mid", trip, { breakM: 18.3 })], { tripTime: trip });
    expect(v).toMatchObject({ is_forecast: true, point: "mid", break_today_ft: { min: 35, max: 45 } });
    expect(v!.points[0]!.break_ft).toEqual({ min: 55, max: 65 });
    expect(v!.points[0]!.valid_at).toBe(trip.toISOString());
    // No profile within 90 minutes of the trip: nothing to show for that day.
    expect(view([row("mid", now)], { tripTime: trip }).view).toBeNull();
  });

  it("reads an upwelling off the near point: colder at the surface and the cold layer shallower than a day before", () => {
    const yesterday = row("near", hours(-24), { bottomM: 18.3, surfaceC: 18, bandM: 12 });
    const today = (surfaceC: number, bandM: number | null) => view([yesterday, row("near", now, { bottomM: 18.3, surfaceC, bandM }), row("mid", now)]).view!.upwelling;
    expect(today(12, 3)).toBe(true);
    expect(today(17.5, 3)).toBe(false); // not 2 °F colder
    expect(today(12, 11.5)).toBe(false); // the cold layer has not come up a layer
    expect(today(12, null)).toBe(false);
    expect(view([row("near", now), row("mid", now)]).view!.upwelling).toBeNull(); // no day before to compare
  });

  it("gives no break where the water does not cool with depth", () => {
    expect(toPoint({ ...row("mid", now), break_depth_m: null }).break_ft).toBeNull();
  });
});
