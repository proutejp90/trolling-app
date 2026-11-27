/**
 * The six Lake Michigan NDBC stations the spec names. Coordinates are approximate
 * and UNVERIFIED: the NDBC station list was not reachable from the build
 * environment. Phase 2 rebuilds this table from NDBC's station list and adds
 * GLOS Seagull platforms with has_temp_profile set from /api/v1/parameters.
 */
export interface StationSeed {
  source: "ndbc" | "seagull" | "nws"; external_id: string; name: string; lake: string;
  lat: number; lon: number; has_temp_profile: boolean; seasonal: boolean;
}

const ndbc = (external_id: string, name: string, lat: number, lon: number): StationSeed =>
  ({ source: "ndbc", external_id, name, lake: "michigan", lat, lon, has_temp_profile: false, seasonal: true });

export const stations: StationSeed[] = [
  ndbc("45161", "Muskegon", 43.178, -86.361),
  ndbc("45029", "Port Sheldon", 42.9, -86.272),
  ndbc("45168", "South Haven", 42.397, -86.331),
  ndbc("45170", "Michigan City", 41.755, -86.968),
  ndbc("45007", "South Michigan", 42.674, -87.026),
  ndbc("45002", "North Michigan", 45.344, -86.411),
];

/** Great-circle distance in statute miles. */
export function distanceMi(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/** Stations farther than this are not linked to a port at all. The 25 mile water-temperature limit is a threshold applied at read time. */
export const PORT_STATION_LINK_MAX_MI = 75;
