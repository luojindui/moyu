// R14 硬核玩家 live 验证（必须使用 playtest/lib/chrome.mjs 以保证 kill Chrome）
// 验证：①三种精力可以同一天全部使用（预算 100 = 总和 → 无取舍）②家具购买生效
// 运行：node_modules/.bin/vite-node playtest/probe-r14-live.mjs
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = process.env.R14_URL ?? "http://127.0.0.1:5173/";

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: URL });
  await sleep(2500);

  // 等 boot 完成
  let booted = false;
  for (let i = 0; i < 60; i++) {
    const ok = await ev("typeof window.__MOYU__ === 'object' && !!window.__MOYU__.state");
    if (ok === true) { booted = true; break; }
    await sleep(250);
  }
  console.log("booted:", booted);

  const out = { url: URL, booted };
  if (!booted) {
    console.log("页面未 boot：", JSON.stringify(c.errors));
    c.close();
    return;
  }

  // 给钱，打开小队面板 → 工位 tab
  await ev("window.__MOYU__.grant(1e11)");
  await sleep(300);
  await ev("document.getElementById('btn-team').click()");
  await sleep(400);
  await ev("document.getElementById('tab-decor').click()");
  await sleep(500);

  // 读工位面板文本
  out.decorPanelText = await ev("document.querySelector('.team-panel .team-body')?.innerText ?? document.querySelector('.team-panel')?.innerText ?? ''");
  out.energyButtons = await ev(`[...document.querySelectorAll('button[data-act="energy"]')].map(b=>({id:b.dataset.id,text:b.textContent,disabled:b.disabled}))`);
  out.decorButtons = await ev(`[...document.querySelectorAll('button[data-act="decor"]')].map(b=>({id:b.dataset.id,text:b.textContent,disabled:b.disabled}))`);
  out.energyBefore = await ev("JSON.stringify(window.__MOYU__.state.energy)");

  // 依次点击三种精力（每次重新查询，因为面板会重渲染）
  const clickLog = [];
  for (const id of ["slack", "fake-work", "social"]) {
    const r = await ev(`(() => { const b=[...document.querySelectorAll('button[data-act="energy"]')].find(x=>x.dataset.id==='${id}'); if(!b) return 'no-button'; b.click(); return 'clicked'; })()`);
    await sleep(350);
    const e = await ev("JSON.stringify(window.__MOYU__.state.energy)");
    clickLog.push({ id, action: r, energy: e });
  }
  out.energyClicks = clickLog;
  out.energyAfterAll = await ev("JSON.stringify(window.__MOYU__.state.energy)");
  out.energyPanelTextAfter = await ev("document.querySelector('.team-panel .team-body')?.innerText ?? ''");

  // 买绿萝（3000）
  const buy = await ev(`(() => { const b=[...document.querySelectorAll('button[data-act="decor"]')].find(x=>x.dataset.id==='plant'); if(!b) return 'no-button'; b.click(); return 'clicked'; })()`);
  await sleep(500);
  out.decorBuy = buy;
  out.decorAfterBuy = await ev("JSON.stringify(window.__MOYU__.state.decor)");
  out.decorPanelTextAfterBuy = await ev("document.querySelector('.team-panel .team-body')?.innerText ?? ''");
  out.toast = await ev("document.querySelector('.toast')?.innerText ?? [...document.querySelectorAll('[class*=toast]')].map(x=>x.innerText).join(' | ')");

  // 截图（工位面板）
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/r14-hardcore-decor.png", Buffer.from(shot.data, "base64"));

  // 页面运行期间是否有异常
  out.consoleErrors = c.errors;
  console.log(JSON.stringify(out, null, 2));
  writeFileSync("playtest/r14-hardcore-live.json", JSON.stringify(out, null, 2));
  c.close();
}, { timeoutMs: 90_000 });
console.log("chrome cleaned");