/**
 * Stores what the lake model job posts: sample points off each port and one modeled
 * temperature profile per point per hour. The job (jobs/lake_model, Python, on GitHub
 * Actions) does the reading; this is the only code that writes it down.
 */
import type { Threshold } from "@recommender/engine";
import { z } from "zod";
import { distanceMi } from "../../../seed/geo";
import type { Queryable } from "../db";
import { steepestDropM } from "../model";

const point = z.object({
  port_id: z.string().uuid(), label: z.enum(["near", "mid", "off"]),
  lat: z.number().min(41).max(47), lon: z.number().min(-89).max(-84),
  node_index: z.number().int().min(0), bottom_depth_m: z.number().min(1).max(300),
}).strict();

const layer = z.object({ depth_m: z.number().min(0).max(300), temp_c: z.number().min(-1).max(35) }).strict();
const profile = z.object({
  port_id: z.string().uuid(), label: z.enum(["near", "mid", "off"]),
  valid_at: z.string().datetime(), is_forecast: z.boolean(),
  profile: z.array(layer).min(3).max(40),
  surface_temp_c: z.number().min(-1).max(35),
  break_depth_m: z.number().min(0).max(300).nullable(),
  band_depth_m: z.number().min(0).max(300).nullable(),
}).strict();

export const modelUpload = z.object({
  run_at: z.string().datetime(),
  points: z.array(point).max(200),
  profiles: z.array(profile).max(5000),
}).strict();
export type ModelUpload = z.infer<typeof modelUpload>;

/** What the job needs to know before it reads anything: the ports and the top of the temperature band. */
export async function modelSetup(q: Queryable, thresholds: Threshold[]) {
  const band = thresholds.find((t) => t.name === "temp_band_f")?.value;
  const { rows } = await q.query("select id, name, lat, lon, shore from public.ports where active order by lat");
  return {
    temp_band_top_f: band !== null && typeof band === "object" ? band.max : 55,
    ports: rows.map((r) => ({ id: r.id as string, name: r.name as string, lat: Number(r.lat), lon: Number(r.lon), shore: r.shore as "east" | "west" })),
  };
}

/**
 * Keeps the model honest: wherever a buoy has measured a temperature profile within a few miles
 * of a sample point, the measured and modeled break depths are stored side by side. Run from
 * the conditions refresh, after new readings arrive. One row per point and reading.
 */
export async function recordModelChecks(q: Queryable, thresholds: Threshold[], now: Date): Promise<number> {
  const maxMiles = Number(thresholds.find((t) => t.name === "model_check_max_miles")?.value ?? 5);
  const { rows } = await q.query(
    `select mp.id as point_id, mp.lat as point_lat, mp.lon as point_lon, s.lat as station_lat, s.lon as station_lon,
            o.observed_at, o.temp_profile, pr.break_depth_m as modeled
     from public.model_points mp
     join public.port_stations ps on ps.port_id = mp.port_id
     join public.stations s on s.id = ps.station_id and s.source <> 'nws'
     join lateral (
       select observed_at, temp_profile from public.observations
       where station_id = s.id and observed_at > $1 and observed_at <= $2 and jsonb_array_length(coalesce(temp_profile, '[]'::jsonb)) >= 3
       order by observed_at desc limit 1
     ) o on true
     join lateral (
       select break_depth_m from public.model_profiles
       where model_point_id = mp.id and valid_at between o.observed_at - interval '45 minutes' and o.observed_at + interval '45 minutes'
       order by abs(extract(epoch from valid_at - o.observed_at)) limit 1
     ) pr on true
     where pr.break_depth_m is not null`,
    [new Date(now.getTime() - 3 * 3_600_000), now],
  );
  let stored = 0;
  for (const r of rows) {
    if (distanceMi(Number(r.point_lat), Number(r.point_lon), Number(r.station_lat), Number(r.station_lon)) > maxMiles) continue;
    const measured = steepestDropM(r.temp_profile as { depth_m: number; temp_c: number }[]);
    if (measured === null) continue;
    const res = await q.query(
      `insert into public.model_checks (model_point_id, checked_at, measured_source, measured_break_m, modeled_break_m)
       values ($1, $2, 'buoy', $3, $4) on conflict (model_point_id, checked_at, measured_source) do nothing`,
      [r.point_id, r.observed_at, measured, r.modeled],
    );
    stored += res.rowCount ?? 0;
  }
  return stored;
}

const KEEP_PAST_HOURS = 48; // yesterday's profile is needed to see an upwelling arrive

export async function storeModel(q: Queryable, upload: ModelUpload, now: Date): Promise<{ points: number; profiles: number }> {
  if (upload.points.length) {
    await q.query(
      `insert into public.model_points (port_id, label, lat, lon, node_index, bottom_depth_m)
       select x.port_id, x.label, x.lat, x.lon, x.node_index, x.bottom_depth_m
       from jsonb_to_recordset($1::jsonb) as x(port_id uuid, label text, lat double precision, lon double precision, node_index int, bottom_depth_m numeric)
       join public.ports p on p.id = x.port_id
       on conflict (port_id, label) do update set lat = excluded.lat, lon = excluded.lon, node_index = excluded.node_index, bottom_depth_m = excluded.bottom_depth_m`,
      [JSON.stringify(upload.points)],
    );
  }
  let stored = 0;
  if (upload.profiles.length) {
    // An older run never replaces a newer run's value for the same hour.
    const res = await q.query(
      `insert into public.model_profiles (model_point_id, run_at, valid_at, is_forecast, profile, surface_temp_c, break_depth_m, band_depth_m)
       select mp.id, $2, x.valid_at, x.is_forecast, x.profile, x.surface_temp_c, x.break_depth_m, x.band_depth_m
       from jsonb_to_recordset($1::jsonb) as x(port_id uuid, label text, valid_at timestamptz, is_forecast boolean, profile jsonb, surface_temp_c numeric, break_depth_m numeric, band_depth_m numeric)
       join public.model_points mp on mp.port_id = x.port_id and mp.label = x.label
       on conflict (model_point_id, valid_at) do update set
         run_at = excluded.run_at, is_forecast = excluded.is_forecast, profile = excluded.profile,
         surface_temp_c = excluded.surface_temp_c, break_depth_m = excluded.break_depth_m, band_depth_m = excluded.band_depth_m
       where public.model_profiles.run_at <= excluded.run_at`,
      [JSON.stringify(upload.profiles), upload.run_at],
    );
    stored = res.rowCount ?? 0;
  }
  await q.query("delete from public.model_profiles where valid_at < $1", [new Date(now.getTime() - KEEP_PAST_HOURS * 3_600_000)]);
  return { points: upload.points.length, profiles: stored };
}
