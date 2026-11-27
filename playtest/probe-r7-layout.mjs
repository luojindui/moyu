/** R7 附加只读探针：首屏布局抖动（canvas 高度 vs 容器高度）+ 商店卡片文字填充时刻。不改 src/ */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9563;
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCRIPT = `
(() => {
  const P = window.__layout = { samples: [] };
  const grab = (tag) => {
    const wrap = document.getElementById('stage-wrap');
    const c = document.getElementById('stage');
    const shop = document.getElementById('shop');
    const hud = document.getElementById('hud');
    const card = document.querySelector('.shop-card');
    const next = document.querySelector('.shop-next');
    const r = (el) => el ? Math.round(el.getBoundingClientRect().height) : null;
    return {
      tag,
      t: Math.round(performance.now()),
      wrapH: wrap ? wrap.clientHeight : null,
      canvasH: r(c),
      canvasCssH: c && c.style.height,
      shopH: r(shop),
      hudH: r(hud),
      cardH: r(card),
      nextTxt: next ? next.textContent : null,
      shopTop: shop ? Math.round(shop.getBoundingClientRect().top) : null,
      canvasBottom: c ? Math.round(c.getBoundingClientRect().bottom) : null,
      bodyScrollH: document.body.scrollHeight,
    };
  };
  const t0 = performance.now();
  const iv = setInterval(() => {
    P.samples.push(grab('poll'));
    if (performance.now() - t0 > 3000) {
      clearInterval(iv);
      P.mutationAt = window.__shopFilledAt || null;
    }
  }, 100);
  const mo = new MutationObserver(() => {
    const next = document.querySelector('.shop-next');
    if (next && next.textContent && !window.__shopFilledAt) window.__shopFilledAt = Math.round(performance.now() * 10) / 10;
  });
  const boot = setInterval(() => {
    const s = document.getElementById('shop-cards');
    if (s) { mo.observe(s, { subtree: true, childList: true, characterData: true }); clearInterval(boot); }
  }, 5);
})();
`;

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r7-layout-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(4000);
const data = await ev("JSON.stringify({samples:__layout.samples, shopFilledAt: window.__shopFilledAt ?? null, hint: null})");
const parsed = JSON.parse(data);
// 触发一次 window resize 看是否修复画布高度
const before = JSON.parse(await ev("JSON.stringify((()=>{const c=document.getElementById('stage');const w=document.getElementById('stage-wrap');return {canvasH:Math.round(c.getBoundingClientRect().height),wrapH:w.clientHeight,canvasCssH:c.style.height}})())"));
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H + 1, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H + 1 });
await sleep(300);
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await sleep(400);
const after = JSON.parse(await ev("JSON.stringify((()=>{const c=document.getElementById('stage');const w=document.getElementById('stage-wrap');return {canvasH:Math.round(c.getBoundingClientRect().height),wrapH:w.clientHeight,canvasCssH:c.style.height}})())"));
parsed.resizeBefore = before; parsed.resizeAfter = after;
writeFileSync("playtest/r7-layout.json", JSON.stringify(parsed, null, 1));
// 打印关键样本（每 300ms 一个）
const key = parsed.samples.filter((s, i) => i % 3 === 0);
console.log(JSON.stringify({ shopFilledAt: parsed.shopFilledAt, samples: key, resizeBefore: before, resizeAfter: after }, null, 1));
proc.kill();
process.exit(0);
