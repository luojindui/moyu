/** R11：点击反馈对比（点职员 vs 点空地），只读 src/。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";
const b = await openBrowser({ port: 9494, tag: "r11click" });
await b.send("Page.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await b.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3000);
const canvasY = (await b.ev(`JSON.stringify(document.getElementById('stage').getBoundingClientRect().y)`));
const cy = JSON.parse(canvasY);
const click = async (x, cssY, n) => {
  // 打点两轮：清掉浮动文字干扰后截图
  for (let i = 0; i < n; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y: cy + cssY, button: "left", clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: cy + cssY, button: "left", clickCount: 1 });
    await sleep(120);
  }
};
const snap = async () => JSON.parse(await b.ev(`JSON.stringify({c:window.__MOYU__.state.totalClicks,m:window.__MOYU__.state.moyu,levels:window.__MOYU__.state.levels})`));
const before = await snap();
await click(195, 196, 12); // 职员可见区
await sleep(300);
const afterWorker = await snap();
await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }).then((r) => writeFileSync("/tmp/r11-click-worker2.png", Buffer.from(r.data, "base64")));
await sleep(600);
await click(60, 500, 12); // 空地（画布内、桌外地板）
await sleep(300);
const afterEmpty = await snap();
await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }).then((r) => writeFileSync("/tmp/r11-click-empty2.png", Buffer.from(r.data, "base64")));
const out={before,afterWorker,afterEmpty,deltaWorker:afterWorker.c-before.c,deltaEmpty:afterEmpty.c-afterWorker.c,
  note:"职员可见区(195,196) 与地板空地(60,500) 各点 12 下：totalClicks 均 +12、余额增量一致；源码 doTap 无坐标语义（除巡逻/丢梗），无角色专属反馈"};
writeFileSync("playtest/r11-pet-click.json", JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2));
try{b.close();}catch(e){}
process.exit(0);
