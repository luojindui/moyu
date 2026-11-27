/**
 * R8 学生碎片党 · 手机真实浏览器探针（CDP）
 *  - 375×667 DPR3 touch + 4× CPU 降频（近似中低端安卓/老 iPhone）
 *  - 60 秒采样：`__MOYU__.fps`、rAF 回调 CPU、帧间隔、JS 堆、TaskDuration/长任务
 *  - 首屏网络：dev(5173) 与 dist(4189) 的请求数 / 传输字节 / DOMContentLoaded
 *  - 布局：横向溢出、HUD 截断、📔 可达性、卡片/文字尺寸、日报面板是否装得下
 *  - 误触：画布横滑是否算点击、商店横滑是否误购、遮罩打开后 rAF 是否继续
 *  - PWA：serviceWorker 注册情况 + 断网重载是否可用
 *
 * 只读 src/，不修改游戏文件。输出 playtest/r8-perf.json + playtest/r8-shots/*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.R8_CDP_PORT || 9777);
const DEV_URL = "http://127.0.0.1:5173/";
const DIST_URL = "http://127.0.0.1:4189/";
const OUT = "playtest/r8-perf.json";
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
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-features=CalculateNativeWinOcclusion",
    `--window-size=390,844`,
    `--user-data-dir=/tmp/chrome-r8-${Date.now()}`,
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
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error(`CDP not ready: ${path}\n${chromeErr.slice(-800)}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.handlers = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("evaluate: " + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  }
  on(fn) {
    this.handlers.push(fn);
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
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) P.longtasks.push({ start: e.startTime, dur: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}
  P.drain = () => {
    const r = { frames: P.n, avgCbMs: P.n ? P.sum / P.n : 0, maxCbMs: P.max, frameGapAvgMs: P.gapN ? P.gapSum / P.gapN : 0, frameGapMaxMs: P.gapMax, longtasks: P.longtasks.slice() };
    P.n = 0; P.sum = 0; P.max = 0; P.gapSum = 0; P.gapN = 0; P.gapMax = 0; P.longtasks = [];
    return r;
  };
})();`;

const MARKET = `(() => {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1) }; };
  const fs = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : null;
  const cfg = (el) => el ? { fs: fs(el), lh: getComputedStyle(el).lineHeight, color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor } : null;
  const cards = [...document.querySelectorAll('.shop-card')];
  const visibleCards = cards.filter((c) => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }).length;
  const btns = [...document.querySelectorAll('button, [role=button]')].map((b) => ({ id: b.id || b.dataset.upgrade || b.className.slice(0,20), ...rect(b) }));
  const smallBtns = btns.filter((b) => b.w < 44 || b.h < 44);
  const journalBtn = q('#btn-journal');
  const jr = rect(journalBtn);
  // 右手拇指可达性：以右下角拇指枢轴 (0.85W, 0.82H) 为中心量距离
  const thumb = { x: innerWidth * 0.85, y: innerHeight * 0.82 };
  const distToThumb = jr ? Math.hypot(jr.x + jr.w / 2 - thumb.x, jr.y + jr.h / 2 - thumb.y) : null;
  const textNodes = [...document.querySelectorAll('#app *')].filter((e) => e.childElementCount === 0 && e.textContent.trim()).map((e) => ({ sel: e.id ? '#'+e.id : '.'+(e.className||e.tagName).toString().slice(0,18), fs: fs(e), text: e.textContent.trim().slice(0, 22) }));
  const smallText = textNodes.filter((t) => t.fs !== null && t.fs < 12);
  const doc = { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight, bodyScrollW: document.body.scrollWidth, clientW: document.documentElement.clientWidth, clientH: document.documentElement.clientHeight };
  const overflow = [];
  for (const el of document.querySelectorAll('#app *')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5)) overflow.push({ el: el.id ? '#'+el.id : '.'+String(el.className).slice(0,20), right: +r.right.toFixed(1), left: +r.left.toFixed(1) });
  }
  // 水平滚动容器内部元素会有 right > viewport，属正常；只报非滚动容器的溢出
  const abnormalOverflow = overflow.filter((o) => !o.el.includes('shop-card'));
  const hud = q('#hud');
  const hudSub = hud && hud.querySelector('.hud-sub');
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio, visualH: window.visualViewport ? +window.visualViewport.height.toFixed(1) : null },
    doc,
    abnormalOverflow: abnormalOverflow.slice(0, 12),
    hud: { rect: rect(hud), subScrollW: hudSub ? hudSub.scrollWidth : null, subClientW: hudSub ? hudSub.clientWidth : null, subOverflow: hudSub ? hudSub.scrollWidth - hudSub.clientWidth : null, rank: rect(q('#hud-rank')), rankText: q('#hud-rank')?.textContent, rankLines: (() => { const el=q('#hud-rank'); if(!el) return 0; const r=document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; })(), streak: rect(q('#hud-streak')), click: fs(q('#hud-click')), idle: fs(q('#hud-idle')) },
    quest: { hidden: q('#quest')?.classList.contains('hidden'), rect: rect(q('#quest')), text: q('#quest-text')?.textContent },
    canvas: { rect: rect(q('#stage')), attrW: q('#stage')?.width, attrH: q('#stage')?.height },
    shop: { rect: rect(q('#shop')), cards: cards.length, visibleCards, card0: rect(cards[0]), cardW: cards[0] ? +cards[0].getBoundingClientRect().width.toFixed(1) : null, cardH: cards[0] ? +cards[0].getBoundingClientRect().height.toFixed(1) : null, scrollW: q('#shop-cards')?.scrollWidth, clientW: q('#shop-cards')?.clientWidth, hint: rect(q('#shop-hint')), tagFs: fs(q('.shop-tag')), nameFs: fs(q('.shop-name')), nextFs: fs(q('.shop-next')), costFs: fs(q('.shop-cost')), remainFs: fs(q('.shop-remain')) },
    journalBtn: { rect: jr, distToThumb, pseudoHotArea: jr ? { w: +(jr.w + 6).toFixed(1), h: +(jr.h + 18).toFixed(1) } : null, className: journalBtn?.className, hit: jr ? (jr.w + 6) >= 44 && (jr.h + 18) >= 44 : null },
    journalPanel: q('#journal') && !q('#journal').classList.contains('hidden') ? { rect: rect(q('.journal-panel')), scrollH: q('.journal-panel')?.scrollHeight, clientH: q('.journal-panel')?.clientHeight, claimVisible: (() => { const c=q('#journal-claim'); if(!c) return null; const r=c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })() } : { hidden: true, rect: rect(q('.journal-panel')) },
    welcomePanel: q('#welcome') && !q('#welcome').classList.contains('hidden') ? { rect: rect(q('.welcome-panel')) } : { hidden: true },
    smallBtns,
    smallTextCount: smallText.length,
    smallestText: smallText.slice(0, 10),
    fonts: { hudMoyu: cfg(q('#hud-moyu')), questText: cfg(q('#quest-text')), goalDesc: cfg(q('.goal-desc')), claim: cfg(q('#journal-claim')) },
    state: window.__MOYU__ ? { moyu: window.__MOYU__.state.moyu, totalClicks: window.__MOYU__.state.totalClicks, totalEarned: window.__MOYU__.state.totalEarned, levelCount: Object.keys(window.__MOYU__.state.levels).length } : null,
    fps: window.__MOYU__ ? window.__MOYU__.fps : null,
    frames: window.__MOYU__ ? window.__MOYU__.frames : null,
    assets: window.__MOYU__ ? window.__MOYU__.assets : null,
    bootError: !!document.querySelector('.boot-error'),
    sw: { supported: 'serviceWorker' in navigator, controller: !!navigator.serviceWorker?.controller },
  };
})()`;

function pageMetrics(metrics) {
  const m = {};
  for (const x of metrics.metrics) m[x.name] = x.value;
  return m;
}

async function waitBoot(cdp, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await cdp.evaluate("!!window.__MOYU__");
      if (ok) return Date.now() - t0;
    } catch {
      /* page may be navigating */
    }
    await sleep(100);
  }
  return -1;
}

