/**
 * NOAA NDBC realtime2 files: plain text, newest row first, about 45 days.
 * Speeds are m/s, temperatures °C, missing values are MM. Times are UTC.
 * NDBC asks for minimal retrievals: one fetch per station per cycle, never from a user request.
 */
import { fetchText } from "../fetcher";
import { emptyReading, type Reading } from "./types";

export const ndbcUrl = (station: string) => `https://www.ndbc.noaa.gov/data/realtime2/${station}.txt`;

export function parseNdbc(text: string): Reading[] {
  const lines = text.split("\n").filter((l) => l.trim());
  const header = lines.find((l) => l.startsWith("#"));
  if (!header) return [];
  const cols = header.replace(/^#/, "").trim().split(/\s+/);
  const at = (name: string) => cols.indexOf(name);
  const idx = { y: at("YY"), mo: at("MM"), d: at("DD"), h: at("hh"), mi: at("mm"), wdir: at("WDIR"), wspd: at("WSPD"), wvht: at("WVHT"), dpd: at("DPD"), atmp: at("ATMP"), wtmp: at("WTMP") };
  if (idx.y < 0 || idx.h < 0) return [];
  const num = (parts: string[], i: number) => {
    if (i < 0) return null;
    const v = parts[i];
    return v === undefined || v === "MM" || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const out: Reading[] = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    const p = line.trim().split(/\s+/);
    const [y, mo, d, h, mi] = [idx.y, idx.mo, idx.d, idx.h, idx.mi].map((i) => Number(p[i]));
    const when = new Date(Date.UTC(y!, mo! - 1, d!, h!, mi!));
    if (Number.isNaN(when.getTime())) continue;
    out.push({
      ...emptyReading(when),
      wind_dir_deg: num(p, idx.wdir), wind_speed_ms: num(p, idx.wspd), wave_height_m: num(p, idx.wvht), wave_period_s: num(p, idx.dpd),
      air_temp_c: num(p, idx.atmp), water_temp_c: num(p, idx.wtmp),
    });
  }
  return out;
}

/** null means the station has no file right now, which is how a buoy pulled for winter answers. */
export async function fetchNdbc(station: string): Promise<Reading[] | null> {
  const res = await fetchText(ndbcUrl(station), { key: `ndbc/${station}` });
  if (res.status === 404) return null;
  if (res.status !== 200) throw new Error(`NDBC ${station} answered ${res.status}`);
  return parseNdbc(res.body);
}
