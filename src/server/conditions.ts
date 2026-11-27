/**
 * The conditions service. It reads the Postgres cache, never an external API,
 * and turns what is there into the engine's inputs plus a plain account of
 * where each input came from, how old it is, and what is missing.
 */
import type { EngineContext, Threshold } from "@recommender/engine";
import type { Queryable } from "./db";
import { sunTimes } from "./sun";
import { cToF, msToMph, mToFt, round } from "./units";

export type TimeOfDay = "before_sunrise" | "early" | "day" | "after_sunset";

export interface StationReading {
  station: string; source: string; distance_mi: number; observed_at: string; age_minutes: number;
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
  forecast: { valid_at: string; sky_cover_pct: number | null; wind_dir_deg: number | null; wind_speed_mph: number | null; hazards: { phenomenon: string; significance: string }[] } | null;
  sky: EngineContext["sky"] | null;
  wind_calm: boolean | null;
  light_period: EngineContext["light_period"] | null;
  hours_after_sunrise: number | null;
  sunrise: string | null;
  sunset: string | null;
  /** What the app does not know, in sentences an angler can read. */
  messages: string[];
  /** Latest reading per linked station, nearest first, for the Conditions screen. */
  readings: StationReading[];
}

export interface PortRow { id: string | null; name: string; shore: "east" | "west"; lat: number; lon: number }
export interface ObservationRow {
  station_name: string; source: string; distance_mi: number; rank: number; observed_at: Date;
  wind_dir_deg: number | null; wind_speed_ms: number | null; wave_height_m: number | null; air_temp_c: number | null; water_temp_c: number | null;
  temp_profile: { depth_m: number; temp_c: number }[] | null;
}
export interface ForecastRow { valid_at: Date; sky_cover_pct: number | null; wind_dir_deg: number | null; wind_speed_ms: number | null; hazards: { phenomenon: string; significance: string }[] }

