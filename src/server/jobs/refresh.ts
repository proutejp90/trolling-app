/**
 * Fills the conditions cache. Runs on a schedule (every 30 minutes in season),
 * never from a user request: the request path reads only what this job stored.
 *
 * Each source and each station fails alone. A buoy that is pulled, slow or
 * renamed costs that one buoy's readings, not the cycle.
 */
import type { SeagullMeta } from "../../../seed/stations";
import { distanceMi } from "../../../seed/geo";
import type { Queryable } from "../db";
import { fetchNdbc } from "../sources/ndbc";
import type { Threshold } from "@recommender/engine";
import { recordModelChecks } from "./model";
import { fetchAlerts, fetchGrid, fetchNearshoreProduct, fetchPoint, fetchStationList, fetchStationObservations, parseNearshore, type ForecastHour } from "../sources/nws";
import { fetchSeagull } from "../sources/seagull";
import { hourly, type Reading } from "../sources/types";

const KEEP_HOURS = 72; // enough for the 48 hour wind rule with room to spare
const PRUNE_DAYS = 7;

export interface RefreshSummary {
  now: string;
  stations: { source: string; id: string; name: string; readings: number; newest: string | null; note?: string }[];
  forecasts: { port: string; hours: number; note?: string }[];
  errors: string[];
}

export async function storeReadings(q: Queryable, stationId: string, readings: Reading[]) {
  if (!readings.length) return;
  await q.query(
    `insert into public.observations (station_id, observed_at, wind_dir_deg, wind_speed_ms, wave_height_m, wave_period_s, air_temp_c, water_temp_c, temp_profile)
     select $1, x.observed_at, x.wind_dir_deg, x.wind_speed_ms, x.wave_height_m, x.wave_period_s, x.air_temp_c, x.water_temp_c, x.temp_profile
     from jsonb_to_recordset($2::jsonb) as x(observed_at timestamptz, wind_dir_deg numeric, wind_speed_ms numeric, wave_height_m numeric, wave_period_s numeric, air_temp_c numeric, water_temp_c numeric, temp_profile jsonb)
     on conflict (station_id, observed_at) do update set
       wind_dir_deg = excluded.wind_dir_deg, wind_speed_ms = excluded.wind_speed_ms, wave_height_m = excluded.wave_height_m, wave_period_s = excluded.wave_period_s,
       air_temp_c = excluded.air_temp_c, water_temp_c = excluded.water_temp_c, temp_profile = excluded.temp_profile`,
    [stationId, JSON.stringify(readings)],
  );
}

async function storeForecast(q: Queryable, portId: string, hours: ForecastHour[], now: Date) {
  if (!hours.length) return;
  await q.query(
    `insert into public.forecasts (port_id, valid_at, fetched_at, sky_cover_pct, precip_pct, air_temp_c, wind_dir_deg, wind_speed_ms, hazards)
     select $1, x.valid_at, $3, x.sky_cover_pct, x.precip_pct, x.air_temp_c, x.wind_dir_deg, x.wind_speed_ms, coalesce(x.hazards, '[]'::jsonb)
     from jsonb_to_recordset($2::jsonb) as x(valid_at timestamptz, sky_cover_pct numeric, precip_pct numeric, air_temp_c numeric, wind_dir_deg numeric, wind_speed_ms numeric, hazards jsonb)
     on conflict (port_id, valid_at) do update set
       fetched_at = excluded.fetched_at, sky_cover_pct = excluded.sky_cover_pct, precip_pct = excluded.precip_pct, air_temp_c = excluded.air_temp_c,
       wind_dir_deg = excluded.wind_dir_deg, wind_speed_ms = excluded.wind_speed_ms, hazards = excluded.hazards`,
    [portId, JSON.stringify(hours), now],
  );
}

interface ZonePort { id: string; name: string; marine_zone: string | null }

