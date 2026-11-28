import { describe, expect, it } from "vitest";
import { ago, windHistoryLine } from "../src/lib/format";

describe("reading ages", () => {
  it("uses the singular for one minute, hour and day", () => {
    expect(ago(0)).toBe("just now");
    expect(ago(1)).toBe("1 minute ago");
    expect(ago(59)).toBe("59 minutes ago");
    expect(ago(60)).toBe("1 hour ago");
    expect(ago(89)).toBe("1 hour ago");
    expect(ago(90)).toBe("2 hours ago");
    expect(ago(1440)).toBe("24 hours ago");
    expect(ago(2100)).toBe("35 hours ago");
    expect(ago(2160)).toBe("2 days ago");
    expect(ago(2159)).toBe("36 hours ago");
  });
  it("says 1 day ago when it rounds to one", () => {
    // Days start at 36 hours, which rounds to 2, so "1 day" cannot occur today; the wording is ready if the cut-over moves.
    expect(ago(2160, 24)).toBe("2 days ago");
    expect(ago(1500, 24)).toBe("1 day ago");
  });
});

describe("wind history line", () => {
  it("says how much history there is when it is too short", () => {
    expect(windHistoryLine({ station: "Muskegon Buoy", hours: 6, north_east_hours: null, enough: false, used: false }, 0)).toBe("Wind history needs a day of readings. 6 hours so far.");
    expect(windHistoryLine({ station: null, hours: 1, north_east_hours: null, enough: false, used: false }, 0)).toBe("Wind history needs a day of readings. 1 hour so far.");
    expect(windHistoryLine({ station: null, hours: 0, north_east_hours: null, enough: false, used: false }, 0)).toBe("Wind history needs a day of readings. None so far.");
  });
  it("reports the count, and says when the trip is too far off for it to be used", () => {
    const w = { station: "Muskegon CG Station", hours: 48, north_east_hours: 12, enough: true, used: true };
    expect(windHistoryLine(w, 0)).toBe("Muskegon CG Station: 12 of 48 hours from the north or east.");
    expect(windHistoryLine({ ...w, used: false }, 124)).toBe("Muskegon CG Station: 12 of 48 hours from the north or east. Not used for this trip: it is 124 days away.");
  });
});
