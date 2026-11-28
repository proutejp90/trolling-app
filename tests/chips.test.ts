import { describe, expect, it } from "vitest";
import { thresholds } from "../seed/thresholds";
import { capBadges, conditionChips, dataAge, groupStatus, isStale } from "../src/lib/chips";

const limit = (name: string) => Number(thresholds.find((t) => t.name === name)!.value);
const fresh = limit("obs_fresh_hours"), stale = limit("obs_stale_hours");

describe("data age chip", () => {
  it("is success below and at the fresh limit, warning above it", () => {
    expect(dataAge(fresh * 60 - 1, fresh)).toEqual({ text: "Buoy 3 h old", tone: "success" });
    expect(dataAge(fresh * 60, fresh)).toEqual({ text: "Buoy 3 h old", tone: "success" });
    expect(dataAge(fresh * 60 + 1, fresh)).toEqual({ text: "Buoy 3 h old", tone: "warning" });
  });
  it("words minutes and hours", () => {
    expect(dataAge(47, fresh)).toEqual({ text: "Buoy 47 min old", tone: "success" });
    expect(dataAge(7 * 60, fresh)).toEqual({ text: "Buoy 7 h old", tone: "warning" });
  });
  it("is neutral with no live data", () => {
    expect(dataAge(null, fresh)).toEqual({ text: "No live water data", tone: "neutral" });
  });
});

describe("stale badge on a station row", () => {
  it("shows above the stale limit, not at or below it", () => {
    expect(isStale(stale * 60 - 1, stale)).toBe(false);
    expect(isStale(stale * 60, stale)).toBe(false);
    expect(isStale(stale * 60 + 1, stale)).toBe(true);
  });
});

describe("condition chips", () => {
  const base = { water: { temp_f: null, has_station: false }, inputs: { sky: null, wind_calm: null, clarity: null }, sources: { sky: null, wind: null, depth_kind: null }, upwelling: false } as const;
  it("gives one chip per input the engine used, with its source", () => {
    expect(conditionChips({
      water: { temp_f: 43, has_station: true }, inputs: { sky: "overcast", wind_calm: true, clarity: "clear" },
      sources: { sky: "you", wind: "forecast", depth_kind: "default" }, upwelling: true,
    })).toEqual([
      { text: "Water 43 °F · buoy", tone: "info" }, { text: "Sky overcast · you", tone: "neutral" }, { text: "Wind calm · forecast", tone: "accent" },
      { text: "Clarity clear · you", tone: "neutral" }, { text: "Depth · month default", tone: "warning" }, { text: "Upwelling likely · wind history", tone: "info" },
    ]);
  });
  it("leaves out inputs the engine did not have", () => {
    expect(conditionChips(base)).toEqual([]);
    expect(conditionChips({ ...base, inputs: { sky: "low_light", wind_calm: false, clarity: "unknown" }, sources: { sky: "time of day", wind: "you", depth_kind: "buoy" } }))
      .toEqual([{ text: "Sky low light · time of day", tone: "neutral" }, { text: "Wind breezy · you", tone: "neutral" }, { text: "Depth · buoy", tone: "info" }]);
  });
});

describe("badge rows", () => {
  it("show at most three, collapsing the rest", () => {
    expect(capBadges([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(capBadges([1, 2, 3, 4])).toEqual({ shown: [1, 2], more: 2 });
    expect(capBadges([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2], more: 3 });
  });
});

describe("question group status", () => {
  it("says done or how many are left", () => {
    expect(groupStatus(0)).toEqual({ text: "Done", tone: "success" });
    expect(groupStatus(1)).toEqual({ text: "1 left", tone: "neutral" });
  });
});
