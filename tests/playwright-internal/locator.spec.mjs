import { test, expect } from "./fixtures.mjs";

// Adapted from Playwright's locator selector behavior, but asserted through the proxy.

test("getByText should find real page content", async ({ page }) => {
  await page.setContent(`
    <main>
      <h1>Locator Lab</h1>
      <p>Hello from the proxy</p>
      <p>Nested <strong>Other text</strong></p>
    </main>
  `);

  expect(await page.getByText("Hello from the proxy").count()).toBe(1);
  expect(await page.getByText("Hello from the proxy").textContent()).toBe(
    "Hello from the proxy"
  );
  expect(await page.getByText("Nested Other text").count()).toBe(1);
});

test("getByPlaceholder and getByTitle should drive form interactions", async ({ page }) => {
  await page.setContent(`
    <main>
      <label for="search">Search sample</label>
      <input id="search" placeholder="Search the catalog" title="search box" />
      <img id="logo" alt="Locator logo" title="locator artwork" />
    </main>
  `);

  await page.getByPlaceholder("Search the catalog").fill("widgets");
  expect(await page.getByPlaceholder("Search the catalog").inputValue()).toBe("widgets");
  expect(await page.getByTitle("search box").getAttribute("title")).toBe("search box");
  expect(await page.getByAltText("Locator logo").getAttribute("alt")).toBe("Locator logo");
});

test("getByLabel should resolve associated controls", async ({ page }) => {
  await page.setContent(`
    <main>
      <label for="name">Full name</label>
      <input id="name" value="" />
      <label>
        <span>Nickname</span>
        <input id="nickname" value="" />
      </label>
    </main>
  `);

  await page.getByLabel("Full name").fill("Ada Lovelace");
  await page.getByLabel("Nickname").fill("Countess");

  expect(await page.getByLabel("Full name").inputValue()).toBe("Ada Lovelace");
  expect(await page.getByLabel("Nickname").inputValue()).toBe("Countess");
});

test("getByRole should work for common control roles", async ({ page }) => {
  await page.setContent(`
    <main>
      <h2>Actions</h2>
      <button id="save">Save</button>
      <label>
        <input id="accept" type="checkbox" />
        Accept terms
      </label>
      <a id="help" href="#help">Help</a>
    </main>
  `);

  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("checkbox", { name: "Accept terms" }).check();

  expect(await page.getByRole("button", { name: "Save" }).count()).toBe(1);
  expect(await page.getByRole("checkbox", { name: "Accept terms" }).isChecked()).toBe(true);
  expect(await page.getByRole("heading", { level: 2, name: "Actions" }).count()).toBe(1);
  expect(await page.getByRole("link", { name: "Help" }).getAttribute("href")).toBe("#help");
});
