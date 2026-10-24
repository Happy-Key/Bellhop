import { defineConfig } from "@playwright/test";

/**
 * Browser smoke tests for the UI (tests/e2e). They run read-only against a dev server and never
 * create, delete, pay, retrieve or call a live provider. `channel: "chrome"` drives the Chrome
 * already installed on the machine, so no browser download is needed; set E2E_CHANNEL=chromium
 * after `npx playwright install chromium` to use Playwright's own build instead.
 *
 *   npm run test:e2e        # starts `npm run dev` on :3000 unless something already listens there
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    colorScheme: "light",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
