/** One cached reading, in metric as received. Matches the observations table. */
export interface Reading {
  observed_at: Date;
  wind_dir_deg: number | null;
  wind_speed_ms: number | null;
  wave_height_m: number | null;
  air_temp_c: number | null;
  water_temp_c: number | null;
  temp_profile: { depth_m: number; temp_c: number }[] | null;
}

export const emptyReading = (observed_at: Date): Reading => ({
  observed_at, wind_dir_deg: null, wind_speed_ms: null, wave_height_m: null, air_temp_c: null, water_temp_c: null, temp_profile: null,
});

/** Keeps the last reading in each clock hour, so a station adds about one row an hour to the cache. */
export function hourly(readings: Reading[]): Reading[] {
  const byHour = new Map<number, Reading>();
  for (const r of readings) {
    const hour = Math.floor(r.observed_at.getTime() / 3_600_000);
    const kept = byHour.get(hour);
    if (!kept || r.observed_at > kept.observed_at) byHour.set(hour, r);
  }
  return [...byHour.values()].sort((a, b) => a.observed_at.getTime() - b.observed_at.getTime());
}
