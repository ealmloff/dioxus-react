import { selectors } from "@playwright/test";
import { test, expect } from "./fixtures.mjs";

// Adapted from Playwright v1.58.2 tests/page/testid.spec.ts.

test("should resolve the default test id attribute", async ({ page }) => {
  await page.setContent(`
    <div data-testid="root">
      <span data-testid="child">Child</span>
    </div>
  `);

  expect(await page.getByTestId("root").textContent()).toContain("Child");
  expect(await page.getByTestId("child").textContent()).toBe("Child");

  const root = await page.getByTestId("root").elementHandle();
  const child = await root.waitForSelector('internal:testid=[data-testid="child"s]');
  expect(await child.textContent()).toBe("Child");
});

test("should respect a custom test id attribute for page queries", async ({ page }) => {
  selectors.setTestIdAttribute("data-pw-testid");
  try {
    await page.setContent(`
      <div data-pw-testid="root">
        <button data-pw-testid="save">Save</button>
      </div>
    `);

    expect(await page.getByTestId("root").textContent()).toContain("Save");
    expect(await page.getByTestId("save").textContent()).toBe("Save");

    const root = await page.getByTestId("root").elementHandle();
    const button = await root.$('internal:testid=[data-pw-testid="save"s]');
    expect(await button.textContent()).toBe("Save");
  } finally {
    selectors.setTestIdAttribute("data-testid");
  }
});

test("should wait for custom test id selectors", async ({ page }) => {
  selectors.setTestIdAttribute("data-pw-testid");
  try {
    const waitForButton = page.getByTestId("later").waitFor();
    await page.evaluate(() => {
      const button = document.createElement("button");
      button.setAttribute("data-pw-testid", "later");
      button.textContent = "Later";
      document.body.appendChild(button);
    });

    await waitForButton;
    expect(await page.getByTestId("later").textContent()).toBe("Later");
  } finally {
    selectors.setTestIdAttribute("data-testid");
  }
});
