/**
 * Flows through Home, Quick questions, Recommendation and Conditions.
 * The app runs on the autumn fixtures with the clock at 2026-10-14 14:00 UTC,
 * so Muskegon's buoy last reported 20 minutes ago.
 */
import { expect, test, type Page } from "@playwright/test";

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
    await expect(page.getByText(reading)).toBeVisible();
    await expect(page.getByText("Depth comes from the break depth you gave.").first()).toBeVisible();
    await expect(page.getByText("60 to 80 ft down").first()).toBeVisible();

    await page.getByRole("button", { name: "View conditions" }).click();
    await expect(page.getByRole("heading", { name: "Conditions at Muskegon" })).toBeVisible();
    await expect(page.getByText("Muskegon Buoy, MI", { exact: true })).toBeVisible();
    await expect(page.getByText(/Water 60\.3 °F\. Wind [\d.]+ mph from the \w+/)).toBeVisible();
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
      for (const legend of ["Time on the water", "Water clarity", "Sky", "Wind", "Depth"]) await expect(page.getByRole("group", { name: legend, exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(0); // sections sit one level under the main heading
  });

  test("on a wide screen the button follows the last field; on a phone it sits at the bottom", async ({ page }) => {
    const gap = async (button: string, above: string) => {
      const b = (await page.getByRole("button", { name: button }).boundingBox())!;
      const a = (await page.getByText(above, { exact: true }).last().boundingBox())!;
      return b.y - (a.y + a.height);
    };
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z"));
    await page.goto("/");
    await expect(dateFieldOf(page)).toHaveValue("2026-10-14");
    const dateBottom = async () => { const d = (await dateFieldOf(page).boundingBox())!; return d.y + d.height; };
    expect((await page.getByRole("button", { name: "Get setup" }).boundingBox())!.y - (await dateBottom())).toBeLessThan(40);
    await dateFieldOf(page).fill("2026-07-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("button", { name: "Show setup" })).toBeVisible();
    expect(await gap("Show setup", "Lines")).toBeLessThan(60);
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

  test("lists the stations in range openly and the rest behind a closed row", async ({ page }) => {
    await conditions(page, "2026-10-14");
    const stations = page.locator("section", { has: page.getByRole("heading", { name: "Stations" }) });
    const open = stations.locator(":scope > ul > li"), farther = stations.locator("details");
    const near = await miles(open);
    expect(near.length).toBeGreaterThan(0);
    for (const d of near) expect(d).toBeLessThanOrEqual(25);
    expect(new Set(near).size).toBe(near.length); // no place is listed twice
    await expect(farther.locator("summary")).toHaveText("Farther stations, not used");
    expect(await farther.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);
    await farther.locator("summary").click();
    const far = await miles(farther.locator("li"));
    expect(far.length).toBeGreaterThan(0);
    for (const d of far) expect(d).toBeGreaterThan(25);
    // Each row names where its numbers came from.
    await expect(open.first()).toContainText(/NDBC|GLOS|NWS/);
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
