import { test, expect, type Page } from "@playwright/test";

// Every test loads the test harness which includes mocked __native functions.
const PAGE = "/tests/index.html";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the React app to mount and render tabs. */
async function waitForApp(page: Page) {
  await page.goto(PAGE);
  await expect(page.locator("h1")).toHaveText("dioxus-react");
  await expect(page.locator(".tabs")).toBeVisible();
}

function tab(page: Page, name: string) {
  return page.locator(".tab", { hasText: name });
}

// ---------------------------------------------------------------------------
// App shell
// ---------------------------------------------------------------------------

test.describe("App shell", () => {
  test("renders header and all four tabs", async ({ page }) => {
    await waitForApp(page);

    await expect(page.locator("h1")).toHaveText("dioxus-react");
    const tabs = page.locator(".tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveText("System Info");
    await expect(tabs.nth(1)).toHaveText("Fibonacci");
    await expect(tabs.nth(2)).toHaveText("File Explorer");
    await expect(tabs.nth(3)).toHaveText("Counter");
  });

  test("System Info tab is active by default", async ({ page }) => {
    await waitForApp(page);
    await expect(tab(page, "System Info")).toHaveClass(/tab-active/);
  });

  test("clicking a tab switches content", async ({ page }) => {
    await waitForApp(page);

    await tab(page, "Counter").click();
    await expect(tab(page, "Counter")).toHaveClass(/tab-active/);
    await expect(tab(page, "System Info")).not.toHaveClass(/tab-active/);
    await expect(page.locator("h2")).toHaveText("Counter");
  });
});

// ---------------------------------------------------------------------------
// System Info tab
// ---------------------------------------------------------------------------

test.describe("System Info", () => {
  test("displays system information from native", async ({ page }) => {
    await waitForApp(page);

    // The System Info tab is active by default
    await expect(page.locator("h2")).toHaveText("System Information");

    const table = page.locator(".info-table");
    await expect(table).toBeVisible();

    // Verify mocked values appear in the table
    await expect(table.locator("text=linux")).toBeVisible();
    await expect(table.locator("text=x86_64")).toBeVisible();
    await expect(table.locator("text=unix")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Fibonacci tab
// ---------------------------------------------------------------------------

test.describe("Fibonacci", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await tab(page, "Fibonacci").click();
    await expect(page.locator("h2")).toHaveText("Native Fibonacci");
  });

  test("calculates fibonacci with default input (n=10)", async ({ page }) => {
    await page.locator(".btn", { hasText: "Calculate" }).click();
    await expect(page.locator(".result-value")).toHaveText("55");
  });

  test("calculates fibonacci for custom input", async ({ page }) => {
    const input = page.locator('input[type="number"]');
    await input.fill("20");
    await page.locator(".btn", { hasText: "Calculate" }).click();
    await expect(page.locator(".result-value")).toHaveText("6765");
  });

  test("calculates fibonacci(0) = 0", async ({ page }) => {
    const input = page.locator('input[type="number"]');
    await input.fill("0");
    await page.locator(".btn", { hasText: "Calculate" }).click();
    await expect(page.locator(".result-value")).toHaveText("0");
  });

  test("calculates fibonacci(1) = 1", async ({ page }) => {
    const input = page.locator('input[type="number"]');
    await input.fill("1");
    await page.locator(".btn", { hasText: "Calculate" }).click();
    await expect(page.locator(".result-value")).toHaveText("1");
  });

  test("shows timing information", async ({ page }) => {
    await page.locator(".btn", { hasText: "Calculate" }).click();
    await expect(page.locator(".result-time")).toBeVisible();
    await expect(page.locator(".result-time")).toContainText("ms");
  });
});

// ---------------------------------------------------------------------------
// File Explorer tab
// ---------------------------------------------------------------------------

test.describe("File Explorer", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await tab(page, "File Explorer").click();
    await expect(page.locator("h2")).toHaveText("File Explorer");
  });

  test("loads initial directory listing", async ({ page }) => {
    // The mock starts at /home/user/dioxus-react
    await expect(page.locator(".path-input")).toHaveValue(
      "/home/user/dioxus-react"
    );

    // Directories should appear
    await expect(
      page.locator(".file-entry", { hasText: "src" })
    ).toBeVisible();
    await expect(
      page.locator(".file-entry", { hasText: "assets" })
    ).toBeVisible();

    // Files should appear
    await expect(
      page.locator(".file-entry", { hasText: "Cargo.toml" })
    ).toBeVisible();
    await expect(
      page.locator(".file-entry", { hasText: "README.md" })
    ).toBeVisible();
  });

  test("directories are styled differently from files", async ({ page }) => {
    const dirEntry = page.locator(".file-entry", { hasText: "src" });
    await expect(dirEntry).toHaveClass(/file-dir/);

    const fileEntry = page.locator(".file-entry", { hasText: "Cargo.toml" });
    await expect(fileEntry).not.toHaveClass(/file-dir/);
  });

  test("clicking a directory navigates into it", async ({ page }) => {
    await page.locator(".file-entry", { hasText: "src" }).click();
    await expect(page.locator(".path-input")).toHaveValue(
      "/home/user/dioxus-react/src"
    );
    await expect(
      page.locator(".file-entry", { hasText: "main.rs" })
    ).toBeVisible();
  });

  test("clicking a file shows its content", async ({ page }) => {
    await page.locator(".file-entry", { hasText: "Cargo.toml" }).click();
    await expect(page.locator(".file-preview")).toBeVisible();
    await expect(page.locator(".file-preview h3")).toHaveText("Cargo.toml");
    await expect(page.locator(".file-preview pre")).toContainText(
      "dioxus-react"
    );
  });

  test("Up button navigates to parent directory", async ({ page }) => {
    // Navigate into src first
    await page.locator(".file-entry", { hasText: "src" }).click();
    await expect(page.locator(".path-input")).toHaveValue(
      "/home/user/dioxus-react/src"
    );

    // Click Up
    await page.locator(".btn", { hasText: /Up/ }).click();
    await expect(page.locator(".path-input")).toHaveValue(
      "/home/user/dioxus-react"
    );
  });

  test("shows error for invalid path", async ({ page }) => {
    const input = page.locator(".path-input");
    await input.fill("/nonexistent/path");
    await page.locator(".btn", { hasText: "Go" }).click();
    await expect(page.locator(".error")).toBeVisible();
    await expect(page.locator(".error")).toContainText(
      "No such file or directory"
    );
  });

  test("file sizes are displayed for files", async ({ page }) => {
    // The mock Cargo.toml is 512 bytes
    const fileEntry = page.locator(".file-entry", { hasText: "Cargo.toml" });
    await expect(fileEntry.locator(".file-size")).toContainText("512 B");
  });
});

