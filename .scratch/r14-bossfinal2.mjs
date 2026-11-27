/** r14 老板复验 v2：单次 forceBoss + 轮询；超时；画布提示 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname; mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14n-" + Date.now(), "--remote-debugging-port=9581", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { try { await fetch("http://127.0.0.1:9581/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9581/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
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
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3500);
await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await sleep(300);
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(400);
// 若每日卡弹窗已在（≥12s 自动弹），先跳过，避免它推迟老板事件
for (let i = 0; i < 20; i++) { const c = await evalJs(`(()=>{const r=document.getElementById('cards');return r&&!r.classList.contains('hidden')})()`); if (c) { await evalJs(`document.getElementById('cards-skip').click()`); await sleep(300); break; } await sleep(200); }
const snap = () => evalJs(`(()=>({panel:!document.getElementById('boss-choice').classList.contains('hidden'),tell:(document.getElementById('boss-tell')||{}).textContent,opts:document.getElementById('boss-opts')?.innerText||'',toast:{text:(document.getElementById('dom-toast')||{}).textContent,show:(document.getElementById('dom-toast')||{className:''}).classList.contains('show')},moyu:window.__MOYU__?.state?.moyu}))()`);
const openOnce = async (label) => {
  await evalJs(`window.__MOYU__.forceBoss('choice')`);
  for (let i = 0; i < 25; i++) { const s = await snap(); if (s.panel) return s; await sleep(80); }
  return null;
};
const out = { rounds: [], timeout: {}, canvasTap: {} };
const chooseAndWatch = async (choice) => {
  await sleep(300);
  const before = await snap();
  await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${choice}"]');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
  const samples = [];
  for (let t = 0; t < 30; t++) { samples.push({ ms: t * 60, ...(await snap()) }); await sleep(60); }
  return { before, samples };
};
for (let i = 0; i < 4; i++) {
  const s = await openOnce(i);
  if (!s) { out.rounds.push({ iter: i, error: "no panel" }); break; }
  const correct = s.tell.includes("脚步") ? "act-busy" : s.tell.includes("盯着") ? "switch-screen" : "keep-slacking";
  const { before, samples } = await chooseAndWatch(correct);
  const lineSample = samples.find((x) => x.toast.text.includes("："));
  const panelMs = samples.filter((x) => x.panel).length ? samples.filter((x) => x.panel).slice(-1)[0].ms : 0;
  out.rounds.push({ iter: i, tell: s.tell, choice: correct, lineText: lineSample?.toast.text, lineVisibleFromMs: lineSample?.ms, panelVisibleMs: panelMs, delta: samples[samples.length - 1].moyu - before.moyu, toastStillShownAt1800: samples[samples.length - 1].toast.show });
  if (i === 0) await shot("14-boss-result-line");
  await sleep(900);
}
// 超时
const s2 = await openOnce("timeout");
out.timeout.open = s2;
if (s2) { await sleep(5400); out.timeout.after = await snap(); await shot("15-boss-timeout"); }
await sleep(800);
// 画布提示
const s3 = await openOnce("canvas");
out.canvasTap.open = s3;
if (s3) {
  await sleep(500);
  const before = await snap();
  await evalJs(`(()=>{const c=document.getElementById('stage');c.dispatchEvent(new PointerEvent('pointerdown',{clientX:195,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
  await sleep(300);
  const after = await snap();
  out.canvasTap = { fx: await evalJs(`window.__MOYU__.fxTexts()`), delta: after.moyu - before.moyu, panel: after.panel };
  await shot("16-canvas-hint");
}
writeFileSync(DIR + "evidence-boss2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
