/**
 * The conditions service. It reads the Postgres cache, never an external API,
 * and turns what is there into the engine's inputs plus a plain account of
 * where each input came from, how old it is, and what is missing.
 */
import type { EngineContext, Threshold } from "@recommender/engine";
import type { Queryable } from "./db";
import { distanceMi } from "../../seed/geo";
import type { Wind48h } from "../lib/format";
import { buildForecastPanel, localDate, type ForecastPanel, type MarineRow } from "./forecast-panel";
import { sunTimes } from "./sun";
import { cToF, msToMph, mToFt, round } from "./units";

/** The four windows of the first quiz. Still accepted, so stored requests and older clients keep working. */
export type LegacyTime = "before_sunrise" | "early" | "day" | "after_sunset";
/** "now" is today at the current time. The other four are for any other day. */
export type TimeWindow = "now" | "first_light" | "morning" | "midday" | "evening";
export type TimeOfDay = LegacyTime | TimeWindow;
export type DayKind = "today" | "forecast" | "beyond" | "past";
/** Where a prefilled value came from. A value with no data behind it is a Default, never a measurement. */
export type DataSource = "Measured" | "Forecast" | "Modeled" | "Default";

export interface StationReading {
  station: string; source: string; distance_mi: number; observed_at: string; age_minutes: number;
  /** Every feed merged into this row, as the names an angler sees: NDBC, GLOS, NWS. */
  sources: string[];
  /** Within the distance the app reads stations from. */
  in_range: boolean;
  /** What the engine read from this station for this trip, if anything. */
  used_for: ("water" | "wind")[];
  water_temp_f: number | null; wind_dir_deg: number | null; wind_speed_mph: number | null; wave_height_ft: number | null; air_temp_f: number | null;
  temp_profile: { depth_ft: number; temp_f: number }[] | null;
}

export interface Conditions {
  port: { id: string | null; name: string; shore: "east" | "west"; lat: number; lon: number };
  now: string;
  trip_time: string | null;
  /** 1 buoy profile, 2 buoy surface temperature, 5 nothing live. Levels 3 and 4 are set by the recommend step. */
  temp_source_level: 1 | 2 | 5;
  water_temp_surface_f: number | null;
  temp_profile: { depth_ft: number; temp_f: number }[] | null;
  temp_station: { name: string; source: string; distance_mi: number } | null;
  observations_at: string | null;
  age_minutes: number | null;
  stale: boolean;
  wind_history: { hours_ago: number; dir_deg: number }[];
  wind_station: string | null;
  /** The last 48 hours of wind as the Conditions screen describes them, whether or not the engine used them. */
  wind_48h: Wind48h;
  /** Whole days from today at the port to the trip date. Negative for a past date. */
  days_to_trip: number;
  /** True when the trip date is today at the port. Buoy and probe readings apply to today only. */
  is_today: boolean;
  day_kind: DayKind;
  /** The window the trip time was worked out for. */
  time_window: TimeOfDay | null;
  sky_source: DataSource | null;
  wind_source: DataSource | null;
  /** The freshness thresholds, in hours, so the screens never carry their own numbers. */
  limits: { fresh_hours: number; stale_hours: number; max_miles: number };
  forecast: { valid_at: string; sky_cover_pct: number | null; wind_dir_deg: number | null; wind_speed_mph: number | null; hazards: { phenomenon: string; significance: string }[] } | null;
  /** True when a cached forecast hour falls near any of the four times of day on the trip date. */
  forecast_covers_date: boolean;
  sky: EngineContext["sky"] | null;
  wind_calm: boolean | null;
  light_period: EngineContext["light_period"] | null;
  hours_after_sunrise: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** The trip day's weather as the National Weather Service gave it, for the Conditions screen. */
  forecast_panel: ForecastPanel;
  /** What the app does not know, in sentences an angler can read. */
  messages: string[];
  /** Latest reading per linked station, nearest first, for the Conditions screen. */
  readings: StationReading[];
}

