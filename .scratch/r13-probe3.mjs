/** r13 探针 3：已选卡的当日重进画面（是否有任何"今日卡"可确认） */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r13/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r13c-" + Date.now(), "--remote-debugging-port=9558", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9558/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9558/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3000);
const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await closeWelcome(); await sleep(200);
const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
const save = await evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save'))}catch(e){return null}})()`);
save.moyu = 1e9; save.totalEarned = 1e9; save.lifetimeEarned = 1e9;
save.cards = { date: today, offers: ["hr_talk", "coffee_day", "overtime"], chosen: "hr_talk", until: Date.now() + 86400000, nextDayGuaranteed: "secret_project" };
await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});Storage.prototype.setItem=function(){};return true})()`);
await send("Page.reload"); await sleep(2200); await closeWelcome(); await sleep(300);
const r = await evalJs(`(()=>{
  const body=document.body.innerText;
  return {
    cardsOpen:!document.getElementById('cards').classList.contains('hidden'),
    containsCardName: body.includes('HR 约谈'),
    containsFlavor: body.includes('别紧张'),
    containsHrId: body.includes('hr_talk'),
    hud: document.getElementById('hud')?.innerText,
    shopHint: document.getElementById('shop-hint')?.textContent
  }})()`);
const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(DIR + "14-reload-with-chosen-card.png", Buffer.from(s.data, "base64"));
writeFileSync(DIR + "evidence3.json", JSON.stringify(r, null, 2));
console.log(JSON.stringify(r, null, 2));
proc.kill("SIGKILL"); process.exit(0);