/** Active alerts for each port's marine zone. Runs every 15 minutes, on its own and inside the full refresh. */
export async function refreshAlerts(q: Queryable, now: Date, ports?: ZonePort[]): Promise<{ zones: number; alerts: number; errors: string[] }> {
  const list = ports ?? (await q.query("select id, name, marine_zone from public.ports where active and marine_zone is not null")).rows as ZonePort[];
  const byZone = new Map<string, Awaited<ReturnType<typeof fetchAlerts>>>(), errors: string[] = [];
  let alerts = 0;
  for (const port of list) {
    if (!port.marine_zone) continue;
    try {
      if (!byZone.has(port.marine_zone)) byZone.set(port.marine_zone, await fetchAlerts(port.marine_zone));
      const found = byZone.get(port.marine_zone)!;
      alerts += found.length;
      await q.query(
        `insert into public.marine_forecasts (port_id, zone, alerts, alerts_fetched_at) values ($1, $2, $3, $4)
         on conflict (port_id) do update set zone = excluded.zone, alerts = excluded.alerts, alerts_fetched_at = excluded.alerts_fetched_at`,
        [port.id, port.marine_zone, JSON.stringify(found), now],
      );
    } catch (err) {
      errors.push(`NWS alerts for ${port.name}: ${(err as Error).message}`);
    }
  }
  return { zones: byZone.size, alerts, errors };
}