const TIME_OFFSET: Record<TimeOfDay, { from: "sunrise" | "sunset"; hours: number; light: NonNullable<EngineContext["light_period"]> }> = {
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
}): Conditions {
  const { port, date, timeOfDay, now, thresholds } = input;
  const messages: string[] = [];
  const maxMiles = num(thresholds, "station_max_miles", 25);
  const staleHours = num(thresholds, "obs_stale_hours", 6);
  const maxAgeHours = num(thresholds, "obs_max_age_hours", 24);
  const maxDaysOut = num(thresholds, "trip_max_days_ahead", 2);
  const ageMin = (d: Date) => Math.round((now.getTime() - d.getTime()) / 60_000);

  // --- Clock: where the trip sits relative to sunrise and sunset ---
  const sun = sunTimes(date, port.lat, port.lon);
  let tripTime: Date | null = null, light: Conditions["light_period"] = null, hoursAfterSunrise: number | null = null;
  if (sun && timeOfDay) {
    const o = TIME_OFFSET[timeOfDay];
    tripTime = new Date(sun[o.from].getTime() + o.hours * 3_600_000);
    light = o.light;
    hoursAfterSunrise = round((tripTime.getTime() - sun.sunrise.getTime()) / 3_600_000, 1);
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
  const readings: StationReading[] = latest.map((o) => ({
    station: o.station_name, source: o.source, distance_mi: Number(o.distance_mi), observed_at: o.observed_at.toISOString(), age_minutes: ageMin(o.observed_at),
    water_temp_f: o.water_temp_c === null ? null : round(cToF(o.water_temp_c)),
    wind_dir_deg: o.wind_dir_deg, wind_speed_mph: o.wind_speed_ms === null ? null : round(msToMph(o.wind_speed_ms)),
    wave_height_ft: o.wave_height_m === null ? null : round(mToFt(o.wave_height_m)), air_temp_f: o.air_temp_c === null ? null : round(cToF(o.air_temp_c)),
    temp_profile: toFeet(o.temp_profile),
  }));

  // --- Water temperature: the fallback ladder, levels 1 and 2 ---
  const daysOut = Math.abs(new Date(`${date}T12:00:00Z`).getTime() - now.getTime()) / 86_400_000;
  const buoys = latest.filter((o) => o.source !== "nws");
  const inRange = buoys.filter((o) => Number(o.distance_mi) <= maxMiles);
  const usable = inRange.filter((o) => ageMin(o.observed_at) <= maxAgeHours * 60);
  const fresh = (o: ObservationRow) => ageMin(o.observed_at) <= staleHours * 60;
  const pick = (ok: (o: ObservationRow) => boolean) => usable.filter(ok).sort((a, b) => Number(fresh(b)) - Number(fresh(a)) || a.distance_mi - b.distance_mi)[0];
  let level: Conditions["temp_source_level"] = 5;
  let source: ObservationRow | undefined;
  if (!input.connected) {
    messages.push("Live water data is not connected. Results use month defaults.");
  } else if (daysOut > maxDaysOut + 0.5) {
    messages.push(`Buoy readings describe the water now, not ${Math.round(daysOut)} days away. Results use month defaults.`);
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
    return { name: rows[0]!.station_name, distance: Number(rows[0]!.distance_mi), history: [...hours.entries()].map(([hours_ago, d]) => ({ hours_ago, dir_deg: meanDirection(d) })).sort((a, b) => a.hours_ago - b.hours_ago) };
  });
  // Nearest station with most of the window covered; failing that, the best coverage there is.
  const chosen = histories.filter((h) => h.history.length >= 36).sort((a, b) => a.distance - b.distance)[0] ?? histories.filter((h) => h.history.length >= 24).sort((a, b) => b.history.length - a.history.length)[0];
  if (chosen) { windHistory = chosen.history; windStation = chosen.name; }
  else if (input.connected) messages.push("There is too little wind history to check for an upwelling.");

  // --- Forecast at the trip time ---
  let forecast: Conditions["forecast"] = null, sky: Conditions["sky"] = null, windCalm: boolean | null = null;
  if (tripTime) {
    const near = input.forecasts.map((f) => ({ f, gap: Math.abs(f.valid_at.getTime() - tripTime!.getTime()) })).filter((x) => x.gap <= 90 * 60_000).sort((a, b) => a.gap - b.gap)[0]?.f;
    if (near) {
      forecast = { valid_at: near.valid_at.toISOString(), sky_cover_pct: near.sky_cover_pct, wind_dir_deg: near.wind_dir_deg, wind_speed_mph: near.wind_speed_ms === null ? null : round(msToMph(Number(near.wind_speed_ms))), hazards: near.hazards ?? [] };
      if (near.sky_cover_pct !== null) sky = Number(near.sky_cover_pct) >= num(thresholds, "sky_overcast_min_pct", 70) ? "overcast" : "bright";
      if (forecast.wind_speed_mph !== null) windCalm = forecast.wind_speed_mph <= num(thresholds, "wind_calm_max_mph", 6);
    } else if (input.connected) {
      messages.push("No forecast covers that time, so sky and wind come from your answers.");
    }
  }
  // In the dark, light is low whatever the cloud cover.
  if (light === "before_sunrise" || light === "after_sunset") sky = "low_light";

  return {
    port, now: now.toISOString(), trip_time: tripTime?.toISOString() ?? null, temp_source_level: level,
    water_temp_surface_f: source?.water_temp_c == null ? null : round(cToF(source.water_temp_c)),
    temp_profile: level === 1 ? toFeet(source!.temp_profile) : null,
    temp_station: source ? { name: source.station_name, source: source.source, distance_mi: Number(source.distance_mi) } : null,
    observations_at: source?.observed_at.toISOString() ?? null, age_minutes: source ? ageMin(source.observed_at) : null,
    stale: source ? !fresh(source) : false,
    wind_history: windHistory, wind_station: windStation, forecast, sky, wind_calm: windCalm,
    light_period: light, hours_after_sunrise: hoursAfterSunrise, sunrise: sun?.sunrise.toISOString() ?? null, sunset: sun?.sunset.toISOString() ?? null,
    messages, readings,
  };
}

/** Reads the cache for a port. Rows come back in metric; buildConditions converts. */
export async function loadConditions(q: Queryable, port: PortRow, date: string, timeOfDay: TimeOfDay | null, now: Date, thresholds: Threshold[]): Promise<Conditions> {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const obs = await q.query(
    `select s.name as station_name, s.source, ps.distance_mi, ps.rank, o.observed_at, o.wind_dir_deg, o.wind_speed_ms, o.wave_height_m, o.air_temp_c, o.water_temp_c, o.temp_profile
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
    "select valid_at, sky_cover_pct, wind_dir_deg, wind_speed_ms, hazards from public.forecasts where port_id = $1 and valid_at between $2 and $3",
    [port.id, new Date(noon.getTime() - 18 * 3_600_000), new Date(noon.getTime() + 18 * 3_600_000)],
  );
  return buildConditions({
    port, date, timeOfDay, now, thresholds, connected: true, buoysInRange: linked.rows[0].n,
    observations: obs.rows.map((r) => ({ ...r, distance_mi: Number(r.distance_mi), wind_dir_deg: n(r.wind_dir_deg), wind_speed_ms: n(r.wind_speed_ms), wave_height_m: n(r.wave_height_m), air_temp_c: n(r.air_temp_c), water_temp_c: n(r.water_temp_c) })),
    forecasts: fc.rows.map((r) => ({ ...r, sky_cover_pct: n(r.sky_cover_pct), wind_dir_deg: n(r.wind_dir_deg), wind_speed_ms: n(r.wind_speed_ms) })),
  });
}
