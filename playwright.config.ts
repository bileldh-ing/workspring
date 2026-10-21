import { defineConfig } from "@playwright/test";

// E2E runs against an already running server (pnpm build && pnpm start, or pnpm dev) with seeded demo data.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  workers: 1,
  use: { baseURL: process.env.BASE_URL ?? "http://localhost:3000", viewport: { width: 1280, height: 860 }, trace: "off" },
  reporter: [["list"]],
});
