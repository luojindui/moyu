import { runChrome, connect, sleep } from "../lib/chrome.mjs";
import { INSTRUMENT } from "./instrument.mjs";
import { writeFileSync } from "node:fs";

const URL_DEV = "http://127.0.0.1:5173/";
const VIEW = { width: 390, height: 844, dpr: 3 };

function topFns(profile, n = 22) {
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const dt = profile.timeDeltas[i] ?? 0;
    self.set(id, (self.get(id) ?? 0) + dt);
  }
  const rows = [];
  for (const [id, us] of self) {
    const nd = nodes.get(id);
    if (!nd) continue;
    const cf = nd.callFrame;
    if (!cf.functionName && !cf.url) continue;
    rows.push({ fn: cf.functionName || "(anonymous)", url: (cf.url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "") || cf.url, us });
  }
  const agg = new Map();
  for (const r of rows) {
    const k = `${r.fn} @ ${r.url}`;
    agg.set(k, (agg.get(k) ?? 0) + r.us);
  }
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => ({ k, ms: +(us / 1000).toFixed(1) }));
}

async function fgStats(gaps) {
  if (!gaps.length) return null;
  const s = [...gaps].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: gaps.length, avg: +(gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1], over33: gaps.filter((x) => x > 33.4).length, over50: gaps.filter((x) => x > 50).length };
}

