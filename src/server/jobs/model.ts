/**
 * Stores what the lake model job posts: sample points off each port and one modeled
 * temperature profile per point per hour. The job (jobs/lake_model, Python, on GitHub
 * Actions) does the reading; this is the only code that writes it down.
 */
import type { Threshold } from "@recommender/engine";
import { z } from "zod";
import type { Queryable } from "../db";

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
