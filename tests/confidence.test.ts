import { describe, expect, it } from "vitest";
import { confidenceFor } from "../src/server/confidence";

const base = { ageHours: 1, freshHours: 3, staleHours: 6, dayKind: "today" as const };

describe("confidence", () => {
  it("starts from the temperature source", () => {
    expect(confidenceFor({ ...base, level: 0 })).toBe("high");
    expect(confidenceFor({ ...base, level: 1 })).toBe("high");
    expect(confidenceFor({ ...base, level: 1, ageHours: 3 })).toBe("high"); // at the fresh limit
    expect(confidenceFor({ ...base, level: 1, ageHours: 3.1 })).toBe("medium");
    for (const level of ["1m", 2, 3] as const) expect(confidenceFor({ ...base, level })).toBe("medium");
    for (const level of [4, 5] as const) expect(confidenceFor({ ...base, level, ageHours: null })).toBe("low");
  });
  it("moves one step for agreement, conflict, or a reading over six hours old", () => {
    expect(confidenceFor({ ...base, level: 2, evidence: "agrees" })).toBe("high");
    expect(confidenceFor({ ...base, level: 5, ageHours: null, evidence: "agrees" })).toBe("medium");
    expect(confidenceFor({ ...base, level: 1, evidence: "conflicts" })).toBe("medium");
    expect(confidenceFor({ ...base, level: 2, ageHours: 6 })).toBe("medium"); // at the stale limit
    expect(confidenceFor({ ...base, level: 2, ageHours: 6.1 })).toBe("low");
    expect(confidenceFor({ ...base, level: 1, ageHours: 7 })).toBe("low"); // medium for age, then down a step for staleness
    expect(confidenceFor({ ...base, level: 5, ageHours: null, evidence: "conflicts" })).toBe("low"); // cannot go below low
  });
  it("is capped at medium for a future day and at low beyond the forecast horizon or in the past", () => {
    expect(confidenceFor({ ...base, level: 0, dayKind: "forecast" })).toBe("medium");
    expect(confidenceFor({ ...base, level: 2, evidence: "agrees", dayKind: "forecast" })).toBe("medium");
    expect(confidenceFor({ ...base, level: 0, dayKind: "beyond" })).toBe("low");
    expect(confidenceFor({ ...base, level: 1, dayKind: "past" })).toBe("low");
  });
});
