/**
 * Flows through Home, Quick questions, Recommendation and Conditions.
 * The app runs on the autumn fixtures with the clock at 2026-10-14 14:00 UTC,
 * so Muskegon's buoy last reported 20 minutes ago.
 */
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

async function start(page: Page, date: string, port = "Muskegon") {
  await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z")); // the device clock matches the server's
  await page.goto("/");
  await page.getByLabel("Port").selectOption(port);
  await page.getByLabel("Date").fill(date);
  await page.getByRole("button", { name: "Get setup" }).click();
}

/** Answers what the app asks when no forecast covers the trip. */
async function answer(page: Page, opts: { where?: string } = {}) {
  await page.getByText("Daytime", { exact: true }).click();
  await page.getByText("Clear", { exact: true }).click();
  await page.getByText("Bright", { exact: true }).click(); // asked from the start: no forecast covers these dates
  await page.getByText("Breezy or more", { exact: true }).click();
  if (opts.where) await page.getByText(opts.where, { exact: true }).click();
}

test.describe("recommendation flow", () => {
  for (const month of [4, 5, 6, 7, 8, 9, 10]) {
    test(`returns setups for month ${month}`, async ({ page }) => {
      await start(page, `2026-${String(month).padStart(2, "0")}-15`);
      await answer(page, { where: month === 8 ? "Offshore" : undefined });
      const show = page.getByRole("button", { name: "Show setup" });
      // June, September and October have no depth default: the app must ask before it answers.
      if ([6, 9, 10].includes(month)) {
        await expect(page.getByText("There is no depth default for this month")).toBeVisible();
        await expect(show).toBeDisabled();
        await page.getByText("I know the break", { exact: true }).click();
        await page.getByLabel("Break depth, in feet").fill("45");
      }
      await expect(show).toBeEnabled();
      await show.click();
      await expect(page.getByText("Run the whole spread at")).toBeVisible();
      await expect(page.getByText("Speed at the lure").first()).toBeVisible();
      expect(await page.getByRole("listitem").filter({ hasText: /spoon|plug|fly|Meat rig/i }).count()).toBeGreaterThan(0);
      await expect(page.getByText("A starting setup based on conditions, reports and angler experience.")).toBeVisible();
    });
  }

  test("Muskegon uses cached buoy data and shows its age", async ({ page }) => {
    await start(page, "2026-10-14");
    const reading = "Muskegon Buoy, MI, 3.1 miles away, read 60.3 °F at the surface 20 minutes ago.";
    await expect(page.getByText(reading)).toBeVisible();
    await expect(page.getByText("No buoy nearby reports temperature at depth right now, only at the surface.")).toBeVisible();
    await answer(page);
    await page.getByText("I know the break", { exact: true }).click();
    await page.getByLabel("Break depth, in feet").fill("60");
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Low confidence")).toBeVisible();
    // The plan card's chips say what the setup is based on and how old the reading is.
    await expect(page.getByText("Water 60.3 °F · buoy")).toBeVisible();
    await expect(page.getByText("Buoy 20 min old")).toBeVisible();
    await expect(page.getByText("Depth · your break")).toBeVisible();
    await expect(page.getByText("Depth comes from the break depth you gave.").first()).toBeVisible();
    await expect(page.getByText("60 to 80 ft down").first()).toBeVisible();

    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByRole("heading", { name: "Conditions at Muskegon" })).toBeVisible();
    await expect(page.getByText("Muskegon Buoy, MI", { exact: true })).toBeVisible();
    await expect(page.getByText(/Water 60\.3 °F · (Waves [\d.]+ ft · )?Wind [\d.]+ mph from the \w+/)).toBeVisible();
    await expect(page.getByText("Used for water")).toBeVisible();
    await expect(page.getByText(/of \d+ hours from the north or east\./)).toBeVisible();
    await expect(page.getByText("No forecast covers that time.").first()).toBeVisible();
  });

  test("a trip weeks away falls back to month defaults and says so", async ({ page }) => {
    await start(page, "2026-08-15");
    await expect(page.getByText(/Buoy readings describe the water now, not \d+ days away\. Results use month defaults\./)).toBeVisible();
    await answer(page, { where: "Offshore" });
    await page.getByRole("button", { name: "Show setup" }).click();
    // Golden scenario G11, through the whole stack.
    await expect(page.getByText("2.0 to 2.2 mph").first()).toBeVisible();
    await expect(page.getByText("50 to 90 ft down").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Flasher and fly" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meat rig" })).toBeVisible();
    await expect(page.getByText(/Spoons run at 2\.4 to 3\.0 mph.*One spread cannot serve both\./)).toBeVisible();
    await expect(page.getByText(/month defaults/)).toHaveCount(1); // said once, beside the confidence badge
    // The top card's reasons are open from the start; the second card's are closed.
    await expect(page.getByText("Reports", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Lore", { exact: true }).first()).toBeVisible();
  });

  test("a winter date is out of season, with one tap to opening day", async ({ page }) => {
    await start(page, "2026-11-27");
    await expect(page.getByRole("heading", { name: "Out of season" })).toBeVisible();
    await expect(page.getByText("November 27 is outside the season.")).toBeVisible();
    await page.getByRole("button", { name: "Show April 1" }).click();
    await expect(page.getByRole("heading", { name: "Muskegon, April 1" })).toBeVisible();
    await answer(page);
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
  });

  test("a January date offers this year's opening day", async ({ page }) => {
    await start(page, "2026-01-15");
    await expect(page.getByRole("button", { name: "Show April 1" })).toBeVisible();
  });

  test("every screen opens at the top with its heading focused", async ({ page }) => {
    const atTop = async (heading: string) => {
      await expect(page.getByRole("heading", { name: heading })).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    };
    await start(page, "2026-11-27");
    await atTop("Out of season");
    await page.getByRole("button", { name: "Show April 1" }).click();
    await atTop("Muskegon, April 1");
    await answer(page);
    const show = page.getByRole("button", { name: "Show setup" });
    await show.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await show.click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
    await atTop("Muskegon, April 1");
    await page.getByRole("button", { name: "View conditions" }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "View conditions" }).click();
    await atTop("Conditions at Muskegon");
    await page.getByRole("button", { name: "Back" }).click();
    await atTop("Muskegon, April 1");
  });

  for (const date of ["2026-04-01", "2026-07-15"]) {
    test(`${date}: every question is there on the first render and picking a time moves nothing`, async ({ page }) => {
      await start(page, date);
      for (const legend of ["Time on the water", "Water clarity", "Sky", "Wind", "What you know"]) await expect(page.getByRole("group", { name: legend, exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Depth", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Lines" })).toBeVisible();
      // Where things sit on the page, not in the window, so scrolling does not count as moving.
      const place = async (text: string) => {
        const box = (await page.getByText(text, { exact: true }).boundingBox())!;
        const scrollY = await page.evaluate(() => window.scrollY);
        return { x: box.x + box.width / 2, y: box.y + scrollY + box.height / 2 };
      };
      const overcast = await place("Overcast");
      const showSetup = await place("Show setup");
      const settled = page.waitForResponse((r) => r.url().includes("/api/recommend") && (r.request().postData() ?? "").includes("time_of_day"));
      await page.getByText("Daytime", { exact: true }).click();
      await settled;
      await page.getByText("Clear", { exact: true }).click();
      expect(await place("Show setup")).toEqual(showSetup);
      // Tap where Overcast was on the first render.
      await page.getByText("Overcast", { exact: true }).scrollIntoViewIfNeeded();
      await page.mouse.click(overcast.x, overcast.y - (await page.evaluate(() => window.scrollY)));
      await expect(page.getByRole("radio", { name: "Overcast" })).toBeChecked();
    });

    test(`${date}: the summary names no fishing location the angler did not choose`, async ({ page }) => {
      await start(page, date);
      await answer(page);
      await page.getByRole("button", { name: "Show setup" }).click();
      await expect(page.getByText("Run the whole spread at")).toBeVisible();
      await expect(page.getByText(/This setup is for (offshore|staging) fish/)).toHaveCount(0);
    });
  }

  test("an August trip near the river mouth says the setup is for staging fish", async ({ page }) => {
    await start(page, "2026-08-15");
    await answer(page, { where: "Near the river mouth" });
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("This setup is for staging fish.")).toBeVisible();
  });
});

