/** 诊断5：forceBoss 第二次为何无面板（frames/异常/卡片弹窗状态） */
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14p-" + Date.now(), "--remote-debugging-port=9582", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { try { await fetch("http://127.0.0.1:9582/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9582/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); return; } if (m.method === "Runtime.exceptionThrown") logs.push("EX " + (m.params.exceptionDetails?.exception?.description ?? "")); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") logs.push("ERR " + m.params.args.map(a => a.value ?? a.description).join(" ").slice(0, 300)); };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3500);
await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await sleep(300);
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(400);
const snap = () => evalJs(`(()=>({frames:window.__MOYU__?.frames,fps:window.__MOYU__?.fps,panel:!document.getElementById('boss-choice').classList.contains('hidden'),cards:!document.getElementById('cards').classList.contains('hidden'),toast:(document.getElementById('dom-toast')||{}).textContent,choiceDone:window.__MOYU__?.state?null:null,patrol:window.__MOYU__?.state?.patrolSurvives,life:window.__MOYU__?.state?.lifetimeEarned}))()`);
const out = {};
for (let round = 0; round < 3; round++) {
  // 先跳卡片弹窗
  const c = await evalJs(`(()=>{const r=document.getElementById('cards');return !!(r&&!r.classList.contains('hidden'))})()`);
  if (c) { await evalJs(`document.getElementById('cards-skip').click()`); await sleep(250); }
  out["r" + round + "_beforeForce"] = await snap();
  out["r" + round + "_forceReturn"] = await evalJs(`window.__MOYU__.forceBoss('choice')`);
  let found = null;
  for (let i = 0; i < 30; i++) { const s = await snap(); if (s.panel) { found = { i, ...s }; break; } await sleep(100); }
  out["r" + round + "_panel"] = found;
  if (!found) { out["r" + round + "_afterWait"] = await snap(); break; }
  await sleep(300);
  const correct = found.panel ? "switch-screen" : "act-busy";
  await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${correct}"]');if(b)b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
  await sleep(600);
  out["r" + round + "_afterPick"] = await snap();
  await sleep(800);
}
out.logs = logs.slice(0, 8);
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