const out = { dev: {}, errors: [] };
const log = (m) => process.stderr.write(`[stage] ${m} t=${((Date.now()-T0)/1000).toFixed(1)}s\n`);
const T0 = Date.now();

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send, ev = c.ev;
  log("connected");
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.dpr, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  log("metrics+instrument");

  // ---- 启动计时：navigate → 首绘 / 可交互 ----
  log("navigate");
  const t0 = Date.now();
  await send("Page.navigate", { url: URL_DEV });
  let readyAt = null, moyuAt = null;
  for (let i = 0; i < 600; i++) {
    const r = await ev(`(() => { const P = window.__perf; if (!P) return null; return { draw: P.firstDrawAt, raf: P.firstRafAt, fcp: P.firstContentfulPaint, moyu: !!window.__MOYU__, canvas: !!document.getElementById('stage') }; })()`);
    if (r && r.draw && readyAt === null) readyAt = Date.now() - t0;
    if (r && r.moyu && moyuAt === null) moyuAt = Date.now() - t0;
    if (readyAt !== null && moyuAt !== null) break;
    await sleep(10);
  }
  const navTiming = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; const P = window.__perf; return {
    ttfb: +n.responseStart.toFixed(1), domInteractive: +n.domInteractive.toFixed(1), domContentLoaded: +n.domContentLoadedEventEnd.toFixed(1),
    loadEventEnd: +n.loadEventEnd.toFixed(1), firstRafAt: P.firstRafAt, firstDrawAt: P.firstDrawAt, fcp: P.firstContentfulPaint,
    transfer: n.transferSize, resources: performance.getEntriesByType('resource').length,
    bootToMoyu: window.__MOYU__ ? null : 'n/a',
  }; })()`);
  log("startup done");
  out.dev.startup = { readyAtMs_node: readyAt, moyuReadyMs_node: moyuAt, ...navTiming };
  out.dev.tapsTotal = await ev("window.__probeTaps");

  const snap = async () => ev(`(() => { const P = window.__perf; const M = window.__MOYU__; return { rafTotal: P.raf.total, rafActive: P.raf.active, draw: P.drawCalls, gapsLen: P.frameGaps.length, fps: M ? M.fps : null, frames: M ? M.frames : null, si: P.si.size, st: P.st.size, longtasks: P.longtasks.length, texts: M ? M.fxTexts().length : null, taps: window.__probeTaps }; })()`);
  const phase = async (name, ms, fn) => {
    const a = await snap();
    const gapsA = (await ev("window.__perf.frameGaps.length"));
    if (fn) await fn();
    await sleep(ms);
    const b = await snap();
    const gaps = await ev(`window.__perf.frameGaps.slice(${gapsA})`);
    out.dev[name] = {
      rafPerSec: +(((b.rafTotal - a.rafTotal) / (ms / 1000))).toFixed(1),
      drawPerSec: +(((b.draw - a.draw) / (ms / 1000))).toFixed(1),
      fps: b.fps, appFrames: b.frames, rafActiveEnd: b.rafActive, si: b.si, st: b.st,
      textsEnd: b.texts, taps: b.taps, longtasks: b.longtasks - a.longtasks, frameGaps: await fgStats(gaps),
    };
    return out.dev[name];
  };

  await sleep(1200);
  out.meta = await ev(`({ ua: navigator.userAgent, dpr: devicePixelRatio, canvasW: document.getElementById('stage').width, canvasH: document.getElementById('stage').height, cssW: document.getElementById('stage').clientWidth, cssH: document.getElementById('stage').clientHeight, mem: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null })`);

  // 1) 空闲
  log("phase idle");
  await phase("idle", 5000);
  // 2) 点击 8cps
  const clicker = (cps) => `(() => { if (window.__clicker) clearInterval(window.__clicker); window.__clicker = setInterval(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.55, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); }, ${Math.round(1000 / cps)}); })()`;
  log("phase click8");
  await phase("click8", 5000, async () => ev(clicker(8)));
  log("phase click20");
  await phase("click20", 5000, async () => ev(clicker(20)));
  await ev("(() => { clearInterval(window.__clicker); window.__clicker = null; })()");
  await sleep(800);

  // 3) 面板打开：journal / team / arcade / cards
  const openPanel = (btn) => ev(`document.getElementById('${btn}').click()`);
  const closeEsc = () => ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  log("phase journal");
  await phase("journalOPEN", 4000, () => openPanel("btn-journal"));
  await closeEsc(); await sleep(500);
  log("phase team");
  await phase("teamOPEN", 4000, () => openPanel("btn-team"));
  await closeEsc(); await sleep(500);
  log("phase arcade");
  await phase("arcadeOPEN", 4000, () => openPanel("btn-arcade"));
  await closeEsc(); await sleep(500);

  // 4) CPU 采样：空闲 5s
  const profilePhase = async (name, ms, fn) => {
    await send("Profiler.enable");
    await send("Profiler.setSamplingInterval", { interval: 200 });
    await send("Profiler.start");
    if (fn) await fn();
    await sleep(ms);
    const { profile } = await send("Profiler.stop");
    out.dev[`cpu_${name}`] = topFns(profile);
  };
  log("cpu idle");
  await profilePhase("idle", 5000);
  log("cpu journal");
  await profilePhase("journalOpen", 5000, () => openPanel("btn-journal"));
  await closeEsc(); await sleep(400);
  log("cpu shopDOM");
  await profilePhase("shopDOM", 5000);

  log("minigame");
  // 5) 小游戏期间的 rAF 数量（coffee）
  await openPanel("btn-arcade");
  await sleep(500);
  const before = await snap();
  await ev(`document.querySelector('#arcade-body button[data-game]').click()`);
  await sleep(2500);
  out.dev.minigameCoffee = {
    rafActive: (await snap()).rafActive, elapsed: 2.5,
    rafPerSec: +((( (await snap()).rafTotal - before.rafTotal) / 2.5).toFixed(1)),
  };
  await ev(`document.getElementById('arcade-close').click()`);
  await sleep(300);
  out.dev.afterMinigame = await snap();

  await ev("(() => { window.dispatchEvent(new Event('pagehide')); })()");
  log("done");
  out.errors = c.errors.slice(0, 20);
  writeFileSync("playtest/perf-review/out-a-fps.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  c.close();
}, { timeoutMs: 180_000 });
console.log("NO_CHROME_LEFT", process.argv[2] === "check" ? "" : "");
