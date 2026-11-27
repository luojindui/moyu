/**
 * R10 探针 3：首购二次确认 + 首次巡逻乱点是否罚钱（只读 src；fillText 钩子仅测试注入）
 * 用法：node playtest/r10-min-probe3.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.env.URL_ || "http://127.0.0.1:5173/";
const W = 390, H = 844, PORT = 9467;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-min3-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(path, tries = 120) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {} await sleep(100); }
  throw new Error("CDP not ready");
}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject, timer } = pending.get(m.id); pending.delete(m.id); clearTimeout(timer); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
function send(method, params = {}, timeoutMs = 30000) { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(i); reject(new Error("timeout " + method)); }, timeoutMs); pending.set(i, { resolve, reject, timer }); }); }
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function shot(path) { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(path, Buffer.from(s.data, "base64")); }

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(600);
await evaluate("localStorage.clear(); location.reload(); true").catch(() => {});
await sleep(3000);

// A) 首购二次确认
const buy = await evaluate(`(async () => {
  const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
  const tap = (x,y)=>c.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));
  for (let i=0;i<22;i++){ tap(r.left+r.width/2, r.top+r.height/2); await new Promise(rr=>setTimeout(rr,40)); }
  await new Promise(rr=>setTimeout(rr,400));
  const before = window.__MOYU__.state;
  const card = document.querySelector('[data-upgrade="coffee"]');
  const enabled = !card.disabled;
  card.click();
  await new Promise(rr=>setTimeout(rr,250));
  const s1 = window.__MOYU__.state;
  const cls = card.className;
  const lv1 = s1.levels.coffee || 0;
  card.click();
  await new Promise(rr=>setTimeout(rr,300));
  const s2 = window.__MOYU__.state;
  return JSON.stringify({ moyuBefore:+before.moyu.toFixed(2), cardEnabled:enabled, levelAfter1Tap:lv1, confirmingClass:cls.includes('confirming'), levelAfter2Tap:s2.levels.coffee||0, moyuAfter2Tap:+s2.moyu.toFixed(2) });
})()`);
console.log("=== FIRST_PURCHASE_CONFIRM ===");
console.log(buy);

// B) 首次巡逻：钩子记录 canvas 每帧文字，等待横幅
const hook = await evaluate(`(() => {
  window.__texts=[];
  const P = CanvasRenderingContext2D.prototype;
  if (!P.__patched) { const orig = P.fillText; P.__patched = true;
    P.fillText = function(t,...a){ try{ window.__texts.push(String(t)); if(window.__texts.length>400) window.__texts.splice(0,250);}catch{} return orig.call(this,t,...a); };
  }
  return true;
})()`);
void hook;
let banner = null;
for (let i = 0; i < 110; i++) {
  await sleep(400);
  let arr;
  try { arr = JSON.parse(await evaluate("JSON.stringify((window.__texts||[]).slice(-120))")); }
  catch (e) { console.log("page reloaded during wait:", String(e).slice(0,120)); break; }
  banner = arr.find((x) => x.includes("老板"));
  if (banner) break;
}
console.log("=== PATROL_BANNER ===", JSON.stringify(banner));
if (banner) {
  await shot("/tmp/r10-min3-patrol.png");
  await sleep(1300);
  const res = await evaluate(`(async () => {
    const before = window.__MOYU__.state;
    const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
    for (let i=0;i<2;i++){ c.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'})); await new Promise(rr=>setTimeout(rr,160)); }
    await new Promise(rr=>setTimeout(rr,400));
    const after = window.__MOYU__.state;
    return JSON.stringify({ deltaMoyu: +(after.moyu-before.moyu).toFixed(2), surviveStreak: after.surviveStreak, moyu: +after.moyu.toFixed(2) });
  })()`);
  console.log("=== PATROL_TAP_RESULT (首次巡逻，新手保护) ===", res);
  await shot("/tmp/r10-min3-patrol-tap.png");
}
// 再等 9s 看巡逻结算文案
await sleep(9000);
const afterPatrol = await evaluate(`JSON.stringify({ moyu: +window.__MOYU__.state.moyu.toFixed(2), surviveStreak: window.__MOYU__.state.surviveStreak, lastTexts: (window.__texts||[]).slice(-30) })`);
console.log("=== AFTER_PATROL_9s ===", afterPatrol);
await shot("/tmp/r10-min3-after-patrol.png");

proc.kill();
process.exit(0);
