/**
 * Flows through Home, Conditions in use and Conditions.
 * The app runs on the autumn fixtures with the clock at 2026-10-14 14:00 UTC (10 a.m. at the ports),
 * so Muskegon's buoy last reported 20 minutes ago. The device clock is pinned to the same moment.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import pg from "pg";

const NOW = "2026-10-14T14:00:00Z";
const TODAY = "2026-10-14";

/** Opens a port. A first visit has no port, so it is picked once; after that Home loads on its own. */
async function open(page: Page, port = "Muskegon") {
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto("/");
  await page.getByLabel("Port").selectOption(port);
  await page.getByRole("button", { name: "Get setup" }).click();
  await expect(page.getByText(/Today, now\./)).toBeVisible();
}

/** Picks a day: from the strip when it is there, from the calendar otherwise. */
async function pickDate(page: Page, date: string) {
  if (date === TODAY) return;
  await page.getByRole("button", { name: "Other date" }).click();
  await page.getByLabel("Date").fill(date);
  await expect(page.getByRole("group", { name: "Time on the water" }).or(page.getByRole("heading", { name: "Out of season" }))).toBeVisible();
}

async function start(page: Page, date: string, port = "Muskegon") {
  await open(page, port);
  await pickDate(page, date);
}

const group = (page: Page, name: string) => page.getByRole("group", { name, exact: true });
const choose = (page: Page, name: string, option: string) => group(page, name).getByText(option, { exact: true }).click();

/** Answers what the app asks on a day with no forecast: a daytime window, then clarity, sky and wind. */
async function answer(page: Page, opts: { where?: string; break?: string } = {}) {
  if (await group(page, "Time on the water").count()) await choose(page, "Time on the water", "Midday");
  await choose(page, "Water clarity", "Clear");
  await choose(page, "Sky", "Bright");
  if (await group(page, "Wind").count()) await choose(page, "Wind", "Breezy or more"); // today the buoy answers it
  if (opts.where) await choose(page, "Where are you fishing", opts.where);
  if (opts.break) {
    await choose(page, "What you know", "I know the break");
    await page.getByLabel("Break depth, in feet").fill(opts.break);
  }
}
const shown = (page: Page) => expect(page.getByText("Run the whole spread at")).toBeVisible();
const zone = (page: Page, label: string) => page.locator("section", { has: page.getByRole("heading", { name: label, exact: true, level: 2 }) });
const miles = async (rows: Locator) => (await rows.allTextContents()).map((t) => Number(/([\d.]+) mi/.exec(t)![1]));

