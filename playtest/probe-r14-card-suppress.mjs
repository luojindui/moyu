/** 补测：卡片弹窗是否在团队面板打开期间保持隐藏（6be96e2） */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const out = {};
await runChrome(async ({ port }) => {
  const b = await connect(port);
  await b.send("Page.enable", {}); await b.send("Runtime.enable", {});
  await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expr) => { const r = await b.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0,200)); return r.result.value; };
  const evj = async (e) => JSON.parse(await evaluate(`JSON.stringify((${e}))`));
  const waitReady = async () => { for (let i=0;i<250;i++){ try{ if(await evaluate("!!window.__MOYU__")) return; }catch{} await sleep(100);} throw new Error("not ready"); };
  await b.send("Page.navigate", { url: URL }); await waitReady(); await sleep(1500);
  // 先确保当天卡片弹窗被处理掉（跳过）
  out.cardHiddenBeforePanel = await evj(`document.getElementById('cards').classList.contains('hidden')`);
  if (!out.cardHiddenBeforePanel) {
    await evj(`document.getElementById('cards-skip').click()`); await sleep(500);
  }
  out.cardHiddenAfterDismiss = await evj(`document.getElementById('cards').classList.contains('hidden')`);
  // 打开团队面板并跨过一个 maybeShow 周期
  await evj(`document.getElementById('btn-team').click()`); await sleep(800);
  await evj(`document.getElementById('tab-decor').click()`); await sleep(1800);
  out.cardHiddenWhilePanelOpen = await evj(`document.getElementById('cards').classList.contains('hidden')`);
  out.teamOpen = await evj(`!document.getElementById('team').classList.contains('hidden')`);
  // 关面板后应允许弹（记录，不作断言）
  await evj(`document.getElementById('team-close').click()`); await sleep(1500);
  out.cardHiddenAfterClose = await evj(`document.getElementById('cards').classList.contains('hidden')`);
  b.close();
}, { timeoutMs: 90_000, port: 9567 });
console.log(JSON.stringify(out));
