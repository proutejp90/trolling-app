import { describe, expect, it } from "vitest";
import { addDays, checkDate, dayStrip, defaultDate, nearestFirst, nextSeasonStart, todayAt } from "../src/lib/home";

describe("default date on Home", () => {
  it("is today in season", () => {
    expect(defaultDate("2026-07-10")).toEqual({ date: "2026-07-10", openingDay: false });
    expect(defaultDate("2026-04-01")).toEqual({ date: "2026-04-01", openingDay: false });
    expect(defaultDate("2026-10-31")).toEqual({ date: "2026-10-31", openingDay: false });
  });
  it("is the next April 1 from November through March", () => {
    expect(defaultDate("2026-11-28")).toEqual({ date: "2027-04-01", openingDay: true });
    expect(defaultDate("2026-11-01")).toEqual({ date: "2027-04-01", openingDay: true });
    expect(defaultDate("2027-01-15")).toEqual({ date: "2027-04-01", openingDay: true });
    expect(defaultDate("2027-03-31")).toEqual({ date: "2027-04-01", openingDay: true });
  });
  it("finds opening day from any date", () => {
    expect(nextSeasonStart("2026-12-31")).toBe("2027-04-01");
    expect(nextSeasonStart("2026-02-01")).toBe("2026-04-01");
  });
});

describe("date check", () => {
  const today = "2026-11-28";
  it("accepts a real date from last year through two years ahead", () => {
    for (const d of ["2025-01-01", "2026-07-15", "2027-04-01", "2028-12-31", "2028-02-29"]) expect(checkDate(d, today)).toBeNull();
  });
  it("rejects a malformed date with an example", () => {
    for (const d of ["", "152027-07-15", "2027-7-15", "2027-02-30", "2027-13-01", "not a date"]) expect(checkDate(d, today)).toBe("Enter a date like 07/15/2027.");
  });
  it("rejects a date outside the range and names the range", () => {
    for (const d of ["2024-12-31", "2029-01-01", "1520-07-15"]) expect(checkDate(d, today)).toBe("Pick a date between 2025 and 2028.");
  });
});

describe("nearest port first", () => {
  const ports = [
    { name: "South Haven", state: "MI", lat: 42.4, lon: -86.28 },
    { name: "Grand Haven", state: "MI", lat: 43.06, lon: -86.25 },
    { name: "Muskegon", state: "MI", lat: 43.23, lon: -86.34 },
    { name: "Ludington", state: "MI", lat: 43.95, lon: -86.46 },
  ];
  it("sorts by distance from the angler and leaves the input alone", () => {
    const sorted = nearestFirst(ports, { lat: 43.06, lon: -86.23 });
    expect(sorted.map((p) => p.name)).toEqual(["Grand Haven", "Muskegon", "South Haven", "Ludington"]);
    expect(ports[0]!.name).toBe("South Haven");
  });
});

describe("day strip", () => {
  it("G39: today is the date at the port", () => {
    const halfPastMidnightEastern = new Date("2026-07-16T04:30:00Z");
    expect(todayAt("America/Detroit", halfPastMidnightEastern)).toBe("2026-07-16");
    expect(todayAt("America/Chicago", halfPastMidnightEastern)).toBe("2026-07-15");
  });
  it("lists today, tomorrow and the next five days, across a month end", () => {
    expect(dayStrip("2026-07-29")).toEqual([
      { date: "2026-07-29", label: "Today" }, { date: "2026-07-30", label: "Tomorrow" }, { date: "2026-07-31", label: "Fri 31" },
      { date: "2026-08-01", label: "Sat 1" }, { date: "2026-08-02", label: "Sun 2" }, { date: "2026-08-03", label: "Mon 3" }, { date: "2026-08-04", label: "Tue 4" },
    ]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
