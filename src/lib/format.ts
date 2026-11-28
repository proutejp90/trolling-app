/** Small formatters shared by the screens. No React, so they can be tested alone. */

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** How long ago a reading was taken. Hours up to `daysFromHours`, days after. */
export function ago(minutes: number, daysFromHours = 36): string {
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${count(minutes, "minute")} ago`;
  if (minutes < daysFromHours * 60) return `${count(Math.round(minutes / 60), "hour")} ago`;
  return `${count(Math.round(minutes / 1440), "day")} ago`;
}

export interface Wind48h { station: string | null; hours: number; north_east_hours: number | null; enough: boolean; used: boolean }

/** The line under "Wind, last 48 hours". */
export function windHistoryLine(w: Wind48h, daysToTrip: number): string {
  if (!w.enough) return `Wind history needs a day of readings. ${w.hours ? `${count(w.hours, "hour")} so far` : "None so far"}.`;
  const line = `${w.station}: ${w.north_east_hours} of ${w.hours} hours from the north or east.`;
  if (w.used) return line;
  return daysToTrip < 0 ? `${line} Not used: this date has passed.` : `${line} Not used for this trip: it is ${count(daysToTrip, "day")} away.`;
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
export const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8]!;
/** "July 15" from an ISO date. */
export const monthName = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric" });
