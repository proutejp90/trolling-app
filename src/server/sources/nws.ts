/**
 * National Weather Service API (api.weather.gov). No key; a User-Agent is required.
 * Response shapes confirmed against the live API on 2026-11-27:
 * - /points/{lat},{lon}: properties.gridId, gridX, gridY, forecastGridData, observationStations
 * - /gridpoints/{office}/{x},{y}: properties.skyCover, windSpeed (km/h), windDirection, hazards,
 *   each { values: [{ validTime: "<ISO start>/<ISO duration>", value }] }
 * - /stations/{id}/observations: features[].properties.timestamp, windDirection.value, windSpeed.value (km/h)
 */
import { fetchText } from "../fetcher";
import { kmhToMs } from "../units";
import { emptyReading, type Reading } from "./types";

export interface NwsPoint { grid_id: string; grid_x: number; grid_y: number; grid_url: string; stations_url: string }
export interface ForecastHour { valid_at: Date; sky_cover_pct: number | null; wind_dir_deg: number | null; wind_speed_ms: number | null; hazards: { phenomenon: string; significance: string }[] }

const getJson = async (url: string, key: string) => {
  const res = await fetchText(url, { key, headers: { Accept: "application/geo+json" }, cacheMs: 60_000 });
  if (res.status !== 200) throw new Error(`NWS ${key} answered ${res.status}`);
  return JSON.parse(res.body);
};

export function parsePoint(json: unknown): NwsPoint {
  const p = (json as { properties: Record<string, unknown> }).properties;
  return { grid_id: String(p.gridId), grid_x: Number(p.gridX), grid_y: Number(p.gridY), grid_url: String(p.forecastGridData), stations_url: String(p.observationStations) };
}

/** "PT1H", "PT3H", "P1DT10H" to hours. */
export function durationHours(iso: string): number {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(iso);
  return m ? Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 60 : 1;
}

interface Series<T> { values: { validTime: string; value: T }[] }
function expand<T>(series: Series<T> | undefined, into: Map<number, T>) {
  for (const v of series?.values ?? []) {
    const [start, duration] = v.validTime.split("/") as [string, string];
    const t0 = new Date(start).getTime();
    for (let h = 0; h < Math.max(1, Math.round(durationHours(duration))); h++) into.set(t0 + h * 3_600_000, v.value);
  }
}

export function parseGrid(json: unknown): ForecastHour[] {
  const p = (json as { properties: Record<string, Series<unknown>> }).properties;
  const sky = new Map<number, number | null>(), speed = new Map<number, number | null>(), dir = new Map<number, number | null>();
  const hazards = new Map<number, { phenomenon: string; significance: string }[]>();
  expand(p.skyCover as Series<number | null>, sky);
  expand(p.windSpeed as Series<number | null>, speed);
  expand(p.windDirection as Series<number | null>, dir);
  expand(p.hazards as Series<{ phenomenon: string; significance: string }[]>, hazards);
  return [...new Set([...sky.keys(), ...speed.keys(), ...dir.keys()])].sort((a, b) => a - b).map((t) => ({
    valid_at: new Date(t),
    sky_cover_pct: sky.get(t) ?? null,
    wind_dir_deg: dir.get(t) ?? null,
    wind_speed_ms: speed.get(t) == null ? null : Math.round(kmhToMs(speed.get(t)!) * 100) / 100,
    hazards: (hazards.get(t) ?? []).map((h) => ({ phenomenon: h.phenomenon, significance: h.significance })),
  }));
}

export function parseStationList(json: unknown): { id: string; name: string; lat: number; lon: number }[] {
  const features = (json as { features: { properties: { stationIdentifier: string; name: string }; geometry: { coordinates: [number, number] } }[] }).features ?? [];
  return features.map((f) => ({ id: f.properties.stationIdentifier, name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
}

export function parseStationObservations(json: unknown): Reading[] {
  const features = (json as { features: { properties: { timestamp: string; windDirection?: { value: number | null }; windSpeed?: { value: number | null }; temperature?: { value: number | null } } }[] }).features ?? [];
  return features
    .map((f) => ({
      ...emptyReading(new Date(f.properties.timestamp)),
      wind_dir_deg: f.properties.windDirection?.value ?? null,
      wind_speed_ms: f.properties.windSpeed?.value == null ? null : Math.round(kmhToMs(f.properties.windSpeed.value) * 100) / 100,
      air_temp_c: f.properties.temperature?.value ?? null,
    }))
    .filter((r) => !Number.isNaN(r.observed_at.getTime()) && (r.wind_dir_deg !== null || r.wind_speed_ms !== null));
}

export const fetchPoint = async (lat: number, lon: number) => parsePoint(await getJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, `nws/points/${lat.toFixed(4)},${lon.toFixed(4)}`));
export const fetchGrid = async (p: Pick<NwsPoint, "grid_id" | "grid_x" | "grid_y" | "grid_url">) => parseGrid(await getJson(p.grid_url, `nws/grid/${p.grid_id}-${p.grid_x}-${p.grid_y}`));
export const fetchStationList = async (p: NwsPoint) => parseStationList(await getJson(p.stations_url, `nws/stations/${p.grid_id}-${p.grid_x}-${p.grid_y}`));
export const fetchStationObservations = async (stationId: string, since: Date) =>
  parseStationObservations(await getJson(`https://api.weather.gov/stations/${stationId}/observations?start=${since.toISOString().slice(0, 19)}Z&limit=500`, `nws/obs/${stationId}`));