test.describe("recommendation screen", () => {
  async function result(page: Page, date: string, where?: string) {
    await start(page, date);
    await answer(page, { where });
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
  }

  test("April 1 at Muskegon says where depth came from once", async ({ page }) => {
    await result(page, "2026-04-01");
    await expect(page.getByText("Low confidence")).toBeVisible();
    await expect(page.getByText(/month defaults/i)).toHaveCount(1);
    // The one mention sits in the confidence box, next to the badge.
    await expect(page.getByText("Low confidence").locator("xpath=../..").getByText(/month defaults/i)).toHaveCount(1);
  });

  for (const theme of ["dark", "light"]) {
    test(`${theme}: Why this setup has a chevron, and the top card starts open`, async ({ page }) => {
      await result(page, "2026-08-15", "Offshore");
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const why = page.locator("summary", { hasText: "Why this setup" });
      await expect(why).toHaveCount(2);
      for (const s of await why.all()) await expect(s.locator("svg")).toBeVisible();
      const open = () => page.locator("details").evaluateAll((all) => all.map((d) => (d as HTMLDetailsElement).open));
      expect(await open()).toEqual([true, false]);
      await expect(page.getByText("With no temperature data, depth comes from August fishing reports.").first()).toBeVisible();
      await why.nth(1).click();
      expect(await open()).toEqual([true, true]);
      await why.first().click();
      expect(await open()).toEqual([false, true]);
    });
  }

  test("a tag opens and closes its sentence by tap and by keyboard", async ({ page }) => {
    await result(page, "2026-08-15", "Offshore");
    const sentences = { Science: "Based on fisheries research.", Reports: "Based on recent Michigan DNR fishing reports.", Lore: "Captain and angler experience. No research backs it." };
    for (const [tag, sentence] of Object.entries(sentences)) {
      const button = page.getByRole("button", { name: tag, exact: true }).first();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByText(sentence)).toHaveCount(0);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText(sentence)).toHaveCount(1);
      // The sentence is the region the button controls.
      await expect(page.locator(`[id="${await button.getAttribute("aria-controls")}"]`)).toHaveText(sentence);
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByText(sentence)).toHaveCount(0);
      await page.keyboard.press("Space");
      await expect(page.getByText(sentence)).toHaveCount(1);
      await page.keyboard.press("Space");
    }
  });

  test("every screen has one main heading", async ({ page }) => {
    await start(page, "2026-11-27");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Out of season");
    await page.getByRole("button", { name: "Show April 1" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Muskegon, April 1");
    await answer(page);
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Muskegon, April 1");
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Conditions at Muskegon");
    // Zone labels are real headings one level under it.
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Water", "Wind", "Forecast"]);
  });

  test("on a wide screen the button follows the last field; on a phone it sits at the bottom", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z"));
    await page.goto("/");
    await expect(dateFieldOf(page)).toHaveValue("2026-10-14");
    const dateBottom = async () => { const d = (await dateFieldOf(page).boundingBox())!; return d.y + d.height; };
    expect((await page.getByRole("button", { name: "Get setup" }).boundingBox())!.y - (await dateBottom())).toBeLessThan(40);
    await dateFieldOf(page).fill("2026-07-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("button", { name: "Show setup" })).toBeVisible();
    const cards = page.locator("form > section");
    const lastCard = (await cards.last().boundingBox())!;
    expect((await page.getByRole("button", { name: "Show setup" }).boundingBox())!.y - (lastCard.y + lastCard.height)).toBeLessThan(60);
    await page.setViewportSize({ width: 390, height: 1400 });
    await page.getByRole("button", { name: "Back" }).click();
    expect((await page.getByRole("button", { name: "Get setup" }).boundingBox())!.y - (await dateBottom())).toBeGreaterThan(200);
  });
});
const dateFieldOf = (page: Page) => page.getByLabel("Date");

