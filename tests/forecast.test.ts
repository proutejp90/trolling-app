/** The forecast panel: parsers on recorded responses, and what the panel shows (G30 to G32). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildForecastPanel, localDate, type MarineRow } from "../src/server/forecast-panel";
import { marineParagraphs } from "../src/components/quiz/conditions-view";
import { parseAlerts, parseGrid, parseNearshore, parsePoint, ugcZones } from "../src/server/sources/nws";

const fixture = (path: string) => JSON.parse(JSON.parse(readFileSync(`fixtures/november/nws/${path}.json`, "utf8")).body);

describe("NWS parsers for the panel", () => {
  it("reads a port's marine zone and time zone from its point", () => {
    expect(parsePoint(fixture("points/43.2270_-86.3410"))).toMatchObject({ zone: "LMZ847", time_zone: "America/Detroit", grid_id: "GRR" });
  });

  it("reads rain chance and air temperature by the hour", () => {
    const hours = parseGrid(fixture("grid/GRR-18-58"));
    const withRain = hours.filter((h) => h.precip_pct !== null), withAir = hours.filter((h) => h.air_temp_c !== null);
    expect(withRain.length).toBeGreaterThan(24);
    expect(withAir.length).toBeGreaterThan(24);
    for (const h of withRain) { expect(h.precip_pct).toBeGreaterThanOrEqual(0); expect(h.precip_pct).toBeLessThanOrEqual(100); }
    for (const h of withAir) { expect(h.air_temp_c).toBeGreaterThan(-40); expect(h.air_temp_c).toBeLessThan(45); }
  });

  it("keeps an alert's headline and times exactly as issued", () => {
    const raw = fixture("alerts/LMZ847");
    const alerts = parseAlerts(raw, "LMZ847");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({
      event: "Small Craft Advisory",
      headline: raw.features[0].properties.headline,
      issued_at: "2026-11-28T03:30:00-05:00", starts_at: "2026-11-28T03:30:00-05:00", ends_at: "2026-11-28T19:00:00-05:00",
      url: "https://forecast.weather.gov/shmrn.php?mz=lmz847",
    });
    expect(alerts[0]!.headline).toBe("Small Craft Advisory issued November 28 at 3:30AM EST until November 28 at 7:00PM EST by NWS Grand Rapids MI");
    expect(parseAlerts({ features: [] }, "LMZ847")).toEqual([]);
  });

  it("expands the zones a product section covers", () => {
    expect(ugcZones("LMZ847-282200-")).toEqual(["LMZ847"]);
    expect(ugcZones("LMZ844-845>847-849-282200-")).toEqual(["LMZ844", "LMZ845", "LMZ846", "LMZ847", "LMZ849"]);
    expect(ugcZones("Grand Haven to Whitehall MI-")).toEqual([]);
  });

  it("cuts one zone's marine forecast out of the product, word for word", () => {
    const product = fixture("nsh/GRR");
    const marine = parseNearshore(product.productText, "LMZ847", product.issuanceTime)!;
    expect(marine.zone).toBe("LMZ847");
    expect(marine.issued_at).toBe("2026-11-28T14:06:00+00:00");
    expect(marine.text.startsWith("Grand Haven to Whitehall MI-")).toBe(true);
    expect(marine.text).toContain("...SMALL CRAFT ADVISORY IN EFFECT UNTIL 7 PM EST THIS EVENING...");
    expect(marine.text).not.toContain("$$");
    expect(marine.text).not.toContain("Whitehall to Pentwater"); // the next zone's section
    expect(product.productText).toContain(marine.text); // nothing reworded
    expect(parseNearshore(product.productText, "LMZ999")).toBeNull();
  });
});

describe("forecast panel", () => {
  const tz = "America/Detroit";
  const now = new Date("2026-11-28T17:00:00Z"); // noon at the port
  const limits = { forecastStaleHours: 3, alertsStaleMinutes: 30, maxMiles: 25, maxAgeHours: 24, marineTextDays: 6 };
  const hour = (iso: string, fetchedHoursAgo = 1) => ({ valid_at: new Date(iso), fetched_at: new Date(now.getTime() - fetchedHoursAgo * 3_600_000), sky_cover_pct: 40, precip_pct: 20, air_temp_c: 5, wind_dir_deg: 270, wind_speed_ms: 5 });
  const alert = { event: "Small Craft Advisory", headline: "Small Craft Advisory issued November 28 at 3:30AM EST until November 28 at 7:00PM EST by NWS Grand Rapids MI", issued_at: "2026-11-28T03:30:00-05:00", starts_at: "2026-11-28T03:30:00-05:00", ends_at: "2026-11-28T19:00:00-05:00", url: "https://forecast.weather.gov/shmrn.php?mz=lmz847" };
  const marine = (over: Partial<MarineRow> = {}): MarineRow => ({ zone: "LMZ847", forecast_text: "Grand Haven to Whitehall MI-\n.TODAY...West winds 10 to 20 knots.", issued_at: new Date("2026-11-28T14:06:00Z"), text_fetched_at: now, alerts: [alert], alerts_fetched_at: new Date(now.getTime() - 10 * 60_000), ...over });
  const build = (over: Partial<Parameters<typeof buildForecastPanel>[0]> = {}) =>
    buildForecastPanel({ date: "2026-11-28", now, timeZone: tz, forecasts: [hour("2026-11-28T15:00:00Z"), hour("2026-11-28T16:00:00Z"), hour("2026-11-29T06:00:00Z")], marine: marine(), waves: [], limits, ...over });

  it("works out the date at the port, not on the server", () => {
    expect(localDate(new Date("2026-11-29T04:30:00Z"), tz)).toBe("2026-11-28"); // 11:30 p.m. Eastern
    expect(localDate(new Date("2026-11-29T05:30:00Z"), tz)).toBe("2026-11-29");
    expect(localDate(new Date("2026-11-29T05:30:00Z"), "America/Chicago")).toBe("2026-11-28");
  });

  it("shows the trip day's hours in the port's day, in display units", () => {
    const p = build();
    expect(p.hours.map((h) => h.valid_at)).toEqual(["2026-11-28T15:00:00.000Z", "2026-11-28T16:00:00.000Z"]); // 06:00Z on the 29th is 1 a.m. the next day
    expect(p.hours[0]).toMatchObject({ wind_speed_mph: 11.2, wind_dir_deg: 270, sky_cover_pct: 40, precip_pct: 20, air_temp_f: 41 });
    expect(p).toMatchObject({ source: "National Weather Service", is_today: true, stale: false });
  });

  it("G30: an active alert is shown exactly as stored, with its times and link", () => {
    const p = build();
    expect(p.alerts).toEqual([alert]);
    expect(p.alerts_stale).toBe(false);
  });

  it("G38: today's alert is not carried onto tomorrow, and an alert that has ended is dropped", () => {
    expect(build({ date: "2026-11-29" }).alerts).toEqual([]);
    expect(build({ now: new Date("2026-11-29T01:00:00Z") }).alerts).toEqual([]); // 8 p.m., an hour after it ended
    // An alert that starts tomorrow does not show today.
    const later = { ...alert, starts_at: "2026-11-29T06:00:00-05:00", ends_at: "2026-11-29T18:00:00-05:00" };
    expect(build({ marine: marine({ alerts: [later] }) }).alerts).toEqual([]);
  });

  it("G31: a forecast or alerts past their limits are marked stale, at the limit they are not", () => {
    const fetched = (h: number) => build({ forecasts: [hour("2026-11-28T15:00:00Z", h)] }).stale;
    expect([fetched(2.9), fetched(3), fetched(4)]).toEqual([false, false, true]);
    const alertsAt = (min: number) => build({ marine: marine({ alerts_fetched_at: new Date(now.getTime() - min * 60_000) }) }).alerts_stale;
    expect([alertsAt(29), alertsAt(30), alertsAt(31)]).toEqual([false, false, true]);
    expect(build().more_url).toBe("https://forecast.weather.gov/shmrn.php?mz=lmz847");
  });

  it("G32: with no buoy reporting waves, the marine text shows and no wave number exists", () => {
    const p = build();
    expect(p.marine?.text).toContain("West winds 10 to 20 knots.");
    expect(p.observed_waves).toBeNull();
    expect(Object.keys(p).filter((k) => /wave/i.test(k))).toEqual(["observed_waves"]); // no forecast wave field to fill with a guess
  });

  it("shows observed waves from the nearest in-range buoy, today only", () => {
    const waves = [
      { station_name: "Far buoy", distance_mi: 30, observed_at: new Date(now.getTime() - 600_000), wave_height_m: 2, wave_period_s: 6 },
      { station_name: "Muskegon Buoy, MI", distance_mi: 3.1, observed_at: new Date(now.getTime() - 20 * 60_000), wave_height_m: 0.8, wave_period_s: 4 },
      { station_name: "Shore station", distance_mi: 0.1, observed_at: new Date(now.getTime() - 600_000), wave_height_m: null },
    ];
    expect(build({ waves }).observed_waves).toEqual({ station: "Muskegon Buoy, MI", height_ft: 2.6, period_s: 4, age_minutes: 20 });
    expect(build({ waves, date: "2026-11-29" }).observed_waves).toBeNull();
  });

  it("drops the marine text for a date beyond what it covers, and for a past date", () => {
    expect(build({ date: "2026-12-04" }).marine).not.toBeNull();
    expect(build({ date: "2026-12-05" }).marine).toBeNull();
    expect(build({ date: "2026-11-27" }).marine).toBeNull();
    expect(build({ marine: null })).toMatchObject({ marine: null, alerts: [], more_url: "https://www.weather.gov/" });
  });

  it("reflows the marine text into paragraphs without changing a word", () => {
    const text = "Pentwater to Manistee MI-\n906 AM EST Sat Nov 28 2026\n\n...SMALL CRAFT ADVISORY IN EFFECT UNTIL 7 PM EST THIS EVENING...\n\n.REST OF TODAY...Southwest winds 10 to 20 knots. Cloudy late in the\nmorning then clearing.\n.TONIGHT...West winds 10 to 20 knots.";
    const paragraphs = marineParagraphs(text);
    expect(paragraphs).toEqual([
      "Pentwater to Manistee MI- 906 AM EST Sat Nov 28 2026",
      "...SMALL CRAFT ADVISORY IN EFFECT UNTIL 7 PM EST THIS EVENING...",
      ".REST OF TODAY...Southwest winds 10 to 20 knots. Cloudy late in the morning then clearing.",
      ".TONIGHT...West winds 10 to 20 knots.",
    ]);
    expect(paragraphs.join(" ").split(/\s+/)).toEqual(text.split(/\s+/)); // the same words in the same order
  });
});
