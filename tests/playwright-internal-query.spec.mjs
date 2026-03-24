import { test, expect } from "@playwright/test";
import { installInternalSessionHooks } from "./playwright-internal-utils.mjs";

test.describe.configure({ mode: "serial" });

const { currentPage } = installInternalSessionHooks(test);

test.describe("Playwright Internal: queryselector.spec.ts", () => {
  test("should throw for non-string selector", async () => {
    const error = await currentPage().$(null).catch((value) => value);
    expect(error.message).toContain("selector: expected string");
  });

  test("should query existing element with css selector @smoke", async () => {
    await currentPage().setContent("<section>test</section>");
    expect(await currentPage().$("css=section")).toBeTruthy();
  });

  test("should return null for non-existing element", async () => {
    expect(await currentPage().$("non-existing-element")).toBe(null);
  });

  test("should auto-detect css selector", async () => {
    await currentPage().setContent("<section>test</section>");
    expect(await currentPage().$("section")).toBeTruthy();
  });

  test("should query existing elements", async () => {
    await currentPage().setContent("<div>A</div><br/><div>B</div>");
    const elements = await currentPage().$$("div");
    expect(elements.length).toBe(2);
    const texts = await Promise.all(elements.map((element) => element.textContent()));
    expect(texts).toEqual(["A", "B"]);
  });

  test("should return empty array if nothing is found", async () => {
    expect((await currentPage().$$("div")).length).toBe(0);
  });
});