test.describe("conditions screen", () => {
  async function conditions(page: Page, date: string) {
    await start(page, date);
    await answer(page);
    await page.getByText("I know the break", { exact: true }).click();
    await page.getByLabel("Break depth, in feet").fill("60");
    await page.getByRole("button", { name: "Show setup" }).click();
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByRole("heading", { name: "Conditions at Muskegon" })).toBeVisible();
  }
  const miles = async (rows: import("@playwright/test").Locator) =>
    (await rows.allTextContents()).map((t) => Number(/([\d.]+) mi/.exec(t)![1]));

  test("lists the stations in range by what they measure, and the rest behind a closed row", async ({ page }) => {
    await conditions(page, "2026-10-14");
    const zone = (label: string) => page.locator("section", { has: page.getByRole("heading", { name: label, exact: true, level: 2 }) });
    const water = await miles(zone("Water").locator("li")), wind = await miles(zone("Wind").locator("li"));
    expect(water.length).toBeGreaterThan(0);
    expect(wind.length).toBeGreaterThan(0);
    for (const d of [...water, ...wind]) expect(d).toBeLessThanOrEqual(25);
    expect(new Set(water).size).toBe(water.length); // no place is listed twice
    // Water rows report water or waves; wind-only stations sit under Wind.
    for (const row of await zone("Water").locator("li").allTextContents()) expect(row).toMatch(/Water|Waves/);
    for (const row of await zone("Wind").locator("li").allTextContents()) { expect(row).toMatch(/Wind/); expect(row).not.toMatch(/Water|Waves/); }
    // Each row names where its numbers came from; the stations the engine read say so.
    await expect(zone("Water").locator("li").first()).toContainText(/NDBC|GLOS|NWS/);
    await expect(zone("Wind").getByText("Used for wind")).toHaveCount(1);
    const farther = page.locator("details", { hasText: "Farther stations, not used" });
    expect(await farther.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await farther.locator("summary").click();
    const far = await miles(farther.locator("li"));
    expect(far.length).toBeGreaterThan(0);
    for (const d of far) expect(d).toBeGreaterThan(25);
    await expect(farther.getByText("Not used", { exact: true }).first()).toBeVisible();
    await expect(farther.getByText(/Used for/)).toHaveCount(0);
  });

  test("the wind line counts the hours, and says when the trip is too far off to use them", async ({ page }) => {
    await conditions(page, "2026-10-14");
    await expect(page.getByText(/: \d+ of \d+ hours from the north or east\.$/)).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await conditions(page, "2026-07-15");
    await expect(page.getByText(/hours from the north or east\. Not used for this trip: it is \d+ days away\.$/)).toBeVisible();
  });
});

