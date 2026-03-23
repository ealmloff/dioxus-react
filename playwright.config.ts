import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "app.spec.mjs",
  timeout: 30_000,
  retries: 0,
  fullyParallel: false,
  workers: 1,
});