// ---------------------------------------------------------------------------
// Counter tab
// ---------------------------------------------------------------------------

test.describe("Counter", () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await tab(page, "Counter").click();
    await expect(page.locator("h2")).toHaveText("Counter");
  });

  test("starts at zero", async ({ page }) => {
    await expect(page.locator(".counter-value")).toHaveText("0");
  });

  test("increments on + click", async ({ page }) => {
    await page.locator(".btn", { hasText: "+" }).click();
    await expect(page.locator(".counter-value")).toHaveText("1");

    await page.locator(".btn", { hasText: "+" }).click();
    await expect(page.locator(".counter-value")).toHaveText("2");
  });

  test("decrements on - click", async ({ page }) => {
    await page.locator(".btn", { hasText: /\u2212/ }).click();
    await expect(page.locator(".counter-value")).toHaveText("-1");
  });

  test("increments and decrements together", async ({ page }) => {
    const plus = page.locator(".btn", { hasText: "+" });
    const minus = page.locator(".btn", { hasText: /\u2212/ });

    await plus.click();
    await plus.click();
    await plus.click();
    await minus.click();
    await expect(page.locator(".counter-value")).toHaveText("2");
  });
});

// ---------------------------------------------------------------------------
// Tab persistence — switching away and back retains no stale state
// ---------------------------------------------------------------------------

test.describe("Tab switching", () => {
  test("switching tabs replaces content", async ({ page }) => {
    await waitForApp(page);

    // Start on System Info
    await expect(page.locator("h2")).toHaveText("System Information");

    // Switch to Counter
    await tab(page, "Counter").click();
    await expect(page.locator("h2")).toHaveText("Counter");
    await expect(page.locator(".info-table")).not.toBeVisible();

    // Switch to Fibonacci
    await tab(page, "Fibonacci").click();
    await expect(page.locator("h2")).toHaveText("Native Fibonacci");
    await expect(page.locator(".counter-value")).not.toBeVisible();

    // Switch back to System Info
    await tab(page, "System Info").click();
    await expect(page.locator("h2")).toHaveText("System Information");
  });
});