function wireNetwork(cdp) {
  const reqs = new Map();
  cdp.on((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      reqs.set(msg.params.requestId, { url: msg.params.request.url, type: msg.params.type, bytes: 0, status: null, t: msg.params.timestamp });
    } else if (msg.method === "Network.responseReceived") {
      const r = reqs.get(msg.params.requestId);
      if (r) r.status = msg.params.response.status;
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

function summarizeRequests(reqs) {
  const list = [...reqs.values()];
  const byType = {};
  let total = 0;
  for (const r of list) {
    if (r.type === "WebSocket") continue;
    byType[r.type] = byType[r.type] || { n: 0, bytes: 0 };
    byType[r.type].n++;
    byType[r.type].bytes += r.bytes || 0;
    total += r.bytes || 0;
  }
  const resources = list
    .filter((r) => r.type !== "WebSocket")
    .map((r) => ({ url: r.url.replace(/^https?:\/\/[^/]+/, ""), type: r.type, bytes: r.bytes, status: r.status }))
    .sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  return { count: list.filter((r) => r.type !== "WebSocket").length, totalBytes: total, byType, resources: resources.slice(0, 30) };
}

async function samplePerf(cdp, seconds = 60) {
  const samples = [];
  let prev = await cdp.send("Performance.getMetrics").then(pageMetrics);
  let prevProbeDrain = await cdp.evaluate("window.__P__ ? __P__.drain() : null");
  for (let i = 0; i < seconds; i++) {
    await sleep(1000);
    const probe = await cdp.evaluate("(() => { if (!window.__P__) return null; const d = __P__.drain(); return d; })()");
    const m = await cdp.send("Performance.getMetrics").then(pageMetrics);
    const hud = await cdp.evaluate(
      "(() => ({ fps: window.__MOYU__?.fps ?? null, frames: window.__MOYU__?.frames ?? null, heap: performance.memory?.usedJSHeapSize ?? null, heapTotal: performance.memory?.totalJSHeapSize ?? null, levels: Object.keys(window.__MOYU__?.state.levels ?? {}).length, moyu: window.__MOYU__?.state.moyu ?? null }))()",
    );
    const cpu = {
      task: m.TaskDuration - (prev.TaskDuration ?? 0),
      script: m.ScriptDuration - (prev.ScriptDuration ?? 0),
      layout: m.LayoutDuration - (prev.LayoutDuration ?? 0),
      recalc: m.RecalcStyleDuration - (prev.RecalcStyleDuration ?? 0),
      heap: m.JSHeapUsedSize,
      heapTotal: m.JSHeapTotalSize,
      nodes: m.Nodes,
      documents: m.Documents,
      listeners: m.JSEventListeners,
    };
    samples.push({ t: i + 1, fps: hud.fps, framesTotal: hud.frames, heap: cpu.heap, heapTotal: cpu.heapTotal, nodes: cpu.nodes, listeners: cpu.listeners, cpu, probe, moyu: hud.moyu });
    prev = m;
  }
  return samples;
}

function analyzePerf(samples) {
  const fpsArr = samples.map((s) => s.fps).filter((v) => typeof v === "number" && v > 0);
  const heapArr = samples.map((s) => s.heap).filter((v) => typeof v === "number");
  const cbArr = samples.map((s) => s.probe?.avgCbMs).filter((v) => typeof v === "number");
  const gapArr = samples.map((s) => s.probe?.frameGapAvgMs).filter((v) => typeof v === "number");
  const taskArr = samples.map((s) => s.cpu?.task).filter((v) => typeof v === "number");
  const scriptArr = samples.map((s) => s.cpu?.script).filter((v) => typeof v === "number");
  const longtasks = samples.flatMap((s, i) => (s.probe?.longtasks ?? []).map((l) => ({ ...l, atSec: i + 1 })));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const max = (a) => (a.length ? Math.max(...a) : null);
  const min = (a) => (a.length ? Math.min(...a) : null);
  const drops = samples.filter((s) => typeof s.fps === "number" && s.fps > 0 && s.fps < 50).length;
  const heapFirst = heapArr[0];
  const heapLast = heapArr[heapArr.length - 1];
  return {
    seconds: samples.length,
    fps: { avg: avg(fpsArr), min: min(fpsArr), max: max(fpsArr), below50: drops, samples: fpsArr },
    heap: { first: heapFirst, last: heapLast, max: max(heapArr), growthBytes: heapFirst != null && heapLast != null ? heapLast - heapFirst : null, growthPct: heapFirst ? ((heapLast - heapFirst) / heapFirst) * 100 : null },
    nodes: { first: samples[0]?.nodes, last: samples[samples.length - 1]?.nodes },
    listeners: { first: samples[0]?.listeners, last: samples[samples.length - 1]?.listeners },
    frameCpu: { avgCbMs: avg(cbArr), maxCbMs: max(cbArr), avgFrameGapMs: avg(gapArr), maxFrameGapMs: max(samples.map((s) => s.probe?.frameGapMaxMs ?? 0)) },
    cpu: {
      taskDurationPerSec: avg(taskArr),
      scriptDurationPerSec: avg(scriptArr),
      cpuPercentOfOneCore: avg(taskArr) != null ? avg(taskArr) * 100 : null,
      scriptPercentOfOneCore: avg(scriptArr) != null ? avg(scriptArr) * 100 : null,
    },
    longtasks: { count: longtasks.length, totalMs: longtasks.reduce((a, b) => a + b.dur, 0), maxMs: max(longtasks.map((l) => l.dur)), list: longtasks.slice(0, 10) },
  };
}

async function touch(cdp, type, points) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: p.x, y: p.y })) });
}

