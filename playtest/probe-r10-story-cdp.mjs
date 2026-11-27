/** R10 剧情/角色党：首 3 分钟真实试玩取证（只读 src/，不改 src/）
 *  头像：iOS 390×844@3x，headless Chrome CDP，自动戳屏 150ms 一次。
 *  取证目标：首屏/首 3 分钟到底出现多少"人物/故事"文本；截图存档。
 *  运行：node playtest/probe-r10-story-cdp.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9611;
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r10-story-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result.value; };
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`playtest/${name}`, Buffer.from(r.data, "base64"));
};
const tap = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(4500);

const snap = async (tag) => {
  const dom = await ev(`JSON.stringify({
    hud: document.getElementById('hud')?.innerText,
    shop: document.getElementById('shop')?.innerText,
    quest: document.getElementById('quest')?.classList.contains('hidden') ? null : document.getElementById('quest-text')?.textContent,
    journalOpen: !document.getElementById('journal')?.classList.contains('hidden'),
    welcomeOpen: !document.getElementById('welcome')?.classList.contains('hidden'),
    state: window.__MOYU__?.state,
  })`);
  return { tag, ...JSON.parse(dom) };
};

const logs = [];
logs.push(await snap("t=4.5s 首屏"));
await shot("r10-story-t0.png");

// 后台累积：每 200ms 抓一次 canvas-drawn 文案看不到，但 DOM 文案 + state 可证
const timeline = [];
const t0 = Date.now();
let tapCount = 0;
const cx = Math.round(W / 2), cy = Math.round(H * 0.42);
while (Date.now() - t0 < 165_000) {
  // 模拟真人：连点 4 下，停 0.6-1.2s（连击链与真实节奏）
  for (let i = 0; i < 4; i++) {
    await tap(cx + (Math.random() * 60 - 30), cy + (Math.random() * 60 - 30));
    tapCount++;
    await sleep(150);
  }
  await sleep(600 + Math.random() * 700);
  const el = Math.round((Date.now() - t0) / 1000);
  if (el % 20 < 2) timeline.push(await snap(`t=${el}s`));
}
logs.push(await snap("t=170s 3 分钟后"));

const shots = await ev(`JSON.stringify({ canvasRect: (()=>{const c=document.getElementById('stage');const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})(), dpr: window.devicePixelRatio })`);
await shot("r10-story-t170.png");

// 打开日报面板（叙事第二承载面）
await ev(`document.getElementById('btn-journal').click()`);
await sleep(700);
await shot("r10-story-journal.png");
const journal = await ev(`document.getElementById('journal')?.innerText`);
// 打一轮牌：看面板文案
await ev(`document.getElementById('journal-close')?.click()`);

writeFileSync("playtest/r10-story-cdp.json", JSON.stringify({ logs, timeline, journal, shots: JSON.parse(shots), tapCount }, null, 1));
console.log(JSON.stringify({ logs, journalLen: (journal || "").length, tapCount }, null, 1));
console.log("--- 日报面板全文 ---\n" + journal);
proc.kill();
process.exit(0);
