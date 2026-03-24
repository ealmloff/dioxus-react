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

test("locator chaining with first, nth, and last should resolve through injected selectors", async ({
  page,
}) => {
  await page.setContent(`
    <main>
      <ul aria-label="Inventory">
        <li class="item">
          <span class="name">Alpha</span>
          <button>Open Alpha</button>
        </li>
        <li class="item">
          <span class="name">Beta</span>
          <button>Open Beta</button>
        </li>
        <li class="item">
          <span class="name">Gamma</span>
          <button>Open Gamma</button>
        </li>
      </ul>
    </main>
  `);

  const items = page.getByRole("list").getByRole("listitem");
  expect(await items.count()).toBe(3);
  expect(await items.first().getByRole("button").textContent()).toBe("Open Alpha");
  expect(await items.nth(1).getByRole("button").textContent()).toBe("Open Beta");
  expect(await items.last().getByRole("button").textContent()).toBe("Open Gamma");
});

test("locator filter should support hasText and has", async ({ page }) => {
  await page.setContent(`
    <main>
      <article class="card">
        <h2>Alpha</h2>
        <button>Select Alpha</button>
      </article>
      <article class="card">
        <h2>Beta</h2>
        <button>Select Beta</button>
      </article>
      <article class="card">
        <h2>Gamma</h2>
        <button>Select Gamma</button>
      </article>
    </main>
  `);

  const betaByText = page.locator(".card").filter({ hasText: "Beta" });
  expect(await betaByText.count()).toBe(1);
  expect(await betaByText.getByRole("heading").textContent()).toBe("Beta");

  const betaByChild = page
    .locator(".card")
    .filter({ has: page.getByRole("button", { name: "Select Beta" }) });
  expect(await betaByChild.count()).toBe(1);
  expect(await betaByChild.getByRole("button").textContent()).toBe("Select Beta");
});

test("strict locator actions should raise Playwright strict mode errors", async ({ page }) => {
  await page.setContent(`
    <main>
      <button>Duplicate</button>
      <button>Duplicate</button>
    </main>
  `);

  const error = await page
    .getByRole("button", { name: "Duplicate" })
    .click()
    .catch((value) => value);
  expect(String(error)).toContain("strict mode violation");
});