export interface PortRow { id: string | null; name: string; shore: "east" | "west"; lat: number; lon: number; time_zone?: string | null }
export interface ObservationRow {
  station_name: string; source: string; distance_mi: number; rank: number; observed_at: Date;
  wind_dir_deg: number | null; wind_speed_ms: number | null; wave_height_m: number | null; air_temp_c: number | null; water_temp_c: number | null;
  temp_profile: { depth_m: number; temp_c: number }[] | null;
  wave_period_s?: number | null;
  /** The station's own position. Rows without one are never merged. */
  lat?: number; lon?: number;
}
export interface ForecastRow {
  valid_at: Date; sky_cover_pct: number | null; wind_dir_deg: number | null; wind_speed_ms: number | null; hazards: { phenomenon: string; significance: string }[];
  fetched_at?: Date | null; precip_pct?: number | null; air_temp_c?: number | null;
}

const TIME_OFFSET: Record<LegacyTime, { from: "sunrise" | "sunset"; hours: number; light: NonNullable<EngineContext["light_period"]> }> = {
  before_sunrise: { from: "sunrise", hours: -1, light: "before_sunrise" },
  early: { from: "sunrise", hours: 1, light: "day" },
  day: { from: "sunrise", hours: 5, light: "day" },
  after_sunset: { from: "sunset", hours: 0.75, light: "after_sunset" },
};

const num = (thresholds: Threshold[], name: string, fallback: number) => {
  const v = thresholds.find((t) => t.name === name)?.value;
  return typeof v === "number" ? v : fallback;
};

/** Mean of compass directions, which cannot be averaged as plain numbers. */
function meanDirection(degrees: number[]): number {
  const s = degrees.reduce((a, d) => a + Math.sin((d * Math.PI) / 180), 0);
  const c = degrees.reduce((a, d) => a + Math.cos((d * Math.PI) / 180), 0);
  return Math.round(((Math.atan2(s, c) * 180) / Math.PI + 360) % 360);
}