test.describe("recommendation flow", () => {
  for (const month of [4, 5, 6, 7, 8, 9, 10]) {
    test(`returns setups for month ${month}`, async ({ page }) => {
      await start(page, `2027-${String(month).padStart(2, "0")}-15`);
      await answer(page, { where: month === 8 ? "Offshore" : undefined });
      // June, September and October have no depth default: the app must ask before it answers.
      if ([6, 9, 10].includes(month)) {
        await expect(page.getByText("There is no depth default for this month")).toBeVisible();
        await expect(page.getByText("Run the whole spread at")).toHaveCount(0);
        await choose(page, "What you know", "I know the break");
        await page.getByLabel("Break depth, in feet").fill("45");
      }
      await shown(page);
      await expect(page.getByText("Speed at the lure").first()).toBeVisible();
      expect(await page.getByRole("listitem").filter({ hasText: /spoon|plug|fly|Meat rig/i }).count()).toBeGreaterThan(0);
      await expect(page.getByText("A starting setup based on conditions, reports and angler experience.")).toBeVisible();
    });
  }

  test("G34: with a port remembered, today's recommendation loads with no tap", async ({ page }) => {
    await open(page);
    await answer(page, { break: "60" });
    await shown(page);
    // A second visit: no port to pick, no button to press, and the water clarity is not asked again.
    await page.reload();
    await expect(page.getByRole("button", { name: "Get setup" })).toHaveCount(0);
    await expect(page.getByLabel("Port")).toHaveValue("Muskegon");
    await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText(/^Today, now\. Data updated \d+:\d\d AM\.$/)).toBeVisible();
    await expect(group(page, "Water clarity")).toHaveCount(0);
    await expect(group(page, "Time on the water")).toHaveCount(0); // today is now
  });

  test("Muskegon today uses cached buoy data and shows its age", async ({ page }) => {
    await open(page);
    await expect(group(page, "Wind")).toHaveCount(0); // the buoy answers it
    await answer(page, { break: "60" });
    await shown(page);
    await expect(page.getByText("Low confidence")).toBeVisible();
    // The plan card's chips say what the setup is based on and how old the reading is.
    await expect(page.getByText("Water 60.3 °F · buoy")).toBeVisible();
    await expect(page.getByText("Buoy 20 min old")).toBeVisible();
    await expect(page.getByText(/^Wind (calm|breezy) · buoy$/)).toBeVisible();
    await expect(page.getByText("Depth · your break")).toBeVisible();
    await expect(page.getByText("Depth comes from the break depth you gave.").first()).toBeVisible();
    await expect(page.getByText("60 to 80").first()).toBeVisible();

    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByRole("heading", { name: "Conditions at Muskegon" })).toBeVisible();
    await expect(page.getByText("Muskegon Buoy, MI", { exact: true })).toBeVisible();
    await expect(page.getByText(/Water 60\.3 °F · (Waves [\d.]+ ft · )?Wind [\d.]+ mph from the \w+/)).toBeVisible();
    await expect(page.getByText("Used for water")).toBeVisible();
    await expect(page.getByText(/of \d+ hours from the north or east\.$/)).toBeVisible();
    await expect(page.getByText("No forecast covers that time.").first()).toBeVisible();
  });

  test("a trip weeks away falls back to month defaults and says so", async ({ page }) => {
    await start(page, "2027-08-15");
    await expect(page.getByText("Forecasts do not reach this date.")).toBeVisible();
    await answer(page, { where: "Offshore" });
    await shown(page);
    await expect(page.getByText(/^Forecasts do not reach \d+ days ahead\. Results use month defaults\.$/)).toBeVisible();
    // Golden scenario G11, through the whole stack.
    await expect(page.getByText("2.0 to 2.2 mph").first()).toBeVisible();
    await expect(page.getByText("50 to 90 ft down").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Flasher and fly" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meat rig" })).toBeVisible();
    await expect(page.getByText(/Spoons run at 2\.4 to 3\.0 mph.*One spread cannot serve both\./)).toBeVisible();
    await expect(page.getByText(/month defaults/)).toHaveCount(1); // said once, beside the confidence badge
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
    await shown(page);
  });

  test("out of season today, the angler sees it on open with no tap", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-28T15:00:00Z"));
    await page.goto("/");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("heading", { name: "Out of season" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show April 1" })).toBeVisible();
  });
});

