import { webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";

const proxy = new PlaywrightWryProxy();

async function main() {
  const wsEndpoint = await proxy.start();
  const browser = await webkit.connect(wsEndpoint);
  const page = browser.contexts()[0].pages()[0];

  const steps = [
    async () => {
      console.log("step1");
      const error = await page.$(null).catch((value) => value);
      console.log("step1-error", error.message);
    },
    async () => {
      console.log("step2");
      await page.setContent("<section>test</section>");
      const element = await page.$("css=section");
      console.log("step2-element", !!element);
    },
    async () => {
      console.log("step3");
      await page.setContent("");
      const element = await page.$("non-existing-element");
      console.log("step3-element", element === null);
    },
    async () => {
      console.log("step4");
      await page.setContent("<section>test</section>");
      const element = await page.$("section");
      console.log("step4-element", !!element);
    },
  ];

  for (const step of steps) {
    await step();
  }

  await browser.close().catch(() => {});
}

main()
  .catch(async (error) => {
    console.error("TOP", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await proxy.close().catch(() => {});
  });
