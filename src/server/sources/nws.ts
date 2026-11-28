/**
 * National Weather Service API (api.weather.gov). No key; a User-Agent is required.
 * Response shapes confirmed against the live API on 2026-11-27:
 * - /points/{lat},{lon}: properties.gridId, gridX, gridY, forecastGridData, observationStations
 * - /gridpoints/{office}/{x},{y}: properties.skyCover, windSpeed (km/h), windDirection, hazards,
 *   each { values: [{ validTime: "<ISO start>/<ISO duration>", value }] }
 * - /stations/{id}/observations: features[].properties.timestamp, windDirection.value, windSpeed.value (km/h)
 *
 * Confirmed on 2026-11-28 for the forecast panel:
 * - /points also gives properties.forecastZone (for a port on the lake this is its marine zone, such as
 *   .../zones/forecast/LMZ847) and properties.timeZone.
 * - /gridpoints also carries probabilityOfPrecipitation (percent) and temperature (°C).
 * - /zones/forecast/{marine zone}/forecast answers 404: the API has no zone forecast for marine zones.
 *   The text comes from the Nearshore Marine Forecast product instead: /products/types/NSH/locations/{office}
 *   lists them newest first, and /products/{id} holds productText, one section per zone.
 * - /alerts/active?zone={zone}: features[].properties.event, headline, sent, onset, ends, expires.
 * - waveHeight on /gridpoints is a single zero at a port's own grid cell, but is populated at a cell
 *   a few miles offshore (metres, with wavePeriod and waveDirection). See DECISIONS.md.
 */
import { fetchText } from "../fetcher";
import { kmhToMs } from "../units";
import { emptyReading, type Reading } from "./types";

export interface NwsPoint { grid_id: string; grid_x: number; grid_y: number; grid_url: string; stations_url: string; zone: string | null; time_zone: string | null }
export interface ForecastHour {
  valid_at: Date; sky_cover_pct: number | null; wind_dir_deg: number | null; wind_speed_ms: number | null;
  precip_pct: number | null; air_temp_c: number | null; hazards: { phenomenon: string; significance: string }[];
}
/** One alert, kept word for word. Times are ISO strings as issued. */
export interface Alert { event: string; headline: string; issued_at: string; starts_at: string; ends_at: string | null; url: string }
export interface MarineText { zone: string; text: string; issued_at: string | null }

const getJson = async (url: string, key: string) => {
  const res = await fetchText(url, { key, headers: { Accept: "application/geo+json" }, cacheMs: 60_000 });
  if (res.status !== 200) throw new Error(`NWS ${key} answered ${res.status}`);
  return JSON.parse(res.body);
};