test.describe("day selection", () => {
  test("the day strip lists today, tomorrow and the next five days, and Today returns in one tap", async ({ page }) => {
    await open(page);
    const strip = page.getByRole("group", { name: "Day" }).getByRole("button");
    await expect(strip).toHaveText(["Today", "Tomorrow", "Fri 16", "Sat 17", "Sun 18", "Mon 19", "Tue 20", "Other date"]);
    await page.getByRole("button", { name: "Fri 16" }).click();
    await expect(page.getByRole("heading", { name: "Muskegon, October 16" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Fri 16" })).toHaveAttribute("aria-pressed", "true");
    // Another day takes a time window, and starts at first light.
    await expect(group(page, "Time on the water").getByRole("radio", { name: "First light" })).toBeChecked();
    await expect(page.getByText("A forecast day.")).toBeVisible();
    // G37: back to today in one tap, live data again.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByText(/^Today, now\. Data updated/)).toBeVisible();
    await expect(group(page, "Time on the water")).toHaveCount(0);
    await expect(group(page, "Wind")).toHaveCount(0);
  });

  test("G35: three days ahead is a forecast day at first light, with confidence no higher than medium", async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: "Sat 17" }).click();
    // First light: the light is low, so sky is not asked. Tomorrow's water is not today's, so buoys are not used.
    await expect(group(page, "Sky")).toHaveCount(0);
    await choose(page, "Water clarity", "Clear");
    await choose(page, "Wind", "Breezy or more");
    await choose(page, "What you know", "I know the break");
    await page.getByLabel("Break depth, in feet").fill("60");
    await shown(page);
    await expect(page.getByText("High confidence")).toHaveCount(0);
    await expect(page.getByText("No live water data")).toBeVisible();
    await expect(page.getByText(/^Sky low light · time of day$/)).toBeVisible();
    await expect(page.getByText(/Buoy readings apply to today only\./)).toBeVisible();
  });

  test("G36: eight days ahead uses month defaults, says the forecasts do not reach, and is low confidence", async ({ page }) => {
    await start(page, "2026-10-22");
    await expect(page.getByText("Forecasts do not reach this date.")).toBeVisible();
    await answer(page, { break: "60" });
    await shown(page);
    await expect(page.getByText("Low confidence")).toBeVisible();
    await expect(page.getByText(/Forecasts do not reach 8 days ahead\./)).toBeVisible();
  });

  test("a past date is labeled as past, not as advice", async ({ page }) => {
    await start(page, "2026-10-10");
    await expect(page.getByText("Past date", { exact: true })).toBeVisible();
    await expect(page.getByText("Shown for review, not as advice.")).toBeVisible();
    await answer(page, { break: "60" });
    await shown(page);
    await expect(page.getByText(/This date has passed\. It is shown for review, not as advice\./)).toBeVisible();
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText(/Not used: this date has passed\.$/)).toBeVisible();
  });

  test("a bad date shows its error at the field and changes nothing", async ({ page }) => {
    await open(page);
    let requests = 0;
    page.on("request", (r) => { if (r.url().includes("/api/recommend")) requests++; });
    await page.getByRole("button", { name: "Other date" }).click();
    await page.getByLabel("Date").focus();
    await page.keyboard.type("0715152027"); // month, day, then a six-digit year
    await page.getByLabel("Date").blur();
    const message = page.getByText("Enter a date like 07/15/2027.");
    await expect(message).toBeVisible();
    await expect(page.getByLabel("Date")).toHaveAttribute("aria-invalid", "true");
    expect(await page.getByLabel("Date").getAttribute("aria-describedby")).toBe(await message.locator("xpath=..").getAttribute("id"));
    await page.getByLabel("Date").fill("2031-07-15");
    await page.getByLabel("Date").blur();
    await expect(page.getByText("Pick a date between 2025 and 2028.")).toBeVisible();
    expect(requests).toBe(0);
    await expect(page.getByRole("button", { name: "Today", exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("the server names the date field when the date is bad", async ({ request }) => {
    const res = await request.post("/api/recommend", { data: { port: "Muskegon", date: "152027-07-15" } });
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: "Enter a date like 07/15/2027.", field: "date" });
  });

  test("a network failure shows the general error box", async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await page.route("**/api/recommend", (route) => route.abort());
    await page.goto("/");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("main").getByRole("alert").filter({ hasText: "Couldn't build a setup. Check your connection and try again." })).toBeVisible();
  });
});

