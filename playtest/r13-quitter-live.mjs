/**
 * R13 弃坑型玩家：线上真实新号前 60s~190s 逐秒记录（只读探针，不改 src）。
 * 关注：打开就弹的「今日摸鱼卡」+ 回合制老板。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const OUT = "playtest/r13-q-live.json";
const SCREENS = "playtest/r13-q-screens";
mkdirSync(SCREENS, { recursive: true });

const b = await openBrowser({ port: 9473, tag: "r13q" });
const consoleErrs = [];
b.send("Log.enable").catch(() => {});
b.send("Runtime.enable").catch(() => {});
// 挂上 console/exception 监听（openBrowser 内部没暴露 onmessage 之外的钩子，简单轮询 window.onerror 兜底）
await setupMobilePage(b, { url: "https://luojindui.github.io/moyu/" });

const t0 = Date.now();
const log = [];
let shotN = 0;
const seen = { cards: false, boss: false, anyToast: [] };

const SNAP = `(() => {
  const q = (id) => document.getElementById(id);
  const vis = (id) => { const e = q(id); return !!e && !e.classList.contains('hidden'); };
  const toast = q('dom-toast');
  return {
    ready: !!q('stage'),
    cardsOpen: vis('cards'),
    cardsTitle: vis('cards') ? (q('cards-title')?.textContent || '') : '',
    cardTexts: [...document.querySelectorAll('#cards-body .card')].map(e => e.innerText.replace(/\\n/g,' | ')),
    cardRects: [...document.querySelectorAll('#cards-body .card')].map(e => { const r=e.getBoundingClientRect(); return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]; }),
    bossOpen: vis('boss-choice'),
    bossTell: q('boss-tell')?.textContent || '',
    bossOpts: [...document.querySelectorAll('#boss-opts button')].map(x => x.textContent),
    bossTimerW: q('boss-timer')?.firstElementChild ? getComputedStyle(q('boss-timer').firstElementChild).width : '',
    welcomeOpen: vis('welcome'),
    journalOpen: vis('journal'),
    teamOpen: vis('team'),
    toast: toast ? toast.textContent : '',
    toastShown: toast ? toast.classList.contains('show') : false,
    moyu: q('hud-moyu')?.textContent || '',
    click: q('hud-click')?.textContent || '',
    idle: q('hud-idle')?.textContent || '',
    rank: q('hud-rank')?.textContent || '',
    quest: q('quest-text')?.textContent || '',
    shopN: document.querySelectorAll('#shop-cards .shop-card').length,
    shopNames: [...document.querySelectorAll('#shop-cards .shop-card')].slice(0,3).map(e => (e.innerText||'').split('\\n')[0]),
  };
})()`;

async function snap(tag) {
  const d = await b.ev(SNAP);
  const rec = { at: +((Date.now() - t0) / 1000).toFixed(2), tag, ...d };
  log.push(rec);
  return rec;
}
async function shot(name) {
  shotN += 1;
  const p = `${SCREENS}/${String(shotN).padStart(2, "0")}-${name}.png`;
  await b.shot(p);
  return p;
}
async function tap(x, y) {
  await b.touch("touchStart", [{ x, y, id: 1 }]);
  await b.touch("touchEnd", []);
}

// —— 时间线 ——
// 0-4s：刚打开，只观察，不点（新玩家的第一反应）
let cardsFirstAt = null;
let lastCards = null;
let lastBoss = null;
const actions = [
  {
    at: 3.0,
    name: "试图点空白处关掉卡弹窗",
    run: async () => {
      await tap(30, 120);
      await sleep(200);
      const s = await snap("tapp-outside-1");
      if (s.cardsOpen) await shot("tap-outside-reopens");
    },
  },
  {
    at: 5.0,
    name: "再点一次空白处",
    run: async () => {
      await tap(30, 700);
      await sleep(200);
      await snap("tapp-outside-2");
    },
  },
  // 6-14s：读卡（真人阅读时间；这里留出 8 秒不操作）
  { at: 8.0, name: "读卡中截图", run: async () => { await snap("reading"); await shot("reading-cards"); } },
  {
    at: 15.0,
    name: "选卡：咖啡管够（自以为看懂了的一条）",
    run: async () => {
      const rect = await b.ev(`(() => { const els=[...document.querySelectorAll('#cards-body .card')]; const el=els.find(e=>e.innerText.includes('咖啡管够'))||els[0]; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
      if (rect) await tap(rect.x, rect.y);
      await sleep(250);
      const s = await snap("after-card-pick");
      await shot("after-card-pick");
      // 再等 2s 看 toast 是否还在 / 有没有后续
      await sleep(1200);
      await snap("after-card-pick+1.2s");
    },
  },
  // 18-55s：像真人一样戳屏幕（1.6s 一下，不追求手速）
  ...[18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40].map((at) => ({
    at,
    name: "tap-canvas",
    run: async () => { await tap(195, 430); },
  })),
  { at: 25, name: "25s 截图", run: async () => { await snap("t25"); await shot("t25"); } },
  { at: 45, name: "45s 截图", run: async () => { await snap("t45"); await shot("t45"); } },
  { at: 60, name: "60s 截图", run: async () => { await snap("t60"); await shot("t60"); } },
];

// 先等一下，确保页面加载（线上资源多，首次约 1-3s）
await sleep(600);
const boot = await snap("boot");
if (!boot.ready) {
  for (let i = 0; i < 100; i++) {
    await sleep(150);
    const s = await b.ev(`!!document.getElementById('stage')`);
    if (s) break;
  }
}

// 逐秒记录：每 100ms 采一次快照（只记变化/关键状态）
const startPoll = Date.now();
let lastKey = "";
while (Date.now() - startPoll < 190_000) {
  const el = (Date.now() - startPoll) / 1000;
  // 执行到点的动作
  for (const a of actions) {
    if (!a.done && el >= a.at) {
      a.done = true;
      try { await a.run(); } catch (e) { log.push({ at: +el.toFixed(2), tag: "action-fail:" + a.name, err: String(e).slice(0, 300) }); }
    }
  }
  let s;
  try { s = await b.ev(SNAP); } catch { s = null; }
  const now = +((Date.now() - startPoll) / 1000).toFixed(1);
  if (s) {
    const key = JSON.stringify([s.cardsOpen, s.cardTexts.length, s.bossOpen, s.bossTell, s.toastShown, s.toast, s.moyu, s.quest]);
    if (key !== lastKey) {
      log.push({ at: +((Date.now() - t0) / 1000).toFixed(2), tag: "state-change", ...s });
      lastKey = key;
      if (s.cardsOpen && !cardsFirstAt) {
        cardsFirstAt = +((Date.now() - t0) / 1000).toFixed(2);
        log.push({ at: cardsFirstAt, tag: "FIRST-CARD-MODAL" });
        await shot("first-card-modal");
      }
      if (!s.cardsOpen && lastCards && lastCards.cardsOpen) {
        await shot("card-closed");
      }
      if (s.bossOpen && (!lastBoss || !lastBoss.bossOpen)) {
        log.push({ at: +((Date.now() - t0) / 1000).toFixed(2), tag: "BOSS-OPEN", tell: s.bossTell, opts: s.bossOpts });
        await shot("boss-open");
      }
      if (!s.bossOpen && lastBoss && lastBoss.bossOpen) {
        log.push({ at: +((Date.now() - t0) / 1000).toFixed(2), tag: "BOSS-CLOSED", toast: s.toast, toastShown: s.toastShown });
        await shot("boss-closed");
      }
      if (s.toastShown && s.toast && !seen.anyToast.includes(s.toast)) {
        seen.anyToast.push(s.toast);
        log.push({ at: +((Date.now() - t0) / 1000).toFixed(2), tag: "TOAST", text: s.toast });
      }
    }
    lastCards = s;
    lastBoss = s;
  }
  // 每 5s 一张截图兜底
  if (Math.abs(now % 5) < 0.15) {
    try { await shot(`t${Math.round(now)}`); } catch {}
  }
  await sleep(250);
}

// 收尾：导出 localStorage 里是否记了卡/存档
let storage = {};
try {
  storage = await b.ev(`(() => { const o={}; for (let i=0;i<localStorage.length;i++){const k=localStorage.key(i); o[k]=(localStorage.getItem(k)||'').slice(0,400);} return o; })()`);
} catch {}
writeFileSync(OUT, JSON.stringify({ t0: new Date(t0).toISOString(), cardsFirstAt, consoleErrs, log, storage }, null, 2));
console.log("cardsFirstAt(s):", cardsFirstAt);
console.log("log lines:", log.length);
console.log("toasts:", seen.anyToast);
console.log("STORAGE KEYS:", Object.keys(storage));
b.close();
process.exit(0);