export async function refreshConditions(q: Queryable, now: Date): Promise<RefreshSummary> {
  const summary: RefreshSummary = { now: now.toISOString(), stations: [], forecasts: [], errors: [] };
  const since = new Date(now.getTime() - KEEP_HOURS * 3_600_000);
  const recent = (rs: Reading[]) => hourly(rs.filter((r) => r.observed_at >= since && r.observed_at <= now));
  const report = (s: { source: string; external_id: string; name: string }, kept: Reading[], note?: string) =>
    summary.stations.push({ source: s.source, id: s.external_id, name: s.name, readings: kept.length, newest: kept.at(-1)?.observed_at.toISOString() ?? null, ...(note ? { note } : {}) });

  // --- Ports: resolve each one's NWS grid and nearest observation station once ---
  const ports = (await q.query("select id, name, lat, lon, nws, marine_zone from public.ports where active")).rows;
  for (const port of ports) {
    // Ports linked before the forecast panel have a grid but no marine zone yet.
    if (port.nws && port.marine_zone) continue;
    try {
      const point = await fetchPoint(port.lat, port.lon);
      if (point.zone) {
        port.marine_zone = point.zone;
        await q.query("update public.ports set marine_zone = $2, time_zone = coalesce($3, time_zone) where id = $1", [port.id, point.zone, point.time_zone]);
      }
      if (port.nws) continue;
      const station = (await fetchStationList(point))[0];
      let stationRef: string | null = null;
      if (station) {
        const { rows } = await q.query(
          `insert into public.stations (source, external_id, name, lake, lat, lon, has_temp_profile, seasonal)
           values ('nws', $1, $2, 'michigan', $3, $4, false, false)
           on conflict (source, external_id) do update set name = excluded.name returning id`,
          [station.id, station.name, station.lat, station.lon],
        );
        await q.query(
          `insert into public.port_stations (port_id, station_id, distance_mi, rank)
           select $1, $2, $3, coalesce(max(rank), 0) + 1 from public.port_stations where port_id = $1
           on conflict (port_id, station_id) do nothing`,
          [port.id, rows[0].id, distanceMi(port.lat, port.lon, station.lat, station.lon).toFixed(1)],
        );
        stationRef = station.id;
      }
      port.nws = { ...point, station_id: stationRef };
      await q.query("update public.ports set nws = $2 where id = $1", [port.id, JSON.stringify(port.nws)]);
    } catch (err) {
      summary.errors.push(`NWS lookup for ${port.name}: ${(err as Error).message}`);
    }
  }

  const stations = (await q.query("select id, source, external_id, name, meta from public.stations order by source, external_id")).rows;

  // --- NDBC: one file per station per cycle ---
  for (const s of stations.filter((x) => x.source === "ndbc")) {
    try {
      const readings = await fetchNdbc(s.external_id);
      if (readings === null) { report(s, [], "no file: pulled for the season"); continue; }
      const kept = recent(readings);
      await storeReadings(q, s.id, kept);
      report(s, kept);
    } catch (err) {
      summary.errors.push(`NDBC ${s.external_id}: ${(err as Error).message}`);
    }
  }

  // --- GLOS Seagull: one request for every dataset ---
  const seagull = stations.filter((x) => x.source === "seagull" && x.meta?.dataset_id);
  try {
    const byDataset = await fetchSeagull(seagull.map((s) => s.meta as SeagullMeta), since);
    for (const s of seagull) {
      const kept = recent(byDataset.get(s.meta.dataset_id) ?? []);
      await storeReadings(q, s.id, kept);
      report(s, kept, kept.length ? undefined : "no readings in the window");
    }
  } catch (err) {
    summary.errors.push(`Seagull: ${(err as Error).message}`);
  }

  // --- NWS: forecast per port, wind history per observation station ---
  const gridsDone = new Map<string, ForecastHour[]>();
  for (const port of ports) {
    if (!port.nws?.grid_url) continue;
    try {
      const key = `${port.nws.grid_id}/${port.nws.grid_x},${port.nws.grid_y}`;
      if (!gridsDone.has(key)) gridsDone.set(key, await fetchGrid(port.nws));
      const hours = gridsDone.get(key)!;
      await storeForecast(q, port.id, hours, now);
      summary.forecasts.push({ port: port.name, hours: hours.length });
    } catch (err) {
      summary.errors.push(`NWS forecast for ${port.name}: ${(err as Error).message}`);
    }
  }
  // --- Marine forecast text, one product per office, and alerts per zone ---
  const products = new Map<string, Awaited<ReturnType<typeof fetchNearshoreProduct>>>();
  for (const port of ports) {
    if (!port.marine_zone || !port.nws?.grid_id) continue;
    try {
      const office = port.nws.grid_id as string;
      if (!products.has(office)) products.set(office, await fetchNearshoreProduct(office));
      const product = products.get(office);
      const marine = product ? parseNearshore(product.text, port.marine_zone, product.issued_at) : null;
      await q.query(
        `insert into public.marine_forecasts (port_id, zone, forecast_text, issued_at, text_fetched_at) values ($1, $2, $3, $4, $5)
         on conflict (port_id) do update set zone = excluded.zone, forecast_text = excluded.forecast_text, issued_at = excluded.issued_at, text_fetched_at = excluded.text_fetched_at`,
        [port.id, port.marine_zone, marine?.text ?? null, marine?.issued_at ?? null, now],
      );
    } catch (err) {
      summary.errors.push(`NWS marine forecast for ${port.name}: ${(err as Error).message}`);
    }
  }
  summary.errors.push(...(await refreshAlerts(q, now, ports)).errors);

  for (const s of (await q.query("select id, source, external_id, name from public.stations where source = 'nws'")).rows) {
    try {
      const kept = recent(await fetchStationObservations(s.external_id, since));
      await storeReadings(q, s.id, kept);
      report(s, kept);
    } catch (err) {
      summary.errors.push(`NWS observations ${s.external_id}: ${(err as Error).message}`);
    }
  }

  // With new readings in, compare any buoy profile with the lake model beside it.
  try {
    const thresholds = (await q.query("select name, value from public.thresholds")).rows as Threshold[];
    await recordModelChecks(q, thresholds, now);
  } catch (err) {
    summary.errors.push(`Model checks: ${(err as Error).message}`);
  }

  await q.query("delete from public.observations where observed_at < $1", [new Date(now.getTime() - PRUNE_DAYS * 86_400_000)]);
  await q.query("delete from public.forecasts where valid_at < $1", [new Date(now.getTime() - 86_400_000)]);
  return summary;
}
