/**
 * R10 探针 4：首购二次确认（修正输入节流）+ 首次巡逻横幅/乱点结果（抗 HMR 刷新）
 * 用法：node playtest/r10-min-probe4.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.env.URL_ || "http://127.0.0.1:5173/";
const W = 390, H = 844, PORT = 9473;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-min4-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
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
const HOOK = `(() => {
  window.__texts = window.__texts || [];
  const P = CanvasRenderingContext2D.prototype;
  if (!P.__r10patched) { const orig = P.fillText; P.__r10patched = true;
    P.fillText = function(t,...a){ try{ window.__texts.push(String(t)); if(window.__texts.length>600) window.__texts.splice(0,300);}catch{} return orig.call(this,t,...a); };
  }
  return true;
})()`;

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(500);
await evaluate("localStorage.clear(); location.reload(); true").catch(() => {});
await sleep(2800);

// A) 首购：间隔 120ms（>80ms 输入节流）
const buy = await evaluate(`(async () => {
  const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
  const tap = ()=>c.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));
  for (let i=0;i<20;i++){ tap(); await new Promise(rr=>setTimeout(rr,120)); }
  await new Promise(rr=>setTimeout(rr,300));
  const before = window.__MOYU__.state;
  const card = document.querySelector('[data-upgrade="coffee"]');
  const enabled = !card.disabled;
  const cost = card.querySelector('.shop-cost b').textContent;
  card.click();
  await new Promise(rr=>setTimeout(rr,300));
  const s1 = window.__MOYU__.state;
  const confirming = card.className.includes('confirming');
  const lv1 = s1.levels.coffee || 0;
  card.click();
  await new Promise(rr=>setTimeout(rr,300));
  const s2 = window.__MOYU__.state;
  return JSON.stringify({ moyuBefore:+before.moyu.toFixed(2), totalClicks: before.totalClicks, cardEnabled:enabled, cost, levelAfter1Tap:lv1, needsConfirm: confirming, confirmingClass: card.className, levelAfter2Tap:s2.levels.coffee||0, moyuAfter2Tap:+s2.moyu.toFixed(2) });
})()`);
console.log("=== FIRST_PURCHASE_CONFIRM ===");
console.log(buy);
await shot("/tmp/r10-min4-buy.png");

// B) 巡逻：注 hook 后轮询（页面被 HMR 刷新则重注 hook，并继续等下一轮首次巡逻）
await evaluate(HOOK);
let banner = null, reloads = 0, waited = 0;
for (let i = 0; i < 160; i++) {
  await sleep(400); waited += 0.4;
  let probe;
  try {
    probe = JSON.parse(await evaluate(`JSON.stringify({ texts: (window.__texts||[]).slice(-120), hooked: !!CanvasRenderingContext2D.prototype.__r10patched, boot: performance.now() })`));
  } catch (e) {
    reloads++; await sleep(800); try { await evaluate(HOOK); } catch {}
    continue;
  }
  if (!probe.hooked || probe.boot < 1000) { await evaluate(HOOK).catch(()=>{}); }
  banner = probe.texts.find((x) => x.includes("老板"));
  if (banner) { console.log(`命中巡逻横幅（等待 ${waited.toFixed(1)}s，页面刷新 ${reloads} 次）`); break; }
}
console.log("=== PATROL_BANNER ===", JSON.stringify(banner));
if (banner) {
  await shot("/tmp/r10-min4-patrol.png");
  const patrolSnapshot = await evaluate(`JSON.stringify({ moyu: +window.__MOYU__.state.moyu.toFixed(2), surviveStreak: window.__MOYU__.state.surviveStreak, totalClicks: window.__MOYU__.state.totalClicks })`);
  console.log("=== PATROL_START_STATE ===", patrolSnapshot);
  await sleep(1400); // 越过 0.8s 宽限
  const res = await evaluate(`(async () => {
    const before = window.__MOYU__.state;
    const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
    for (let i=0;i<2;i++){ c.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'})); await new Promise(rr=>setTimeout(rr,180)); }
    await new Promise(rr=>setTimeout(rr,400));
    const after = window.__MOYU__.state;
    return JSON.stringify({ deltaMoyu: +(after.moyu-before.moyu).toFixed(2), surviveStreak: after.surviveStreak, totalClicks: after.totalClicks });
  })()`);
  console.log("=== PATROL_TAP_AFTER_GRACE (首次巡逻，新手保护) ===", res);
  await shot("/tmp/r10-min4-patrol-tap.png");
  // 等巡逻结束（≤9s）看结算
  await sleep(9000);
  const after = await evaluate(`JSON.stringify({ moyu: +window.__MOYU__.state.moyu.toFixed(2), surviveStreak: window.__MOYU__.state.surviveStreak, texts: (window.__texts||[]).slice(-40) })`);
  console.log("=== AFTER_PATROL ===", after);
  await shot("/tmp/r10-min4-after-patrol.png");
}

proc.kill();
process.exit(0);
