/** Home screen logic with no React in it, so it can be tested on its own. */
import { distanceMi } from "../../seed/geo";

/** The next date the rules cover: April 1 of this year before the season, of next year after it. */
export function nextSeasonStart(date: string): string {
  const year = Number(date.slice(0, 4));
  return `${Number(date.slice(5, 7)) > 10 ? year + 1 : year}-04-01`;
}

/** Today in season; opening day from November through March, so Home never opens on a date with no setup. */
export function defaultDate(today: string): { date: string; openingDay: boolean } {
  const month = Number(today.slice(5, 7));
  return month >= 4 && month <= 10 ? { date: today, openingDay: false } : { date: nextSeasonStart(today), openingDay: true };
}

/** Null when the date can be sent; otherwise the sentence to show under the field. */
export function checkDate(value: string, today: string): string | null {
  const malformed = "Enter a date like 07/15/2027.";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return malformed;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(Date.UTC(year, month - 1, day));
  if (real.getUTCFullYear() !== year || real.getUTCMonth() !== month - 1 || real.getUTCDate() !== day) return malformed;
  const thisYear = Number(today.slice(0, 4));
  return year < thisYear - 1 || year > thisYear + 2 ? `Pick a date between ${thisYear - 1} and ${thisYear + 2}.` : null;
}

export interface PortOption { name: string; state: string; lat: number; lon: number }

export function nearestFirst<P extends PortOption>(ports: readonly P[], here: { lat: number; lon: number }): P[] {
  return [...ports].sort((a, b) => distanceMi(here.lat, here.lon, a.lat, a.lon) - distanceMi(here.lat, here.lon, b.lat, b.lon));
}
