/** 诊断4：s2 之后 s3 面板不出现的原因 */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14g-" + Date.now(), "--remote-debugging-port=9564", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9564/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9564/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); return; } if (m.method === "Runtime.exceptionThrown") logs.push("EX " + (m.params.exceptionDetails?.exception?.description ?? "")); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 200)); };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
const vis = () => evalJs(`(()=>{const s=window.__MOYU__?.state;return{cards:!document.getElementById('cards').classList.contains('hidden'),hidden:document.getElementById('cards').className,saveDismissed:JSON.parse(localStorage.getItem('moyu-save')||'null')?.cards?.dismissed,stateDismissed:s?.cards?.dismissed,totalClicks:s?.totalClicks,fps:window.__MOYU__?.fps,frames:window.__MOYU__?.frames,boot:sessionStorage.getItem('moyu-boot-ms'),welcome:!document.getElementById('welcome').classList.contains('hidden'),body:document.body.innerText.slice(0,80)}})()`);
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3000); await closeWelcome();
const base = await evalJs(`JSON.parse(localStorage.getItem('moyu-save'))`);
const T = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
const mk = (dismissed) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed, chosenDate: "" } });
const patchReload = async (blob) => { await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});Storage.prototype.setItem=function(){}})()`); await send("Page.reload"); await sleep(2600); await closeWelcome(); await sleep(500); };
const rep = {};
// 第一次：dismissed false → 面板出现（先不关）
await patchReload(mk(false));
rep.first = await vis();
// 关掉（点跳过）
await evalJs(`document.getElementById('cards-skip').click()`); await sleep(500);
rep.firstAfterSkip = await vis();
// 第二次 reload dismissed false
await patchReload(mk(false));
rep.second = await vis();
await sleep(3000);
rep.secondAfter3s = await vis();
// 点击画布 3 下，看看是否恢复
await evalJs(`(()=>{const c=document.getElementById('stage');for(let i=0;i<3;i++)c.dispatchEvent(new PointerEvent('pointerdown',{clientX:100+i,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
await sleep(800);
rep.secondAfterTaps = await vis();
console.log(JSON.stringify(rep, null, 2));
console.log("LOGS", JSON.stringify(logs.slice(0, 8)));
proc.kill("SIGKILL"); process.exit(0);
