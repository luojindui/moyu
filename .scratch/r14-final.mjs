/** r14 复验收尾：超时提示 / 画布提示 / 老周好感 / 首次巡逻=回合制教学 / 次日保底 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname; mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { errors: [] };
let portSeq = 9590;

async function session(label, fn) {
  const port = portSeq++;
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r14q-${port}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 120; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(100); } }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); } };
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
  const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const shot = async (n) => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(DIR + n + ".png", Buffer.from(s.data, "base64")); };
  const h = { send, evalJs, shot, sleep,
    snap: () => evalJs(`(()=>({panel:!document.getElementById('boss-choice').classList.contains('hidden'),tell:(document.getElementById('boss-tell')||{}).textContent,toast:{text:(document.getElementById('dom-toast')||{}).textContent,show:(document.getElementById('dom-toast')||{className:''}).classList.contains('show')},moyu:window.__MOYU__?.state?.moyu,frames:window.__MOYU__?.frames}))()`),
    openChoice: async () => { await evalJs(`window.__MOYU__.forceBoss('choice')`); for (let i = 0; i < 30; i++) { const s = await h.snap(); if (s.panel) return s; await sleep(80); } return null; },
  };
  try {
    await send("Runtime.enable"); await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3500);
    await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
    await sleep(300);
    await fn(h);
  } catch (e) { out.errors.push(label + ": " + e.message); }
  try { proc.kill("SIGKILL"); } catch {}
  await sleep(200);
}

await session("timeout+canvas", async (h) => {
  await h.evalJs(`window.__MOYU__.grant(1e9)`); await h.sleep(300);
  // 跳卡
  if (await h.evalJs(`(()=>{const r=document.getElementById('cards');return !!(r&&!r.classList.contains('hidden'))})()`)) { await h.evalJs(`document.getElementById('cards-skip').click()`); await h.sleep(300); }
  // A. 超时
  const s1 = await h.openChoice();
  out.timeout = { open: !!s1, tell: s1?.tell };
  await h.sleep(5600);
  const after = await h.snap();
  out.timeout.after = after;
  await h.shot("17-boss-timeout");
  // B. 画布提示
  await h.sleep(800);
  const s2 = await h.openChoice();
  out.canvas = { open: !!s2, tell: s2?.tell };
  if (s2) {
    await h.sleep(400);
    const before = await h.snap();
    await h.evalJs(`(()=>{const c=document.getElementById('stage');c.dispatchEvent(new PointerEvent('pointerdown',{clientX:195,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
    await h.sleep(300);
    const afterTap = await h.snap();
    out.canvas.fx = await h.evalJs(`window.__MOYU__.fxTexts()`);
    out.canvas.delta = afterTap.moyu - before.moyu;
    out.canvas.panel = afterTap.panel;
    await h.shot("18-canvas-hint");
  }
});

await session("favor", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  const now = Date.now();
  const base = await h.evalJs(`JSON.parse(localStorage.getItem('moyu-save'))`);
  const mission = { level: 1, missionId: "stroll", startedAt: now - 120000, endsAt: now - 1000, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
  const blob = { ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["old_zhou_secret", "coffee_day", "overtime"], chosen: "old_zhou_secret", until: now + 86400000, nextDayGuaranteed: null, dismissed: true, chosenDate: T }, team: { colleagues: { zhou: mission } } };
  await h.evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});Storage.prototype.setItem=function(){}})()`);
  await h.send("Page.reload"); await h.sleep(2600);
  out.favor = { before: (await h.evalJs(`window.__MOYU__.state.team.colleagues.zhou.favor`)) };
  await h.evalJs(`document.getElementById('btn-team').click()`); await h.sleep(400);
  out.favor.btn = await h.evalJs(`!!document.querySelector('[data-act="claim"][data-id="zhou"]')`);
  await h.evalJs(`document.querySelector('[data-act="claim"][data-id="zhou"]').click()`); await h.sleep(500);
  out.favor.after = await h.evalJs(`window.__MOYU__.state.team.colleagues.zhou.favor`);
  out.favor.hud = await h.evalJs(`(document.getElementById('hud-card')||{}).textContent`);
  // 顺带记录卡面文案
  out.favor.desc = "领奖好感 +1 (卡片 desc)";
});

await session("teaching", async (h) => {
  // 不调 forceBoss：等首个自然巡逻（20-35s），验证"首次巡逻=回合制教学"
  let seen = null;
  for (let t = 0; t < 45; t++) {
    const s = await h.snap();
    if (s.panel) { seen = { waitedSec: t, ...s }; break; }
    await h.sleep(1000);
  }
  out.teaching = seen;
  if (seen) await h.shot("19-first-patrol-choice");
});

writeFileSync(DIR + "evidence-final.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
