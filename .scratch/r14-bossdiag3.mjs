/** 聚焦诊断 v3：MutationObserver 记录 toast/面板变化时间线 */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14j-" + Date.now(), "--remote-debugging-port=9567", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9567/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9567/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
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
await sleep(300);
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(300);
// 装观察器
await evalJs(`(()=>{window.__log=[];const t0=performance.now();
const rec=(src)=>{const toast=document.getElementById('dom-toast');const p=document.getElementById('boss-choice');
 window.__log.push({t:Math.round(performance.now()-t0),src,toast:toast?toast.textContent:null,toastShow:toast?toast.classList.contains('show'):null,panel:p?!p.classList.contains('hidden'):null});};
window.__rec=rec;
new MutationObserver(()=>rec('toast-mut')).observe(document.getElementById('dom-toast'),{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class']});
new MutationObserver(()=>rec('panel-mut')).observe(document.getElementById('boss-choice'),{attributes:true,attributeFilter:['class']});
new MutationObserver(()=>rec('opts-mut')).observe(document.getElementById('boss-opts'),{childList:true,subtree:true});
rec('init');return true})()`);
// 开面板
let tell = null;
for (let t = 0; t < 40; t++) { tell = await evalJs(`(()=>{const r=document.getElementById('boss-choice');return r&&!r.classList.contains('hidden')?document.getElementById('boss-tell').textContent:null})()`); if (tell) break; await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(120); }
const correct = tell.includes("脚步") ? "act-busy" : tell.includes("盯着") ? "switch-screen" : "keep-slacking";
await evalJs(`window.__rec && window.__rec('panel-ready')`);
await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${correct}"]');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));window.__rec('clicked');return true})()`);
await sleep(1500);
const log = await evalJs(`window.__log`);
console.log("TELL:", tell, "CHOICE:", correct);
console.log(JSON.stringify(log, null, 1));
proc.kill("SIGKILL"); process.exit(0);