export function buildConditions(input: {
  port: PortRow; date: string; timeOfDay: TimeOfDay | null; now: Date;
  observations: ObservationRow[]; forecasts: ForecastRow[]; thresholds: Threshold[]; connected: boolean;
  /** Buoys linked to the port within range, reporting or not. Defaults to those seen in the observations. */
  buoysInRange?: number;
  /** The port's marine forecast text and alerts, when the cache has them. */
  marine?: MarineRow | null;
}): Conditions {
  const { port, date, timeOfDay, now, thresholds } = input;
  const messages: string[] = [];
  const maxMiles = num(thresholds, "station_max_miles", 25);
  const staleHours = num(thresholds, "obs_stale_hours", 6);
  const maxAgeHours = num(thresholds, "obs_max_age_hours", 24);
  const timeZone = port.time_zone ?? "America/Detroit";
  // Today is today at the port, whatever zone the phone or the server is in.
  const todayAtPort = localDate(now, timeZone);
  const daysToTrip = Math.round((new Date(`${date}T12:00:00Z`).getTime() - new Date(`${todayAtPort}T12:00:00Z`).getTime()) / 86_400_000);
  const isToday = daysToTrip === 0;
  const horizonDays = num(thresholds, "forecast_horizon_days", 5);
  const dayKind: DayKind = isToday ? "today" : daysToTrip < 0 ? "past" : daysToTrip <= horizonDays ? "forecast" : "beyond";
  const ageMin = (d: Date) => Math.round((now.getTime() - d.getTime()) / 60_000);

  // --- Clock: where the trip sits relative to sunrise and sunset ---
  const sun = sunTimes(date, port.lat, port.lon);
  let tripTime: Date | null = null, light: Conditions["light_period"] = null, hoursAfterSunrise: number | null = null;
  const windowTime = (w: TimeOfDay): Date | null => {
    if (!sun) return null;
    const rise = sun.sunrise.getTime(), set = sun.sunset.getTime(), h = 3_600_000;
    if (w === "now") return now;
    if (w === "first_light") return new Date(rise - 0.5 * h);
    if (w === "morning") return new Date(rise + 2 * h);
    if (w === "midday") return new Date((rise + set) / 2);
    if (w === "evening") return new Date(set - 0.5 * h);
    return new Date(sun[TIME_OFFSET[w].from].getTime() + TIME_OFFSET[w].hours * h);
  };
  // "Now" only means something today. On any other day it is first light.
  const window: TimeOfDay | null = timeOfDay === "now" && !isToday ? "first_light" : timeOfDay;
  let lowLight = false;
  if (sun && window) {
    tripTime = windowTime(window);
    light = tripTime! < sun.sunrise ? "before_sunrise" : tripTime! > sun.sunset ? "after_sunset" : "day";
    hoursAfterSunrise = round((tripTime!.getTime() - sun.sunrise.getTime()) / 3_600_000, 1);
    const near = num(thresholds, "low_light_minutes", 45) * 60_000;
    lowLight = light !== "day" || tripTime!.getTime() - sun.sunrise.getTime() <= near || sun.sunset.getTime() - tripTime!.getTime() <= near;
  }

  // --- Latest reading per station, nearest first ---
  const past = input.observations.filter((o) => o.observed_at <= now).sort((a, b) => b.observed_at.getTime() - a.observed_at.getTime());
  const latestBy = new Map<string, ObservationRow>();
  for (const o of past) {
    const key = `${o.source}/${o.station_name}`;
    const kept = latestBy.get(key);
    // The newest row can be a partial report. Fill its gaps from older rows of the same station inside the age limit.
    if (!kept) latestBy.set(key, { ...o });
    else if (ageMin(o.observed_at) <= maxAgeHours * 60) {
      kept.water_temp_c ??= o.water_temp_c; kept.wind_dir_deg ??= o.wind_dir_deg; kept.wind_speed_ms ??= o.wind_speed_ms;
      kept.wave_height_m ??= o.wave_height_m; kept.air_temp_c ??= o.air_temp_c;
      if (!kept.temp_profile?.length && o.temp_profile?.length) kept.temp_profile = o.temp_profile;
    }
  }
  const latest = [...latestBy.values()].sort((a, b) => a.distance_mi - b.distance_mi);
  const toFeet = (p: ObservationRow["temp_profile"]) => p?.map((x) => ({ depth_ft: Math.round(mToFt(x.depth_m)), temp_f: round(cToF(x.temp_c)) })) ?? null;
  // One row per physical station: feeds within a tenth of a mile of each other are the same instrument
  // reported by two networks. Only this list is merged; the engine's inputs below read the feeds as before.
  const SOURCE_ORDER = ["ndbc", "seagull", "nws"], SOURCE_NAME: Record<string, string> = { ndbc: "NDBC", seagull: "GLOS", nws: "NWS" };
  const places: ObservationRow[][] = [];
  for (const o of latest) {
    const same = places.find((g) => g.some((m) => o.lat !== undefined && o.lon !== undefined && m.lat !== undefined && m.lon !== undefined && distanceMi(o.lat, o.lon, m.lat, m.lon) <= 0.1));
    if (same) same.push(o); else places.push([o]);
  }
  const readings: StationReading[] = places.map((group) => {
    const bySource = [...group].sort((a, b) => SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source));
    const newestFirst = [...group].sort((a, b) => b.observed_at.getTime() - a.observed_at.getTime());
    const newest = <K extends keyof ObservationRow>(field: K) => newestFirst.find((m) => m[field] !== null && m[field] !== undefined)?.[field] ?? null;
    const named = bySource[0]!, windFrom = newestFirst.find((m) => m.wind_speed_ms !== null || m.wind_dir_deg !== null);
    const water = newest("water_temp_c"), waves = newest("wave_height_m"), air = newest("air_temp_c");
    const distance = Math.min(...group.map((m) => Number(m.distance_mi)));
    return {
      station: named.station_name, source: named.source, sources: [...new Set(bySource.map((m) => SOURCE_NAME[m.source] ?? m.source))],
      distance_mi: distance, in_range: distance <= maxMiles, used_for: [],
      observed_at: newestFirst[0]!.observed_at.toISOString(), age_minutes: ageMin(newestFirst[0]!.observed_at),
      water_temp_f: water === null ? null : round(cToF(water)),
      // Direction and speed stay a pair: both come from the newest feed that reported wind.
      wind_dir_deg: windFrom?.wind_dir_deg ?? null, wind_speed_mph: windFrom?.wind_speed_ms == null ? null : round(msToMph(windFrom.wind_speed_ms)),
      wave_height_ft: waves === null ? null : round(mToFt(waves)), air_temp_f: air === null ? null : round(cToF(air)),
      temp_profile: toFeet(newestFirst.find((m) => (m.temp_profile?.length ?? 0) >= 3)?.temp_profile ?? null),
    };
  });

  // --- Water temperature: the fallback ladder, levels 1 and 2 ---
  const buoys = latest.filter((o) => o.source !== "nws");
  const inRange = buoys.filter((o) => Number(o.distance_mi) <= maxMiles);
  const usable = inRange.filter((o) => ageMin(o.observed_at) <= maxAgeHours * 60);
  const fresh = (o: ObservationRow) => ageMin(o.observed_at) <= staleHours * 60;
  const pick = (ok: (o: ObservationRow) => boolean) => usable.filter(ok).sort((a, b) => Number(fresh(b)) - Number(fresh(a)) || a.distance_mi - b.distance_mi)[0];
  let level: Conditions["temp_source_level"] = 5;
  let source: ObservationRow | undefined;
  if (!input.connected) {
    messages.push("Live water data is not connected. Results use month defaults.");
  } else if (dayKind === "past") {
    messages.push("This date has passed. It is shown for review, not as advice. Results use month defaults.");
  } else if (dayKind === "beyond") {
    messages.push(`Forecasts do not reach ${daysToTrip} days ahead. Results use month defaults.`);
  } else if (dayKind === "forecast") {
    messages.push("Buoy readings apply to today only. Results use month defaults.");
  } else if ((input.buoysInRange ?? inRange.length) === 0) {
    messages.push(`No buoy within ${maxMiles} miles of ${port.name} is in the cache. Results use month defaults.`);
  } else if (!usable.length) {
    messages.push("Live water data is unavailable until buoys return. Results use month defaults.");
  } else {
    source = pick((o) => (o.temp_profile?.length ?? 0) >= 3);
    if (source) level = 1;
    else if ((source = pick((o) => o.water_temp_c !== null))) {
      level = 2;
      messages.push("No buoy nearby reports temperature at depth right now, only at the surface.");
    } else {
      messages.push("Buoys nearby are reporting, but not water temperature. Results use month defaults.");
    }
    if (source && !fresh(source)) messages.push(`The newest water reading is more than ${staleHours} hours old.`);
  }

  // --- Wind history for the upwelling rule: hourly directions over the last 48 hours ---
  let windHistory: Conditions["wind_history"] = [], windStation: string | null = null;
  const byStation = new Map<string, ObservationRow[]>();
  for (const o of past) if (o.wind_dir_deg !== null && ageMin(o.observed_at) <= 48 * 60) byStation.set(`${o.source}/${o.station_name}`, [...(byStation.get(`${o.source}/${o.station_name}`) ?? []), o]);
  const histories = [...byStation.entries()].map(([, rows]) => {
    const hours = new Map<number, number[]>();
    for (const r of rows) {
      const h = Math.max(1, Math.ceil(ageMin(r.observed_at) / 60));
      hours.set(h, [...(hours.get(h) ?? []), Number(r.wind_dir_deg)]);
    }
    return { key: `${rows[0]!.source}/${rows[0]!.station_name}`, name: rows[0]!.station_name, distance: Number(rows[0]!.distance_mi), history: [...hours.entries()].map(([hours_ago, d]) => ({ hours_ago, dir_deg: meanDirection(d) })).sort((a, b) => a.hours_ago - b.hours_ago) };
  });
  // Nearest station with most of the window covered; failing that, the best coverage there is.
  const chosen = histories.filter((h) => h.history.length >= 36).sort((a, b) => a.distance - b.distance)[0] ?? histories.filter((h) => h.history.length >= 24).sort((a, b) => b.history.length - a.history.length)[0];
  const northEast = (h: Conditions["wind_history"]) => h.filter((w) => w.dir_deg >= 315 || w.dir_deg <= 135).length;
  const tripIsFar = !isToday;
  const best = [...histories].sort((a, b) => b.history.length - a.history.length)[0];
  const wind48h: Wind48h = chosen
    ? { station: chosen.name, hours: chosen.history.length, north_east_hours: northEast(chosen.history), enough: true, used: !tripIsFar }
    : { station: best?.name ?? null, hours: best?.history.length ?? 0, north_east_hours: null, enough: false, used: false };
  // The last 48 hours of wind say nothing about the water on a trip weeks away.
  if (tripIsFar) { /* no wind history for a distant trip */ }
  else if (chosen) { windHistory = chosen.history; windStation = chosen.name; }
  else if (input.connected) messages.push("There is too little wind history to check for an upwelling.");

  // Mark the rows the engine read, so the Conditions screen can say which stations counted.
  const waterKey = source ? `${source.source}/${source.station_name}` : null, windKey = chosen && !tripIsFar ? chosen.key : null;
  places.forEach((group, i) => {
    const keys = group.map((m) => `${m.source}/${m.station_name}`);
    if (waterKey && keys.includes(waterKey)) readings[i]!.used_for.push("water");
    if (windKey && keys.includes(windKey)) readings[i]!.used_for.push("wind");
  });

  // --- Forecast at the trip time ---
  let forecast: Conditions["forecast"] = null, sky: Conditions["sky"] = null, windCalm: boolean | null = null;
  let skySource: DataSource | null = null, windSource: DataSource | null = null;
  const calmMaxMph = round(num(thresholds, "wind_calm_max_kt", 5) * 1.15078);
  if (tripTime) {
    const near = input.forecasts.map((f) => ({ f, gap: Math.abs(f.valid_at.getTime() - tripTime!.getTime()) })).filter((x) => x.gap <= 90 * 60_000).sort((a, b) => a.gap - b.gap)[0]?.f;
    if (near) {
      forecast = { valid_at: near.valid_at.toISOString(), sky_cover_pct: near.sky_cover_pct, wind_dir_deg: near.wind_dir_deg, wind_speed_mph: near.wind_speed_ms === null ? null : round(msToMph(Number(near.wind_speed_ms))), hazards: near.hazards ?? [] };
      if (near.sky_cover_pct !== null) { sky = Number(near.sky_cover_pct) >= num(thresholds, "sky_overcast_min_pct", 70) ? "overcast" : "bright"; skySource = "Forecast"; }
      if (forecast.wind_speed_mph !== null) { windCalm = forecast.wind_speed_mph <= calmMaxMph; windSource = "Forecast"; }
    } else if (input.connected) {
      messages.push("No forecast covers that time, so sky and wind come from your answers.");
    }
  }
  // Known before a time is chosen, so sky and wind can be asked on the first screen instead of appearing later.
  const possibleTrips = sun ? (["before_sunrise", "early", "day", "after_sunset", "first_light", "morning", "midday", "evening"] as const).map((w) => windowTime(w)!.getTime()) : [];
  const forecastCoversDate = input.forecasts.some((f) => possibleTrips.some((t) => Math.abs(f.valid_at.getTime() - t) <= 90 * 60_000));
  // In the dark and close to sunrise or sunset, light is low whatever the cloud cover.
  // The sun's position is worked out, not measured, so without a forecast behind it the value is a Default.
  if (lowLight) { sky = "low_light"; skySource ??= "Default"; }
  // Today the wind is read off the water: the nearest in-range station with a fresh reading beats the forecast.
  if (isToday) {
    const freshMin = num(thresholds, "obs_fresh_hours", 3) * 60;
    const measured = past.filter((o) => o.source !== "nws" && o.wind_speed_ms !== null && Number(o.distance_mi) <= maxMiles && ageMin(o.observed_at) <= freshMin)
      .sort((a, b) => Number(a.distance_mi) - Number(b.distance_mi) || b.observed_at.getTime() - a.observed_at.getTime())[0];
    if (measured) { windCalm = round(msToMph(Number(measured.wind_speed_ms))) <= calmMaxMph; windSource = "Measured"; }
  }

  const forecastPanel = buildForecastPanel({
    date, now, timeZone: port.time_zone ?? "America/Detroit", forecasts: input.forecasts, marine: input.marine ?? null,
    waves: past.filter((o) => o.source !== "nws"),
    limits: { forecastStaleHours: num(thresholds, "forecast_stale_hours", 3), alertsStaleMinutes: num(thresholds, "alerts_stale_minutes", 30), maxMiles, maxAgeHours, marineTextDays: 6 },
  });

  return {
    forecast_panel: forecastPanel,
    port, now: now.toISOString(), trip_time: tripTime?.toISOString() ?? null, temp_source_level: level,
    water_temp_surface_f: source?.water_temp_c == null ? null : round(cToF(source.water_temp_c)),
    temp_profile: level === 1 ? toFeet(source!.temp_profile) : null,
    temp_station: source ? { name: source.station_name, source: source.source, distance_mi: Number(source.distance_mi) } : null,
    observations_at: source?.observed_at.toISOString() ?? null, age_minutes: source ? ageMin(source.observed_at) : null,
    stale: source ? !fresh(source) : false,
    wind_history: windHistory, wind_station: windStation, wind_48h: wind48h, days_to_trip: daysToTrip, is_today: isToday, day_kind: dayKind, time_window: window, sky_source: skySource, wind_source: windSource, limits: { fresh_hours: num(thresholds, "obs_fresh_hours", 3), stale_hours: staleHours, max_miles: maxMiles }, forecast, forecast_covers_date: forecastCoversDate, sky, wind_calm: windCalm,
    light_period: light, hours_after_sunrise: hoursAfterSunrise, sunrise: sun?.sunrise.toISOString() ?? null, sunset: sun?.sunset.toISOString() ?? null,
    messages, readings,
  };
}