test.describe("zones, chips and indicators", () => {
  async function toResult(page: Page, date: string, where?: string) {
    await start(page, date);
    await answer(page, { where });
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
  }

  test("the top bar shows Offline only while the device is offline", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByRole("banner").getByText("Offline", { exact: true })).toBeVisible();
    await expect(page.getByRole("banner").locator("svg").first()).toBeVisible(); // the word comes with its icon
    await context.setOffline(false);
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);
  });

  test("the top bar spans the window while its contents stay on the content column", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const bar = (await page.getByRole("banner").boundingBox())!;
    expect(bar.width).toBe(1440);
    const name = (await page.getByRole("banner").getByText("Conditions recommender").boundingBox())!;
    const heading = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
    expect(name.x).toBe(heading.x);
  });

  test("question cards say what is left, and the progress bar counts the groups done", async ({ page }) => {
    await start(page, "2026-07-15");
    const card = (title: string) => page.locator("section", { has: page.getByRole("heading", { name: title, exact: true, level: 2 }) });
    await expect(card("Your trip")).toContainText("1 left");
    await expect(card("On the water")).toContainText("3 left");
    await expect(card("Depth")).toContainText("Done");
    await expect(card("Depth").getByText("Optional")).toBeVisible();
    await expect(page.getByText("1 of 3 done")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await page.getByText("Daytime", { exact: true }).click();
    await expect(card("Your trip")).toContainText("Done");
    await expect(page.getByText("2 of 3 done")).toBeVisible();
    // A chosen option carries a check as well as the dot and the fill.
    await expect(page.locator("label", { hasText: "Daytime" }).locator("svg")).toHaveCount(1);
    await expect(page.locator("label", { hasText: "Before sunrise" }).locator("svg")).toHaveCount(0);
    const button = async () => (await page.getByRole("button", { name: "Show setup" }).boundingBox())!.y + (await page.evaluate(() => window.scrollY));
    const before = await button();
    await page.getByText("Clear", { exact: true }).click();
    await page.getByText("Bright", { exact: true }).click();
    await page.getByText("Breezy or more", { exact: true }).click();
    await expect(card("On the water")).toContainText("Done");
    await expect(page.getByRole("button", { name: "Show setup" })).toBeEnabled();
    // Finishing hides the progress bar without moving the button.
    await expect(page.getByText("3 of 3 done")).toBeHidden();
    expect(await button()).toBe(before);
    // A depth choice with no number is one more thing to answer.
    await page.getByText("I know the break", { exact: true }).click();
    await expect(card("Depth")).toContainText("1 left");
  });

  for (const date of ["2026-04-01", "2026-07-15"]) {
    test(`${date}: the result is zoned, and the plan card shows speed and confidence above the fold`, async ({ page }) => {
      await toResult(page, date);
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Your spread · 4 lines", "If nothing bites", "Good to know"]);
      for (const text of ["Run the whole spread at", "Low confidence", "No live water data"]) {
        const box = (await page.getByText(text, { exact: true }).boundingBox())!;
        expect(box.y + box.height, text).toBeLessThan(844);
      }
      // One chip per input the engine used, each with its source.
      const chips = page.getByRole("list", { name: "What the setup is based on" }).getByRole("listitem");
      await expect(chips).toHaveText(["Sky bright · you", "Wind breezy · you", "Clarity clear · you", "Depth · month default"]);
      // Status badges carry an icon as well as the word.
      for (const text of ["Low confidence", "No live water data"]) await expect(page.getByText(text, { exact: true }).locator("svg")).toHaveCount(1);
      // Each card: its line count, and Top pick on the first row only.
      const cards = page.locator("section", { has: page.getByText("Speed at the lure") }).filter({ has: page.locator("details") });
      await expect(cards.first().getByText("Top pick")).toHaveCount(1);
      await expect(cards.first().getByText(/^\d+ lines?$/)).toBeVisible();
    });
  }

  test("glow finishes carry a Glow label, and depth and speed sit side by side", async ({ page }) => {
    await toResult(page, "2026-08-15", "Offshore");
    await expect(page.getByText("Glow", { exact: true }).first()).toBeVisible();
    const depth = (await page.getByText("Depth", { exact: true }).first().boundingBox())!, speed = (await page.getByText("Speed at the lure").first().boundingBox())!;
    expect(depth.y).toBe(speed.y);
    expect(speed.x).toBeGreaterThan(depth.x);
    // Reason text starts at one edge whatever the tags.
    const edges = await page.locator("details[open] li > div > span:last-child").evaluateAll((all) => all.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(edges.length).toBeGreaterThan(2);
    expect(new Set(edges).size).toBe(1);
  });

  test("Writing reasons shows while the agent's words are on their way, then goes", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z"));
    // The test server has no model key, so say an agent is available and hold its answer.
    await page.route("**/api/recommend", async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), agent_available: true, recommendation_id: "00000000-0000-4000-8000-000000000000" } });
    });
    let release = () => {};
    await page.route("**/api/explain", async (route) => { await new Promise<void>((r) => { release = r; }); await route.fulfill({ status: 500, json: {} }); });
    await page.goto("/");
    await page.getByLabel("Date").fill("2026-07-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    await answer(page);
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Writing reasons…")).toBeVisible();
    release();
    // The fallback stays and no error shows.
    await expect(page.getByText("Writing reasons…")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
  });
});

