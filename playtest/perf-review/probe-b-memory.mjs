import { runChrome, connect, sleep } from "../lib/chrome.mjs";
import { INSTRUMENT } from "./instrument.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const out = { samples: [], gc: [], errors: [] };
const J = (o) => JSON.stringify(o);

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send; const rawEv = c.ev;
  const ev = (e) => Promise.race([rawEv(e), new Promise((r) => setTimeout(() => r({ __timeout: true }), 8000))]);
  const heap = async () => {
    const { usedSize } = await send("Runtime.getHeapUsage");
    const dom = await send("Memory.getDOMCounters");
    return { heapMB: +(usedSize / 1048576).toFixed(2), dom };
  };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  await send("Page.navigate", { url: URL });
  // 等待 __MOYU__ 可用
  for (let i = 0; i < 300; i++) { if (await ev("!!window.__MOYU__")) break; await sleep(20); }
  await ev("window.__perf.gapsDisabled = true");
  await sleep(1500);
  await send("HeapProfiler.enable");
  await send("HeapProfiler.collectGarbage");
  await sleep(300);
  const base = await heap();
  out.gc.push({ label: "baseline(after GC)", ...base });
  const state0 = await ev(`(() => { const P = window.__perf; return { raf: P.raf.active, si: P.si.size, st: P.st.size, taps: window.__probeTaps, domNodes: document.querySelectorAll('*').length, mem: performance.memory ? performance.memory.usedJSHeapSize : null }; })()`);
  out.state0 = state0;
  // 事件/定时器/监听基线
  const objectIdOf = async (expr) => (await send("Runtime.evaluate", { expression: expr })).result.objectId;
  const listeners = async (label) => {
    const res = {};
    for (const [name, expr] of [["window", "window"], ["document", "document"], ["canvas", "document.getElementById('stage')"], ["hud", "document.getElementById('hud')"], ["app", "document.getElementById('app')"], ["journal", "document.getElementById('journal')"], ["team", "document.getElementById('team')"], ["arcade", "document.getElementById('arcade')"], ["cardsRoot", "document.getElementById('cards')"], ["bossChoice", "document.getElementById('boss-choice')"]]) {
      const oid = await objectIdOf(expr);
      if (!oid) { res[name] = null; continue; }
      try {
        const r = await send("DOMDebugger.getEventListeners", { objectId: oid, depth: 0, pierce: true });
        res[name] = r.listeners.length;
      } catch (e) { res[name] = "err"; }
    }
    return res;
  };
  out.listenersBefore = await listeners("before");

  // ------- 3 分钟连续负载 -------
  const startedAt = Date.now();
  let phase = 0;
  const panels = ["btn-journal", "btn-team", "btn-arcade"];
  while (Date.now() - startedAt < 180_000) {
    phase++;
    // 5cps 点击
    await ev(`(() => { clearInterval(window.__ck); window.__ck = setInterval(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width*0.5, clientY: r.top + r.height*0.55, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); }, 200); })()`);
    // 每 10s 开关一个面板
    for (let k = 0; k < 2; k++) {
      const btn = panels[(phase + k) % panels.length];
      await ev(`document.getElementById('${btn}').click()`);
      await sleep(1200);
      if (btn === "btn-team") { // 切 tab
        await ev(`document.getElementById('tab-talents').click()`); await sleep(300);
        await ev(`document.getElementById('tab-decor').click()`); await sleep(300);
        await ev(`document.getElementById('tab-colleagues').click()`); await sleep(300);
      }
      await ev(`document.getElementById('${btn}').click()`);
      await sleep(900);
    }
    // 每 30s 进一次小游戏并中途退出
    if (phase % 3 === 0) {
      await ev(`document.getElementById('btn-arcade').click()`);
      await sleep(600);
      await ev(`document.querySelector('#arcade-body button[data-game]').click()`);
      await sleep(3200);
      await ev(`document.getElementById('arcade-close').click()`); // playedSec>2 -> confirm 已 stub 为 true
      await sleep(600);
    }
    if (phase % 4 === 0) {
      const s = await heap();
      out.samples.push({ t: Math.round((Date.now() - startedAt) / 1000), ...s, timers: await ev("({ raf: __perf.raf.active, si: __perf.si.size, st: __perf.st.size, taps: window.__probeTaps, texts: __MOYU__ ? __MOYU__.fxTexts().length : -1 })") });
    }
  }
  await ev("clearInterval(window.__ck)");
  await sleep(1500);
  await send("HeapProfiler.collectGarbage");
  await sleep(500);
  out.gc.push({ label: "after 3min (after GC)", ...(await heap()) });
  out.listenersAfter = await listeners("after");
  out.stateEnd = await ev(`(() => { const P = window.__perf; return { raf: P.raf.active, si: P.si.size, st: P.st.size, taps: window.__probeTaps, domNodes: document.querySelectorAll('*').length, longtasks: P.longtasks.length, maxLongtask: Math.max(0, ...P.longtasks.map(l => l.dur)), mem: performance.memory ? performance.memory.usedJSHeapSize : null, intervals: [...P.si.values()], pendingTimeouts: [...P.st.values()] }; })()`);
  out.errors = c.errors.slice(0, 20);
  writeFileSync("playtest/perf-review/out-b-memory.json", J(out, null, 1));
  console.log(J(out, null, 1));
  c.close();
}, { timeoutMs: 260_000 });