test.describe("screens", () => {
  test("each screen opens at the top with its heading focused, and has one main heading", async ({ page }) => {
    const atTop = async (heading: string) => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    };
    await open(page);
    await answer(page, { break: "60" });
    await shown(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Muskegon, October 14");
    await page.getByRole("button", { name: "View conditions" }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "View conditions" }).click();
    await atTop("Conditions at Muskegon");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Water", "Wind", "Forecast"]);
    await page.getByRole("button", { name: "Back" }).click();
    await atTop("Muskegon, October 14");
    await page.getByRole("button", { name: "Change conditions" }).click();
    await atTop("Conditions in use");
    await page.getByRole("button", { name: "Done" }).click();
    await atTop("Muskegon, October 14");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["A few questions", "Your spread · 4 lines", "If nothing bites", "Good to know"]);
  });

  test("answering one question moves none of the others", async ({ page }) => {
    await start(page, "2027-07-15");
    await choose(page, "Time on the water", "Midday"); // in daylight, clarity, sky and wind all matter
    for (const legend of ["Time on the water", "Water clarity", "Sky", "Wind"]) await expect(group(page, legend)).toBeVisible();
    await expect(page.getByText("3 left")).toBeVisible();
    // Where things sit on the page, not in the window, so scrolling does not count as moving.
    const place = async (text: string) => {
      const box = (await page.getByText(text, { exact: true }).boundingBox())!;
      return { x: box.x + box.width / 2, y: box.y + (await page.evaluate(() => window.scrollY)) + box.height / 2 };
    };
    const overcast = await place("Overcast"), calm = await place("Calm");
    const settled = page.waitForResponse((r) => r.url().includes("/api/recommend") && (r.request().postData() ?? "").includes("clear"));
    await choose(page, "Water clarity", "Clear");
    await settled;
    await expect(page.getByText("2 left")).toBeVisible();
    expect(await place("Calm")).toEqual(calm);
    // Tap where Overcast was before the first answer.
    await page.getByText("Overcast", { exact: true }).scrollIntoViewIfNeeded();
    await page.mouse.click(overcast.x, overcast.y - (await page.evaluate(() => window.scrollY)));
    await expect(page.getByRole("radio", { name: "Overcast" })).toBeChecked();
    // A chosen option carries a check in its dot.
    await expect(page.locator("label", { hasText: "Overcast" }).locator("svg")).toHaveCount(1);
    await expect(page.locator("label", { hasText: "Bright" }).locator("svg")).toHaveCount(0);
    await choose(page, "Wind", "Calm");
    await shown(page);
    await expect(page.locator("section", { has: page.getByRole("heading", { name: "A few questions" }) }).getByText("Done")).toBeVisible();
  });

  for (const date of ["2027-04-01", "2027-07-15"]) {
    test(`${date}: the summary names no fishing location the angler did not choose, and depth's source is said once`, async ({ page }) => {
      await start(page, date);
      await answer(page);
      await shown(page);
      await expect(page.getByText(/This setup is for (offshore|staging) fish/)).toHaveCount(0);
      await expect(page.getByText("Low confidence")).toBeVisible();
      await expect(page.getByText(/month defaults/i)).toHaveCount(1);
      // The result is zoned, each input has a chip with its source, and status badges carry an icon.
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(["A few questions", "Your spread · 4 lines", "If nothing bites", "Good to know"]);
      await expect(page.getByRole("list", { name: "What the setup is based on" }).getByRole("listitem")).toHaveText(["Sky bright · you", "Wind breezy · you", "Clarity clear · you", "Depth · month default"]);
      for (const text of ["Low confidence", "No live water data"]) await expect(page.getByText(text, { exact: true }).locator("svg")).toHaveCount(1);
      const cards = page.locator("section", { has: page.getByText("Speed at the lure") }).filter({ has: page.locator("details") });
      await expect(cards.first().getByText("Top pick")).toHaveCount(1);
      await expect(cards.first().getByText(/^\d+ lines?$/)).toBeVisible();
    });
  }

  test("an August trip near the river mouth says the setup is for staging fish", async ({ page }) => {
    await start(page, "2027-08-15");
    await answer(page, { where: "Near the river mouth" });
    await shown(page);
    await expect(page.getByText("This setup is for staging fish.")).toBeVisible();
  });

  for (const theme of ["dark", "light"]) {
    test(`${theme}: Why this setup has a chevron, and the top card starts open`, async ({ page }) => {
      await start(page, "2027-08-15");
      await answer(page, { where: "Offshore" });
      await shown(page);
      await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      const why = page.locator("summary", { hasText: "Why this setup" });
      await expect(why).toHaveCount(2);
      for (const s of await why.all()) await expect(s.locator("svg")).toBeVisible();
      const openOnes = () => page.locator("details").evaluateAll((all) => all.map((d) => (d as HTMLDetailsElement).open));
      expect(await openOnes()).toEqual([true, false]);
      await why.nth(1).click();
      expect(await openOnes()).toEqual([true, true]);
      await why.first().click();
      expect(await openOnes()).toEqual([false, true]);
    });
  }

  test("a tag opens and closes its sentence by tap and by keyboard", async ({ page }) => {
    await start(page, "2027-08-15");
    await answer(page, { where: "Offshore" });
    await shown(page);
    const sentences = { Science: "Based on fisheries research.", Reports: "Based on recent Michigan DNR fishing reports.", Lore: "Captain and angler experience. No research backs it." };
    for (const [tag, sentence] of Object.entries(sentences)) {
      const button = page.getByRole("button", { name: tag, exact: true }).first();
      await expect(button).toHaveAttribute("aria-expanded", "false");
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator(`[id="${await button.getAttribute("aria-controls")}"]`)).toHaveText(sentence);
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByText(sentence)).toHaveCount(0);
      await page.keyboard.press("Space");
      await expect(page.getByText(sentence)).toHaveCount(1);
      await page.keyboard.press("Space");
    }
    // Glow finishes carry a label, depth and speed sit side by side, and reason text starts at one edge.
    await expect(page.getByText("Glow", { exact: true }).first()).toBeVisible();
    const depth = (await page.getByText("Depth", { exact: true }).first().boundingBox())!, speed = (await page.getByText("Speed at the lure").first().boundingBox())!;
    expect(depth.y).toBe(speed.y);
    const edges = await page.locator("details[open] li > div > span:last-child").evaluateAll((all) => all.map((e) => Math.round(e.getBoundingClientRect().x)));
    expect(edges.length).toBeGreaterThan(2);
    expect(new Set(edges).size).toBe(1);
  });

  test("Writing reasons shows while the agent's words are on their way, then goes", async ({ page }) => {
    // The test server has no model key, so say an agent is available and hold its answer.
    await page.route("**/api/recommend", async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      await route.fulfill({ response: res, json: body.status === "ok" ? { ...body, agent_available: true, recommendation_id: "00000000-0000-4000-8000-000000000000" } : body });
    });
    let release = () => {};
    await page.route("**/api/explain", async (route) => { await new Promise<void>((r) => { release = r; }); await route.fulfill({ status: 500, json: {} }); });
    await start(page, "2027-07-15");
    await answer(page);
    await shown(page);
    await expect(page.getByText("Writing reasons…")).toBeVisible();
    release();
    // The fallback stays and no error shows.
    await expect(page.getByText("Writing reasons…")).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await shown(page);
  });

  test("the top bar spans the window, and shows Offline only while the device is offline", async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto("/");
    expect((await page.getByRole("banner").boundingBox())!.width).toBe(1440);
    const name = (await page.getByRole("banner").getByText("Conditions recommender").boundingBox())!;
    expect(name.x).toBe((await page.getByRole("heading", { level: 1 }).boundingBox())!.x);
    // On a wide screen the one button follows the card instead of sitting at the bottom of the window.
    const card = (await page.locator("form > section").boundingBox())!;
    expect((await page.getByRole("button", { name: "Get setup" }).boundingBox())!.y - (card.y + card.height)).toBeLessThan(40);
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);
    await context.setOffline(true);
    await expect(page.getByRole("banner").getByText("Offline", { exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByText("Offline", { exact: true })).toHaveCount(0);
  });
});

