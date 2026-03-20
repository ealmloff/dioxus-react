import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 15_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3199",
  },
  webServer: {
    // Serve the project root so both /tests/index.html and /assets/* are accessible.
    command: "npx serve . -l 3199 --no-clipboard",
    port: 3199,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
