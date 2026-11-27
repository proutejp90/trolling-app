import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:3210", viewport: { width: 390, height: 844 }, trace: "off" },
  // The app runs against the autumn fixtures with the clock pinned to them. `npm run test:e2e` loads the cache first.
  webServer: {
    command: "npm run start -- -p 3210", url: "http://localhost:3210", reuseExistingServer: false, timeout: 60_000,
    env: { FIXTURES: "replay:autumn", FIXED_NOW: "2026-10-14T14:00:00Z", DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/conditions" },
  },
});
