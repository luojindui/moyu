/**
 * R10 极简主义探针 2：基线 vs 极简 CSS 模拟、首购确认、巡逻横幅（只读 src，注入仅限本脚本）
 * 用法：node playtest/r10-min-probe2.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.env.URL_ || "http://127.0.0.1:5173/";
const W = 390, H = 844;
const PORT = 9461;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-min2-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });

async function waitJson(path, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject, timer } = pending.get(m.id); pending.delete(m.id); clearTimeout(timer); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
function send(method, params = {}, timeoutMs = 30000) {
  const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(i); reject(new Error("timeout " + method)); }, timeoutMs); pending.set(i, { resolve, reject, timer }); });
}
async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}
async function shot(path) {
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path, Buffer.from(s.data, "base64"));
}
const MEASURE = `(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  };
  const own = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\\s+/g,' ').trim();
  const blocks = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const txt = own(el); if (!txt) continue;
    blocks.push({ text: txt, px: parseFloat(getComputedStyle(el).fontSize), y: Math.round(el.getBoundingClientRect().top) });
  }
  const nums = blocks.map(b=>b.text).join(' ').match(/\\d+(?:\\.\\d+)?/g) || [];
  const clicks = [...document.querySelectorAll('button,a,[role=button]')].filter(vis)
    .map(e => ({ label: (e.getAttribute('aria-label')||e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,28), disabled: !!e.disabled, x: Math.round(e.getBoundingClientRect().left) }));
  const rect = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), pct: +(100*r.height/vh).toFixed(1) }; };
  return JSON.stringify({
    blocks: blocks.length, nums: nums.length, distinctNums: [...new Set(nums)].length,
    clicks: clicks.length, clickTargets: clicks,
    smallFonts: blocks.filter(b=>b.px<12).length,
    sections: { hud: rect('#hud'), stage: rect('#stage-wrap'), shop: rect('#shop') },
    shopVisibleCards: [...document.querySelectorAll('#shop-cards .shop-card')].filter(vis).length,
    text: blocks.map(b=>b.text),
  });
})()`;

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(500);
await evaluate("localStorage.clear(); location.reload(); true").catch(() => {});
await sleep(3000);

const base = await evaluate(MEASURE);
console.log("=== BASE ===");
console.log(base);
await shot("/tmp/r10-min2-base.png");

await evaluate(`(() => { const st=document.createElement('style'); st.id='r10-min-sim';
  st.textContent = [
    '#quest{display:none!important}',
    '#hud-combo,#hud-streak{display:none!important}',
    '#hud-rank{display:none!important}',
    '.shop-tag,.shop-value,.shop-remain,.shop-level{display:none!important}',
    '#shop-hint{display:none!important}',
    '#shop-cards{mask-image:none!important;-webkit-mask-image:none!important}',
    '#btn-mute{display:none!important}'
  ].join('\\n'); document.head.appendChild(st); return true; })()`);
await sleep(400);
const mini = await evaluate(MEASURE);
console.log("=== MINIMAL_SIM ===");
console.log(mini);
await shot("/tmp/r10-min2-minimal.png");

// ---- 首购是否要二次确认（价格 ≥ 余额一半）----
const buy = await evaluate(`(async () => {
  const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
  const tap = (x,y)=>c.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));
  for (let i=0;i<20;i++){ tap(r.left+r.width/2, r.top+r.height/2); await new Promise(rr=>setTimeout(rr,40)); }
  await new Promise(rr=>setTimeout(rr,300));
  const before = window.__MOYU__.state;
  const card = document.querySelector('[data-upgrade="coffee"]');
  card.click();
  await new Promise(rr=>setTimeout(rr,250));
  const after1 = window.__MOYU__.state;
  const cls1 = card.className;
  const lv1 = after1.levels.coffee || 0;
  card.click();
  await new Promise(rr=>setTimeout(rr,250));
  const after2 = window.__MOYU__.state;
  return JSON.stringify({ moyuBefore: +before.moyu.toFixed(2), levelAfter1stTap: lv1, confirmingClass: cls1.includes('confirming'), levelAfter2ndTap: after2.levels.coffee || 0, moyuAfter2nd: +after2.moyu.toFixed(2) });
})()`);
console.log("=== FIRST_PURCHASE ===");
console.log(buy);

// ---- 巡逻横幅检测：patch fillText 记录本帧文字（仅测试注入）----
await evaluate(`(() => { window.__texts=[]; window.__ft = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function(t,...a){ try{ (window.__texts=window.__texts||[]).push(String(t)); if(window.__texts.length>200) window.__texts.splice(0,100);}catch{} return window.__ft.call(this,t,...a); }; return true; })()`);
let found = null;
for (let i = 0; i < 90; i++) {
  await sleep(500);
  const txt = await evaluate("JSON.stringify((window.__texts||[]).slice(-80))");
  const arr = JSON.parse(txt);
  const banner = arr.find((x) => x.includes("老板"));
  if (banner) { found = banner; break; }
}
console.log("=== PATROL_BANNER ===", found);
if (found) {
  await shot("/tmp/r10-min2-patrol.png");
  await sleep(1300); // 过 0.8s 宽限
  const patrolTap = await evaluate(`(async () => {
    const before = window.__MOYU__.state;
    const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
    for (let i=0;i<2;i++){ c.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'})); await new Promise(rr=>setTimeout(rr,150)); }
    await new Promise(rr=>setTimeout(rr,300));
    const after = window.__MOYU__.state;
    return JSON.stringify({ deltaMoyu: +(after.moyu-before.moyu).toFixed(2), surviveStreakAfter: after.surviveStreak });
  })()`);
  console.log("=== PATROL_TAP (rookie) ===", patrolTap);
  await shot("/tmp/r10-min2-patrol-tap.png");
}

proc.kill();
process.exit(0);
