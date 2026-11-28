/**
 * NOAA's lake model, as the recommendation reads it. Everything here is modeled,
 * never measured, and is labeled so wherever it is used.
 */
import { cToF, mToFt, round } from "./units";

export type PointLabel = "near" | "mid" | "off";
export interface ModelRow {
  label: PointLabel; bottom_depth_m: number; run_at: Date; valid_at: Date; is_forecast: boolean;
  profile: { depth_m: number; temp_c: number }[]; surface_temp_c: number | null; break_depth_m: number | null; band_depth_m: number | null;
}
export interface Range { min: number; max: number }

export interface ModelPoint {
  label: PointLabel;
  /** The real bottom depth at the grid node, which on a steep shore is not the 60, 120 or 200 ft aimed for. */
  water_depth_ft: number;
  valid_at: string;
  profile: { depth_ft: number; temp_f: number }[];
  surface_temp_f: number | null;
  /** The steepest drop, as a range one model layer thick. Null when the water does not cool with depth. */
  break_ft: Range | null;
  /** One model layer's thickness here: the finest the model can place anything. */
  layer_ft: number;
}

export interface ModelView {
  run_at: string;
  age_hours: number;
  /** True when the profile is the model's forecast for a later time, not its picture of now. */
  is_forecast: boolean;
  /** The sample point in use. */
  point: PointLabel;
  points: ModelPoint[];
  /** For a later day: today's break at the same point, to show the trend. */
  break_today_ft: Range | null;
  /** The near-shore water is colder and its cold layer shallower than a day earlier. Null when there is nothing to compare. */
  upwelling: boolean | null;
}

const LAYERS = 20;
const feet = (m: number) => Math.round(mToFt(m));

/** A depth the model gives, as a range one layer thick, never below the bottom or above the surface. */
export function asRange(depthM: number, bottomM: number): Range {
  const half = mToFt(bottomM / LAYERS) / 2, at = mToFt(depthM);
  return { min: Math.max(0, Math.round(at - half)), max: Math.min(feet(bottomM), Math.round(at + half)) };
}

export function toPoint(row: ModelRow): ModelPoint {
  return {
    label: row.label, water_depth_ft: feet(Number(row.bottom_depth_m)), valid_at: row.valid_at.toISOString(),
    profile: row.profile.map((p) => ({ depth_ft: feet(p.depth_m), temp_f: round(cToF(p.temp_c)) })),
    surface_temp_f: row.surface_temp_c === null ? null : round(cToF(Number(row.surface_temp_c))),
    break_ft: row.break_depth_m === null ? null : asRange(Number(row.break_depth_m), Number(row.bottom_depth_m)),
    layer_ft: Math.max(1, Math.round(mToFt(Number(row.bottom_depth_m) / LAYERS))),
  };
}

/** Depth of the steepest cooling in a profile, at the midpoint of that step, in metres. Null when it never cools going down. */
export function steepestDropM(profile: { depth_m: number; temp_c: number }[]): number | null {
  const p = [...profile].sort((a, b) => a.depth_m - b.depth_m);
  let best: { rate: number; depth: number } | null = null;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    if (b.depth_m <= a.depth_m) continue;
    const rate = (a.temp_c - b.temp_c) / (b.depth_m - a.depth_m);
    if (rate > 0 && (!best || rate > best.rate)) best = { rate, depth: (a.depth_m + b.depth_m) / 2 };
  }
  return best ? Math.round(best.depth * 100) / 100 : null;
}

const nearest = (rows: ModelRow[], at: Date, withinMs = 90 * 60_000) =>
  rows.map((r) => ({ r, gap: Math.abs(r.valid_at.getTime() - at.getTime()) })).filter((x) => x.gap <= withinMs).sort((a, b) => a.gap - b.gap)[0]?.r ?? null;

/**
 * The model's view for one trip: the profile at each sample point nearest the trip time.
 * Null when there is none, or when the newest run is older than the age limit.
 */
export function modelView(input: {
  rows: ModelRow[]; tripTime: Date | null; now: Date; point: PointLabel; maxAgeHours: number;
  /** How much colder the near-shore surface must be than a day earlier to call an upwelling, in °F. */
  upwellingDropF: number;
}): { view: ModelView | null; stale_hours: number | null } {
  const { rows, tripTime, now } = input;
  if (!rows.length || !tripTime) return { view: null, stale_hours: null };
  const newestRun = rows.reduce((a, r) => Math.max(a, r.run_at.getTime()), 0);
  const ageHours = (now.getTime() - newestRun) / 3_600_000;
  if (ageHours > input.maxAgeHours) return { view: null, stale_hours: Math.round(ageHours) };

  const at = (label: PointLabel, when: Date) => nearest(rows.filter((r) => r.label === label), when);
  const points = (["near", "mid", "off"] as const).map((l) => at(l, tripTime)).filter((r): r is ModelRow => r !== null);
  const chosen = points.find((p) => p.label === input.point) ?? points.find((p) => p.label === "mid") ?? points[0];
  if (!chosen) return { view: null, stale_hours: null };

  const todayRow = at(chosen.label, now);
  const later = tripTime.getTime() - now.getTime() > 90 * 60_000;
  // An upwelling shows near shore first: colder at the surface, and the cold layer closer to it, than a day before.
  const nearNow = at("near", tripTime), nearBefore = at("near", new Date(tripTime.getTime() - 24 * 3_600_000));
  let upwelling: boolean | null = null;
  if (nearNow && nearBefore && nearNow.surface_temp_c !== null && nearBefore.surface_temp_c !== null) {
    const colder = cToF(Number(nearBefore.surface_temp_c)) - cToF(Number(nearNow.surface_temp_c)) >= input.upwellingDropF;
    const layer = Number(nearNow.bottom_depth_m) / LAYERS;
    const shallower = nearNow.band_depth_m !== null && nearBefore.band_depth_m !== null && Number(nearBefore.band_depth_m) - Number(nearNow.band_depth_m) >= layer;
    upwelling = colder && shallower;
  }
  return {
    stale_hours: null,
    view: {
      run_at: new Date(newestRun).toISOString(), age_hours: round(ageHours, 1), is_forecast: later,
      point: chosen.label, points: points.map(toPoint),
      break_today_ft: later && todayRow && todayRow.break_depth_m !== null ? asRange(Number(todayRow.break_depth_m), Number(todayRow.bottom_depth_m)) : null,
      upwelling,
    },
  };
}