test.describe("conditions screen", () => {
  test("lists the stations in range by what they measure, and the rest behind a closed row", async ({ page }) => {
    await open(page);
    await answer(page, { break: "60" });
    await shown(page);
    await page.getByRole("button", { name: "View conditions" }).click();
    const water = await miles(zone(page, "Water").locator("li")), wind = await miles(zone(page, "Wind").locator("li"));
    expect(water.length).toBeGreaterThan(0);
    expect(wind.length).toBeGreaterThan(0);
    for (const d of [...water, ...wind]) expect(d).toBeLessThanOrEqual(25);
    expect(new Set(water).size).toBe(water.length); // no place is listed twice
    for (const row of await zone(page, "Water").locator("li").allTextContents()) expect(row).toMatch(/Water|Waves/);
    for (const row of await zone(page, "Wind").locator("li").allTextContents()) { expect(row).toMatch(/Wind/); expect(row).not.toMatch(/Water|Waves/); }
    await expect(zone(page, "Water").locator("li").first()).toContainText(/NDBC|GLOS|NWS/);
    await expect(zone(page, "Wind").getByText("Used for wind")).toHaveCount(1);
    const farther = page.locator("details", { hasText: "Farther stations, not used" });
    expect(await farther.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await farther.locator("summary").click();
    const far = await miles(farther.locator("li"));
    expect(far.length).toBeGreaterThan(0);
    for (const d of far) expect(d).toBeGreaterThan(25);
    await expect(farther.getByText("Not used", { exact: true }).first()).toBeVisible();
    await expect(farther.getByText(/Used for/)).toHaveCount(0);
  });

  test("the wind line says when the trip is too far off to use it, and no wave value shows without a source", async ({ page }) => {
    await start(page, "2027-07-15");
    await answer(page);
    await shown(page);
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText(/hours from the north or east\. Not used for this trip: it is \d+ days away\.$/)).toBeVisible();
    await expect(page.getByText("No forecast covers that time.").first()).toBeVisible();
    await expect(page.getByText(/Waves, observed/)).toHaveCount(0); // G32
  });
});

