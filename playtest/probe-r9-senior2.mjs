/**
 * R9 中老年试玩探针 2（只读，不改 src/）
 * - 手抖微拖误买（6px 位移的「点击」是否触发购买）
 * - 买不起卡片点击反馈（仅有 .shake？有没有大字提示？）
 * - 长跑 150s 抓 canvas 事件横幅（丢梗/老板巡逻）真实字号、颜色、停留时间 + 截图
 * - 375x667 小屏首屏布局
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9582;
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("playtest/r9-screens", { recursive: true });

const SCRIPT = `
(() => {
  const P = window.__r9 = { fill: [], clicks: [], clsMuts: [], anims: [] };
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
    try {
      const s = String(t); const font = this.font;
      const last = P.fill[P.fill.length - 1];
      if (!last || last.text !== s || last.font !== font) P.fill.push({ ts: Math.round(performance.now()), font, fill: String(this.fillStyle), text: s.slice(0, 70), x: Math.round(x), y: Math.round(y) });
      if (P.fill.length > 600) P.fill.splice(0, 300);
    } catch (e) {}
    return orig.apply(this, arguments);
  };
  document.addEventListener('click', (e) => {
    const t = e.target, card = t.closest && t.closest('[data-upgrade]');
    P.clicks.push({ ts: Math.round(performance.now()), target: card ? 'card:' + card.dataset.upgrade : (t.id || t.tagName) });
  }, true);
  const boot = setInterval(() => {
    const s = document.getElementById('shop-cards');
    if (!s) return; clearInterval(boot);
    new MutationObserver((ms) => { for (const m of ms) if (m.attributeName === 'class') P.clsMuts.push({ ts: Math.round(performance.now()), up: m.target.dataset.upgrade, cls: String(m.target.className) }); })
      .observe(s, { subtree: true, attributes: true, attributeFilter: ['class'] });
    s.addEventListener('animationstart', (e) => P.anims.push({ ts: Math.round(performance.now()), name: e.animationName, up: e.target.dataset.upgrade }), true);
    s.addEventListener('animationend', (e) => P.anims.push({ ts: Math.round(performance.now()), name: e.animationName + ':end', up: e.target.dataset.upgrade }), true);
  }, 5);
})();
`;

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r9b-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const state = () => ev("JSON.stringify(__MOYU__.state)").then(JSON.parse);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(`playtest/r9-screens/${name}.png`, Buffer.from(r.data, "base64")); };
const tap = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
  await sleep(50);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const rectOf = (sel) => ev(`JSON.stringify((()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)};})())`).then(JSON.parse);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2500);
const out = {};

// 攒到咖啡可买（约 15 次点击 @1.2s，慢手）
for (let i = 0; i < 15; i++) { await tap(195, 430); await sleep(1200); }
const s0 = await state();
const coffee = await rectOf('[data-upgrade=coffee]');

// 1) 手抖：6px 位移的点击（模拟抖动/滑动起步）是否会误买
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: coffee.cx, y: coffee.cy, id: 3, radiusX: 10, radiusY: 10, force: 1 }] });
for (let i = 1; i <= 3; i++) { await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: coffee.cx + i * 2, y: coffee.cy + (i % 2 ? 1 : 0), id: 3, radiusX: 10, radiusY: 10, force: 1 }] }); await sleep(30); }
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(500);
const s1 = await state();
out.shakyTap = { card: coffee, moyuBefore: s0.moyu, moyuAfter: s1.moyu, coffeeLevelBefore: s0.levels.coffee ?? 0, coffeeLevelAfter: s1.levels.coffee ?? 0, accidentallyBought: (s1.levels.coffee ?? 0) > (s0.levels.coffee ?? 0), clickLog: JSON.parse(await ev("JSON.stringify(__r9.clicks)")).slice(-4), floatTexts: JSON.parse(await ev("JSON.stringify(__r9.fill.filter(e=>e.text[0]==='+'||e.text.includes('✓')))")).slice(-6) };

// 2) 买不起的卡片点击反馈（water 100）
const water = await rectOf('[data-upgrade=water]');
const w0 = await state();
const z0 = await ev("__r9.clsMuts.length");
await tap(water.cx, water.cy);
await sleep(150);
const clsNow = await ev("JSON.stringify(__r9.clsMuts.slice(-6))").then(JSON.parse);
await sleep(600);
const w1 = await state();
out.deadClick = { card: water, moyuDelta: Math.round((w1.moyu - w0.moyu) * 100) / 100, bought: (w1.levels.water ?? 0) > 0, clsMutations: JSON.parse(await ev("JSON.stringify(__r9.clsMuts.slice(" + z0 + "))")), anims: JSON.parse(await ev("JSON.stringify(__r9.anims)")), floatTextsAfter: JSON.parse(await ev("JSON.stringify(__r9.fill.filter(e=>e.text.includes('不够')||e.text.includes('差')||e.text.includes('再戳')))")), cardText: await ev("document.querySelector('[data-upgrade=water]').innerText.replace(/\\n/g,' | ')") };

// 3) 长跑抓事件（丢梗 45-75s / 老板巡逻 90-150s）
const eventLog = []; const seen = new Set(); let memeShot = false, bossShot = false;
const t0 = Date.now();
while (Date.now() - t0 < 165000) {
  const rec = JSON.parse(await ev("JSON.stringify(__r9.fill)"));
  for (const r of rec) {
    const key = r.font + '|' + r.fill + '|' + r.text.replace(/[0-9]+(\.[0-9]+)?/g, '#');
    if (seen.has(key)) continue;
    if (/丢梗|戳它|老板|忍住|连点|假装工作|安然|摸鱼冲刺|没达标/.test(r.text)) {
      seen.add(key);
      const item = { ...r, firstSeenAtMs: Math.round(performance.now()) };
      eventLog.push(item);
      const cur = await ev("JSON.stringify(__MOYU__.state)").then(JSON.parse);
      item.stateMoyu = Math.round(cur.moyu * 10) / 10;
      if (/丢梗/.test(r.text) && !memeShot) { memeShot = true; await shot("r9-meme-event"); }
      if (/老板|忍住|连点|假装工作/.test(r.text) && !bossShot) { bossShot = true; await shot("r9-boss-event"); }
    }
  }
  await sleep(400);
}
out.events = eventLog;
out.eventSeen = { memeShot, bossShot };

// 4) 小屏 375x667 首屏布局
await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 3, mobile: true, screenWidth: 375, screenHeight: 667 });
await sleep(800);
out.smallScreen = await ev(`JSON.stringify((()=>{
  const R=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return {y:Math.round(r.y),h:Math.round(r.height),bottom:Math.round(r.bottom)}};
  const jb=R('#btn-journal'), shop=R('#shop');
  return {hud:R('#hud'),quest:R('#quest'),stage:R('#stage-wrap'),shop,journalBtn:jb,journalOverlapsShop: !!(jb&&shop&&jb.bottom>shop.y), questVisible:!document.getElementById('quest').classList.contains('hidden')};
})())`).then(JSON.parse);
await shot("r9-small-screen-375x667");

writeFileSync("playtest/r9-senior-evidence2.json", JSON.stringify(out, null, 2));
console.log("WROTE playtest/r9-senior-evidence2.json");
console.log(JSON.stringify({ shaky: out.shakyTap, dead: { anims: out.deadClick.anims, cls: out.deadClick.clsMutations, text: out.deadClick.cardText }, events: out.events, seen: out.eventSeen, small: out.smallScreen }, null, 2));
ws.close();
proc.kill();
process.exit(0);
