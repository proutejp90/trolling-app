import { expect, test, type Page } from "@playwright/test";

async function answer(page: Page, date: string, opts: { where?: string; breakFt?: number } = {}) {
  await page.goto("/");
  await page.getByLabel("Port").selectOption("Muskegon");
  await page.getByLabel("Date").fill(date);
  await page.getByRole("button", { name: "Get setup" }).click();
  await page.getByText("Clear", { exact: true }).click();
  await page.getByText("Bright", { exact: true }).click();
  await page.getByText("Daytime", { exact: true }).click();
  await page.getByText("Breezy or more", { exact: true }).click();
  if (opts.where) await page.getByText(opts.where, { exact: true }).click();
  if (opts.breakFt !== undefined) {
    await page.getByText("I know the break", { exact: true }).click();
    await page.getByLabel("Break depth, in feet").fill(String(opts.breakFt));
  }
}

test.describe("manual quiz", () => {
  for (const month of [4, 5, 6, 7, 8, 9, 10]) {
    test(`returns setups for month ${month}`, async ({ page }) => {
      const date = `2026-${String(month).padStart(2, "0")}-15`;
      // June, September and October have no depth default: the quiz must ask before it answers.
      const asksDepth = [6, 9, 10].includes(month);
      await answer(page, date, { where: month === 8 ? "Offshore" : undefined });
      const show = page.getByRole("button", { name: "Show setup" });
      if (asksDepth) {
        await expect(show).toBeDisabled();
        await expect(page.getByText("There is no depth default for this month")).toBeVisible();
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

  test("August offshore at midday matches golden scenario G11", async ({ page }) => {
    await answer(page, "2026-08-15", { where: "Offshore" });
    await page.getByRole("button", { name: "Show setup" }).click();
    await expect(page.getByText("2.0 to 2.2 mph").first()).toBeVisible();
    await expect(page.getByText("50 to 90 ft down").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Flasher and fly" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meat rig" })).toBeVisible();
    await expect(page.getByText(/Spoons run at 2\.4 to 3\.0 mph.*One spread cannot serve both\./)).toBeVisible();
    await page.getByText("Why this setup").first().click();
    await expect(page.getByText("Reports", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Lore", { exact: true }).first()).toBeVisible();
  });

  test("a winter date is out of season", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Date").fill("2026-01-15");
    await page.getByRole("button", { name: "Get setup" }).click();
    await expect(page.getByRole("heading", { name: "Out of season" })).toBeVisible();
  });
});
