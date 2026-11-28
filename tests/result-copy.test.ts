import { describe, expect, it } from "vitest";
import { caveatsToShow, depthSourceLine, TAG_EXPLAINER } from "../src/lib/reasons";

describe("the depth source is said once, in the confidence box", () => {
  it("adds the depth source line only when the confidence reason does not name the source", () => {
    expect(depthSourceLine("Buoy readings describe the water now, not 124 days away. Results use month defaults.", "month defaults")).toBeNull();
    expect(depthSourceLine("No live water data, so depth comes from Month Defaults.", "month defaults")).toBeNull();
    expect(depthSourceLine("There is no live water data for this trip.", "month defaults")).toBe("Depth comes from month defaults.");
    expect(depthSourceLine("Depth comes from the break depth you gave. No buoy nearby reports temperature at depth.", "the break depth you gave")).toBeNull();
    expect(depthSourceLine("A buoy gives the surface temperature only.", "the Muskegon Buoy, MI temperature profile")).toBe("Depth comes from the Muskegon Buoy, MI temperature profile.");
  });

  it("drops caveats that restate where depth came from and keeps the rest", () => {
    const speed = "Speeds are speed at the lure, which can differ from the speed your GPS shows.";
    const kept = ["Spoons are left out of this spread because they run faster than the boat can hold.", "If you can find the break on your own gear, give that depth for a better starting range.", speed];
    const dropped = [
      "No water data is in use, so depth is a starting range from July reports. Check it against your sounder.",
      "Depth is an estimate from July reports; no live water data is available, so set your own depth finder to the break.",
      "Depth comes from month defaults, not a measurement.",
      "These results use month defaults.",
      "No buoy reading covers this trip.",
    ];
    expect(caveatsToShow([...kept, ...dropped], "month defaults")).toEqual(kept);
  });
});

describe("tag sentences", () => {
  it("are the four fixed sentences, written by the app and not the agent", () => {
    expect(TAG_EXPLAINER).toEqual({
      science: "Based on fisheries research.",
      reports: "Based on recent Michigan DNR fishing reports.",
      lore: "Captain and angler experience. No research backs it.",
      your_log: "Based on your own logged trips.",
    });
  });
});
