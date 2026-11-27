/**
 * r11 内容运营党探针：验证「无版本号/无公告/无更新提示」的可玩性信号缺失 + SW 旧版本行为。
 *
 * 只读探针：不改 src/，只写 playtest/ 与 /tmp。
 * 用法：export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
 *       node playtest/r11-liveops-probe.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { extname, join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9481;
const STATIC_PORT = 4188;
const DEV = "http://127.0.0.1:5173/";
const OUT = "/tmp/moyu-r11-v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".md": "text/markdown" };

const results = { dev: {}, dist: {}, notes: [] };

// ---------- 1. dev server：玩家可见文本里有没有运营信号 ----------
const proc = spawn(
  CHROME,
  [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--disable-extensions",
    `--user-data-dir=/tmp/chrome-r11-${Date.now()}`,
    `--remote-debugging-port=${PORT}`, "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitJson(path, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
await waitJson("/json/version");

async function newPage() {
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + JSON.stringify(r.exceptionDetails.exception?.description ?? ""));
    return r.result.value;
  };
  const goto = async (url) => { await send("Page.navigate", { url }); await sleep(2600); };
  const reload = async () => { await send("Page.reload", { ignoreCache: false }); await sleep(2600); };
  return { send, evaluate, goto, reload, ws };
}

const OPS_WORDS = ["版本", "更新", "公告", "日志", "赛季", "活动", "v0.", "v1.", "版本号", "changelog", "what's new", "关于"];

try {
  const dev = await newPage();
  await dev.goto(DEV);

  results.dev.page = await dev.evaluate(`(() => {
    const body = document.body;
    // 只取面板/HUD 里的静态文案，canvas 无文本
    const text = body ? body.innerText : "";
    const panelOpen = !!document.querySelector("#journal");
    const journalHidden = document.querySelector("#journal")?.classList.contains("hidden");
    return {
      title: document.title,
      innerTextSample: text.slice(0, 600),
      hasVersionNode: /版本|v\\d+\\.\\d+/i.test(text),
      hasAnnouncement: /公告|更新日志|赛季|活动|changelog/i.test(text),
      buttons: [...document.querySelectorAll("button")].map(b => (b.textContent||"").trim()).filter(Boolean),
      manifestHref: document.querySelector('link[rel=manifest]')?.getAttribute("href") ?? null,
      journalExists: panelOpen, journalStartsHidden: journalHidden,
      mouyuHook: typeof window.__MOYU__ !== "undefined",
      lsKeys: (() => { try { return Object.keys(localStorage); } catch { return []; } })(),
    };
  })()`);

  // 打开日报/图鉴面板，看有没有"关于/版本/更新日志"入口
  await dev.evaluate(`(() => { const b = document.getElementById("btn-journal"); if (b) b.click(); return true; })()`);
  await sleep(600);
  results.dev.journalPanel = await dev.evaluate(`(() => {
    const j = document.getElementById("journal");
    const text = j ? j.innerText : "";
    return {
      open: j && !j.classList.contains("hidden"),
      headings: [...document.querySelectorAll("#journal h2, #journal h3")].map(h => h.textContent.trim()),
      hasVersionOrChangelog: /版本|v\\d+\\.\\d|更新日志|公告|赛季/i.test(text),
      panelBottomText: text.slice(-300),
    };
  })()`);

  // SW 注册与缓存实况（dev 下也会注册！）
  results.dev.sw = await dev.evaluate(`(async () => {
    let regs = [];
    try { regs = (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.scriptURL ?? null })); } catch (e) { regs = [{ error: String(e) }]; }
    let cachesInfo = [];
    try {
      for (const k of await caches.keys()) {
        const c = await caches.open(k);
        cachesInfo.push({ name: k, entries: (await c.keys()).map(r => new URL(r.url).pathname) });
      }
    } catch (e) { cachesInfo = [{ error: String(e) }]; }
    return {
      controlled: !!navigator.serviceWorker.controller,
      controllerScript: navigator.serviceWorker.controller?.scriptURL ?? null,
      registrations: regs,
      caches: cachesInfo,
      listensForUpdate: false,
    };
  })()`);

  const shot = await dev.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync("playtest/r11-liveops-hud.png", Buffer.from(shot.data, "base64"));
  dev.ws.close();

  // ---------- 2. 生产构建：模拟两次部署 + 离线，验证 SW 旧版本行为 ----------
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync("dist", OUT, { recursive: true });

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);
    if (p === "/" || p.endsWith("/")) p += "index.html";
    try {
      const buf = readFileSync(join(OUT, p));
      res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end("nf");
    }
  });
  await new Promise((r) => server.listen(STATIC_PORT, "127.0.0.1", r));

  const dist = await newPage();
  await dist.goto(`http://127.0.0.1:${STATIC_PORT}/`);
  await dist.evaluate(`navigator.serviceWorker.ready.then(() => true)`);
  results.dist.afterFirstLoad = await dist.evaluate(`(async () => {
    const cachesInfo = [];
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      cachesInfo.push({ name: k, entries: (await c.keys()).map(r => new URL(r.url).pathname) });
    }
    return { controlled: !!navigator.serviceWorker.controller, caches: cachesInfo, title: document.title };
  })()`);

  // 部署 v2：只改 index.html（模拟一次内容更新）
  const idx = readFileSync(join(OUT, "index.html"), "utf8");
  writeFileSync(join(OUT, "index.html"), idx.replace("<title>摸鱼工位</title>", "<title>摸鱼工位 v2</title>").replace("<body>", '<body data-deploy="v2">'));
  results.dist.v2Deployed = { titleChanged: true };

  // 3a. 老用户断网后重开 → 应该看到旧版且无任何版本提示
  await dist.send("Network.enable");
  await dist.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await dist.reload();
  results.dist.offlineReload = await dist.evaluate(`(async () => {
    let cacheNames = [];
    try { cacheNames = (await caches.keys()).map(async k => ({ name: k, entries: (await (await caches.open(k)).keys()).length })); } catch {}
    return {
      online: navigator.onLine,
      title: document.title,
      bodyHasV2: document.body?.dataset?.deploy === "v2",
      cachedEntryCounts: await Promise.all(cacheNames),
      anyUpdatePrompt: /更新|新版本|刷新/.test(document.getElementById("app")?.innerText || ""),
      boot: !!window.__MOYU__,
    };
  })()`);

  // 3b. 恢复联网再重开 → 导航 network-first 应拿到 v2（说明"在线用户其实能更新"）
  await dist.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await dist.reload();
  results.dist.onlineReloadAfterDeploy = await dist.evaluate(`({
    title: document.title,
    bodyHasV2: document.body?.dataset?.deploy === "v2",
    anyUpdatePrompt: /更新|新版本/.test(document.getElementById("app")?.innerText || ""),
    boot: !!window.__MOYU__,
  })`);

  // 3c. 检查 SW 自身是否因部署而更新（sw.js 字节未变 → 不应触发 update）
  results.dist.swAfterDeploy = await dist.evaluate(`(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    const keys = await caches.keys();
    return { cacheNames: keys, waiting: !!r?.waiting, installing: !!r?.installing, activeScript: r?.active?.scriptURL ?? null };
  })()`);
  dist.ws.close();
  server.close();
} catch (e) {
  results.error = String(e?.stack || e);
} finally {
  proc.kill();
  writeFileSync("playtest/r11-liveops-evidence.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}
