/**
 * r11 探针 2：SW 旧版本细节
 *  A. dev（127.0.0.1:5173）第二次加载后，SW 是否把 /src/*.ts 缓存优先缓存起来（会污染开发）
 *  B. 生产构建：真·断网（关掉静态服务器）后重开，看是否停在旧版、有无提示
 *  C. 一次"发布"后旧哈希资源是否残留在缓存（moyu-v1 不换名 → 无法 GC）
 * 只写 playtest/ 与 /tmp。
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { extname, join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9482;
const HOST_PORT = 4189;
const DEV = "http://127.0.0.1:5173/";
const OUT = "/tmp/moyu-r11-v2";
const OUT2 = "/tmp/moyu-r11-v2b";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".md": "text/markdown" };
const res = { dev: {}, dist: {} };

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions",
  `--user-data-dir=/tmp/chrome-r11b-${Date.now()}`,
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

async function waitJson(path, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
await waitJson("/json/version");

async function newPage() {
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r2, rj) => { ws.onopen = r2; ws.onerror = rj; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  const evaluate = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const goto = async (url) => { await send("Page.navigate", { url }); await sleep(2800); };
  const reload = async () => { await send("Page.reload", { ignoreCache: false }); await sleep(2800); };
  return { send, evaluate, goto, reload, ws };
}

function serve(dir, port) {
  return new Promise((resolve) => {
    const s = createServer((req, res2) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/" || p.endsWith("/")) p += "index.html";
      try { const b = readFileSync(join(dir, p)); res2.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-cache" }); res2.end(b); }
      catch { res2.writeHead(404); res2.end("nf"); }
    });
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

const cacheDump = `(async () => {
  const out = [];
  for (const k of await caches.keys()) {
    const c = await caches.open(k);
    out.push({ name: k, entries: (await c.keys()).map(r => new URL(r.url).pathname + new URL(r.url).search) });
  }
  let reg = null; try { reg = await navigator.serviceWorker.getRegistration(); } catch {}
  return { controlled: !!navigator.serviceWorker.controller, caches: out, waiting: !!reg?.waiting,
           title: document.title, bodyMarker: document.body?.dataset?.deploy ?? null,
           hook: typeof window.__MOYU__ !== "undefined",
           appText: (document.getElementById("app")?.innerText || "").slice(0, 120) };
})()`;

try {
  // ---------- A. dev：第二次加载后缓存内容 ----------
  const dev = await newPage();
  await dev.goto(DEV);
  await dev.evaluate(`navigator.serviceWorker.ready.then(() => true)`);
  await dev.reload(); // 第二次：由 SW 控制
  res.dev.secondLoadCache = await dev.evaluate(cacheDump);
  res.dev.secondLoadCache.entryCount = (res.dev.secondLoadCache.caches[0]?.entries || []).length;
  res.dev.srcModulesCached = (res.dev.secondLoadCache.caches[0]?.entries || []).filter((p) => p.startsWith("/src/")).length;
  dev.ws.close();

  // ---------- B/C. 生产构建 ----------
  rmSync(OUT, { recursive: true, force: true });
  cpSync("dist", OUT, { recursive: true });
  let server = await serve(OUT, HOST_PORT);
  const dist = await newPage();
  await dist.goto(`http://127.0.0.1:${HOST_PORT}/`);
  await dist.evaluate(`navigator.serviceWorker.ready.then(() => true)`);
  await dist.reload();
  res.dist.v1Online = await dist.evaluate(cacheDump);

  // 真断网：关服务器
  await new Promise((r) => server.close(r));
  await dist.reload();
  res.dist.offlineOnV1 = await dist.evaluate(cacheDump);
  res.dist.offlineOnV1.reallyOffline = true;

  // 断网期间"发布" v2（换一个新哈希的 JS + 新 index），恢复网络后重开
  mkdirSync(join(OUT, "assets"), { recursive: true });
  const oldJs = "assets/index-Lx7xv9iD.js";
  const newJs = "assets/index-ZZZZv2.js";
  writeFileSync(join(OUT, newJs), readFileSync(join(OUT, oldJs)));
  const html = readFileSync(join(OUT, "index.html"), "utf8");
  writeFileSync(join(OUT, "index.html"), html.replace(oldJs, newJs).replace("<title>摸鱼工位</title>", "<title>摸鱼工位 v2</title>").replace("<body>", '<body data-deploy="v2">'));
  server = await serve(OUT, HOST_PORT);
  await dist.reload();
  res.dist.v2Online = await dist.evaluate(cacheDump);
  res.dist.v2Online.staleAssetStillCached = (res.dist.v2Online.caches[0]?.entries || []).includes("/" + oldJs);
  res.dist.v2Online.cacheCount = (res.dist.v2Online.caches[0]?.entries || []).length;
  dist.ws.close();
  await new Promise((r) => server.close(r));
} catch (e) {
  res.error = String(e?.stack || e);
} finally {
  proc.kill();
  writeFileSync("playtest/r11-liveops-evidence-sw.json", JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}
