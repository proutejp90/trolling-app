import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: { baseURL: "http://localhost:3210", viewport: { width: 390, height: 844 }, trace: "off" },
  webServer: { command: "npm run start -- -p 3210", url: "http://localhost:3210", reuseExistingServer: !process.env.CI, timeout: 60_000 },
});
