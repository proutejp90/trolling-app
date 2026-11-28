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
      const pick = (legend, option) => page.getByRole("group", { name: legend, exact: true }).getByText(option, { exact: true }).click();
      await page.goto(base);
      await page.waitForLoadState("networkidle");
      await shot("first-visit");
      await page.getByRole("button", { name: "Get setup" }).click();
      // Today, with the buoy's data: the questions, then the result, then the two screens behind it.
      await page.getByText(/Today, now\./).waitFor();
      await shot("today-questions");
      await pick("Water clarity", "Clear");
      await pick("Sky", "Bright");
      await pick("What you know", "I know the break");
      await page.getByLabel("Break depth, in feet").fill("60");
      await page.getByText("Run the whole spread at").waitFor();
      await shot("today-result");
      await page.getByRole("button", { name: "Change conditions" }).click();
      await shot("conditions-in-use");
      await page.getByRole("button", { name: "Done" }).click();
      await page.getByRole("button", { name: "View conditions" }).click();
      await page.getByRole("heading", { name: /Conditions at/ }).waitFor();
      await shot("conditions");
      await page.getByRole("button", { name: "Back" }).click();
      // A forecast day, at first light.
      await page.getByRole("button", { name: "Sat 17" }).click();
      await page.getByRole("group", { name: "Time on the water" }).waitFor();
      await shot("forecast-day");
      await page.close();
    }
  }
  await browser.close();
};
await run();
