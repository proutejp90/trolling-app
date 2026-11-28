/**
 * The forecast panel: the weather the rules are reading, shown to the angler as stored.
 * Nothing here is advice. Alerts are passed through word for word, and waves are
 * only ever a value a source gave: none is estimated from wind.
 */
import { cToF, msToMph, mToFt, round } from "./units";

export interface PanelForecastRow {
  valid_at: Date; fetched_at?: Date | null; sky_cover_pct: number | null; precip_pct?: number | null; air_temp_c?: number | null;
  wind_dir_deg: number | null; wind_speed_ms: number | null;
}
export interface StoredAlert { event: string; headline: string; issued_at: string; starts_at: string; ends_at: string | null; url: string }
export interface MarineRow { zone: string; forecast_text: string | null; issued_at: Date | null; text_fetched_at: Date | null; alerts: StoredAlert[]; alerts_fetched_at: Date | null }
export interface WaveRow { station_name: string; distance_mi: number; observed_at: Date; wave_height_m: number | null; wave_period_s?: number | null }

export interface ForecastPanel {
  source: "National Weather Service";
  time_zone: string;
  /** True when the trip date is today at the port. Alerts and observed waves show only then. */
  is_today: boolean;
  hours: { valid_at: string; wind_speed_mph: number | null; wind_dir_deg: number | null; sky_cover_pct: number | null; precip_pct: number | null; air_temp_f: number | null }[];
  fetched_at: string | null;
  stale: boolean;
  marine: { zone: string; text: string; issued_at: string | null } | null;
  alerts: StoredAlert[];
  alerts_fetched_at: string | null;
  alerts_stale: boolean;
  /** Measured at the nearest buoy. Forecast waves join in Phase 2b; until then there is no forecast value to show. */
  observed_waves: { station: string; height_ft: number; period_s: number | null; age_minutes: number } | null;
  /** Where to read the current forecast and any alert in full. */
  more_url: string;
}

/** The calendar date at the port, as YYYY-MM-DD. */
export const localDate = (d: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function buildForecastPanel(input: {
  date: string; now: Date; timeZone: string; forecasts: PanelForecastRow[]; marine: MarineRow | null; waves: WaveRow[];
  limits: { forecastStaleHours: number; alertsStaleMinutes: number; maxMiles: number; maxAgeHours: number; marineTextDays: number };
}): ForecastPanel {
  const { date, now, timeZone, marine, limits } = input;
  const today = localDate(now, timeZone);
  const isToday = date === today;
  const hourRows = input.forecasts.filter((f) => localDate(f.valid_at, timeZone) === date).sort((a, b) => a.valid_at.getTime() - b.valid_at.getTime());
  const fetched = hourRows.map((f) => f.fetched_at?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
  const daysAhead = Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);

  // An alert belongs to the day it covers. Today's alert is never carried onto another day.
  const alerts = isToday && marine
    ? marine.alerts.filter((a) => (!a.ends_at || new Date(a.ends_at) > now) && (!a.starts_at || localDate(new Date(a.starts_at), timeZone) <= date))
    : [];

  const wave = isToday
    ? input.waves
        .filter((w) => w.wave_height_m !== null && w.distance_mi <= limits.maxMiles && w.observed_at <= now && now.getTime() - w.observed_at.getTime() <= limits.maxAgeHours * 3_600_000)
        .sort((a, b) => a.distance_mi - b.distance_mi || b.observed_at.getTime() - a.observed_at.getTime())[0]
    : undefined;

  return {
    source: "National Weather Service", time_zone: timeZone, is_today: isToday,
    hours: hourRows.map((f) => ({
      valid_at: f.valid_at.toISOString(),
      wind_speed_mph: f.wind_speed_ms === null ? null : round(msToMph(Number(f.wind_speed_ms))), wind_dir_deg: f.wind_dir_deg,
      sky_cover_pct: f.sky_cover_pct, precip_pct: f.precip_pct ?? null, air_temp_f: f.air_temp_c == null ? null : Math.round(cToF(Number(f.air_temp_c))),
    })),
    fetched_at: fetched ? new Date(fetched).toISOString() : null,
    stale: fetched > 0 && now.getTime() - fetched > limits.forecastStaleHours * 3_600_000,
    marine: marine?.forecast_text && daysAhead >= 0 && daysAhead <= limits.marineTextDays ? { zone: marine.zone, text: marine.forecast_text, issued_at: marine.issued_at?.toISOString() ?? null } : null,
    alerts,
    alerts_fetched_at: marine?.alerts_fetched_at?.toISOString() ?? null,
    alerts_stale: isToday && Boolean(marine?.alerts_fetched_at) && now.getTime() - marine!.alerts_fetched_at!.getTime() > limits.alertsStaleMinutes * 60_000,
    observed_waves: wave ? { station: wave.station_name, height_ft: round(mToFt(wave.wave_height_m!)), period_s: wave.wave_period_s ?? null, age_minutes: Math.round((now.getTime() - wave.observed_at.getTime()) / 60_000) } : null,
    more_url: marine ? `https://forecast.weather.gov/shmrn.php?mz=${marine.zone.toLowerCase()}` : "https://www.weather.gov/",
  };
}