test.describe("prefilled conditions and the forecast panel", () => {
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

  /** Today at Ludington: the forecast gives the sky and a shore station the wind, so only clarity and depth are asked. */
  async function toResult(page: Page) {
    await open(page, "Ludington");
    await expect(group(page, "Sky")).toHaveCount(0);
    await expect(group(page, "Wind")).toHaveCount(0);
    await choose(page, "Water clarity", "Clear");
    await choose(page, "What you know", "I know the break");
    await page.getByLabel("Break depth, in feet").fill("60");
    await shown(page);
  }
  const row = (page: Page, name: string) => page.getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });

  test("G41, G44: sky and wind are prefilled with their sources, and only what no source supplies is asked", async ({ page }) => {
    await toResult(page); // it checks that sky and wind are not asked: only clarity and a depth October has no default for
    await expect(page.getByText("Sky bright · forecast")).toBeVisible();
    await expect(page.getByText(/^Wind (calm|breezy) · buoy$/)).toBeVisible();
    await page.getByRole("button", { name: "Change conditions" }).click();
    await expect(row(page, "Sky")).toContainText("Bright");
    await expect(row(page, "Sky")).toContainText("Forecast");
    await expect(row(page, "Wind")).toContainText("Measured");
    await expect(row(page, "Lines")).toContainText("Default");
    await expect(row(page, "Water clarity")).toContainText("Your answer");
    await expect(page.getByText("Time on the water")).toHaveCount(0); // today is now
  });

  test("G42, G43: a change wins and is marked as the angler's; Reset returns every value to the data", async ({ page }) => {
    await toResult(page);
    await page.getByRole("button", { name: "Change conditions" }).click();
    await page.getByRole("button", { name: "Change sky" }).click();
    await choose(page, "Sky", "Overcast");
    await expect(row(page, "Sky")).toContainText("Your answer");
    await expect(row(page, "Sky")).toContainText("The data said bright (Forecast).");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Sky overcast · you")).toBeVisible(); // the engine ran again with the answer
    await page.getByRole("button", { name: "Change conditions" }).click();
    await page.getByRole("button", { name: "Reset to the data" }).click();
    await expect(row(page, "Sky")).toContainText("Bright");
    await expect(row(page, "Sky")).toContainText("Forecast");
    await expect(row(page, "Sky")).not.toContainText("The data said");
    await expect(row(page, "Water clarity")).toContainText("Needs your answer");
  });

  test("G45: yesterday's clarity and line count come back labeled as the angler's last answer", async ({ page }) => {
    await toResult(page);
    await page.getByRole("button", { name: "Change conditions" }).click();
    await page.getByRole("button", { name: "Change water clarity" }).click();
    await choose(page, "Water clarity", "Stained");
    await page.getByRole("button", { name: "Change lines" }).click();
    await page.getByRole("button", { name: "More lines" }).click();
    await page.getByRole("button", { name: "More lines" }).click();
    await expect(row(page, "Lines")).toContainText("Your answer");
    await page.reload();
    await expect(page.getByText(/Today, now\./)).toBeVisible();
    await expect(group(page, "Water clarity")).toHaveCount(0); // not asked again
    await choose(page, "What you know", "I know the break");
    await page.getByLabel("Break depth, in feet").fill("60");
    await shown(page);
    await expect(page.getByText("Your spread · 6 lines")).toBeVisible();
    await page.getByRole("button", { name: "Change conditions" }).click();
    await expect(row(page, "Water clarity")).toContainText("Stained");
    await expect(row(page, "Water clarity")).toContainText("Your last answer");
    await expect(row(page, "Lines")).toContainText("Your last answer");
  });

  test("G30: an active alert shows word for word on the result and on the panel, with its times and link", async ({ page }) => {
    await toResult(page);
    const banner = page.getByText(headline, { exact: true });
    await expect(banner).toHaveCount(1);
    expect((await banner.boundingBox())!.y).toBeLessThan((await page.getByRole("heading", { level: 1 }).boundingBox())!.y);
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText(headline, { exact: true })).toHaveCount(1);
    await expect(page.getByText(/Issued Oct 14, 3:30 AM\. In effect until Oct 14, 7:00 PM\. National Weather Service\./)).toBeVisible();
    await expect(page.getByRole("link", { name: "Read the full text at weather.gov" })).toHaveAttribute("href", "https://forecast.weather.gov/shmrn.php?mz=lmz849");
    // The alert carries no warning or danger color: it is not the app's place to rate the day.
    expect(await page.getByText(headline, { exact: true }).locator("xpath=..").getAttribute("class")).not.toMatch(/warning|danger|success/);
  });

  test("G31: the panel shows the day by hour and the marine text, and marks a four-hour-old forecast stale", async ({ page }) => {
    await toResult(page);
    await page.getByRole("button", { name: "View conditions" }).click();
    const forecast = zone(page, "Forecast");
    await expect(forecast.getByText(/National Weather Service\. Forecast fetched 4 hours ago\. Alerts checked 5 minutes ago\./)).toBeVisible();
    await expect(forecast.getByText(/^Sunrise \d+:\d\d AM\. Sunset \d+:\d\d PM\.$/)).toBeVisible();
    await expect(forecast.locator("tbody tr")).toHaveCount(24);
    await expect(forecast.locator("tbody tr").first()).toHaveText(/12 AM.*9 mph SW.*20% cloud.*0%.*50 °F/);
    await expect(forecast.getByText(/Nearshore marine forecast, issued Oct 14, 9:06 AM/)).toBeVisible();
    await expect(forecast.getByText(".REST OF TODAY...Southwest winds 10 to 20 knots. Waves 1 to 3 feet.")).toBeVisible();
    await expect(forecast.getByText("Stale", { exact: true })).toBeVisible();
    await expect(forecast.getByRole("link", { name: "See the current forecast at weather.gov" })).toHaveAttribute("href", "https://forecast.weather.gov/shmrn.php?mz=lmz849");
  });

  test("G38: today's alert does not show on another day", async ({ page }) => {
    await open(page, "Ludington");
    await expect(page.getByText(headline, { exact: true })).toHaveCount(0); // nothing to show until there is a result
    await page.getByRole("button", { name: "Tomorrow" }).click();
    await choose(page, "Water clarity", "Clear");
    await choose(page, "Wind", "Breezy or more"); // tomorrow's hours are not in the cache
    await choose(page, "What you know", "I know the break");
    await page.getByLabel("Break depth, in feet").fill("60");
    await shown(page);
    await expect(page.getByText(headline, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByText(headline, { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Nearshore marine forecast/)).toBeVisible(); // the text covers the coming days
  });
});

