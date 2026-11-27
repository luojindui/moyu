/** R14 冒烟：验证 playtest/lib/chrome.mjs + dev server 可连 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    await b.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
    for (let i = 0; i < 200; i++) {
      await sleep(100);
      try {
        const ok = await b.ev("!!window.__MOYU__");
        if (ok === true) break;
      } catch {
        /* retry */
      }
    }
    const info = await b.ev("JSON.stringify({title: document.title, ready: document.readyState, has: !!window.__MOYU__, state: window.__MOYU__ ? window.__MOYU__.state.moyu : null})");
    console.log("SMOKE:", info);
    b.close();
  },
  { timeoutMs: 90_000, port: 9561 },
);
console.log("done");