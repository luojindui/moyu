import { runChrome, connect, sleep } from "../lib/chrome.mjs";
import { INSTRUMENT } from "./instrument.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const out = { dpr: {}, leak: {}, errors: [] };
const J = (o) => JSON.stringify(o, null, 1);
const busy = (profile) => {
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  let total = 0, idle = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    total += (profile.timeDeltas[i] ?? 0) / 1000;
    if (nodes.get(profile.samples[i])?.callFrame?.functionName === "(idle)") idle += (profile.timeDeltas[i] ?? 0) / 1000;
  }
  return { totalMs: +total.toFixed(0), busyMs: +(total - idle).toFixed(0), busyPct: +(((total - idle) / total) * 100).toFixed(1) };
};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send; const rawEv = c.ev;
  const ev = (e) => Promise.race([rawEv(e), new Promise((r) => setTimeout(() => r({ __timeout: true }), 10000))]);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  const waitReady = async () => { for (let i = 0; i < 600; i++) { if (await ev("!!(window.__perf && window.__perf.firstDrawAt)")) return; await sleep(30); } };
  const goto = async (w, h, dpr) => {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr, mobile: true });
    await send("Page.navigate", { url: URL });
    await waitReady(); await sleep(1200);
  };
  // DPR 影响：每次改 DPR 后重新加载，确保 fit() 按新 DPR 设定画布
  for (const dpr of [3, 2, 1]) {
    await goto(390, 844, dpr);
    await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 200 }); await send("Profiler.start");
    const a = await ev("({draw: __perf.drawCalls, raf: __perf.raf.total, t: performance.now()})");
    await sleep(4000);
    const b = await ev("({draw: __perf.drawCalls, raf: __perf.raf.total, t: performance.now()})");
    const { profile } = await send("Profiler.stop");
    const secs = (b.t - a.t) / 1000;
    out.dpr["dpr" + dpr] = { ...busy(profile), canvas: await ev("({w: document.getElementById('stage').width, h: document.getElementById('stage').height})"), drawCallPerSec: Math.round((b.draw - a.draw) / secs), rafPerSec: +((b.raf - a.raf) / secs).toFixed(1), cssCanvas: await ev("({w: document.getElementById('stage').clientWidth, h: document.getElementById('stage').clientHeight})") };
  }

  // 泄漏复核：预热渲染所有懒加载面板 → GC 基线 → 100 轮开关/切 tab → GC 对比
  await goto(390, 844, 3);
  await send("HeapProfiler.enable");
  for (const btn of ["btn-journal", "btn-team", "btn-arcade"]) { await ev(`document.getElementById('${btn}').click()`); await sleep(400); await ev(`document.getElementById('${btn}').click()`); await sleep(250); }
  const counters = async () => { const { usedSize } = await send("Runtime.getHeapUsage"); return { heapMB: +(usedSize / 1048576).toFixed(2), dom: await send("Memory.getDOMCounters"), ui: await ev("({nodes: document.querySelectorAll('*').length, raf: __perf.raf.active, si: __perf.si.size, st: __perf.st.size})") }; };
  await send("HeapProfiler.collectGarbage"); await sleep(500);
  const before = await counters();
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) {
    await ev(`document.getElementById('btn-journal').click()`); await sleep(20); await ev(`document.getElementById('btn-journal').click()`);
    await ev(`document.getElementById('btn-team').click()`); await ev(`document.getElementById('tab-talents').click()`); await ev(`document.getElementById('tab-decor').click()`); await ev(`document.getElementById('tab-colleagues').click()`); await sleep(20); await ev(`document.getElementById('btn-team').click()`);
    await ev(`document.getElementById('btn-arcade').click()`); await sleep(20); await ev(`document.getElementById('btn-arcade').click()`);
  }
  await sleep(800);
  await send("HeapProfiler.collectGarbage"); await sleep(500);
  const after = await counters();
  out.leak = { before, after, elapsedMs: Date.now() - t0, heapDeltaMB: +(after.heapMB - before.heapMB).toFixed(2), domNodeDelta: after.dom.nodes - before.dom.nodes, listenerDelta: after.dom.jsEventListeners - before.dom.jsEventListeners, nodeDelta: after.ui.nodes - before.ui.nodes };
  out.errors = c.errors.slice(0, 20);
  writeFileSync("playtest/perf-review/out-f-dpr-leak.json", J(out));
  console.log(J(out));
  c.close();
}, { timeoutMs: 240_000 });