test.describe("lake model", () => {
  test.describe.configure({ mode: "serial" });
  // Pentwater gets modeled profiles for the fixture hour: warm to 40 ft, cold below. No other test uses that port.
  let db: pg.Client;
  test.beforeAll(async () => {
    db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/conditions" });
    await db.connect();
    const port = (await db.query("select id from public.ports where name = 'Pentwater'")).rows[0].id;
    const bottoms = { near: 18.29, mid: 60.96, off: 76.2 };
    for (const [i, label] of (["near", "mid", "off"] as const).entries()) {
      const bottom = bottoms[label], breakM = Math.min(12.19, bottom * 0.8);
      const profile = Array.from({ length: 20 }, (_, k) => { const depth = Math.round(((k + 0.5) / 20) * bottom * 100) / 100; return { depth_m: depth, temp_c: depth < breakM ? 19.56 : 6 }; });
      const cold = profile.findIndex((p) => p.temp_c === 6), mid = Math.round(((profile[cold - 1]!.depth_m + profile[cold]!.depth_m) / 2) * 100) / 100;
      const point = (await db.query(
        `insert into public.model_points (port_id, label, lat, lon, node_index, bottom_depth_m) values ($1, $2, 43.78, $3, $4, $5)
         on conflict (port_id, label) do update set bottom_depth_m = excluded.bottom_depth_m returning id`,
        [port, label, -86.5 - i * 0.03, 200 + i, bottom],
      )).rows[0].id;
      await db.query(
        `insert into public.model_profiles (model_point_id, run_at, valid_at, is_forecast, profile, surface_temp_c, break_depth_m, band_depth_m)
         values ($1, '2026-10-14T11:00:00Z', '2026-10-14T14:00:00Z', false, $2, 19.56, $3, $3)
         on conflict (model_point_id, valid_at) do update set run_at = excluded.run_at, profile = excluded.profile, break_depth_m = excluded.break_depth_m, band_depth_m = excluded.band_depth_m`,
        [point, JSON.stringify(profile), mid],
      );
    }
  });
  test.afterAll(async () => {
    await db.query("delete from public.model_points where port_id = (select id from public.ports where name = 'Pentwater')");
    await db.end();
  });

  async function toResult(page: Page) {
    await open(page, "Pentwater");
    // October has no depth default, but the model gives one, so depth is not asked.
    await expect(page.getByText("There is no depth default for this month")).toHaveCount(0);
    for (const [legend, option] of [["Water clarity", "Clear"], ["Sky", "Bright"], ["Wind", "Breezy or more"]] as const) if (await group(page, legend).count()) await choose(page, legend, option);
    await shown(page);
  }

  test("with no buoy profile, depth comes from the model and is labeled modeled", async ({ page }) => {
    await toResult(page);
    await expect(page.getByText("Medium confidence")).toBeVisible();
    await expect(page.getByText("Depth comes from NOAA's lake model, run 3 hours ago. It is modeled, not measured.")).toBeVisible();
    await expect(page.getByText("Depth · modeled")).toBeVisible();
    await expect(page.getByText("Water 67.2 °F · modeled")).toBeVisible();
    await expect(page.getByText("Model run 3 h old")).toBeVisible();
    await expect(page.getByText(/· buoy$/).filter({ hasText: "Water" })).toHaveCount(0); // no buoy is credited with a modeled number
    await expect(page.getByText("35 to 65").first()).toBeVisible(); // the break's 10 ft range, and 20 ft below it
  });

  test("the Conditions screen charts the profile at each sample point, with the break as a range", async ({ page }) => {
    await toResult(page);
    await page.getByRole("button", { name: "View conditions" }).click();
    const card = page.locator("section", { has: page.getByRole("heading", { name: "Temperature at depth" }) }).last();
    await expect(card.getByText("Modeled", { exact: true })).toBeVisible();
    await expect(card.getByText(/NOAA lake model, run 3 hours ago\. Modeled, not measured/)).toBeVisible();
    const tabs = card.getByRole("group", { name: "Sample point" }).getByRole("button");
    await expect(tabs).toHaveText([/Near shore\s*60 ft of water/, /Mid\s*200 ft of water/, /Offshore\s*250 ft of water/]);
    await expect(tabs.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByText("Break 35 to 45 ft down. Surface 67.2 °F.")).toBeVisible();
    await expect(card.getByText("The model resolves about 10 ft here, so the break is a range.")).toBeVisible();
    await expect(card.getByRole("img", { name: /Modeled water temperature by depth, mid point, over 200 feet of water/ })).toBeVisible();
    // The near point has thinner layers, so its break is a tighter range.
    await tabs.first().click();
    await expect(card.getByText(/^Break \d+ to \d+ ft down\. Surface 67\.2 °F\.$/)).toBeVisible();
    await expect(card.getByText("The model resolves about 3 ft here, so the break is a range.")).toBeVisible();
    // The same numbers as a table, for anyone who cannot use the chart.
    await card.getByText("Show as a table").click();
    await expect(card.locator("tbody tr")).toHaveCount(20);
  });

  test("the angler can say which water they fish, and the depth follows", async ({ page }) => {
    await toResult(page);
    await page.getByRole("button", { name: "Change conditions" }).click();
    const row = page.getByRole("listitem").filter({ has: page.getByText("Water fished", { exact: true }) });
    await expect(row).toContainText("Mid, 200 ft of water");
    await expect(row).toContainText("Default");
    await expect(page.getByRole("listitem").filter({ has: page.getByText("Depth", { exact: true }) })).toContainText("Modeled");
    await page.getByRole("button", { name: "Change water fished" }).click();
    await choose(page, "Water fished", "Near shore, 60 ft");
    await expect(row).toContainText("Near shore, 60 ft of water");
    await expect(row).toContainText("Your answer");
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("35 to 65")).toHaveCount(0);
  });
});

