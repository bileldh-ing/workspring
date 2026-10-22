import { defineConfig, devices } from "@playwright/test";

// E2E runs against an already running production server (pnpm build && pnpm start) with seeded demo data.
// CI: Playwright-managed Chromium on ubuntu x64. Machines where Playwright cannot download Chromium
// (e.g. linux-arm64 sandboxes) can point PW_CHROMIUM_PATH at a distro chromium-headless-shell binary.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  outputDir: "test-results",
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1280, height: 860 },
    trace: isCI ? "retain-on-failure" : "off",
    video: isCI ? "retain-on-failure" : "off",
    screenshot: "only-on-failure",
  },
  reporter: isCI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }], ["junit", { outputFile: "test-results/junit.xml" }]] : [["list"]],
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 860 },
        // --no-proxy-server: never route localhost through an HTTP(S)_PROXY from the environment
        // (a corporate/sandbox proxy answered 404 for "/" in one environment).
        launchOptions: { executablePath, args: ["--no-proxy-server"] },
      },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], launchOptions: { executablePath, args: ["--no-proxy-server"] } },
    },
  ],
});
