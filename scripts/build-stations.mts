/**
 * Rebuilds seed/stations.ts from the live NDBC station list and the GLOS Seagull
 * platform and parameter lists. Run by hand when buoys change:
 *   tsx scripts/build-stations.mts
 * It calls live APIs, so it is never run by tests or CI.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ports } from "../seed/ports";
import { distanceMi } from "../seed/geo";

const UA = { "User-Agent": process.env.NWS_USER_AGENT ?? "conditions-recommender (station list build)" };
const get = async (url: string) => {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};
const NEAR_PORT_MI = 40;
/** West of this the Wisconsin shore's water takes over, where the same wind does the opposite. */
const EAST_SIDE_MIN_LON = -86.7;
/** Inland lakes and bays whose water says nothing about the open lake. */
const NOT_OPEN_LAKE = /Muskegon Lake|Lake Macatawa|Observatory|Traverse Bay|Green Bay|Water Level|Prior Platform/i;
const nearest = (lat: number, lon: number) => Math.min(...ports.map((p) => distanceMi(p.lat, p.lon, lat, lon)));

interface Param { parameter_id: number; platform_id: number; standard_name: string | null; depth: number | null }
interface Summary {
  obs_dataset_id: number; platform_name: string; org_platform_id: string | null; ndbc_id: string | null;
  deployment_site: { body_of_water: string; latitude: number; longitude: number } | null;
  obs_dataset_platform_assignment: { platform_id: number; platform: { platform_type: string } } | null;
}

const [summaries, params, activeXml] = await Promise.all([
  get("https://seagull-api.glos.org/api/v1/obs-dataset-summaries").then((r) => r.json() as Promise<Summary[]>),
  get("https://seagull-api.glos.org/api/v1/parameters").then((r) => r.json() as Promise<Param[]>),
  get("https://www.ndbc.noaa.gov/activestations.xml").then((r) => r.text()),
]);

const byPlatform = new Map<number, Param[]>();
for (const p of params) byPlatform.set(p.platform_id, [...(byPlatform.get(p.platform_id) ?? []), p]);

const stations: Record<string, unknown>[] = [];
const coveredNdbc = new Set<string>();

for (const s of summaries) {
  const site = s.deployment_site, assign = s.obs_dataset_platform_assignment;
  if (!site || !assign || site.body_of_water !== "lake-michigan") continue;
  if (!["moored_buoy", "tower"].includes(assign.platform.platform_type)) continue;
  if (NOT_OPEN_LAKE.test(s.platform_name) || site.longitude < EAST_SIDE_MIN_LON || nearest(site.latitude, site.longitude) > NEAR_PORT_MI) continue;
  const ps = byPlatform.get(assign.platform_id) ?? [];
  const one = (name: string) => ps.find((p) => p.standard_name === name)?.parameter_id ?? null;
  const temps = ps
    .filter((p) => p.standard_name === "sea_water_temperature" && p.depth !== null && p.depth >= 0)
    .map((p) => ({ depth_m: p.depth as number, id: p.parameter_id }))
    .sort((a, b) => a.depth_m - b.depth_m || a.id - b.id)
    .filter((t, i, all) => i === 0 || all[i - 1]!.depth_m !== t.depth_m);
  const surface = ps.find((p) => p.standard_name === "sea_surface_temperature")?.parameter_id ?? temps.find((t) => t.depth_m <= 1)?.id ?? null;
  const meta = {
    dataset_id: s.obs_dataset_id, ndbc_id: s.ndbc_id ?? (/^\d{5}$|^[A-Z]{4}\d$/.test(s.org_platform_id ?? "") ? s.org_platform_id : null),
    params: { wind_dir: one("wind_from_direction"), wind_speed: one("wind_speed"), wave_height: one("sea_surface_wave_significant_height"), air_temp: one("air_temperature"), surface_temp: surface, temps },
  };
  if (!meta.params.wind_dir && !surface && !temps.length) continue;
  if (meta.ndbc_id) coveredNdbc.add(meta.ndbc_id);
  stations.push({
    source: "seagull", external_id: String(s.obs_dataset_id), name: s.platform_name.trim(), lake: "michigan",
    lat: site.latitude, lon: site.longitude, has_temp_profile: temps.length >= 3,
    seasonal: assign.platform.platform_type === "moored_buoy", meta,
  });
}

// NDBC serves the same buoys' surface readings, often days fresher than Seagull, plus stations Seagull lacks.
for (const m of activeXml.matchAll(/<station id="([^"]+)" lat="([^"]+)" lon="([^"]+)"[^>]*? name="([^"]*)"[^>]*? type="([^"]*)"/g)) {
  const [, id, lat, lon, name, type] = m as unknown as [string, string, string, string, string, string];
  const la = Number(lat), lo = Number(lon);
  if (la < 41.6 || la > 46.1 || lo < -88.1 || lo > -85.0) continue;
  const midLake = id === "45007" || id === "45002";
  if (!midLake && (lo < EAST_SIDE_MIN_LON || nearest(la, lo) > NEAR_PORT_MI)) continue;
  if (NOT_OPEN_LAKE.test(name)) continue;
  stations.push({
    source: "ndbc", external_id: id.toUpperCase(), name: name.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(), lake: "michigan",
    lat: la, lon: lo, has_temp_profile: false, seasonal: type === "buoy" || coveredNdbc.has(id.toUpperCase()), meta: {},
  });
}

stations.sort((a, b) => String(a.source).localeCompare(String(b.source)) || Number(b.lat) - Number(a.lat));
const body = `/**
 * GENERATED by scripts/build-stations.mts on ${new Date().toISOString().slice(0, 10)} from the live NDBC station
 * list and the GLOS Seagull platform and parameter lists. Do not edit by hand.
 *
 * Seagull rows carry the dataset id and parameter ids the fetch job needs. A buoy
 * usually appears twice, once per source: NDBC for surface readings and wind,
 * Seagull for temperature at depth. NWS observation stations are added per port
 * by the refresh job.
 */
export interface SeagullMeta {
  dataset_id: number; ndbc_id: string | null;
  params: { wind_dir: number | null; wind_speed: number | null; wave_height: number | null; air_temp: number | null; surface_temp: number | null; temps: { depth_m: number; id: number }[] };
}
export interface StationSeed {
  source: "ndbc" | "seagull" | "nws"; external_id: string; name: string; lake: string;
  lat: number; lon: number; has_temp_profile: boolean; seasonal: boolean; meta: SeagullMeta | Record<string, never>;
}

export const stations: StationSeed[] = ${JSON.stringify(stations, null, 2)};

/** Stations farther than this are not linked to a port at all. The 25 mile water-temperature limit is a threshold applied at read time. */
export const PORT_STATION_LINK_MAX_MI = 75;
`;
writeFileSync(join(import.meta.dirname, "../seed/stations.ts"), body);
console.log(`wrote ${stations.length} stations`);
for (const s of stations) console.log(s.source, s.external_id, s.name, s.has_temp_profile ? "profile" : "", `${nearest(s.lat as number, s.lon as number).toFixed(0)} mi`);
