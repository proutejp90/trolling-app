/**
 * Confidence is computed in code, never by the agent. It starts from where the
 * water temperature came from, moves a step for agreement or staleness, and is
 * capped for any day that is not today.
 */
export type Confidence = "low" | "medium" | "high";
export type DayKind = "today" | "forecast" | "beyond" | "past";

const STEPS: Confidence[] = ["low", "medium", "high"];
const step = (c: Confidence, by: number): Confidence => STEPS[Math.max(0, Math.min(2, STEPS.indexOf(c) + by))]!;
const cap = (c: Confidence, max: Confidence): Confidence => (STEPS.indexOf(c) > STEPS.indexOf(max) ? max : c);

export function confidenceFor(input: {
  /** 0 probe, 1 buoy profile, "1m" lake model, 2 buoy surface, 3 report, 4 the angler's answer, 5 month defaults. */
  level: 0 | 1 | "1m" | 2 | 3 | 4 | 5;
  /** Hours since the newest observation behind the depth, or null with none. */
  ageHours: number | null;
  freshHours: number; staleHours: number;
  dayKind: DayKind;
  /** A report from the last 21 days, or the angler's log: agrees with the first setup, conflicts with the depth range, or neither. */
  evidence?: "agrees" | "conflicts" | null;
}): Confidence {
  const { level, ageHours } = input;
  let c: Confidence =
    level === 0 ? "high"
    : level === 1 ? (ageHours !== null && ageHours <= input.freshHours ? "high" : "medium")
    : level === "1m" || level === 2 || level === 3 ? "medium"
    : "low";
  if (input.evidence === "agrees") c = step(c, 1);
  if (input.evidence === "conflicts") c = step(c, -1);
  if (ageHours !== null && ageHours > input.staleHours) c = step(c, -1);
  if (input.dayKind === "forecast") c = cap(c, "medium");
  if (input.dayKind === "beyond" || input.dayKind === "past") c = cap(c, "low");
  return c;
}