test.describe("forecast panel", () => {
  // One worker runs these in order: the rows seeded below are shared, and removed when the last one ends.
  test.describe.configure({ mode: "serial" });
  // Ludington gets a forecast, a marine forecast and an alert for the fixture day. No other test uses that port.
  const headline = "Small Craft Advisory issued October 14 at 3:30AM EDT until October 14 at 7:00PM EDT by NWS Grand Rapids MI";
  const marineText = "Pentwater to Manistee MI-\n.REST OF TODAY...Southwest winds 10 to 20 knots. Waves 1 to 3 feet.";
  let db: pg.Client;
  test.beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/conditions" });
    await db.connect();
    const port = (await db.query("select id from public.ports where name = 'Ludington'")).rows[0].id;
    const hours = Array.from({ length: 24 }, (_, h) => ({ valid_at: new Date(Date.UTC(2026, 9, 14, 4 + h)).toISOString(), sky: 20 + h, rain: h, air: 10 + h / 4, dir: 225, speed: 4 + h / 10 }));
    await db.query(
      `insert into public.forecasts (port_id, valid_at, fetched_at, sky_cover_pct, precip_pct, air_temp_c, wind_dir_deg, wind_speed_ms)
       select $1, x.valid_at, $3, x.sky, x.rain, x.air, x.dir, x.speed from jsonb_to_recordset($2::jsonb) as x(valid_at timestamptz, sky numeric, rain numeric, air numeric, dir numeric, speed numeric)
       on conflict (port_id, valid_at) do update set fetched_at = excluded.fetched_at, sky_cover_pct = excluded.sky_cover_pct, precip_pct = excluded.precip_pct, air_temp_c = excluded.air_temp_c, wind_dir_deg = excluded.wind_dir_deg, wind_speed_ms = excluded.wind_speed_ms`,
      [port, JSON.stringify(hours), "2026-10-14T10:00:00Z"], // fetched four hours before the test clock: stale
    );
    const alert = { event: "Small Craft Advisory", headline, issued_at: "2026-10-14T03:30:00-04:00", starts_at: "2026-10-14T03:30:00-04:00", ends_at: "2026-10-14T19:00:00-04:00", url: "https://forecast.weather.gov/shmrn.php?mz=lmz849" };
    await db.query(
      `insert into public.marine_forecasts (port_id, zone, forecast_text, issued_at, text_fetched_at, alerts, alerts_fetched_at) values ($1, 'LMZ849', $2, $3, $3, $4, $5)
       on conflict (port_id) do update set forecast_text = excluded.forecast_text, issued_at = excluded.issued_at, alerts = excluded.alerts, alerts_fetched_at = excluded.alerts_fetched_at`,
      [port, marineText, "2026-10-14T13:06:00Z", JSON.stringify([alert]), "2026-10-14T13:55:00Z"],
    );
  });
  test.afterAll(async () => {
    await db.query("delete from public.forecasts where port_id = (select id from public.ports where name = 'Ludington')");
    await db.query("delete from public.marine_forecasts where port_id = (select id from public.ports where name = 'Ludington')");
    await db.end();
  });

  async function toResult(page: Page, date: string) {
    await start(page, date, "Ludington");
    await page.getByText("Daytime", { exact: true }).click();
    // The forecast answers sky and wind, so they are not asked.
    await expect(page.getByRole("group", { name: "Sky", exact: true })).toHaveCount(0);
    await page.getByText("Clear", { exact: true }).click();
    await page.getByText("I know the break", { exact: true }).click();
    await page.getByLabel("Break depth, in feet").fill("60");
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
  }

  test("G30: an active alert shows word for word on the result and on the panel, with its times and link", async ({ page }) => {
    await toResult(page, "2026-10-14");
    const banner = page.getByText(headline, { exact: true });
    await expect(banner).toHaveCount(1);
    expect((await banner.boundingBox())!.y).toBeLessThan((await page.getByRole("heading", { level: 1 }).boundingBox())!.y); // above everything else
    await expect(page.getByText("Sky bright · forecast")).toBeVisible();
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText(headline, { exact: true })).toHaveCount(1);
    await expect(page.getByText(/Issued Oct 14, 3:30 AM\. In effect until Oct 14, 7:00 PM\. National Weather Service\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "Read the full text at weather.gov" })).toHaveAttribute("href", "https://forecast.weather.gov/shmrn.php?mz=lmz849");
    // The alert carries no warning or danger color: it is not the app's place to rate the day.
    const classes = await page.getByText(headline, { exact: true }).locator("xpath=..").getAttribute("class");
    expect(classes).not.toMatch(/warning|danger|success/);
  });

  test("the panel shows the trip day by hour, the marine text as issued, and names its source", async ({ page }) => {
    await toResult(page, "2026-10-14");
    await page.getByRole("button", { name: "View conditions" }).click();
    const forecast = page.locator("section", { has: page.getByRole("heading", { name: "Forecast", exact: true, level: 2 }) });
    await expect(forecast.getByText(/National Weather Service\. Forecast fetched 4 hours ago\. Alerts checked 5 minutes ago\./)).toBeVisible();
    await expect(forecast.getByText(/^Sunrise \d+:\d\d AM\. Sunset \d+:\d\d PM\.$/)).toBeVisible();
    const rows = forecast.locator("tbody tr");
    await expect(rows).toHaveCount(24);
    await expect(rows.first()).toHaveText(/12 AM.*9 mph SW.*20% cloud.*0%.*50 °F/);
    await expect(forecast.getByText("Southwest winds 10 to 20 knots. Waves 1 to 3 feet.", { exact: false })).toBeVisible();
    await expect(forecast.getByText(/Nearshore marine forecast, issued Oct 14, 9:06 AM/)).toBeVisible();
  });

  test("G31: a forecast fetched four hours ago is marked stale with a link, and the result still renders", async ({ page }) => {
    await toResult(page, "2026-10-14");
    await page.getByRole("button", { name: "View conditions" }).click();
    const forecast = page.locator("section", { has: page.getByRole("heading", { name: "Forecast", exact: true, level: 2 }) });
    await expect(forecast.getByText("Stale", { exact: true })).toBeVisible();
    await expect(forecast.getByRole("link", { name: "See the current forecast at weather.gov" })).toHaveAttribute("href", "https://forecast.weather.gov/shmrn.php?mz=lmz849");
  });

  test("G38: today's alert does not show on another day", async ({ page }) => {
    await start(page, "2026-10-15", "Ludington");
    for (const t of ["Daytime", "Clear", "I know the break"]) await page.getByText(t, { exact: true }).click();
    await page.getByLabel("Break depth, in feet").fill("60");
    // Tomorrow's own hours are not in the cache, so sky and wind are asked.
    await page.getByText("Bright", { exact: true }).click();
    await page.getByText("Breezy or more", { exact: true }).click();
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("Run the whole spread at")).toBeVisible();
    await expect(page.getByText(headline, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText(headline, { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Nearshore marine forecast/)).toBeVisible(); // the text covers the coming days
  });

  test("G32: a port with no buoy waves and no forecast shows no wave value", async ({ page }) => {
    await start(page, "2026-07-15");
    await answer(page);
    await page.getByRole("button", { name: "Show setup" }).click();
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText("No forecast covers that time.").first()).toBeVisible();
    await expect(page.getByText(/Waves, observed/)).toHaveCount(0);
  });
});