export function parsePoint(json: unknown): NwsPoint {
  const p = (json as { properties: Record<string, unknown> }).properties;
  const zone = typeof p.forecastZone === "string" ? p.forecastZone.split("/").pop() ?? null : null;
  return {
    grid_id: String(p.gridId), grid_x: Number(p.gridX), grid_y: Number(p.gridY), grid_url: String(p.forecastGridData), stations_url: String(p.observationStations),
    zone, time_zone: typeof p.timeZone === "string" ? p.timeZone : null,
  };
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
  const rain = new Map<number, number | null>(), air = new Map<number, number | null>();
  expand(p.probabilityOfPrecipitation as Series<number | null>, rain);
  expand(p.temperature as Series<number | null>, air);
  expand(p.skyCover as Series<number | null>, sky);
  expand(p.windSpeed as Series<number | null>, speed);
  expand(p.windDirection as Series<number | null>, dir);
  expand(p.hazards as Series<{ phenomenon: string; significance: string }[]>, hazards);
  return [...new Set([...sky.keys(), ...speed.keys(), ...dir.keys()])].sort((a, b) => a - b).map((t) => ({
    valid_at: new Date(t),
    sky_cover_pct: sky.get(t) ?? null,
    wind_dir_deg: dir.get(t) ?? null,
    wind_speed_ms: speed.get(t) == null ? null : Math.round(kmhToMs(speed.get(t)!) * 100) / 100,
    precip_pct: rain.get(t) ?? null,
    air_temp_c: air.get(t) == null ? null : Math.round(air.get(t)! * 100) / 100,
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

/** Where an angler can read the zone's full marine forecast and any alert in full. */
export const zonePage = (zone: string) => `https://forecast.weather.gov/shmrn.php?mz=${zone.toLowerCase()}`;

/** Active alerts for a zone. Nothing is shortened or reworded: the headline is stored as issued. */
export function parseAlerts(json: unknown, zone: string): Alert[] {
  const features = (json as { features?: { properties: Record<string, string | null> }[] }).features ?? [];
  return features
    .map((f) => f.properties)
    .filter((p) => p.headline && p.event)
    .map((p) => ({ event: p.event!, headline: p.headline!, issued_at: p.sent ?? p.effective ?? "", starts_at: p.onset ?? p.effective ?? p.sent ?? "", ends_at: p.ends ?? p.expires ?? null, url: zonePage(zone) }));
}

/** The zones a UGC line covers: "LMZ844-845>847-282200-" is LMZ844, LMZ845, LMZ846 and LMZ847. */
export function ugcZones(line: string): string[] {
  const m = /^([A-Z]{2}Z)(\d{3}(?:[->]\d{3})*)-\d{6}-$/.exec(line.trim());
  if (!m) return [];
  const zones: string[] = [];
  const parts = m[2]!.split(/([->])/);
  for (let i = 0; i < parts.length; i += 2) {
    const n = Number(parts[i]);
    if (parts[i - 1] === ">") for (let k = Number(parts[i - 2]) + 1; k <= n; k++) zones.push(`${m[1]}${String(k).padStart(3, "0")}`);
    else zones.push(`${m[1]}${String(n).padStart(3, "0")}`);
  }
  return zones;
}

/** One zone's section of a Nearshore Marine Forecast product, word for word, from its name line to the end mark. */
export function parseNearshore(productText: string, zone: string, issuedAt: string | null = null): MarineText | null {
  const lines = productText.split("\n");
  const start = lines.findIndex((l) => ugcZones(l).includes(zone));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.trim() === "$$");
  const text = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  return text ? { zone, text, issued_at: issuedAt } : null;
}

export const fetchAlerts = async (zone: string) => parseAlerts(await getJson(`https://api.weather.gov/alerts/active?zone=${zone}`, `nws/alerts/${zone}`), zone);
/** The newest Nearshore Marine Forecast from an office, or null when it has issued none. */
export async function fetchNearshoreProduct(office: string): Promise<{ text: string; issued_at: string | null } | null> {
  const list = await getJson(`https://api.weather.gov/products/types/NSH/locations/${office}`, `nws/nsh-list/${office}`);
  const newest = (list["@graph"] ?? [])[0] as { id: string; issuanceTime?: string } | undefined;
  if (!newest) return null;
  const product = await getJson(`https://api.weather.gov/products/${newest.id}`, `nws/nsh/${office}`);
  return { text: String(product.productText ?? ""), issued_at: product.issuanceTime ?? newest.issuanceTime ?? null };
}

export const fetchPoint = async (lat: number, lon: number) => parsePoint(await getJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, `nws/points/${lat.toFixed(4)},${lon.toFixed(4)}`));
export const fetchGrid = async (p: Pick<NwsPoint, "grid_id" | "grid_x" | "grid_y" | "grid_url">) => parseGrid(await getJson(p.grid_url, `nws/grid/${p.grid_id}-${p.grid_x}-${p.grid_y}`));
export const fetchStationList = async (p: NwsPoint) => parseStationList(await getJson(p.stations_url, `nws/stations/${p.grid_id}-${p.grid_x}-${p.grid_y}`));
export const fetchStationObservations = async (stationId: string, since: Date) =>
  parseStationObservations(await getJson(`https://api.weather.gov/stations/${stationId}/observations?start=${since.toISOString().slice(0, 19)}Z&limit=500`, `nws/obs/${stationId}`));
