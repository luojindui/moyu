/** r14 收尾：HUD 溢出测量 + 跨天 buff 读档是否保留 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname; mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14r-" + Date.now(), "--remote-debugging-port=9600", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { try { await fetch("http://127.0.0.1:9600/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9600/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3500);
await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
const base = await evalJs(`JSON.parse(localStorage.getItem('moyu-save'))`);
const T = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
const now = Date.now();
const out = {};
// A. HUD 溢出测量（今日卡生效中）
const blobA = { ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: "hr_talk", until: now + 86400000, nextDayGuaranteed: null, dismissed: true, chosenDate: T } };
await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blobA))});Storage.prototype.setItem=function(){}})()`);
await send("Page.reload"); await sleep(2600);
await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await sleep(400);
out.hud = await evalJs(`(()=>{const sub=document.querySelector('.hud-sub');const rect=(el)=>{const r=el.getBoundingClientRect();return {t:Math.round(r.top),l:Math.round(r.left),r:Math.round(r.right),w:Math.round(r.width),text:el.textContent.slice(0,20)}};
 return {clientWidth:sub.clientWidth,scrollWidth:sub.scrollWidth,items:[...sub.children].map(rect),card:rect(document.getElementById('hud-card')),rank:rect(document.getElementById('hud-rank')),viewport:innerWidth}})()`);
const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(DIR + "20-hud-overflow.png", Buffer.from(s.data, "base64"));
// B. 跨天：昨日选的卡仍在 24h 内，今日 offers 不含它 → 读档后是否保留 buff
const blobB = { ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: "2026-11-26", offers: ["coffee_day", "overtime", "team_bond"], chosen: "hr_talk", until: now + 18 * 3600000, nextDayGuaranteed: null, dismissed: true, chosenDate: "2026-11-26" } };
await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blobB))});Storage.prototype.setItem=function(){}})()`);
await send("Page.reload"); await sleep(2600);
out.crossDay = await evalJs(`(()=>{const s=window.__MOYU__?.state;return {cards:s?.cards, hud:(document.getElementById('hud-card')||{}).textContent, hudHidden:(document.getElementById('hud-card')||{className:''}).classList.contains('hidden'), key:'(注: chosen 昨日不在今日 offers 内)'}})()`);
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
