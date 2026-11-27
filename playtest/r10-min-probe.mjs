/**
 * R10 极简主义试玩探针（只读 UI / 不改 src）
 * 目的：量化首屏认知负荷 + 验证是否存在「不学就会卡住」的强制学习。
 * 用法：node playtest/r10-min-probe.mjs
 * 输出：/tmp/r10-min-*.png + JSON 指标（stdout）
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.env.URL_ || "http://127.0.0.1:5173/";
const W = 390;
const H = 844;
const PORT = Number(process.env.SHOT_PORT || 9455);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--disable-extensions",
    `--user-data-dir=/tmp/chrome-min-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitJson(path, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}

await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, {
  method: "PUT",
}).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject, timer } = pending.get(m.id);
    pending.delete(m.id);
    clearTimeout(timer);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
function send(method, params = {}, timeoutMs = 30000) {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(i);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeoutMs);
    pending.set(i, { resolve, reject, timer });
  });
}

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function shot(path) {
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path, Buffer.from(s.data, "base64"));
}

await send("Emulation.setDeviceMetricsOverride", {
  width: W,
  height: H,
  deviceScaleFactor: 3,
  mobile: true,
  screenWidth: W,
  screenHeight: H,
});
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(600);
// 清档后重载，保证首屏是「纯新用户」
await evaluate("localStorage.clear(); location.reload(); true").catch(() => undefined);
await sleep(3200);

// ---------- 1) 首屏量化 ----------
const metrics = await evaluate(`(() => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) return false;
    return true;
  };
  const ownText = (el) => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('');
  const blocks = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const txt = ownText(el).replace(/\\s+/g, ' ').trim();
    if (!txt) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    blocks.push({
      text: txt, tag: el.tagName.toLowerCase(), id: el.id || undefined,
      cls: el.className && typeof el.className === 'string' ? el.className : undefined,
      px: parseFloat(cs.fontSize), color: cs.color,
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    });
  }
  const visibleText = blocks.map(b => b.text).join(' ');
  const nums = visibleText.match(/(\\d+(?:\\.\\d+)?)(?:\\.\\d+)?/g) || [];
  const numTokens = [...new Set(nums)];
  const isClickable = (el) => {
    if (['BUTTON','A','INPUT','TEXTAREA','SELECT'].includes(el.tagName)) return true;
    if (el.getAttribute && (el.getAttribute('role') === 'button' || el.hasAttribute('onclick'))) return true;
    const cs = getComputedStyle(el);
    return cs.cursor === 'pointer';
  };
  const clicks = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || !isClickable(el)) continue;
    const r = el.getBoundingClientRect();
    const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g,' ').trim().slice(0, 46);
    clicks.push({ tag: el.tagName.toLowerCase(), id: el.id || undefined, cls: String(el.className||'').slice(0,40), label, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), disabled: !!el.disabled });
  }
  // canvas 主交互区（pointerdown 监听 + 提示文字）
  const canvas = document.getElementById('stage');
  const cw = canvas ? canvas.getBoundingClientRect() : null;
  const canvasInteractive = cw && cw.width > 0;
  const sectionBox = (sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { y: Math.round(r.top), h: Math.round(r.height), pct: +(100*r.height/vh).toFixed(1) }; };
  const fontBuckets = {};
  for (const b of blocks) { const k = b.px < 12 ? 'lt12' : b.px < 14 ? '12-13' : b.px < 18 ? '14-17' : 'ge18'; fontBuckets[k] = (fontBuckets[k]||0)+1; }
  return JSON.stringify({
    vw, vh, dpr: devicePixelRatio,
    blocks, blockCount: blocks.length,
    nums, numTokens, numCount: nums.length,
    clicks, clickCount: clicks.length,
    canvasInteractive,
    sections: { hud: sectionBox('#hud'), stage: sectionBox('#stage-wrap'), shop: sectionBox('#shop') },
    fontBuckets,
    hint: (() => { const c = document.getElementById('stage'); return c ? 'canvas' : null; })(),
    hiddenPanels: [...document.querySelectorAll('#journal, #welcome')].map(e => ({ id: e.id, hidden: e.classList.contains('hidden') })),
  });
})()`);

console.log("=== FIRST_SCREEN_METRICS ===");
const M = JSON.parse(metrics);
console.log(JSON.stringify(M, null, 1));
await shot("/tmp/r10-min-firstscreen.png");

// ---------- 2) 连击 HUD / 点击反馈 ----------
const combo = await evaluate(`(async () => {
  const c = document.getElementById('stage');
  const send = (x, y) => c.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'touch' }));
  const r = c.getBoundingClientRect();
  const x = r.left + r.width/2, y = r.top + r.height/2;
  for (let i=0;i<5;i++){ send(x,y); await new Promise(rr=>setTimeout(rr,130)); }
  await new Promise(rr=>setTimeout(rr,200));
  const hud = document.getElementById('hud');
  const comboEl = document.getElementById('hud-combo');
  const streakEl = document.getElementById('hud-streak');
  return JSON.stringify({
    comboVisible: !comboEl.classList.contains('hidden'), comboText: comboEl.textContent,
    streakVisible: !streakEl.classList.contains('hidden'), streakText: streakEl.textContent,
    hudLines: [...document.querySelectorAll('#hud .hud-sub > *')].filter(e=>!e.classList.contains('hidden')).map(e=>e.textContent.trim()),
    hudText: hud.innerText.replace(/\\n+/g,' | '),
    state: window.__MOYU__ ? { moyu: window.__MOYU__.state.moyu, totalClicks: window.__MOYU__.state.totalClicks, daily: window.__MOYU__.state.daily } : null,
  });
})()`);
console.log("=== AFTER_5_TAPS ===");
console.log(JSON.stringify(JSON.parse(combo), null, 1));
await shot("/tmp/r10-min-after5taps.png");

// ---------- 3) 日报目标是否「可完成」（visit/idle 是否有推进路径） ----------
const daily = await evaluate(`(() => {
  const st = window.__MOYU__ ? window.__MOYU__.state : null;
  if (!st || !st.daily) return JSON.stringify({ err: 'no daily' });
  return JSON.stringify({ date: st.daily.date, window: st.daily.window, streak: st.daily.streak, claimed: st.daily.claimed, goals: st.daily.goals });
})()`);
console.log("=== DAILY_GOALS ===");
console.log(daily);

// ---------- 4) 打开 📔 面板：统计「被藏起来」的信息量 ----------
const journal = await evaluate(`(async () => {
  document.getElementById('btn-journal').click();
  await new Promise(r=>setTimeout(r,350));
  const panel = document.querySelector('#journal .journal-panel');
  const vis = (el) => { const cs = getComputedStyle(el); if (cs.display==='none'||cs.visibility==='hidden') return false; const r=el.getBoundingClientRect(); return r.width>1&&r.height>1; };
  const texts = [];
  for (const el of panel.querySelectorAll('*')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\\s+/g,' ').trim();
    if (own) texts.push(own);
  }
  const scrollH = panel.scrollHeight;
  const visibleH = panel.getBoundingClientRect().height;
  return JSON.stringify({
    scrollHeight: scrollH, visibleHeight: Math.round(visibleH), screens: +(scrollH/visibleH).toFixed(2),
    textBlocks: texts.length, numsDistinct: [...new Set((texts.join(' ').match(/\\d+(?:\\.\\d+)?/g)||[]))].length,
    gridCells: document.querySelectorAll('#journal-grid *').length,
    statRows: document.querySelectorAll('#stats-list > *').length,
    goals: document.querySelectorAll('#journal-goals > *').length,
    buttons: [...document.querySelectorAll('#journal button')].map(b=>b.textContent.trim()),
    sample: texts.slice(0, 40),
  });
})()`);
console.log("=== JOURNAL_PANEL ===");
console.log(JSON.stringify(JSON.parse(journal), null, 1));
await shot("/tmp/r10-min-journal.png");
await evaluate("document.getElementById('journal-close').click(); true");

// ---------- 5) 等第一次巡逻：是否「不学也会被罚」 ----------
const patrolWait = 34; // 首次巡逻 20-35s
await sleep(patrolWait * 1000);
const patrol = await evaluate(`(() => {
  const st = window.__MOYU__ ? window.__MOYU__.state : null;
  return JSON.stringify({
    now: performance.now()/1000,
    moyu: st && st.moyu, totalClicks: st && st.totalClicks, totalEarned: st && st.totalEarned,
    surviveStreak: st && st.surviveStreak,
    canvasHint: !!window.__MOYU__,
  });
})()`);
console.log("=== AT_~40s (第一次巡逻窗口内) ===");
console.log(patrol);
await shot("/tmp/r10-min-patrol.png");

// 巡逻中乱点 3 下（模拟「不知道规则的人猛戳」）→ 看是否扣钱（新手前 3 次巡逻应免罚）
const patrolTap = await evaluate(`(async () => {
  const c = document.getElementById('stage');
  const r = c.getBoundingClientRect();
  const before = window.__MOYU__.state;
  const send = (x,y)=>c.dispatchEvent(new PointerEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));
  for (let i=0;i<3;i++){ send(r.left+r.width/2, r.top+r.height/2); await new Promise(rr=>setTimeout(rr,140)); }
  await new Promise(rr=>setTimeout(rr,250));
  const after = window.__MOYU__.state;
  return JSON.stringify({ beforeMoyu: before.moyu, afterMoyu: after.moyu, beforeEarned: before.totalEarned, afterEarned: after.totalEarned, surviveStreak: after.surviveStreak, delta: after.moyu - before.moyu });
})()`);
console.log("=== PATROL_TAP_RESULT ===");
console.log(patrolTap);
await shot("/tmp/r10-min-patrol-tap.png");

// ---------- 6) 60s 时 HUD / 首屏文本变化（是否越来越吵） ----------
await sleep(18000);
const late = await evaluate(`(() => {
  const st = window.__MOYU__.state;
  const vis = (el) => { const cs=getComputedStyle(el); if(cs.display==='none'||cs.visibility==='hidden') return false; const r=el.getBoundingClientRect(); return r.width>1&&r.height>1; };
  const own = (el)=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('');
  const texts=[]; for (const el of document.querySelectorAll('body *')){ if(!vis(el)) continue; const t=own(el).replace(/\\s+/g,' ').trim(); if(t) texts.push(t); }
  return JSON.stringify({ moyu: st.moyu, blocks: texts.length, text: texts, hud: document.getElementById('hud').innerText.replace(/\\n+/g,' | '), questHidden: document.getElementById('quest').classList.contains('hidden') });
})()`);
console.log("=== AT_~60s ===");
console.log(JSON.stringify(JSON.parse(late), null, 1));
await shot("/tmp/r10-min-60s.png");

// ---------- 7) 「极简模式」模拟（仅注入 CSS，不改 src）：只保留「数字 + 点 + 价格」 ----------
const minimal = await evaluate(`(async () => {
  const st = document.createElement('style');
  st.id = 'r10-minimal-sim';
  st.textContent = [
    '#quest{display:none!important}',
    '#hud-combo,#hud-streak{display:none!important}',
    '#hud .hud-sub span:first-child{display:none!important}',
    '.shop-tag,.shop-value,.shop-remain,.shop-level,.shop-next{display:none!important}',
    '#shop-hint{display:none!important}',
    '#shop-cards{mask-image:none!important;-webkit-mask-image:none!important}',
  ].join('\\n');
  document.head.appendChild(st);
  await new Promise(r=>setTimeout(r,250));
  const vis = (el)=>{const cs=getComputedStyle(el);if(cs.display==='none'||cs.visibility==='hidden')return false;const r=el.getBoundingClientRect();return r.width>1&&r.height>1&&r.bottom>0&&r.top<innerHeight;};
  const own=(el)=>[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').replace(/\\s+/g,' ').trim();
  const texts=[]; for(const el of document.querySelectorAll('body *')){if(!vis(el))continue;const t=own(el);if(t)texts.push(t);}
  const nums=(texts.join(' ').match(/\\d+(?:\\.\\d+)?/g)||[]);
  const clicks=[...document.querySelectorAll('button,a')].filter(vis).length + (document.getElementById('stage')?1:0);
  const shop=document.getElementById('shop').getBoundingClientRect();
  return JSON.stringify({blocks:texts.length,texts,nums:nums.length,clicks,shopHeight:Math.round(shop.height)});
})()`);
console.log("=== MINIMAL_MODE_SIM ===");
console.log(JSON.stringify(JSON.parse(minimal), null, 1));
await shot("/tmp/r10-min-minimalmode.png");

proc.kill();
process.exit(0);
