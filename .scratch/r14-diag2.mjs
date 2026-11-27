/** 诊断2：按 r14 场景 1-4 顺序复现，每步 dump */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14e-" + Date.now(), "--remote-debugging-port=9562", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9562/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9562/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
const logs=[];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); return; } if (m.method === "Runtime.exceptionThrown") logs.push("EX " + (m.params.exceptionDetails?.exception?.description ?? "")); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map(a=>a.value??a.description).join(" ").slice(0,200)); };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const vis = () => evalJs(`(()=>({fps:window.__MOYU__?.fps,frames:window.__MOYU__?.frames,cards:!document.getElementById('cards').classList.contains('hidden'),offers:[...document.querySelectorAll('#cards .card')].map(c=>c.dataset.id),save:JSON.parse(localStorage.getItem('moyu-save')||'null')?.cards,state:window.__MOYU__?.state?.cards,welcome:!document.getElementById('welcome').classList.contains('hidden')}))()`);
const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3000); await closeWelcome(); await sleep(300);
const base = await evalJs(`JSON.parse(localStorage.getItem('moyu-save'))`);
const T = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
const saveWith = (dismissed, chosen = null) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen, until: chosen ? Date.now() + 86400000 : 0, nextDayGuaranteed: null, dismissed, chosenDate: chosen ? T : "" } });
const patchReload = async (blob) => { await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});Storage.prototype.setItem=function(){};return true})()`); await send("Page.reload"); await sleep(2600); await closeWelcome(); await sleep(500); };
const report = {};

// S1: dismissed true
await patchReload(saveWith(true));
report.s1 = await vis();
// S2: dismissed false -> Esc
await patchReload(saveWith(false));
report.s2before = await vis();
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(500);
report.s2afterEsc = await vis();
// S3: dismissed false -> backdrop
await patchReload(saveWith(false));
report.s3before = await vis();
await evalJs(`(()=>{const r=document.getElementById('cards');r.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`);
await sleep(700);
report.s3afterBackdrop = await vis();
// S4: dismissed false -> wait 6s
await patchReload(saveWith(false));
report.s4immediate = await vis();
await sleep(6000);
report.s4after6s = await vis();
console.log(JSON.stringify(report, null, 2));
console.log("LOGS", JSON.stringify(logs.slice(0,10)));
proc.kill("SIGKILL"); process.exit(0);
