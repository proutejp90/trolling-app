/** The fallback ladder and what the conditions service says about gaps. Pure function, hand-built rows. */
import { describe, expect, it } from "vitest";
import { thresholds } from "../seed/thresholds";
import { buildConditions, type ForecastRow, type ObservationRow } from "../src/server/conditions";

const now = new Date("2026-07-15T16:00:00Z");
const port = { id: "p1", name: "Muskegon", shore: "east" as const, lat: 43.227, lon: -86.341 };
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const obs = (o: Partial<ObservationRow> & { observed_at: Date }): ObservationRow => ({
  station_name: "Muskegon Buoy", source: "ndbc", distance_mi: 3.5, rank: 1, wind_dir_deg: null, wind_speed_ms: null,
  wave_height_m: null, air_temp_c: null, water_temp_c: null, temp_profile: null, ...o,
});
const profile = [{ depth_m: 0, temp_c: 20 }, { depth_m: 6, temp_c: 18 }, { depth_m: 12, temp_c: 12 }, { depth_m: 18, temp_c: 7 }];
const build = (observations: ObservationRow[], extra: Partial<Parameters<typeof buildConditions>[0]> = {}) =>
  buildConditions({ port, date: "2026-07-15", timeOfDay: "day", now, observations, forecasts: [], thresholds, connected: true, ...extra });

describe("water temperature ladder", () => {
  it("level 1: a buoy within 25 miles with temperature at depth", () => {
    const c = build([obs({ observed_at: hoursAgo(1), water_temp_c: 20, temp_profile: profile, station_name: "Muskegon Buoy", source: "seagull" })]);
    expect(c.temp_source_level).toBe(1);
    expect(c.temp_profile).toEqual([{ depth_ft: 0, temp_f: 68 }, { depth_ft: 20, temp_f: 64.4 }, { depth_ft: 39, temp_f: 53.6 }, { depth_ft: 59, temp_f: 44.6 }]);
    expect(c).toMatchObject({ age_minutes: 60, stale: false, water_temp_surface_f: 68, temp_station: { name: "Muskegon Buoy", distance_mi: 3.5 } });
  });

  it("level 2: surface temperature only, and it says so", () => {
    const c = build([obs({ observed_at: hoursAgo(2), water_temp_c: 15.8 })]);
    expect(c.temp_source_level).toBe(2);
    expect(c.temp_profile).toBeNull();
    expect(c.water_temp_surface_f).toBe(60.4);
    expect(c.messages).toContain("No buoy nearby reports temperature at depth right now, only at the surface.");
  });

  it("ignores a profile from a buoy more than 25 miles away", () => {
    const c = build([
      obs({ observed_at: hoursAgo(1), temp_profile: profile, water_temp_c: 20, station_name: "Ludington buoy", distance_mi: 54 }),
      obs({ observed_at: hoursAgo(1), water_temp_c: 19 }),
    ]);
    expect(c.temp_source_level).toBe(2);
    expect(c.temp_station?.name).toBe("Muskegon Buoy");
  });

  it("prefers a fresh reading over a nearer stale one, and flags readings older than 6 hours", () => {
    const stale = obs({ observed_at: hoursAgo(7), water_temp_c: 18 });
    const fresh = obs({ observed_at: hoursAgo(1), water_temp_c: 19, station_name: "Port Sheldon buoy", distance_mi: 22.9 });
    expect(build([stale, fresh]).temp_station?.name).toBe("Port Sheldon buoy");
    const only = build([stale]);
    expect(only.stale).toBe(true);
    expect(only.messages).toContain("The newest water reading is more than 6 hours old.");
  });

  it("level 5 in winter: buoys linked but silent", () => {
    const c = build([obs({ observed_at: hoursAgo(30), water_temp_c: 5 })]);
    expect(c.temp_source_level).toBe(5);
    expect(c.messages).toContain("Live water data is unavailable until buoys return. Results use month defaults.");
    expect(c.temp_station).toBeNull();
  });

  it("level 5 in winter with an empty cache, when buoys are linked but none has reported", () => {
    const c = build([], { buoysInRange: 3 });
    expect(c.messages[0]).toBe("Live water data is unavailable until buoys return. Results use month defaults.");
  });

  it("level 5 with no station in range, naming the port", () => {
    const c = build([obs({ observed_at: hoursAgo(1), water_temp_c: 19, distance_mi: 41.9 })]);
    expect(c.temp_source_level).toBe(5);
    expect(c.messages[0]).toBe("No buoy within 25 miles of Muskegon is in the cache. Results use month defaults.");
  });

  it("does not use today's water for a trip a week out", () => {
    const c = build([obs({ observed_at: hoursAgo(1), temp_profile: profile, water_temp_c: 20 })], { date: "2026-07-22" });
    expect(c.temp_source_level).toBe(5);
    expect(c.messages[0]).toMatch(/not 7 days away/);
  });

  it("fills a partial newest report from the same station's earlier rows", () => {
    const c = build([obs({ observed_at: hoursAgo(0.2), wave_height_m: 0.5 }), obs({ observed_at: hoursAgo(1), water_temp_c: 17 })]);
    expect(c.temp_source_level).toBe(2);
    expect(c.readings[0]).toMatchObject({ water_temp_f: 62.6, wave_height_ft: 1.6, age_minutes: 12 });
  });

  it("says live data is not connected when there is no database", () => {
    const c = build([], { connected: false });
    expect(c.temp_source_level).toBe(5);
    expect(c.messages).toEqual(["Live water data is not connected. Results use month defaults."]);
  });
});