test.describe("port and location", () => {
  const portOrder = (page: Page) => page.getByLabel("Port").locator("option").allTextContents();

  test("a first visit asks for a port once, with the one filled button", async ({ page }) => {
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Get a starting setup" })).toBeVisible();
    await expect(page.getByLabel("Port")).toHaveValue("Muskegon");
    await page.getByLabel("Port").selectOption("Holland");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("heading", { name: "Holland, October 14" })).toBeVisible();
    // Changing the port on Home loads it at once.
    await page.getByLabel("Port").selectOption("Muskegon");
    await expect(page.getByRole("heading", { name: "Muskegon, October 14" })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Port")).toHaveValue("Muskegon");
  });

  test("with location already allowed, the nearest port opens with no tap", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 43.063, longitude: -86.228 }); // Grand Haven
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Grand Haven, October 14" })).toBeVisible();
    await expect(page.getByLabel("Port")).toHaveValue("Grand Haven");
    expect((await portOrder(page))[0]).toBe("Grand Haven, MI");
  });

  test("Use my location lists the nearest port first and opens it", async ({ page, context }) => {
    await open(page);
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 43.063, longitude: -86.228 });
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByLabel("Port")).toHaveValue("Grand Haven");
    await expect(page.getByText("Nearest port: Grand Haven.")).toBeVisible();
    expect((await portOrder(page))[0]).toBe("Grand Haven, MI");
  });

  test("with location refused the list is unchanged and the app says so", async ({ page, context }) => {
    await context.clearPermissions();
    await page.clock.setFixedTime(new Date(NOW));
    await page.goto("/");
    await expect(page.getByLabel("Port")).toBeVisible();
    const before = await portOrder(page);
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByText("Location is off. Pick a port from the list.")).toBeVisible();
    expect(await portOrder(page)).toEqual(before);
    await expect(page.getByLabel("Port")).toHaveValue("Muskegon");
  });
});
