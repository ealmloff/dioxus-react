import { test, expect } from "@playwright/test";
import { installInternalSessionHooks } from "./playwright-internal-utils.mjs";


const { currentPage } = installInternalSessionHooks(test);

test.describe("Playwright Internal: page-wait-for-selector-1.spec.ts", () => {
  test("should immediately resolve promise if node exists", async () => {
    await currentPage().setContent("<div></div>");
    await currentPage().waitForSelector("div", { state: "attached" });
  });

  test("elementHandle.waitForSelector should immediately resolve if node exists", async () => {
    await currentPage().setContent("<span>extra</span><div><span>target</span></div>");
    const div = await currentPage().$("div");
    const span = await div.waitForSelector("span", { state: "attached" });
    expect(await span.evaluate((element) => element.textContent)).toBe("target");
  });

  test("elementHandle.waitForSelector should wait", async () => {
    await currentPage().setContent("<div></div>");
    const div = await currentPage().$("div");
    const promise = div.waitForSelector("span", { state: "attached" });
    await div.evaluate((element) => {
      element.innerHTML = "<span>target</span>";
    });
    const span = await promise;
    expect(await span.evaluate((element) => element.textContent)).toBe("target");
  });

  test("elementHandle.waitForSelector should timeout", async () => {
    await currentPage().setContent("<div></div>");
    const div = await currentPage().$("div");
    const error = await div.waitForSelector("span", { timeout: 100 }).catch((value) => value);
    expect(error.message).toContain("Timeout 100ms exceeded");
  });

  test("should work with removed MutationObserver", async () => {
    await currentPage().evaluate(() => {
      delete window.MutationObserver;
    });
    const [handle] = await Promise.all([
      currentPage().waitForSelector(".zombo"),
      currentPage().setContent("<div class='zombo'>anything</div>"),
    ]);
    expect(await currentPage().evaluate((element) => element.textContent, handle)).toBe(
      "anything"
    );
  });

  test("should resolve promise when node is added", async () => {
    const promise = currentPage().waitForSelector("div", { state: "attached" });
    await currentPage().evaluate(() => {
      document.body.appendChild(document.createElement("br"));
      document.body.appendChild(document.createElement("div"));
    });
    const handle = await promise;
    const tagName = await handle.getProperty("tagName").then((value) => value.jsonValue());
    expect(tagName).toBe("DIV");
  });
});
