/**
 * Flows through Home, Quick questions, Recommendation and Conditions.
 * The app runs on the autumn fixtures with the clock at 2026-10-14 14:00 UTC,
 * so Muskegon's buoy last reported 20 minutes ago.
 */
import { expect, test, type Page } from "@playwright/test";

async function start(page: Page, date: string, port = "Muskegon") {
  await page.goto("/");
  await page.getByLabel("Port").selectOption(port);
  await page.getByLabel("Date").fill(date);
  await page.getByRole("button", { name: "Get setup" }).click();
}

/** Answers what the app asks when no forecast covers the trip. */
async function answer(page: Page, opts: { where?: string } = {}) {
  await page.getByText("Daytime", { exact: true }).click();
  await page.getByText("Clear", { exact: true }).click();
  await page.getByText("Bright", { exact: true }).click(); // appears once the time is known and no forecast covers it
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
    await expect(page.getByText("Depth comes from month defaults.")).toBeVisible();
    await page.getByText("Why this setup").first().click();
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
});
