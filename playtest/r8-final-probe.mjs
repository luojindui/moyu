/**
 * R8 学生碎片党 · 最终证据探针（CDP，375×667 DPR3 touch，4× CPU 降频）
 *
 * 性能/内存/布局/误触 均在 **dist 静态产物**上做（dev 服务器会被其他 agent 的 HMR 重载污染，
 * 且学生拿到的是 dist），dev 只测首屏请求数/字节做对照。
 *
 *  - 4G(70ms/10Mbps) 冷/热缓存首屏：请求数、字节、DCL/FCP/boot
 *  - 60 秒静置采样：__MOYU__.fps、rAF 回调 CPU、帧间隔、JS 堆、Performance.getMetrics、长任务
 *  - 结束后 HeapProfiler.collectGarbage 看保留堆（判断是否内存泄漏）
 *  - 375×667 布局：溢出/HUD 截断/📔 热区与单手可达/卡片与字号/日报面板
 *  - 误触：画布横滑、商店横滑、遮罩期间 rAF 是否继续
 *  - PWA：SW 注册 + 断网重载
 *
 * 只读 src/。输出 playtest/r8-final.json + playtest/r8-shots/*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.R8_CDP_PORT3 || 9900 + (process.pid % 80));
const DEV_URL = "http://127.0.0.1:5173/";
const DIST_URL = "http://127.0.0.1:4189/";
const SHOTS = "playtest/r8-shots";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SHOTS, { recursive: true });

const proc = spawn(
  CHROME,
  [
    "--headless=new",
    "--no-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    `--window-size=390,844`,
    `--user-data-dir=/tmp/chrome-r8-final-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let chromeErr = "";
proc.stderr.on("data", (d) => (chromeErr += d.toString()));

async function waitJson(path, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(100);
  }
  throw new Error("CDP not ready\n" + chromeErr.slice(-600));
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await Promise.race([
      this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("evaluate timeout")), 5000)),
    ]);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  }
  on(fn) {
    this.handlers.push(fn);
  }
  async close() {
    try {
      await this.send("Page.close");
    } catch {}
    try {
      this.ws.close();
    } catch {}
  }
}

async function openPage() {
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  return new CDP(ws);
}

const PROBE_INJECT = `(() => {
  const P = window.__P__ = { n: 0, sum: 0, max: 0, gapSum: 0, gapN: 0, gapMax: 0, longtasks: [], last: 0 };
  const orig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return orig(function (t) {
      const a = performance.now();
      try { cb(t); } finally {
        const d = performance.now() - a;
        P.n++; P.sum += d; if (d > P.max) P.max = d;
        if (P.last) { const g = t - P.last; P.gapSum += g; P.gapN++; if (g > P.gapMax) P.gapMax = g; }
        P.last = t;
      }
    });
  };
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) P.longtasks.push({ start: +e.startTime.toFixed(0), dur: +e.duration.toFixed(0) }); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
  P.drain = () => { const r = { frames: P.n, avgCbMs: P.n ? P.sum / P.n : 0, maxCbMs: P.max, frameGapAvgMs: P.gapN ? P.gapSum / P.gapN : 0, frameGapMaxMs: P.gapMax, longtasks: P.longtasks.slice() }; P.n=0;P.sum=0;P.max=0;P.gapSum=0;P.gapN=0;P.gapMax=0;P.longtasks=[]; return r; };
})();`;

const MARKET = `(() => {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1) }; };
  const fs = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
  const lines = (el) => { if (!el) return 0; const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; };
  const cards = [...document.querySelectorAll('.shop-card')];
  const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => ({ id: b.id || b.dataset.upgrade, ...rect(b) }));
  const journalBtn = q('#btn-journal');
  const jr = rect(journalBtn);
  const thumb = { x: innerWidth * 0.85, y: innerHeight * 0.82 };
  const distToThumb = jr ? +Math.hypot(jr.x + jr.w / 2 - thumb.x, jr.y + jr.h / 2 - thumb.y).toFixed(0) : null;
  const textEls = [...document.querySelectorAll('#app *, #journal *')].filter((e) => e.childElementCount === 0 && e.textContent.trim() && e.offsetParent !== null);
  const smallText = textEls.map((e) => ({ sel: e.id ? '#' + e.id : '.' + String(e.className || e.tagName).slice(0, 22), fs: fs(e), text: e.textContent.trim().slice(0, 20) })).filter((x) => x.fs !== null && x.fs < 12);
  const overflow = [];
  for (const el of document.querySelectorAll('#app *')) {
    const r = el.getBoundingClientRect();
    const inScroller = el.closest('#shop-cards') || el.closest('.journal-panel');
    if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5) && !inScroller) overflow.push({ el: el.id ? '#' + el.id : '.' + String(el.className).slice(0, 24), right: +r.right.toFixed(1), left: +r.left.toFixed(1) });
  }
  const hud = q('#hud');
  const hudSub = hud && hud.querySelector('.hud-sub');
  const stage = q('#stage');
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    doc: { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, clientW: document.documentElement.clientWidth, clientH: document.documentElement.clientHeight },
    overflow: overflow.slice(0, 10),
    hud: { rect: rect(hud), subScrollW: hudSub ? hudSub.scrollWidth : null, subClientW: hudSub ? hudSub.clientWidth : null, rank: rect(q('#hud-rank')), rankText: q('#hud-rank')?.textContent, rankLines: lines(q('#hud-rank')) },
    quest: { hidden: q('#quest')?.classList.contains('hidden'), rect: rect(q('#quest')), text: q('#quest-text')?.textContent },
    canvas: { rect: rect(stage), attrW: stage?.width, attrH: stage?.height, pixels: stage ? stage.width * stage.height : null },
    shop: { rect: rect(q('#shop')), cards: cards.length, card0: rect(cards[0]), scrollW: q('#shop-cards')?.scrollWidth, clientW: q('#shop-cards')?.clientWidth, visibleFullCards: cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5; }).length, fonts: { tag: fs(q('.shop-tag')), name: fs(q('.shop-name')), next: fs(q('.shop-next')), cost: fs(q('.shop-cost')), remain: fs(q('.shop-remain')), hint: fs(q('#shop-hint')) } },
    journalBtn: { rect: jr, distToThumb, hotArea: jr ? { w: +(jr.w + 6).toFixed(1), h: +(jr.h + 18).toFixed(1) } : null, meets44: jr ? jr.w + 6 >= 44 && jr.h + 18 >= 44 : null },
    journalPanel: q('#journal') && !q('#journal').classList.contains('hidden') ? { rect: rect(q('.journal-panel')), scrollH: q('.journal-panel')?.scrollHeight, clientH: q('.journal-panel')?.clientHeight, claimVisible: (() => { const c = q('#journal-claim'); if (!c) return null; const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })() } : { hidden: true },
    buttons: btns,
    smallTextCount: smallText.length,
    smallText: smallText.slice(0, 12),
    state: window.__MOYU__ ? { moyu: window.__MOYU__.state.moyu, totalClicks: window.__MOYU__.state.totalClicks, levels: Object.keys(window.__MOYU__.state.levels).length, daily: window.__MOYU__.state.daily } : null,
    fps: window.__MOYU__?.fps ?? null,
    frames: window.__MOYU__?.frames ?? null,
    spriteAssets: window.__MOYU__?.assets ?? null,
    bootError: !!document.querySelector('.boot-error'),
    welcomeHidden: q('#welcome')?.classList.contains('hidden'),
  };
})()`;

function wireNetwork(cdp) {
  const reqs = new Map();
  cdp.on((msg) => {
    if (msg.method === "Network.requestWillBeSent") reqs.set(msg.params.requestId, { url: msg.params.request.url, type: msg.params.type, bytes: 0, status: null, cached: false });
    else if (msg.method === "Network.responseReceived") {
      const r = reqs.get(msg.params.requestId);
      if (r) {
        r.status = msg.params.response.status;
        r.cached = !!(msg.params.response.fromDiskCache || msg.params.response.fromMemoryCache);
      }
    } else if (msg.method === "Network.loadingFinished") {
      const r = reqs.get(msg.params.requestId);
      if (r) r.bytes = msg.params.encodedDataLength;
    } else if (msg.method === "Network.loadingFailed") {
      const r = reqs.get(msg.params.requestId);
      if (r) r.failed = msg.params.errorText;
    }
  });
  return reqs;
}

function summarize(reqs) {
  const list = [...reqs.values()].filter((r) => r.type !== "WebSocket");
  const byType = {};
  let total = 0;
  let cached = 0;
  for (const r of list) {
    byType[r.type] = byType[r.type] || { n: 0, bytes: 0 };
    byType[r.type].n++;
    byType[r.type].bytes += r.bytes || 0;
    total += r.bytes || 0;
    if (r.cached) cached++;
  }
  return { count: list.length, totalBytes: total, cachedCount: cached, byType, failed: list.filter((r) => r.failed).length };
}

async function setup(cdp, width = 375, height = 667) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 3, mobile: true, screenWidth: width, screenHeight: height });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.R8_CPU_THROTTLE || 4) });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE_INJECT });
}

async function setNet(cdp, mode) {
  if (mode === "4g") await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 70, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
  else if (mode === "offline") await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  else await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
}

async function waitBoot(cdp, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await cdp.evaluate("({ rs: document.readyState, moyu: typeof window.__MOYU__, href: location.href, bootErr: !!document.querySelector('.boot-error') })");
      if (v && v.moyu === "object") return Date.now() - t0;
      if (v && v.rs === "complete" && v.bootErr) throw new Error("boot error banner: " + JSON.stringify(v));
    } catch (e) {
      if (String(e).includes("boot error banner")) throw e;
    }
    await sleep(100);
  }
  throw new Error("boot timeout: " + JSON.stringify(await cdp.evaluate("({ rs: document.readyState, moyu: typeof window.__MOYU__, href: location.href })").catch((e) => String(e))));
}

async function navInfo(cdp) {
  return cdp.evaluate("(() => { const t = performance.timing; return { dcl: t.domContentLoadedEventEnd - t.navigationStart, load: t.loadEventEnd ? t.loadEventEnd - t.navigationStart : null, fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime ?? null, respEnd: t.responseEnd - t.navigationStart }; })()");
}

async function loadOnce(cdp, url, mode, cacheDisabled) {
  await setNet(cdp, mode);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled });
  const t0 = Date.now();
  await cdp.send("Page.navigate", { url });
  const bootMs = await waitBoot(cdp).catch((e) => ({ error: String(e) }));
  const wallMs = Date.now() - t0;
  await sleep(2500);
  return { bootMs, wallMs };
}

function pageMetrics(metrics) {
  return Object.fromEntries(metrics.metrics.map((x) => [x.name, x.value]));
}

async function samplePerf(cdp, seconds = 60) {
  const samples = [];
  let prev = pageMetrics(await cdp.send("Performance.getMetrics"));
  await cdp.evaluate("window.__P__ && __P__.drain()");
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const probe = await cdp.evaluate("window.__P__ ? __P__.drain() : null");
    const m = pageMetrics(await cdp.send("Performance.getMetrics"));
    const hud = await cdp.evaluate("({ fps: window.__MOYU__?.fps ?? null, frames: window.__MOYU__?.frames ?? null, heap: performance.memory?.usedJSHeapSize ?? null, moyu: window.__MOYU__?.state.moyu ?? null })");
    samples.push({
      t: i + 1,
      fps: hud.fps,
      frames: hud.frames,
      heap: m.JSHeapUsedSize,
      heapTotal: m.JSHeapTotalSize,
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      docs: m.Documents,
      task: m.TaskDuration - (prev.TaskDuration ?? 0),
      script: m.ScriptDuration - (prev.ScriptDuration ?? 0),
      layout: m.LayoutDuration - (prev.LayoutDuration ?? 0),
      recalc: m.RecalcStyleDuration - (prev.RecalcStyleDuration ?? 0),
      probe,
      moyu: hud.moyu,
    });
    prev = m;
  }
  return samples;
}

function analyze(samples) {
  const nums = (f) => samples.map(f).filter((x) => typeof x === "number" && Number.isFinite(x));
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const avg = (a) => (a.length ? sum(a) / a.length : null);
  const fps = nums((s) => s.fps);
  const heap = nums((s) => s.heap);
  const cb = nums((s) => s.probe?.avgCbMs);
  const gap = nums((s) => s.probe?.frameGapAvgMs);
  const task = nums((s) => s.task);
  const script = nums((s) => s.script);
  const longtasks = samples.flatMap((s) => (s.probe?.longtasks ?? []).map((l) => ({ ...l, at: s.t })));
  const reloads = samples.filter((s, i) => i > 0 && s.frames < samples[i - 1].frames).length;
  return {
    seconds: samples.length,
    reloadsDetected: reloads,
    fps: { avg: avg(fps), min: fps.length ? Math.min(...fps) : null, max: fps.length ? Math.max(...fps) : null, below50: fps.filter((v) => v < 50).length, drops: fps.filter((v) => v < 55).length },
    heap: { first: heap[0], mid10s: heap[9], last: heap[heap.length - 1], max: heap.length ? Math.max(...heap) : null, growthFrom10sTo60s: heap.length >= 10 ? heap[heap.length - 1] - heap[9] : null },
    nodes: { first: samples[0].nodes, last: samples[samples.length - 1].nodes },
    listeners: { first: samples[0].listeners, last: samples[samples.length - 1].listeners },
    frameCpu: { avgCbMs: avg(cb), maxCbMs: cb.length ? Math.max(...cb) : null, avgFrameGapMs: avg(gap), maxFrameGapMs: Math.max(...samples.map((s) => s.probe?.frameGapMaxMs ?? 0)) },
    cpu: { taskPerSec: avg(task), scriptPerSec: avg(script), taskPctOfCore: avg(task) != null ? avg(task) * 100 : null, scriptPctOfCore: avg(script) != null ? avg(script) * 100 : null },
    longtasks: { count: longtasks.length, totalMs: sum(longtasks.map((l) => l.dur)), maxMs: longtasks.length ? Math.max(...longtasks.map((l) => l.dur)) : 0, list: longtasks.slice(0, 8) },
  };
}

async function touch(cdp, type, pts) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
}
async function tapAt(cdp, x, y) {
  await touch(cdp, "touchStart", [{ x, y }]);
  await sleep(30);
  await touch(cdp, "touchEnd", []);
  await sleep(80);
}
async function swipe(cdp, x1, y1, x2, y2, steps = 10) {
  await touch(cdp, "touchStart", [{ x: x1, y: y1 }]);
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x1 + ((x2 - x1) * i) / steps, y: y1 + ((y2 - y1) * i) / steps }] });
    await sleep(16);
  }
  await touch(cdp, "touchEnd", []);
  await sleep(250);
}
async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}`, Buffer.from(r.data, "base64"));
}

const run = async () => {
  await waitJson("/json/version");
  const out = {
    meta: {
      generatedAt: new Date().toISOString(),
      revision: process.env.R8_REV || null,
      dirtySrc: process.env.R8_DIRTY || null,
      distBundle: process.env.R8_DIST || null,
      viewport: "375x667 DPR3 touch",
      cpuThrottle: Number(process.env.R8_CPU_THROTTLE || 4),
      network: "4G 70ms/10Mbps (冷/热缓存各一次)",
    },
  };

  // ========== A. dist 首屏（4G 冷缓存 + 热缓存） ==========
  const cdp = await openPage();
  await setup(cdp);
  const net = wireNetwork(cdp);
  out.distLoad = await loadOnce(cdp, DIST_URL, "4g", true);
  out.distLoad.nav = await navInfo(cdp);
  out.distLoad.cold = summarize(net);
  await shot(cdp, "r8-dist-first-run-375x667.png");

  net.clear();
  await setNet(cdp, "4g");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.send("Page.reload");
  const warmBoot = await waitBoot(cdp).catch((e) => ({ error: String(e) }));
  await sleep(2000);
  out.distLoad.warm = { ...summarize(net), bootMs: warmBoot };

  // 回到在线、无缓存禁用，等干净状态
  await setNet(cdp, "online");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.send("Page.reload");
  await waitBoot(cdp).catch(() => {});
  await sleep(2500);

  // ========== B. 布局 / 单手可达 / 误触 ==========
  out.layout = await cdp.evaluate(MARKET);
  await shot(cdp, "r8-dist-layout-375x667.png");

  const stage = out.layout.canvas.rect;
  const cx = Math.round(stage.x + stage.w / 2);
  const cy = Math.round(stage.y + stage.h / 2);
  const mis = {};
  const c0 = await cdp.evaluate("window.__MOYU__.state.totalClicks");
  for (let i = 0; i < 25; i++) await tapAt(cdp, cx, cy - 40 + (i % 5) * 12);
  mis.tap25 = { before: c0, after: await cdp.evaluate("window.__MOYU__.state.totalClicks"), expected: 25 };
  const c1 = await cdp.evaluate("window.__MOYU__.state.totalClicks");
  await swipe(cdp, cx - 60, cy, cx + 60, cy);
  const c2 = await cdp.evaluate("window.__MOYU__.state.totalClicks");
  mis.canvasSwipe = { before: c1, after: c2, delta: c2 - c1, note: "画布上横向拖动也会记 1 次点击（pointerdown 判定）" };
  const shop = out.layout.shop.rect;
  const shopY = Math.round(shop.y + shop.h / 2);
  const s0 = await cdp.evaluate("({ scrollLeft: document.getElementById('shop-cards').scrollLeft, levels: window.__MOYU__.state.levels, clicks: window.__MOYU__.state.totalClicks })");
  await swipe(cdp, 330, shopY, 60, shopY, 12);
  const s1 = await cdp.evaluate("({ scrollLeft: document.getElementById('shop-cards').scrollLeft, levels: window.__MOYU__.state.levels, clicks: window.__MOYU__.state.totalClicks })");
  mis.shopSwipe = { scrollBefore: s0.scrollLeft, scrollAfter: s1.scrollLeft, scrolled: s1.scrollLeft !== s0.scrollLeft, levelsChanged: JSON.stringify(s0.levels) !== JSON.stringify(s1.levels), clicksDelta: s1.clicks - s0.clicks };
  // 商店卡片真点：买一张能买的（若有）
  const buy = await cdp.evaluate(`(() => {
    const card = document.querySelector('.shop-card.affordable:not([disabled])');
    if (!card) return { bought: false, reason: '当前无买得起的卡' };
    const r = card.getBoundingClientRect();
    return { bought: true, x: r.x + r.width / 2, y: r.y + r.height / 2, id: card.dataset.upgrade };
  })()`);
  if (buy.bought) {
    await tapAt(cdp, Math.round(buy.x), Math.round(buy.y));
    mis.buyTap = { id: buy.id, bought: await cdp.evaluate(`!!window.__MOYU__.state.levels['${buy.id}']`) };
  } else mis.buyTap = buy;
  out.misTouch = mis;

  // 日报面板 + 遮罩期间 rAF
  const jr = out.layout.journalBtn.rect;
  const f0 = await cdp.evaluate("window.__MOYU__.frames");
  await tapAt(cdp, Math.round(jr.x + jr.w / 2), Math.round(jr.y + jr.h / 2));
  await sleep(500);
  out.journalOpen = await cdp.evaluate(MARKET);
  await shot(cdp, "r8-dist-journal-375x667.png");
  await sleep(2500);
  const f1 = await cdp.evaluate("window.__MOYU__.frames");
  out.modalRaf = { framesDuringOpen: f1 - f0, note: "遮罩打开期间 rAF 未暂停" };
  const closeR = await cdp.evaluate("(() => { const r = document.getElementById('journal-close').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()");
  await tapAt(cdp, Math.round(closeR.x), Math.round(closeR.y));
  await sleep(300);
  out.journalClosed = await cdp.evaluate("document.getElementById('journal').classList.contains('hidden')");

  // ========== C. 60 秒性能采样（静置） ==========
  out.perf60 = analyze(await samplePerf(cdp, 60));
  // GC 后保留堆
  const beforeGc = pageMetrics(await cdp.send("Performance.getMetrics"));
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(800);
  const afterGc = pageMetrics(await cdp.send("Performance.getMetrics"));
  out.heapAfterGc = { beforeGc: beforeGc.JSHeapUsedSize, afterGc: afterGc.JSHeapUsedSize, nodes: afterGc.Nodes, listeners: afterGc.JSEventListeners };
  await shot(cdp, "r8-dist-after-60s.png");

  // ========== D. PWA ==========
  out.pwa = await cdp.evaluate(
    "navigator.serviceWorker.getRegistrations().then(rs => ({ supported: 'serviceWorker' in navigator, registrations: rs.length, controller: !!navigator.serviceWorker.controller, manifest: document.querySelector('link[rel=manifest]')?.href ?? null, display: getComputedStyle(document.documentElement).getPropertyValue('color-scheme').trim() }))",
  );
  await setNet(cdp, "offline");
  await cdp.send("Page.reload", { ignoreCache: true });
  await sleep(4000);
  out.pwa.offlineReload = await cdp.evaluate("({ url: location.href, title: document.title, hasApp: !!document.getElementById('app'), hasMoyu: !!window.__MOYU__, text: (document.body?.innerText || '').slice(0, 100) })").catch((e) => ({ error: String(e) }));
  await setNet(cdp, "online");
  await cdp.close();

  // ========== E. dev 首屏请求数/字节（对照，不做性能判断） ==========
  const dev = await openPage();
  await setup(dev);
  const devNet = wireNetwork(dev);
  try {
    await loadOnce(dev, DEV_URL, "4g", true);
  } catch (e) {
    out.devLoadError = String(e).slice(0, 300);
  }
  out.devLoad = { cold: summarize(devNet), nav: await navInfo(dev).catch(() => null) };
  devNet.clear();
  await setNet(dev, "4g");
  await dev.send("Network.setCacheDisabled", { cacheDisabled: false });
  await dev.send("Page.reload");
  await waitBoot(dev).catch(() => {});
  await sleep(1500);
  out.devLoad.warm = summarize(devNet);
  out.devLoad.note = "dev 服务器会被其他 agent 的 HMR 重载污染，只用于请求数/字节对照；学生拿到的是 dist。";
  await dev.close();

  writeFileSync("playtest/r8-final.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify({
    meta: out.meta,
    distLoad: out.distLoad,
    devLoad: out.devLoad,
    perf60: out.perf60,
    heapAfterGc: out.heapAfterGc,
    layout: { viewport: out.layout.viewport, doc: out.layout.doc, overflow: out.layout.overflow, hud: out.layout.hud, quest: out.layout.quest, canvas: out.layout.canvas, shop: out.layout.shop, journalBtn: out.layout.journalBtn, smallTextCount: out.layout.smallTextCount, smallText: out.layout.smallText, welcomeHidden: out.layout.welcomeHidden },
    journalPanel: out.journalOpen?.journalPanel,
    misTouch: out.misTouch,
    modalRaf: out.modalRaf,
    pwa: out.pwa,
  }, null, 1));
  proc.kill();
  process.exit(0);
};

run().catch((e) => {
  console.error("[r8-final] FAILED", e);
  proc.kill();
  process.exit(1);
});
