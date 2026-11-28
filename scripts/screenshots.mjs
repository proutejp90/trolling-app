// Screenshots of every angler screen at phone and desktop width, in both themes.
// Usage: start the app on the autumn fixtures, then: node scripts/screenshots.mjs http://localhost:3225 docs/ui-review/part-e
import { chromium } from "playwright";

const [base, out] = process.argv.slice(2);
const run = async () => {
  const browser = await chromium.launch();
  for (const width of [390, 1440]) {
    for (const theme of ["dark", "light"]) {
      const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: width === 390 ? 2 : 1 });
      await page.addInitScript((t) => globalThis.localStorage.setItem("theme", t), theme);
      await page.clock.setFixedTime(new Date("2026-10-14T14:00:00Z"));
      const shot = (name) => page.screenshot({ path: `${out}/${name}-${width}-${theme}.png`, fullPage: true });
      await page.goto(base);
      await page.waitForLoadState("networkidle");
      await shot("home");
      for (const [name, date] of [["april-1", "2027-04-01"], ["july-15", "2027-07-15"]]) {
        await page.goto(base);
        await page.waitForLoadState("networkidle");
        await page.getByLabel("Date").fill(date);
        await page.getByRole("button", { name: "Get setup" }).click();
        await page.getByText("Daytime", { exact: true }).click();
        await page.getByText("Clear", { exact: true }).click();
        if (name === "july-15") await shot("questions");
        await page.getByText("Overcast", { exact: true }).click();
        await page.getByText("Calm", { exact: true }).click();
        await page.getByRole("button", { name: "Show setup" }).click();
        await page.getByText("Run the whole spread at").waitFor();
        await shot(`recommendation-${name}`);
      }
      // Conditions for a trip today, so the stations the engine read are marked.
      await page.goto(base);
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Get setup" }).click();
      for (const t of ["Daytime", "Clear", "Bright", "Calm", "I know the break"]) await page.getByText(t, { exact: true }).click();
      await page.getByLabel("Break depth, in feet").fill("60");
      await page.getByRole("button", { name: "Show setup" }).click();
      await page.getByRole("button", { name: "View conditions" }).click();
      await page.getByRole("heading", { name: /Conditions at/ }).waitFor();
      await shot("conditions");
      await page.close();
    }
  }
  await browser.close();
};
await run();
