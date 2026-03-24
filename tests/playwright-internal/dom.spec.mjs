import { test, expect } from "./fixtures.mjs";

// Imported from Playwright's DOM/state coverage, trimmed to proxy-supported surfaces.

test("innerText should work on pages and element handles", async ({ page }) => {
  await page.setContent("<div id=\"box\">Hello <span>World</span></div>");
  expect(await page.innerText("#box")).toBe("Hello World");

  const handle = await page.$("#box");
  expect(handle).toBeTruthy();
  expect(await handle.innerText()).toBe("Hello World");
});

test("innerHTML should work on pages and element handles", async ({ page }) => {
  await page.setContent("<div id=\"box\">Hello <span>World</span></div>");
  expect(await page.innerHTML("#box")).toBe("Hello <span>World</span>");

  const handle = await page.$("#box");
  expect(handle).toBeTruthy();
  expect(await handle.innerHTML()).toBe("Hello <span>World</span>");
});

test("blur should clear focus on a focused element", async ({ page }) => {
  await page.setContent("<input id=\"name\" value=\"abc\"><p id=\"state\">idle</p>");
  await page.evaluate(() => {
    const input = document.querySelector("#name");
    const state = document.querySelector("#state");
    input.addEventListener("focus", () => {
      state.textContent = "focused";
    });
    input.addEventListener("blur", () => {
      state.textContent = "blurred";
    });
  });

  await page.focus("#name");
  await expect.poll(() => page.textContent("#state")).toBe("focused");
  await page.mainFrame()._channel.blur({ selector: "#name", timeout: 0 });
  await expect.poll(() => page.textContent("#state")).toBe("blurred");
});

test("isEnabled should reflect disabled controls", async ({ page }) => {
  await page.setContent(
    "<button id=\"enabled\">ok</button><button id=\"disabled\" disabled>no</button>"
  );

  expect(await page.isEnabled("#enabled")).toBe(true);
  expect(await page.isEnabled("#disabled")).toBe(false);

  const disabledHandle = await page.$("#disabled");
  expect(disabledHandle).toBeTruthy();
  expect(await disabledHandle.isEnabled()).toBe(false);
});

test("queryCount should count matching elements", async ({ page }) => {
  await page.setContent("<ul><li>A</li><li>B</li><li>C</li></ul>");
  expect(await page.mainFrame()._queryCount("li")).toBe(3);
});

test("waitForTimeout should wait for the requested duration", async ({ page }) => {
  const start = performance.now();
  await page.waitForTimeout(100);
  expect(performance.now() - start).toBeGreaterThanOrEqual(80);
});
