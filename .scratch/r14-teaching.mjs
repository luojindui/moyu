/** 教学验证：首次自然巡逻是否必为回合制 choice；卡片弹窗门槛；线上资源核对 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname; mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14s-" + Date.now(), "--remote-debugging-port=9601", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { try { await fetch("http://127.0.0.1:9601/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9601/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async (n) => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(DIR + n + ".png", Buffer.from(s.data, "base64")); };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3200);
await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
const out = { cardPrompt: {}, firstBoss: {} };
const snap = () => evalJs(`(()=>({cards:!document.getElementById('cards').classList.contains('hidden'),boss:!document.getElementById('boss-choice').classList.contains('hidden'),tell:(document.getElementById('boss-tell')||{}).textContent,toast:(document.getElementById('dom-toast')||{}).textContent,frames:window.__MOYU__?.frames,patrol:window.__MOYU__?.state?.patrolSurvives}))()`);
// 卡片弹窗：12s 后应自动弹出（totalClicks 0）
let cardShown = false, waited = 0;
for (let t = 0; t < 20; t++) { const s = await snap(); if (s.cards) { cardShown = true; waited = (t + 1) * 1000; break; } await sleep(1000); }
out.cardPrompt = { shown: cardShown, waitedMs: waited };
if (cardShown) { await evalJs(`document.getElementById('cards-skip').click()`); await sleep(400); }
// 首次自然巡逻：20-35s；跳过卡后继续等
let boss = null, t0 = Date.now();
for (let i = 0; i < 60; i++) { const s = await snap(); if (s.boss) { boss = { waitedSinceSkipMs: Date.now() - t0, ...s }; break; } await sleep(1000); }
out.firstBoss = boss;
if (boss) await shot("21-first-patrol-choice");
// 线上资源核对（页面内 fetch 不可跨域，用 node 另行检查）
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
