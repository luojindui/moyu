/** 聚焦诊断 v4：点击是否命中/是否结算/为何无台词 */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14k-" + Date.now(), "--remote-debugging-port=9568", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9568/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9568/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
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
const snap = () => evalJs(`(()=>({panel:!document.getElementById('boss-choice').classList.contains('hidden'),tell:(document.getElementById('boss-tell')||{}).textContent,timer:(document.querySelector('#boss-timer i')||{style:{}}).style.width,toast:(document.getElementById('dom-toast')||{}).textContent,toastShow:(document.getElementById('dom-toast')||{className:''}).classList.contains('show'),moyu:window.__MOYU__?.state?.moyu,optsN:document.querySelectorAll('#boss-opts button').length}))()`);
let tell = null;
for (let t = 0; t < 40; t++) { const p = await evalJs(`(()=>{const r=document.getElementById('boss-choice');return r&&!r.classList.contains('hidden')?document.getElementById('boss-tell').textContent:null})()`); if (p) { tell = p; break; } await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(120); }
const correct = tell.includes("脚步") ? "act-busy" : tell.includes("盯着") ? "switch-screen" : "keep-slacking";
const out = { tell, correct };
out.before = await snap();
// 捕获命中计数
await evalJs(`(()=>{window.__hit=0;const opts=document.getElementById('boss-opts');opts.addEventListener('pointerdown',()=>{window.__hit++},true);const b=document.querySelector('#boss-opts button[data-choice="${correct}"]');b.addEventListener('pointerdown',()=>{window.__hit+=10},true);return true})()`);
await sleep(300);
out.beforeClick = await snap();
const beforeMoyu = out.beforeClick.moyu;
await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${correct}"]');window.__ev=new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'});window.__disp=b.dispatchEvent(window.__ev);window.__hit0=window.__hit;return true})()`);
out.hit = await evalJs(`window.__hit`);
out.dispatchReturn = await evalJs(`window.__disp`);
await sleep(60);
out.after60 = await snap();
await sleep(200);
out.after260 = await snap();
await sleep(500);
out.after760 = await snap();
out.delta = (await snap()).moyu - beforeMoyu;
await sleep(2000);
out.after2s = await snap();
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