/** Reads the cache for a port. Rows come back in metric; buildConditions converts. */
export async function loadConditions(q: Queryable, port: PortRow, date: string, timeOfDay: TimeOfDay | null, now: Date, thresholds: Threshold[]): Promise<Conditions> {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const obs = await q.query(
    `select s.name as station_name, s.source, s.lat, s.lon, ps.distance_mi, ps.rank, o.observed_at, o.wind_dir_deg, o.wind_speed_ms, o.wave_height_m, o.wave_period_s, o.air_temp_c, o.water_temp_c, o.temp_profile
     from public.port_stations ps
     join public.stations s on s.id = ps.station_id
     join public.observations o on o.station_id = s.id
     where ps.port_id = $1 and o.observed_at > $2 and o.observed_at <= $3`,
    [port.id, new Date(now.getTime() - 72 * 3_600_000), now],
  );
  const linked = await q.query(
    "select count(*)::int as n from public.port_stations ps join public.stations s on s.id = ps.station_id where ps.port_id = $1 and s.source <> 'nws' and ps.distance_mi <= $2",
    [port.id, Number(thresholds.find((t) => t.name === "station_max_miles")?.value ?? 25)],
  );
  const noon = new Date(`${date}T17:00:00Z`);
  const fc = await q.query(
    "select valid_at, fetched_at, sky_cover_pct, precip_pct, air_temp_c, wind_dir_deg, wind_speed_ms, hazards from public.forecasts where port_id = $1 and valid_at between $2 and $3",
    [port.id, new Date(noon.getTime() - 18 * 3_600_000), new Date(noon.getTime() + 18 * 3_600_000)],
  );
  const zone = await q.query("select zone, forecast_text, issued_at, text_fetched_at, alerts, alerts_fetched_at from public.marine_forecasts where port_id = $1", [port.id]);
  return buildConditions({
    port, date, timeOfDay, now, thresholds, connected: true, buoysInRange: linked.rows[0].n, marine: zone.rows[0] ?? null,
    observations: obs.rows.map((r) => ({ ...r, lat: Number(r.lat), lon: Number(r.lon), distance_mi: Number(r.distance_mi), wind_dir_deg: n(r.wind_dir_deg), wind_speed_ms: n(r.wind_speed_ms), wave_height_m: n(r.wave_height_m), wave_period_s: n(r.wave_period_s), air_temp_c: n(r.air_temp_c), water_temp_c: n(r.water_temp_c) })),
    forecasts: fc.rows.map((r) => ({ ...r, precip_pct: n(r.precip_pct), air_temp_c: n(r.air_temp_c), sky_cover_pct: n(r.sky_cover_pct), wind_dir_deg: n(r.wind_dir_deg), wind_speed_ms: n(r.wind_speed_ms) })),
  });
}
