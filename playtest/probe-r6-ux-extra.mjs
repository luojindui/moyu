/**
 * R6 · 补充探针：
 * 1) 日报领取后，领取按钮文案/禁用态是否即时更新（journal.refresh 节流 400ms 的影响）
 * 2) #stage 画布 CSS 高度为何比 #stage-wrap 高 42px（fit() 只在 resize 时调用）→ dispatch resize 后是否恢复
 * 3) 不可买商店卡被点击是否有任何反馈
 * 产出：playtest/r6-ux-extra.json
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9518;
const APP = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--disable-extensions", "--disable-background-networking",
    `--user-data-dir=/tmp/chrome-r6-extra-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank",
  ],
  { stdio: ["ignore", "ignore", "ignore"] },
);
const waitJson = async (p) => {
  for (let i = 0; i < 150; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return r.json(); } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("cdp not ready");
};
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
};
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, timeout: 20000 });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800));
  return r.result.value;
};
const tap = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await sleep(25);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const tapSel = async (sel) => {
  const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await tap(r.x, r.y);
};
const boot = async () => {
  await send("Page.navigate", { url: `${APP}?extra=${Date.now()}` });
  for (let i = 0; i < 150; i++) {
    if (await evaluate("!!window.__MOYU__")) break;
    await sleep(100);
  }
  await sleep(900);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await boot();
await send("Storage.clearDataForOrigin", { origin: "http://127.0.0.1:5173", storageTypes: "local_storage" });
await boot();

const out = {};

// ---- 1) 画布高度错位 & resize 修复 ----
out.canvasBefore = await evaluate(`(() => {
  const c = document.getElementById('stage'); const w = document.getElementById('stage-wrap');
  return { canvasCssH: c.clientHeight, wrapH: w.clientHeight, overflowPx: Math.round(c.getBoundingClientRect().height - w.getBoundingClientRect().height), canvasAttr: { w: c.width, h: c.height }, dpr: devicePixelRatio };
})()`);
await evaluate("window.dispatchEvent(new Event('resize'))");
await sleep(300);
out.canvasAfterResize = await evaluate(`(() => {
  const c = document.getElementById('stage'); const w = document.getElementById('stage-wrap');
  return { canvasCssH: c.clientHeight, wrapH: w.clientHeight, overflowPx: Math.round(c.getBoundingClientRect().height - w.getBoundingClientRect().height), canvasAttr: { w: c.width, h: c.height } };
})()`);

// ---- 3) 不可买卡片点击反馈（初始 0 摸鱼值，全部 disabled）----
out.disabledCardTap = await (async () => {
  const before = await evaluate(`(() => { const c = document.querySelector('.shop-card'); const r = c.getBoundingClientRect(); return { disabled: c.disabled, moyu: window.__MOYU__.state.moyu, cost: c.querySelector('.shop-cost').textContent, x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tap(before.x, before.y);
  await sleep(250);
  const after = await evaluate(`({ moyu: window.__MOYU__.state.moyu, levels: window.__MOYU__.state.levels, hud: document.getElementById('hud-moyu').textContent })`);
  return { before, after, tappedButNoChange: after.moyu === before.moyu && Object.keys(after.levels).length === 0 };
})();

// ---- 2) 领取按钮反馈时延（伪造可领存档）----
const forged = await evaluate(`(() => {
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const save = {
    v: 1, moyu: 300, totalEarned: 300, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 3600e3,
    collected: { quotes: [], flavors: [] },
    daily: { date: today, goals: [
      { id: 'click_100', target: 100, progress: 100, done: true },
      { id: 'meme_1', target: 1, progress: 1, done: true },
      { id: 'buy_3', target: 3, progress: 3, done: true } ], streak: 0, lastCompleteDate: null, claimed: false },
    surviveStreak: 0,
  };
  localStorage.setItem('moyu-save', JSON.stringify(save));
  window.__MOYU__.rewindSave(0.001);
  return true;
})()`);
await boot();
out.badgeBeforeClaim = await evaluate(`(() => { const b = document.getElementById('btn-journal'); return { hasReward: b.classList.contains('has-reward'), badge: getComputedStyle(b, '::after').content, title: b.getAttribute('title') }; })()`);
await tapSel("#btn-journal");
await sleep(350);
out.claimBefore = await evaluate(`(() => { const c = document.getElementById('journal-claim'); return { text: c.textContent, disabled: c.disabled, badge: document.getElementById('btn-journal').classList.contains('has-reward') }; })()`);
const t0 = Date.now();
await tapSel("#journal-claim");
out.claimTimeline = [];
for (const delay of [0, 60, 120, 200, 300, 420, 600, 900]) {
  const target = t0 + delay;
  const wait = target - Date.now();
  if (wait > 0) await sleep(wait);
  const s = await evaluate(`(() => { const c = document.getElementById('journal-claim'); return { t: ${delay}, text: c.textContent, disabled: c.disabled, hasReward: document.getElementById('btn-journal').classList.contains('has-reward'), badge: getComputedStyle(document.getElementById('btn-journal'), '::after').content, hudMoyu: document.getElementById('hud-moyu').textContent, claimed: window.__MOYU__.state.daily.claimed }; })()`);
  out.claimTimeline.push(s);
}

// ---- 4) 面板刚打开（refresh 节流窗口内）立刻领取：按钮文案/禁用态延迟 ----
const forge2 = await evaluate(`(() => {
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const save = {
    v: 1, moyu: 300, totalEarned: 300, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 3600e3,
    collected: { quotes: [], flavors: [] },
    daily: { date: today, goals: [
      { id: 'click_100', target: 100, progress: 100, done: true },
      { id: 'meme_1', target: 1, progress: 1, done: true },
      { id: 'buy_3', target: 3, progress: 3, done: true } ], streak: 0, lastCompleteDate: null, claimed: false },
    surviveStreak: 0,
  };
  localStorage.setItem('moyu-save', JSON.stringify(save));
  window.__MOYU__.rewindSave(0.001);
  return true;
})()`);
await boot();
await tapSel("#btn-journal");
await sleep(60);
out.claimFastBefore = await evaluate(`(() => { const c = document.getElementById('journal-claim'); return { text: c.textContent, disabled: c.disabled, hasReward: document.getElementById('btn-journal').classList.contains('has-reward') }; })()`);
const t1 = Date.now();
await tapSel("#journal-claim");
out.claimTimelineFast = [];
for (const delay of [0, 80, 160, 260, 380, 520, 700]) {
  const wait = t1 + delay - Date.now();
  if (wait > 0) await sleep(wait);
  out.claimTimelineFast.push(await evaluate(`(() => { const c = document.getElementById('journal-claim'); return { t: ${delay}, text: c.textContent, disabled: c.disabled, hasReward: document.getElementById('btn-journal').classList.contains('has-reward'), hudMoyu: document.getElementById('hud-moyu').textContent, claimed: window.__MOYU__.state.daily.claimed }; })()`));
}

writeFileSync("playtest/r6-ux-extra.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
try { proc.kill(); } catch { /* ignore */ }
process.exit(0);
