import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    pool: "forks",
    fileParallelism: false, // integration files share one real Postgres database
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      include: ["src/domain/**", "src/server/**", "src/lib/env.ts", "src/lib/logger.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
    hookTimeout: 120_000,
    env: {
      TEST_PROVIDER_WEBHOOK_SECRET: "test-secret-for-vitest-0123456789abcdef",
      PAYMENTS_PROVIDER: "test",
      APP_URL: "http://localhost:3000",
      RATE_LIMIT_DRIVER: "memory",
    },
  },
});
