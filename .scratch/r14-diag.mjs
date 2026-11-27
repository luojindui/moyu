/** 诊断：crafted save 后卡片面板为何不出现 */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14d-" + Date.now(), "--remote-debugging-port=9561", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9561/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9561/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3000);
const w = await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
const save = await evalJs(`JSON.parse(localStorage.getItem('moyu-save'))`);
const T = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
save.moyu = 1e9; save.totalEarned = 1e9; save.lifetimeEarned = 1e9; save.totalClicks = 20;
save.cards = { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" };
await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});Storage.prototype.setItem=function(){}})()`);
await send("Page.reload"); await sleep(2500);
const r = await evalJs(`(()=>{
  const s=window.__MOYU__?.state;
  return {cardsOpen:!document.getElementById('cards').classList.contains('hidden'),
    saveCards: JSON.parse(localStorage.getItem('moyu-save')||'null')?.cards,
    stateCards: s?.cards, totalClicks:s?.totalClicks,
    welcomeHidden:document.getElementById('welcome').classList.contains('hidden'),
    body:document.body.innerText.slice(0,160)};
})()`);
console.log(JSON.stringify(r, null, 2));
proc.kill("SIGKILL"); process.exit(0);
