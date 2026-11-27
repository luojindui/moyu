/**
 * R8 学生碎片党 · 加载流量 + 内存趋势探针（CDP）
 *  - 4G 模拟（latency 70ms / 10Mbps）+ 4× CPU 降频，冷缓存 vs 热缓存各测一遍
 *  - dev(5173) 与 dist(4189) 首屏请求数 / 字节 / DOMContentLoaded
 *  - 90 秒内存趋势（每 5s 采样 JS 堆 + 节点数 + 长任务），末尾 GC 后看保留量
 * 只读 src/。输出 /tmp/r8-load-mem.json
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.R8_CDP_PORT2 || (9800 + (process.pid % 90)));
const DEV_URL = "http://127.0.0.1:5173/";
const DIST_URL = "http://127.0.0.1:4189/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    `--user-data-dir=/tmp/chrome-r8-load-${Date.now()}`,
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
  throw new Error("CDP not ready\n" + chromeErr.slice(-500));
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
  const P = window.__P__ = { lt: [] };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lt.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
})();`;

async function setup(cdp) {
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Performance.enable");
  await cdp.send("Network.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 3, mobile: true, screenWidth: 375, screenHeight: 667 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE_INJECT });
}

async function set4G(cdp, on) {
  if (on) {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 70, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (5 * 1024 * 1024) / 8 });
  } else {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  }
}

function wireNetwork(cdp) {
  const reqs = new Map();
  const headers = {};
  cdp.on((msg) => {
    if (msg.method === "Network.requestWillBeSent") {
      reqs.set(msg.params.requestId, { url: msg.params.request.url, type: msg.params.type, bytes: 0, status: null, fromCache: null });
    } else if (msg.method === "Network.responseReceived") {
      const r = reqs.get(msg.params.requestId);
      const p = msg.params.response;
      if (r) {
        r.status = p.status;
        r.fromCache = p.fromDiskCache || p.fromPrefetchCache || (p.fromMemoryCache ?? false);
        const h = p.headers || {};
        const key = r.url.replace(/^https?:\/\/[^/]+/, "");
        if (!headers[key] && (h["cache-control"] || h["Cache-Control"] || h["etag"] || h["last-modified"])) headers[key] = { cacheControl: h["cache-control"] || h["Cache-Control"], etag: h.etag || h["Etag"], lastModified: h["last-modified"] || h["Last-Modified"] };
      }
    } else if (msg.method === "Network.loadingFinished") {
      const r = reqs.get(msg.params.requestId);
      if (r) r.bytes = msg.params.encodedDataLength;
    } else if (msg.method === "Network.loadingFailed") {
      const r = reqs.get(msg.params.requestId);
      if (r) r.failed = msg.params.errorText;
    }
  });
  return { reqs, headers };
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
    if (r.fromCache) cached++;
  }
  return { count: list.length, totalBytes: total, cachedCount: cached, byType };
}

async function waitBoot(cdp, timeoutMs = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await cdp.evaluate("!!window.__MOYU__")) return Date.now() - t0;
    } catch {}
    await sleep(100);
  }
  return -1;
}

async function measure(loadFn, tag) {
  const t0 = Date.now();
  console.error("[load]", tag, "navigate");
  await loadFn();
  console.error("[load]", tag, "waitBoot");
  const bootMs = await waitBoot();
  console.error("[load]", tag, "boot", bootMs);
  const wallMs = Date.now() - t0;
  await sleep(1500);
  const nav = await cdpEval(
    "(() => { const t = performance.timing; return { dcl: t.domContentLoadedEventEnd - t.navigationStart, load: t.loadEventEnd ? t.loadEventEnd - t.navigationStart : null, fcp: (performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime ?? null }; })()",
  );
  return { bootMs, wallMs, nav };
}

let cdpEval = null;

const run = async () => {
  await waitJson("/json/version");
  const out = { meta: { generatedAt: new Date().toISOString(), revision: process.env.R8_REV || null, dirty: process.env.R8_DIRTY || null, cpuThrottle: 4, network: "4G 70ms/10Mbps", viewport: "375x667 DPR3" } };

  // ---------- dev / dist 首屏（冷缓存 vs 热缓存）----------
  for (const [name, url] of [["dev", DEV_URL], ["dist", DIST_URL]]) {
    console.error("[load] page", name);
    const cdp = await openPage();
    await setup(cdp);
    cdpEval = (expr) => cdp.evaluate(expr);
    const net = wireNetwork(cdp);
    await set4G(cdp, true);
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    const m1 = await measure(() => cdp.send("Page.navigate", { url }), name + "-cold");
    const cold = summarize(net.reqs);
    // 同一页面热缓存重载（模拟第 2 次打开）
    net.reqs.clear();
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
    console.error("[load]", name, "warm reload");
    await cdp.send("Page.reload");
    const boot2 = await waitBoot(cdp);
    console.error("[load]", name, "warm boot", boot2);
    await sleep(1500);
    const warm = summarize(net.reqs);
    // 取关键响应头
    const keyHeaders = Object.fromEntries(Object.entries(net.headers).slice(0, 8));
    out[name] = { cold: { ...cold, ...m1 }, warm: { ...warm, bootMs: boot2 }, headers: keyHeaders };
    await cdp.ws.close?.();
  }

  // ---------- 90 秒内存趋势（dev, 在线, 4× CPU）----------
  console.error("[load] mem page");
  const mem = await openPage();
  await setup(mem);
  cdpEval = (expr) => mem.evaluate(expr);
  const net = wireNetwork(mem);
  await set4G(mem, false);
  await mem.send("Network.setCacheDisabled", { cacheDisabled: false });
  await mem.send("Page.navigate", { url: DEV_URL });
  await waitBoot(mem);
  console.error("[load] mem booted");
  await sleep(2000);
  net.reqs.clear();
  const samples = [];
  const getMetrics = async () => Object.fromEntries((await mem.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  let frames0 = await mem.evaluate("window.__MOYU__.frames");
  for (let i = 0; i < 12; i++) {
    await sleep(5000);
    const m = await getMetrics();
    const live = await mem.evaluate("({ frames: window.__MOYU__?.frames ?? 0, fps: window.__MOYU__?.fps ?? null, heap: performance.memory?.usedJSHeapSize ?? null, lt: (window.__P__?.lt ?? []).length, ltDur: (window.__P__?.lt ?? []).reduce((a, b) => a + b.dur, 0) })");
    if (live.frames < frames0) samples.push({ t: (i + 1) * 5, event: "PAGE_RELOAD_DETECTED" });
    frames0 = live.frames;
    samples.push({
      t: (i + 1) * 5,
      heap: m.JSHeapUsedSize,
      heapTotal: m.JSHeapTotalSize,
      nodes: m.Nodes,
      listeners: m.JSEventListeners,
      documents: m.Documents,
      fps: live.fps,
      frames: live.frames,
      longtasks: live.lt,
      longtaskMs: live.ltDur,
      taskDuraction: m.TaskDuration,
    });
  }
  await mem.send("HeapProfiler.collectGarbage");
  await sleep(800);
  const afterGc = await getMetrics();
  const retained = await mem.evaluate("({ heap: performance.memory?.usedJSHeapSize ?? null, nodes: document.getElementsByTagName('*').length, fps: window.__MOYU__?.fps ?? null })");
  out.memory90 = { samples, afterGc: { heap: afterGc.JSHeapUsedSize, nodes: afterGc.Nodes, listeners: afterGc.JSEventListeners }, retained };

  console.error("[load] done");
  writeFileSync("/tmp/r8-load-mem.json", JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
  proc.kill();
  process.exit(0);
};

run().catch((e) => {
  console.error("[r8-load] FAILED", e);
  proc.kill();
  process.exit(1);
});