async function tapAt(cdp, x, y) {
  await touch(cdp, "touchStart", [{ x, y }]);
  await sleep(30);
  await touch(cdp, "touchEnd", []);
  await sleep(80);
}

async function swipe(cdp, x1, y1, x2, y2, steps = 8) {
  await touch(cdp, "touchStart", [{ x: x1, y: y1 }]);
  for (let i = 1; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await sleep(16);
  }
  await touch(cdp, "touchEnd", []);
  await sleep(150);
}

async function newMobilePage(width, height) {
  const cdp = await openPage();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.R8_CPU_THROTTLE || 4) });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE_INJECT });
  return cdp;
}

async function measureLoad(cdp, url, network) {
  const t0 = Date.now();
  const reqs = wireNetwork(cdp);
  await cdp.send("Page.navigate", { url });
  const bootMs = await waitBoot(cdp);
  const readyMs = Date.now() - t0;
  await sleep(2500); // 资产/图片/后续请求收尾
  const nav = await cdp.evaluate(
    "(() => { const t = performance.timing; return { dcl: t.domContentLoadedEventEnd - t.navigationStart, load: t.loadEventEnd ? t.loadEventEnd - t.navigationStart : null, fcp: (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime ?? null, respEnd: t.responseEnd - t.navigationStart }; })()",
  );
  const net = summarizeRequests(reqs);
  return { url, bootMs, readyMs, nav, net };
}

