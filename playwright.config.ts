import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:3000" },
  webServer: { command: "npm run dev", url: "http://127.0.0.1:3000/login", reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
