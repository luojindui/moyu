/** R7 附加只读探针：灰色商店卡（disabled）点击是否有任何反馈 / 📔 是否有反馈 / 首次购买反馈。不改 src/ */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9564;
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("playtest/r7-screens", { recursive: true });

const SCRIPT = `
(() => {
  const P = window.__dc = { muts: [], events: [], hint: { count: 0 } };
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
    try { const s = String(t); if (s !== '戳屏幕摸鱼') { P.events.push({ txt: s, ts: Math.round(performance.now()) }); if (P.events.length > 400) P.events.splice(0, 200); } else P.hint.count++; } catch (_) {}
    return orig.apply(this, arguments);
  };
  P.recent = function (sinceMs, winMs) { const now = performance.now(); const out = []; const seen = {}; for (let i = P.events.length - 1; i >= 0; i--) { const e = P.events[i]; if (now - e.ts > winMs) break; if (e.ts <= sinceMs) continue; if (!seen[e.txt]) { seen[e.txt] = 1; out.push(e.txt); } } return out; };
  const boot = setInterval(() => {
    const s = document.getElementById('shop-cards');
    if (!s) return;
    clearInterval(boot);
    new MutationObserver((ms) => { for (const m of ms) P.muts.push({ t: Math.round(performance.now()), type: m.type, attr: m.attributeName }); })
      .observe(s, { subtree: true, childList: true, characterData: true, attributes: true });
    new MutationObserver((ms) => { for (const m of ms) P.muts.push({ t: Math.round(performance.now()), type: 'hud-' + m.type }); })
      .observe(document.getElementById('hud'), { subtree: true, childList: true, characterData: true, attributes: true });
  }, 5);
})();
`;

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r7-dc-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
const tap = async (x, y) => { await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] }); await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); };
const state = () => ev("JSON.stringify(__MOYU__.state)").then(JSON.parse);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(1500);

const out = {};

// 0) 首次进入的新手教程：先点「开始摸鱼」关掉（等同真实玩家一进来先点掉弹窗）
const tut = JSON.parse(await ev("JSON.stringify((()=>{const t=document.getElementById(tutorial);if(!t)return null;const b=document.getElementById(tutorial-ok);const r=b.getBoundingClientRect();return {visible:!t.classList.contains(hidden),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),text:b.textContent,panel:[Math.round(t.querySelector(.tutorial-panel).getBoundingClientRect().x),Math.round(t.querySelector(.tutorial-panel).getBoundingClientRect().y),Math.round(t.querySelector(.tutorial-panel).getBoundingClientRect().width),Math.round(t.querySelector(.tutorial-panel).getBoundingClientRect().height)]};})())"));
out.tutorial = tut;
if (tut && tut.visible) { await tap(tut.x, tut.y); await sleep(350); }
out.tutorialClosed = await ev("!!document.getElementById(tutorial) && document.getElementById(tutorial).classList.contains(hidden)");

// 1) 点灰色（disabled）商店卡：咖啡续命中心
const cardRect = JSON.parse(await ev("JSON.stringify((()=>{const c=document.querySelector('[data-upgrade=coffee]');const r=c.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),disabled:c.disabled};})())"));
const s0 = await state();
const mark0 = await ev("performance.now()");
const mutBase = await ev("__dc.muts.length");
const hudBase = await ev("document.getElementById('hud-moyu').textContent");
await tap(cardRect.x, cardRect.y);
await sleep(400);
const s1 = await state();
out.disabledCardTap = {
  card: cardRect,
  moyuBefore: Math.round(s0.moyu * 10) / 10,
  moyuAfter: Math.round(s1.moyu * 10) / 10,
  domMutations: (await ev("__dc.muts.length")) - mutBase,
  floatTexts: JSON.parse(await ev(`JSON.stringify(__dc.recent(${mark0 - 5}, 1000))`)),
  hudSame: hudBase === (await ev("document.getElementById('hud-moyu').textContent")),
};

// 2) 点 📔
const jr = JSON.parse(await ev("JSON.stringify((()=>{const r=document.getElementById('btn-journal').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})())"));
await tap(jr.x, jr.y);
await sleep(300);
out.journalTap = {
  tap: jr,
  journalOpen: !(await ev("document.getElementById('journal').classList.contains('hidden')")),
  goals: await ev("document.getElementById('journal-goals').innerText"),
  claimBtn: await ev("document.getElementById('journal-claim').textContent"),
  shot: "playtest/r7-screens/journal.png",
};
const shot1 = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync("playtest/r7-screens/journal.png", Buffer.from(shot1.data, "base64"));
await ev("document.getElementById('journal-close').click()");
await sleep(200);

// 3) 连点场景 15 下（模拟 1 下/秒玩家），看多久第一张卡可买 + 购买后的反馈
const clicks = [];
for (let i = 0; i < 15; i++) {
  await tap(195, 430);
  await sleep(1000 - 60);
  const can = await ev("document.querySelector('[data-upgrade=coffee]').disabled === false");
  clicks.push({ i: i + 1, t: Math.round(await ev("performance.now()")), coffeeAffordable: can });
  if (can) break;
}
out.clicksToAffordable = clicks;
const sBeforeBuy = await state();
const mutBeforeBuy = await ev("__dc.muts.length");
const markBuy = await ev("performance.now()");
await tap(cardRect.x, cardRect.y);
await sleep(400);
const sAfterBuy = await state();
out.firstBuy = {
  moyuBefore: Math.round(sBeforeBuy.moyu * 10) / 10,
  moyuAfter: Math.round(sAfterBuy.moyu * 10) / 10,
  levels: sAfterBuy.levels,
  clickPowerHud: await ev("document.getElementById('hud-click').textContent"),
  cardText: await ev("document.querySelector('[data-upgrade=coffee]').innerText.replace(/\\n/g,' | ')"),
  domMutations: (await ev("__dc.muts.length")) - mutBeforeBuy,
  floatTexts: JSON.parse(await ev(`JSON.stringify(__dc.recent(${markBuy - 5}, 1200))`)),
};
out.hintDrawnCount = await ev("__dc.hint.count");
out.eventsSeen = JSON.parse(await ev("JSON.stringify(Object.keys(__dc.events.reduce((a,e)=>(a[e.txt]=1,a),{})))"));

writeFileSync("playtest/r7-deadclick.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
proc.kill();
process.exit(0);
