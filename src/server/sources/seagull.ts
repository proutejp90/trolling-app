/**
 * GLOS Seagull. Differences from the build spec, found against the live API on 2026-11-27:
 * - GET /api/v1/obs serves only the last 30 days; older ranges answer [] with an X-Note header.
 * - /api/v1/obs-latest does not exist (the API definition lists /api/v2/obs-latest). /obs covers it.
 * - Temperatures are kelvin. Timestamps carry no zone and are UTC.
 * - For the same buoy, Seagull can lag NDBC by days. Seagull is the source for temperature at depth.
 */
import type { SeagullMeta } from "../../../seed/stations";
import { fetchText } from "../fetcher";
import { kToC } from "../units";
import { emptyReading, type Reading } from "./types";

interface ObsResponse { obs_dataset_id: number; parameters: { parameter_id: number; observations: { timestamp: string; value: number | null }[] }[] }

export function seagullObsUrl(datasetIds: number[], startDate: string) {
  return `https://seagull-api.glos.org/api/v1/obs?startDate=${startDate}&${datasetIds.map((id) => `obsDatasetId=${id}`).join("&")}`;
}

const toC = (v: number) => (v > 150 ? kToC(v) : v);
const plausibleWater = (c: number) => c > -1 && c < 35;

/** Readings per dataset id. `metas` says which parameter id is which measurement. */
export function parseSeagullObs(json: string, metas: SeagullMeta[]): Map<number, Reading[]> {
  const data = JSON.parse(json) as ObsResponse[];
  const out = new Map<number, Reading[]>();
  for (const dataset of Array.isArray(data) ? data : []) {
    const meta = metas.find((m) => m.dataset_id === dataset.obs_dataset_id);
    if (!meta) continue;
    const depthOf = new Map(meta.params.temps.map((t) => [t.id, t.depth_m]));
    const rows = new Map<string, Reading>();
    const row = (timestamp: string) => {
      let r = rows.get(timestamp);
      if (!r) rows.set(timestamp, (r = emptyReading(new Date(`${timestamp.replace(/Z$/, "")}Z`))));
      return r;
    };
    for (const p of dataset.parameters) {
      for (const o of p.observations) {
        if (o.value === null || Number.isNaN(o.value)) continue;
        const r = row(o.timestamp);
        const id = p.parameter_id;
        if (id === meta.params.wind_dir) r.wind_dir_deg = o.value;
        else if (id === meta.params.wind_speed) r.wind_speed_ms = o.value;
        else if (id === meta.params.wave_height) r.wave_height_m = o.value;
        else if (id === meta.params.air_temp) r.air_temp_c = toC(o.value);
        if (id === meta.params.surface_temp && plausibleWater(toC(o.value))) r.water_temp_c = toC(o.value);
        if (depthOf.has(id) && plausibleWater(toC(o.value))) (r.temp_profile ??= []).push({ depth_m: depthOf.get(id)!, temp_c: Math.round(toC(o.value) * 100) / 100 });
      }
    }
    const readings = [...rows.values()].filter((r) => !Number.isNaN(r.observed_at.getTime()));
    for (const r of readings) {
      r.temp_profile?.sort((a, b) => a.depth_m - b.depth_m);
      if (r.water_temp_c === null && r.temp_profile?.length && r.temp_profile[0]!.depth_m <= 1) r.water_temp_c = r.temp_profile[0]!.temp_c;
      if (r.water_temp_c !== null) r.water_temp_c = Math.round(r.water_temp_c * 100) / 100;
    }
    out.set(dataset.obs_dataset_id, readings.sort((a, b) => a.observed_at.getTime() - b.observed_at.getTime()));
  }
  return out;
}

/** One request for every dataset, as the API allows repeated obsDatasetId. */
export async function fetchSeagull(metas: SeagullMeta[], since: Date): Promise<Map<number, Reading[]>> {
  if (!metas.length) return new Map();
  const res = await fetchText(seagullObsUrl(metas.map((m) => m.dataset_id), since.toISOString().slice(0, 10)), { key: "seagull/obs", timeoutMs: 60_000 });
  if (res.status !== 200) throw new Error(`Seagull answered ${res.status}`);
  return parseSeagullObs(res.body, metas);
}
