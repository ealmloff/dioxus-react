import { webkit } from "@playwright/test";
import { PlaywrightWryProxy } from "./driver/dist/index.mjs";

const html = `<!doctype html>
<html>
  <body>
    <button id="dispatch-button">Dispatch</button>
    <input id="text-input" value="" />
    <select id="single-select">
      <option value="">Choose</option>
      <option value="green">Green</option>
      <option value="blue">Blue</option>
    </select>
    <select id="multi-select" multiple>
      <option value="alpha">Alpha</option>
      <option value="beta">Beta</option>
      <option value="gamma">Gamma</option>
    </select>
    <div id="result">ready</div>
    <script>
      const result = document.getElementById("result");
      document.getElementById("dispatch-button").addEventListener("click", () => {
        result.textContent = "clicked";
      });
      document.getElementById("dispatch-button").addEventListener("dblclick", () => {
        result.textContent = "double-clicked";
      });
      document.getElementById("dispatch-button").addEventListener("custom-event", (event) => {
        const kind = event.detail && event.detail.kind ? event.detail.kind : "missing";
        result.textContent = \`custom-\${kind}\`;
      });
    </script>
  </body>
</html>`;

const proxy = new PlaywrightWryProxy();

try {
  const wsEndpoint = await proxy.start();
  const browser = await webkit.connect(wsEndpoint);
  const page = browser.contexts()[0].pages()[0];

  await page.waitForSelector("h1");
  await page.setContent(html);
  await page.waitForSelector("#dispatch-button");

  await page.evaluate(() => {
    const button = document.getElementById("dispatch-button");
    const result = document.getElementById("result");
    if (!button || !result) return;

    button.addEventListener("click", () => {
      result.textContent = "clicked";
    });
    button.addEventListener("dblclick", () => {
      result.textContent = "double-clicked";
    });
    button.addEventListener("custom-event", (event) => {
      const kind = event.detail && event.detail.kind ? event.detail.kind : "missing";
      result.textContent = `custom-${kind}`;
    });
  });

  console.log("before", await page.textContent("#result"));
  await page.click("#dispatch-button");
  console.log("after click", await page.textContent("#result"));
  await page.dblclick("#dispatch-button");
  console.log("after dblclick", await page.textContent("#result"));
  await page.dispatchEvent("#dispatch-button", "custom-event", {
    detail: { kind: "command-dispatch" },
  });
  console.log("after dispatch", await page.textContent("#result"));
  console.log("single", await page.selectOption("#single-select", { label: "Blue" }));
  console.log("multi", await page.selectOption("#multi-select", [
    { value: "alpha" },
    { value: "gamma" },
  ]));
  await page.fill("#text-input", "playwright");
  console.log("fill", await page.inputValue("#text-input"));
  await page.type("#text-input", "!");
  console.log("type", await page.inputValue("#text-input"));
  await page.press("#text-input", "Backspace");
  console.log("press", await page.inputValue("#text-input"));

  await browser.close().catch(() => {});
} finally {
  await proxy.close().catch(() => {});
}
