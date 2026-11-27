/**
 * Sunrise and sunset from the standard sunrise equation, good to a few minutes.
 * Used only to place "before sunrise" or "daytime" on the clock and to tell low
 * light from daylight. It is not navigation data.
 */
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function sunTimes(date: string, lat: number, lon: number): { sunrise: Date; sunset: Date } | null {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const julianMidnight = Date.UTC(y, m - 1, d) / 86_400_000 + 2440587.5;
  const n = Math.ceil(julianMidnight - 2451545.0 + 0.0008);
  const meanNoon = n - lon / 360;
  const M = (357.5291 + 0.98560028 * meanNoon) % 360;
  const C = 1.9148 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 0.0003 * Math.sin(rad(3 * M));
  const lambda = (M + C + 180 + 102.9372) % 360;
  const transit = 2451545.0 + meanNoon + 0.0053 * Math.sin(rad(M)) - 0.0069 * Math.sin(rad(2 * lambda));
  const sinDec = Math.sin(rad(lambda)) * Math.sin(rad(23.4397));
  const cosDec = Math.cos(Math.asin(sinDec));
  const cosHour = (Math.sin(rad(-0.833)) - Math.sin(rad(lat)) * sinDec) / (Math.cos(rad(lat)) * cosDec);
  if (cosHour < -1 || cosHour > 1) return null; // no sunrise or sunset on this day at this latitude
  const hour = deg(Math.acos(cosHour));
  const toDate = (julian: number) => new Date((julian - 2440587.5) * 86_400_000);
  return { sunrise: toDate(transit - hour / 360), sunset: toDate(transit + hour / 360) };
}
