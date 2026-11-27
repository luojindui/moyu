/** 聚焦诊断：回合制老板 pointerdown 为何没结算 */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14h-" + Date.now(), "--remote-debugging-port=9565", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9565/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9565/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); return; } if (m.method === "Runtime.exceptionThrown") logs.push("EX " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? "")); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 300)); };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3200);
const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await closeWelcome(); await sleep(300);
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(300);
const snap = () => evalJs(`(()=>({now:performance.now(),panel:!document.getElementById('boss-choice').classList.contains('hidden'),bodyCls:document.body.className,tell:(document.getElementById('boss-tell')||{}).textContent,toast:(document.getElementById('dom-toast')||{}).textContent,fx:window.__MOYU__?.fxTexts?.().slice(-2),btnN:document.querySelectorAll('#boss-opts button').length}))()`);
const out = {};
out.before = await snap();
await evalJs(`window.__MOYU__.forceBoss('choice')`);
await sleep(150);
out.afterForce150 = await snap();
// 在按钮上加计数监听（捕获阶段，先于面板监听）
await evalJs(`(()=>{window.__hits=0;const b=document.querySelector('#boss-opts button[data-choice="act-busy"]');b.addEventListener('pointerdown',()=>{window.__hits++},true);return true})()`);
await sleep(400);
out.beforeClick = await snap();
await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="act-busy"]');window.__hit2=(b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'})));return true})()`);
out.rightAfterDispatch = await snap();
await evalJs(`window.__hits`);
await sleep(100);
out.after100 = await snap();
out.hits = await evalJs(`window.__hits`);
out.dispatchReturn = await evalJs(`window.__hit2`);
await sleep(3000);
out.after3s = await snap();
// 再试一次，用 .click()（click 监听不存在，应无反应；验证按钮是否存在 click 兜底）
await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(400);
out.secondBefore = await snap();
await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="switch-screen"]');b.click();return true})()`);
await sleep(300);
out.secondAfterClick = await snap();
out.logs = logs.slice(0, 10);
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