describe("wind history", () => {
  const wind = (station: string, source: string, distance: number, hours: number, dir: number) =>
    Array.from({ length: hours }, (_, i) => obs({ observed_at: hoursAgo(i + 0.5), wind_dir_deg: dir, wind_speed_ms: 5, station_name: station, source, distance_mi: distance }));

  it("gives one direction per hour for the last 48 hours from the nearest station that covers them", () => {
    const c = build([...wind("Muskegon Buoy", "ndbc", 3.5, 48, 20), ...wind("Muskegon County Airport", "nws", 6, 48, 200)]);
    expect(c.wind_station).toBe("Muskegon Buoy");
    expect(c.wind_history).toHaveLength(48);
    expect(c.wind_history[0]).toEqual({ hours_ago: 1, dir_deg: 20 });
  });

  it("falls back to an airport when the buoy has too few hours", () => {
    const c = build([...wind("Muskegon Buoy", "ndbc", 3.5, 5, 20), ...wind("Muskegon County Airport", "nws", 6, 40, 200)]);
    expect(c.wind_station).toBe("Muskegon County Airport");
  });

  it("averages directions around north correctly", () => {
    const rows = [obs({ observed_at: hoursAgo(0.2), wind_dir_deg: 350 }), obs({ observed_at: hoursAgo(0.6), wind_dir_deg: 10 }), ...wind("Muskegon Buoy", "ndbc", 3.5, 40, 0).slice(1)];
    expect(build(rows).wind_history[0]!.dir_deg % 360).toBe(0);
  });

  it("does not apply this week's wind to a trip weeks away", () => {
    const c = build(wind("Muskegon Buoy", "ndbc", 3.5, 48, 20), { date: "2026-08-20" });
    expect(c.wind_history).toEqual([]);
    expect(c.wind_station).toBeNull();
  });

  it("says when there is too little wind history", () => {
    const c = build(wind("Muskegon Buoy", "ndbc", 3.5, 6, 20));
    expect(c.wind_history).toEqual([]);
    expect(c.messages).toContain("There is too little wind history to check for an upwelling.");
  });
});

describe("forecast, sky and light", () => {
  const forecastAt = (c: ReturnType<typeof build>, f: Partial<ForecastRow>) => [{ valid_at: new Date(c.trip_time!), sky_cover_pct: null, wind_dir_deg: null, wind_speed_ms: null, hazards: [], ...f }];
  const base = build([]);

  it("places the trip on the clock from sunrise", () => {
    expect(base.light_period).toBe("day");
    expect(base.hours_after_sunrise).toBe(5);
    expect(new Date(base.trip_time!).getTime() - new Date(base.sunrise!).getTime()).toBe(5 * 3_600_000);
  });

  it("reads overcast at 70 percent cover and bright below it", () => {
    expect(build([], { forecasts: forecastAt(base, { sky_cover_pct: 70 }) }).sky).toBe("overcast");
    expect(build([], { forecasts: forecastAt(base, { sky_cover_pct: 69 }) }).sky).toBe("bright");
  });

  it("reads calm at 6 mph and under", () => {
    expect(build([], { forecasts: forecastAt(base, { wind_speed_ms: 2.6 }) }).wind_calm).toBe(true); // 5.8 mph
    expect(build([], { forecasts: forecastAt(base, { wind_speed_ms: 3.2 }) }).wind_calm).toBe(false); // 7.2 mph
  });

  it("calls the light low before sunrise and after sunset, whatever the cloud", () => {
    for (const timeOfDay of ["before_sunrise", "after_sunset"] as const) {
      const dark = build([], { timeOfDay });
      expect(build([], { timeOfDay, forecasts: forecastAt(dark, { sky_cover_pct: 5 }) }).sky).toBe("low_light");
    }
  });

  it("says whether any forecast covers the date, before a time is chosen", () => {
    const noTime = build([], { timeOfDay: null });
    expect(noTime.forecast_covers_date).toBe(false);
    // One forecast hour near the daytime trip is enough: part of the date is covered.
    expect(build([], { timeOfDay: null, forecasts: forecastAt(base, { sky_cover_pct: 40 }) }).forecast_covers_date).toBe(true);
    const weekEarlier = [{ valid_at: new Date(new Date(base.trip_time!).getTime() - 7 * 86_400_000), sky_cover_pct: 40, wind_dir_deg: null, wind_speed_ms: null, hazards: [] }];
    expect(build([], { timeOfDay: null, forecasts: weekEarlier }).forecast_covers_date).toBe(false);
  });

  it("leaves sky and wind unknown, and says so, when no forecast covers the trip", () => {
    expect(base).toMatchObject({ sky: null, wind_calm: null, forecast: null });
    expect(base.messages).toContain("No forecast covers that time, so sky and wind come from your answers.");
  });

  it("knows nothing about the clock until the angler says when", () => {
    expect(build([], { timeOfDay: null })).toMatchObject({ trip_time: null, light_period: null, hours_after_sunrise: null });
  });
});