test.describe("home", () => {
  const dateField = (page: Page) => page.getByLabel("Date");
  const portOrder = (page: Page) => page.getByLabel("Port").locator("option").allTextContents();

  test("out of season, the date defaults to opening day and says so", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-28T15:00:00"));
    await page.goto("/");
    await expect(dateField(page)).toHaveValue("2027-04-01");
    await expect(page.getByText("Out of season now. Showing opening day.")).toBeVisible();
    // A date typed by hand still gets the out-of-season screen.
    await dateField(page).fill("2026-12-05");
    await expect(page.getByText("Out of season now. Showing opening day.")).toHaveCount(0);
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("heading", { name: "Out of season" })).toBeVisible();
  });

  test("in season, the date defaults to today with no note", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-07-10T15:00:00"));
    await page.goto("/");
    await expect(dateField(page)).toHaveValue("2026-07-10");
    await expect(page.getByText("Out of season now. Showing opening day.")).toHaveCount(0);
  });

  test("a six-digit year shows the error at the Date field and sends nothing", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z"));
    await page.goto("/");
    let requests = 0;
    page.on("request", (r) => { if (r.url().includes("/api/recommend")) requests++; });
    await dateField(page).focus();
    await page.keyboard.type("0715152027"); // month, day, then the six-digit year from the review
    await expect(dateField(page)).toHaveValue("152027-07-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    const message = page.getByText("Enter a date like 07/15/2027.");
    await expect(message).toBeVisible();
    await expect(dateField(page)).toHaveAttribute("aria-invalid", "true");
    expect(await dateField(page).getAttribute("aria-describedby")).toBe(await message.locator("xpath=..").getAttribute("id"));
    expect(requests).toBe(0);
    await dateField(page).fill("2031-07-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByText("Pick a date between 2025 and 2028.")).toBeVisible();
    expect(requests).toBe(0);
  });

  test("a network failure still shows the general error box", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z"));
    await page.goto("/");
    await page.route("**/api/recommend", (route) => route.abort());
    await dateField(page).fill("2026-07-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Couldn't build a setup. Check your connection and try again." })).toBeVisible();
  });

  test("the server names the date field when the date is bad", async ({ request }) => {
    const res = await request.post("/api/recommend", { data: { port: "Muskegon", date: "152027-07-15" } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter a date like 07/15/2027.", field: "date" });
  });

  test("Use my location lists the nearest port first and selects it", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 43.063, longitude: -86.228 }); // Grand Haven
    await page.goto("/");
    await expect(page.getByLabel("Port")).toHaveValue("Muskegon"); // nothing is asked on load
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByLabel("Port")).toHaveValue("Grand Haven");
    expect((await portOrder(page))[0]).toBe("Grand Haven, MI");
    // Kept for the session: the order survives a reload.
    await page.reload();
    await expect(page.getByLabel("Port")).toHaveValue("Grand Haven");
  });

  test("with location refused the list is unchanged and the app says so", async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto("/");
    const before = await portOrder(page);
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByText("Location is off. Pick a port from the list.")).toBeVisible();
    expect(await portOrder(page)).toEqual(before);
    await expect(page.getByLabel("Port")).toHaveValue("Muskegon");
  });
});
