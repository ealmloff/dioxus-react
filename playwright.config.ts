import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["app.spec.mjs", "playwright-internal-*.spec.mjs"],
  timeout: 30_000,
  retries: 0,
  fullyParallel: true,
  workers: 32,
});