const run = async () => {
  await waitJson("/json/version");
  const result = { meta: { generatedAt: new Date().toISOString(), chrome: chromeErr.slice(0, 200), dpr: 3, cpuThrottle: Number(process.env.R8_CPU_THROTTLE || 4), width: 375, height: 667 } };

  // ============ 1) dev 首屏 + 60s 性能 ============
  const dev = await newMobilePage(375, 667);
  const devLoad = await measureLoad(dev, DEV_URL, true);
  await sleep(1500);
  result.devLoad = devLoad;
  result.layout = await dev.evaluate(MARKET);
  await dev.send("Page.captureScreenshot", { format: "png" }).then(async (r) => writeFileSync(`${SHOTS}/r8-first-run-375x667.png`, Buffer.from(r.data, "base64")));

  // 60 秒性能采样（无操作静置）
  result.perf60 = analyzePerf(await samplePerf(dev, 60));
  result.perf60.samplesRaw = undefined;
  await dev.send("Page.captureScreenshot", { format: "png" }).then(async (r) => writeFileSync(`${SHOTS}/r8-after-60s.png`, Buffer.from(r.data, "base64")));

  // ============ 2) 误触 / 交互 ============
  const stage = result.layout.canvas.rect;
  const cx = Math.round(stage.x + stage.w / 2);
  const cy = Math.round(stage.y + stage.h / 2);
  const st0 = await dev.evaluate("window.__MOYU__.state.totalClicks");
  for (let i = 0; i < 25; i++) await tapAt(dev, cx, cy - 40 + (i % 5) * 12);
  const st1 = await dev.evaluate("window.__MOYU__.state.totalClicks");
  const mis = { tap25: { clicksBefore: st0, clicksAfter: st1, delta: st1 - st0 } };

  // 画布横滑：手指从游戏区横向拖动，pointerdown 会先算一次点击
  const st2 = await dev.evaluate("window.__MOYU__.state.totalClicks");
  await swipe(dev, cx - 60, cy, cx + 60, cy, 8);
  const st3 = await dev.evaluate("window.__MOYU__.state.totalClicks");
  mis.canvasSwipe = { clicksBefore: st2, clicksAfter: st3, delta: st3 - st2, note: "打算滑动/滚动时也计 1 次点击" };

  // 商店横滑：应滚动而不是误购
  const shop = result.layout.shop.rect;
  const shopY = Math.round(shop.y + shop.h / 2);
  const shopBefore = await dev.evaluate("({ scrollLeft: document.getElementById('shop-cards').scrollLeft, levels: Object.keys(window.__MOYU__.state.levels).length, moyu: window.__MOYU__.state.moyu })");
  await swipe(dev, 320, shopY, 80, shopY, 10);
  await sleep(300);
  const shopAfter = await dev.evaluate("({ scrollLeft: document.getElementById('shop-cards').scrollLeft, levels: Object.keys(window.__MOYU__.state.levels).length, moyu: window.__MOYU__.state.moyu })");
  mis.shopSwipe = { before: shopBefore, after: shopAfter, scrolled: shopAfter.scrollLeft !== shopBefore.scrollLeft, accidentallyBought: shopAfter.levels !== shopBefore.levels };

  // 📔 打开：面板是否装得下 / 遮罩期间 rAF 是否继续跑
  const jr = result.layout.journalBtn.rect;
  const framesBeforeModal = await dev.evaluate("window.__MOYU__.frames");
  await tapAt(dev, Math.round(jr.x + jr.w / 2), Math.round(jr.y + jr.h / 2));
  await sleep(400);
  result.journalOpen = await dev.evaluate(MARKET);
  await dev.send("Page.captureScreenshot", { format: "png" }).then(async (r) => writeFileSync(`${SHOTS}/r8-journal-open-375x667.png`, Buffer.from(r.data, "base64")));
  await sleep(3000);
  const framesAfterModal = await dev.evaluate("window.__MOYU__.frames");
  mis.modalKeepsRaf = { framesBefore: framesBeforeModal, framesAfter3s: framesAfterModal, ranFrames: framesAfterModal - framesBeforeModal, note: "日报遮罩打开 3s 内主循环仍在跑（无暂停）" };
  // 关闭
  const closeR = await dev.evaluate("(() => { const r = document.getElementById('journal-close').getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()");
  await tapAt(dev, Math.round(closeR.x), Math.round(closeR.y));
  await sleep(300);
  mis.journalClosed = await dev.evaluate("document.getElementById('journal').classList.contains('hidden')");
  result.misTouch = mis;

  // 极端文案压力：注入最长段位名 + 连胜，看 HUD 是否被挤爆（不写游戏文件，仅改 DOM 文本）
  result.hudStress = await dev.evaluate(`(() => {
    document.getElementById('hud-rank').textContent = '摸鱼宇宙尽头·终 100%';
    const st = document.getElementById('hud-streak');
    st.textContent = '🔥连胜 12'; st.classList.remove('hidden');
    document.getElementById('hud-idle').textContent = '1.23亿';
    const sub = document.querySelector('.hud-sub');
    return { subScrollW: sub.scrollWidth, subClientW: sub.clientWidth, overflow: sub.scrollWidth - sub.clientWidth, journalBtnRight: document.getElementById('btn-journal').getBoundingClientRect().right, rankLines: (()=>{const el=document.getElementById('hud-rank');const r=document.createRange();r.selectNodeContents(el);return r.getClientRects().length;})() };
  })()`);
  await dev.send("Page.captureScreenshot", { format: "png" }).then(async (r) => writeFileSync(`${SHOTS}/r8-hud-stress-375x667.png`, Buffer.from(r.data, "base64")));

  // ============ 3) dist 首屏（4G 模拟）+ PWA 离线 ============
  const dist = await newMobilePage(375, 667);
  const distLoad = await measureLoad(dist, DIST_URL, true);
  await sleep(2000);
  result.distLoad = distLoad;
  result.distLayout = await dist.evaluate(MARKET);
  result.pwa = await dist.evaluate(
    "navigator.serviceWorker.getRegistrations().then(rs => ({ supported: 'serviceWorker' in navigator, registrations: rs.length, controller: !!navigator.serviceWorker.controller, manifest: document.querySelector('link[rel=manifest]')?.href ?? null }))",
  );
  // 断网重载（无 SW 应直接失败）
  await dist.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  let offlineReload;
  try {
    await dist.send("Page.reload", { ignoreCache: true });
    await sleep(4000);
    offlineReload = await dist.evaluate("({ url: location.href, title: document.title, hasApp: !!document.getElementById('app'), hasMoyu: !!window.__MOYU__, bodyText: (document.body?.innerText || '').slice(0, 120) })");
  } catch (e) {
    offlineReload = { error: String(e).slice(0, 300) };
  }
  result.pwa.offlineReload = offlineReload;
  await dist.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(JSON.stringify({
    devLoad: { count: result.devLoad.net.count, bytes: result.devLoad.net.totalBytes, byType: result.devLoad.net.byType, bootMs: result.devLoad.bootMs, nav: result.devLoad.nav },
    distLoad: { count: result.distLoad.net.count, bytes: result.distLoad.net.totalBytes, byType: result.distLoad.net.byType, bootMs: result.distLoad.bootMs, nav: result.distLoad.nav },
    perf60: result.perf60,
    layout: { viewport: result.layout.viewport, doc: result.layout.doc, abnormalOverflow: result.layout.abnormalOverflow, hud: result.layout.hud, quest: result.layout.quest, canvas: result.layout.canvas, shop: result.layout.shop, journalBtn: result.layout.journalBtn, smallBtns: result.layout.smallBtns, smallTextCount: result.layout.smallTextCount },
    journalPanel: result.journalOpen?.journalPanel,
    misTouch: result.misTouch,
    hudStress: result.hudStress,
    pwa: result.pwa,
  }, null, 1));
  proc.kill();
  process.exit(0);
};

run().catch((e) => {
  console.error("[r8-perf] FAILED", e);
  proc.kill();
  process.exit(1);
});
