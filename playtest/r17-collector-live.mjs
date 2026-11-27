/**
 * R17 终验-收集成就党 live 探针（必须用 playtest/lib/chrome.mjs；会自动清理 Chrome）
 *
 * 线上 https://luojindui.github.io/moyu/（生产包 v0.6.0，无 __MOYU__ 调试钩子）
 * ① 无痕新档：📔 → 成就墙 —— 22 条 / 10 分类 / 进度条 / 版本 v0.6.0（桌面 + 移动端）
 * ② seed 存档实测"完成成就后永久加成是否真的生效"（读 HUD 数值，对照引擎预期；不修改 src/）
 *    - A 对照：coffee Lv100 + phone Lv40，图鉴 55/55（3 条图鉴成就）
 *        HUD 点击力预期 3841 / 挂机 220.2
 *    - B click_1k：totalClicks=999 → 真实点一下 1000 → HUD 点击力应变为 3996.2
 *        （引擎单次应用应为 3917.8；若实测 3996.2 说明点击系成就在 effectOf 内+clickPowerOf 外被重复计入）
 *    - C idle_1k：phone Lv80，bestIdleRate 由 tick 自然记录 → HUD 挂机应 1795.2（+2% 生效）
 *    - D rank_7：rankIndex=7 → HUD 挂机应 220.2→224.6（+2% 生效）
 * ③ 完成瞬间是否有反馈（toast / 角标 / 播报）—— 收集党感知闭环
 * ④ 全系统拉满卡死态：成就墙 20/22、Lv.6，rank_14 永远 13/14、talent_18 永远 14/18
 * ⑤ 8 类收集系统的面板可见性（图鉴 55 / 家具 8 / 段位 14 / 同事 5 / 天赋 18 / 小游戏 3 / 本地纪录 / 成就墙）
 *
 * seed 关键技巧：先写 localStorage，再把 Storage.prototype.setItem 打补丁屏蔽 moyu-* 写入，
 * 否则 Page.reload 触发的 pagehide → saveNow() 会用当前状态覆盖种子。
 * 运行：node playtest/r17-collector-live.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PROD = "https://luojindui.github.io/moyu/";
const SHOTS = "playtest/r17-collector-shots-v063";
const OUT = "playtest/r17-collector-live-v063.json";
mkdirSync(SHOTS, { recursive: true });

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = {
  startedAt: new Date().toISOString(),
  url: PROD,
  version: "v0.6.3",
  expected: {
    // 与 playtest/r17-collector-engine.test.ts 输出一致（v0.6.3：点击只计一次 / 等级每级 +2% 挂机）
    A: { clickHud: "3841", idleHud: "220.2", achSummary: "3/22 · Lv.1" },
    B: { clickBefore: "3841", clickAfterSingle: "3917.8", clickAfterOldDoubleIfRegression: "3996.2", idleBefore: "220.2", idleAfterLevelReward: "224.6", achSummaryAfter: "4/22 · Lv.2" },
    C: { idleHud: "1831.1", achSummary: "4/22 · Lv.2" },
    D: { idleHud: "229.1", achSummary: "4/22 · Lv.2" },
    E: { achSummary: "22/22 · Lv.6", rank14: "14/14", talent18: "13/13", decorOfflineText: "离线收益 ×1.62" },
    F: { achSummary: "5/22 · Lv.2" },
    bars: { trackH: 5, trackW: 207, fillsVisibleOnFresh: 0, fillsVisibleOnMid: 15, allVisibleOnMax: 22 },
  },
  errors: [],
  steps: [],
};
const step = (s) => {
  R.steps.push({ t: +((Date.now() - t0) / 1000).toFixed(1), s });
  log("STEP", s);
};
const write = () => {
  R.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(R, null, 2));
  log("evidence ->", OUT);
};

// ---------- 存档构造 ----------
const fullCollected = () => ({ quotes: [...Array(10).keys()], flavors: [...Array(45).keys()] });
const emptyCards = (today) => ({ date: today, offers: [], chosen: null, until: 0, dismissed: true, chosenDate: "", nextDayGuaranteed: null });
const emptyEnergy = (today) => ({ date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } });
const TALENTS14 = ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"];
const MATES = ["zhou", "mei", "qiang", "li", "wang"];

function saveBase(today, over = {}) {
  const now = Date.now();
  return {
    v: 2,
    moyu: 0,
    totalEarned: 0,
    lifetimeEarned: 0,
    levels: { coffee: 100, phone: 40 },
    savedAt: now,
    createdAt: now,
    collected: fullCollected(),
    daily: null,
    surviveStreak: 0,
    totalClicks: 0,
    visits: { date: "", count: 0 },
    prestige: 0,
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: today, overflow: 0 },
    patrolSurvives: 0,
    cards: emptyCards(today),
    decor: [],
    energy: emptyEnergy(today),
    arcade: { date: today, played: 0, best: {} },
    bestIdleRate: 0,
    rankIndex: 0,
    cardsChosenTotal: 0,
    ...over,
  };
}

const saveStuck = (today) => {
  const cols = {};
  for (const id of MATES) cols[id] = { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: false, rewardSnapshot: 0 };
  return saveBase(today, {
    moyu: 1e11,
    totalEarned: 4e11,
    lifetimeEarned: 4e11,
    levels: { coffee: 100, phone: 40, group: 100 },
    collected: fullCollected(),
    totalClicks: 100000,
    bestIdleRate: 1e6,
    rankIndex: 14,
    surviveStreak: 10,
    bestSurviveStreak: 10,
    cardsChosenTotal: 5,
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    team: { colleagues: cols },
    talents: { unlocked: TALENTS14, points: 0, rankGranted: 12, dailyGiftDate: today, overflow: 0 },
    arcade: { date: today, played: 3, best: { findboss: 2000 } },
  });
};

const saveMid = (today) =>
  saveBase(today, {
    moyu: 5000,
    totalEarned: 8000,
    lifetimeEarned: 8000,
    levels: { coffee: 1 },
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    totalClicks: 5000,
    bestIdleRate: 800,
    rankIndex: 3,
    surviveStreak: 2,
    cardsChosenTotal: 2,
    decor: ["plant", "lamp", "rug"],
    team: {
      colleagues: {
        zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 30, autoRepeat: false, rewardSnapshot: 0 },
        mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 },
      },
    },
    talents: { unlocked: ["click_1", "idle_1", "event_1", "click_2"], points: 0, rankGranted: 0, dailyGiftDate: today, overflow: 0 },
    arcade: { date: today, played: 1, best: { findboss: 900 } },
  });

const RECORDS = { bestDayEarned: 123456, bestDayDate: "2026-11-26", maxStreak: 5, bestLifetime: 4e11, maxClicks: 12345, bestCollection: 20 };

// ---------- 页内读取脚本 ----------
const JS_HUD = `(() => ({
  moyu: (document.getElementById('hud-moyu')||{}).textContent || null,
  click: (document.getElementById('hud-click')||{}).textContent || null,
  idle: (document.getElementById('hud-idle')||{}).textContent || null,
  rank: (document.getElementById('hud-rank')||{}).textContent || null,
  rankTitle: document.getElementById('hud-rank') ? document.getElementById('hud-rank').title : null,
  quest: { hidden: document.getElementById('quest') ? document.getElementById('quest').classList.contains('hidden') : null, text: (document.getElementById('quest-text')||{}).textContent || null, bar: document.getElementById('quest-bar') ? document.getElementById('quest-bar').style.width : null },
  journalBtn: (function(){ var b = document.getElementById('btn-journal'); return b ? { cls: b.className, title: b.title } : null; })(),
  debugHook: typeof window.__MOYU__
}))()`;

const JS_WALL = `(() => {
  var items = Array.prototype.slice.call(document.querySelectorAll('#ach-list .ach-item')).map(function(el){
    var nameEl = el.querySelector('.ach-name');
    var descEl = el.querySelector('.ach-desc');
    var countEl = el.querySelector('.ach-count');
    var barEl = el.querySelector('.ach-progress > i');
    var trackEl = el.querySelector('.ach-progress');
    var tr = trackEl ? trackEl.getBoundingClientRect() : null;
    var fr = barEl ? barEl.getBoundingClientRect() : null;
    return {
      name: nameEl ? nameEl.textContent.replace('（已完成）', '') : '',
      desc: descEl ? descEl.textContent : '',
      count: countEl ? countEl.textContent : '',
      bar: barEl ? barEl.style.width : '',
      done: el.classList.contains('done'),
      track: tr ? { w: Math.round(tr.width * 10) / 10, h: Math.round(tr.height * 10) / 10 } : null,
      fill: fr ? { w: Math.round(fr.width * 10) / 10, h: Math.round(fr.height * 10) / 10 } : null
    };
  });
  var cats = Array.prototype.slice.call(document.querySelectorAll('#ach-categories .ach-cat')).map(function(el){
    return { text: el.textContent, done: el.classList.contains('done') };
  });
  var barsRendered = items.filter(function(i){ return i.track && i.track.h >= 3 && i.track.w >= 20; }).length;
  var fillsRendered = items.filter(function(i){ return i.fill && i.fill.h >= 3 && i.fill.w >= 1; }).length;
  return {
    summary: (document.getElementById('ach-summary')||{}).textContent || null,
    count: items.length,
    cats: cats,
    doneNames: items.filter(function(i){ return i.done; }).map(function(i){ return i.name; }),
    barsRendered: barsRendered,
    fillsRendered: fillsRendered,
    items: items
  };
})()`;

const JS_JOURNAL = `(() => {
  var stats = Array.prototype.slice.call(document.querySelectorAll('#stats-list .stat-row')).map(function(r){ return r.textContent; });
  var grid = document.getElementById('journal-grid');
  var cItems = grid ? grid.querySelectorAll('.c-item') : [];
  var cOn = grid ? grid.querySelectorAll('.c-item.on') : [];
  return {
    version: (document.getElementById('about-version')||{}).textContent || null,
    notes: (document.getElementById('about-notes')||{}).textContent || null,
    today: (document.getElementById('about-today')||{}).textContent || null,
    journalTotal: (document.getElementById('journal-total')||{}).textContent || null,
    quote: (document.getElementById('journal-quote')||{}).textContent || null,
    flavor: (document.getElementById('journal-flavor')||{}).textContent || null,
    statsRank: (document.getElementById('stats-rank')||{}).textContent || null,
    stats: stats,
    grid: { total: cItems.length, on: cOn.length, firstOffLabel: (grid && grid.querySelector('.c-item.off .c-label')) ? grid.querySelector('.c-item.off .c-label').textContent : null },
    achSummary: (document.getElementById('ach-summary')||{}).textContent || null,
    panelScroll: (function(){ var p = document.querySelector('#journal .journal-panel'); return p ? { scrollH: p.scrollHeight, clientH: p.clientHeight, scrollW: p.scrollWidth, clientW: p.clientWidth } : null; })()
  };
})()`;

const JS_PANELS = `(() => {
  function txt(sel){ var e = document.querySelector(sel); return e ? e.textContent : null; }
  var mates = Array.prototype.slice.call(document.querySelectorAll('#team .mate')).map(function(m){
    var n = m.querySelector('.mate-name'); var f = m.querySelector('.favor-track .favor-bar');
    return { name: n ? n.textContent.replace(/\\s+/g,' ').trim() : '', favorWidth: f ? f.style.width : '', locked: m.classList.contains('locked') };
  });
  var talents = Array.prototype.slice.call(document.querySelectorAll('#team .talent')).map(function(t){
    var n = t.querySelector('.talent-name'); return { name: n ? n.textContent : '', on: t.classList.contains('on') };
  });
  return {
    teamSummary: (document.querySelector('#team .team-summary')||{}).textContent || null,
    tabs: Array.prototype.slice.call(document.querySelectorAll('#team .tab')).map(function(t){ return { text: t.textContent, active: t.classList.contains('active') }; }),
    mates: mates,
    talents: talents,
    decorSummary: (document.querySelector('#team .team-summary')||{}).textContent || null,
    teamHint: txt('#team .team-hint'),
    bodyLen: (document.getElementById('team-body')||{}).innerHTML ? document.getElementById('team-body').innerHTML.length : 0
  };
})()`;

const JS_ARCADE = `(() => {
  var cards = Array.prototype.slice.call(document.querySelectorAll('#arcade .arcade-card, #arcade [data-game]')).map(function(c){ return c.textContent.replace(/\\s+/g,' ').trim().slice(0, 60); });
  return { text: (document.getElementById('arcade-body')||{}).textContent ? document.getElementById('arcade-body').textContent.replace(/\\s+/g,' ').trim().slice(0, 300) : null, cardCount: cards.length };
})()`;

const JS_MOBILE = `(() => {
  var items = Array.prototype.slice.call(document.querySelectorAll('#ach-list .ach-item'));
  var p = document.querySelector('#journal .journal-panel');
  var names = items.map(function(el){ var n = el.querySelector('.ach-name'); return n ? { w: Math.round(n.getBoundingClientRect().width), scrollW: n.scrollWidth } : null; });
  return {
    innerW: window.innerWidth, innerH: window.innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    panel: p ? { scrollW: p.scrollWidth, clientW: p.clientWidth, scrollH: p.scrollHeight, clientH: p.clientHeight } : null,
    itemCount: items.length,
    itemHeights: items.map(function(el){ return Math.round(el.getBoundingClientRect().height); }),
    nameOverflow: names.filter(function(n){ return n && n.scrollW > n.w + 2; }).length,
    achSummary: (document.getElementById('ach-summary')||{}).textContent || null
  };
})()`;

// ---------- 主流程 ----------
async function main() {
  await runChrome(
    async ({ port }) => {
      const c = await connect(port);
      const rawSend = c.send.bind(c);
      c.send = (m, p) => Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 15000))]);
      const ev = async (expr) => {
        try {
          return await c.ev(expr);
        } catch (e) {
          return { __err: String(e).slice(0, 300) };
        }
      };
      const waitFor = async (expr, ms = 30000) => {
        const st = Date.now();
        while (Date.now() - st < ms) {
          const v = await ev(expr);
          if (v === true) return true;
          await sleep(150);
        }
        return false;
      };
      const shot = async (name) => {
        try {
          const r = await c.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(r.data, "base64"));
          log("shot", name);
        } catch (e) {
          log("shot FAIL", name, String(e).slice(0, 80));
        }
      };
      const viewport = (width, height, mobile, dpr = 1) => c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
      const openJournal = async () => {
        await ev("(function(){ var j = document.getElementById('journal'); if (j && j.classList.contains('hidden')) document.getElementById('btn-journal').click(); return true; })()");
        await sleep(700);
      };
      const closeJournal = async () => {
        await ev("(function(){ var b = document.getElementById('journal-close'); if (b) b.click(); return true; })()");
        await sleep(300);
      };
      const dismiss = async () => {
        for (let i = 0; i < 4; i++) {
          const r = await ev(`(() => {
            var w = document.getElementById('welcome');
            if (w && !w.classList.contains('hidden')) { var b = document.getElementById('welcome-ok'); if (b) b.click(); return 'welcome'; }
            var cd = document.getElementById('cards');
            if (cd && !cd.classList.contains('hidden')) { var s = document.getElementById('cards-skip'); if (s) s.click(); return 'cards'; }
            return 'none';
          })()`);
          if (r === "none") return "none";
          await sleep(250);
        }
        return "loop";
      };
      const scrollTo = (sel, block) =>
        ev(`(function(){ var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'no-el'; e.scrollIntoView({ block: ${JSON.stringify(block)} }); return 'ok'; })()`);
      const seedSave = async (save, records) => {
        const saveStr = JSON.stringify(JSON.stringify(save));
        const recPart = records ? `orig.call(localStorage, 'moyu-records', ${JSON.stringify(JSON.stringify(records))});` : "";
        return ev(`(() => {
          var orig = Storage.prototype.setItem;
          orig.call(localStorage, 'moyu-save', ${saveStr});
          ${recPart}
          Storage.prototype.setItem = function(k, v) {
            if (typeof k === 'string' && k.indexOf('moyu-') === 0) { window.__r17BlockedSave = (window.__r17BlockedSave || 0) + 1; return; }
            return orig.call(this, k, v);
          };
          return 'seeded';
        })()`);
      };
      const reload = async (waitMs = 1800) => {
        await c.send("Page.reload", { ignoreCache: false });
        const ok = await waitFor("document.readyState === 'complete' && !!document.getElementById('btn-journal')", 30000);
        await sleep(waitMs);
        await dismiss();
        return ok;
      };
      const clickCanvas = async () =>
        ev(`(() => {
          var cv = document.getElementById('stage');
          var r = cv.getBoundingClientRect();
          cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        })()`);
      const readLog = async () => (await ev("window.__r17Log ? window.__r17Log : null")) || { toasts: [], announces: [] };

      try {
        await c.send("Page.enable");
        await c.send("Runtime.enable");
        // 每次新文档注入 toast/播报日志（用于判断"成就完成有没有提示"）
        await c.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `(function(){
            window.__r17Log = { toasts: [], announces: [] };
            function push(arr, text, at) { if (!text) return; if (arr.length && arr[arr.length-1].text === text) return; arr.push({ at: Math.round(at), text: text }); }
            function start() {
              var obs = new MutationObserver(function(){
                var t = document.getElementById('dom-toast');
                if (t && t.classList.contains('show')) push(window.__r17Log.toasts, (t.textContent||'').trim(), performance.now());
                var l = document.getElementById('sr-live');
                if (l) push(window.__r17Log.announces, (l.textContent||'').trim(), performance.now());
              });
              obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
            }
            if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
          })();`,
        });

        // ===== 阶段 0：线上无痕新档 =====
        step("navigate prod fresh profile");
        await viewport(1280, 800, false, 1);
        await c.send("Page.navigate", { url: PROD });
        const booted = await waitFor("document.readyState === 'complete' && !!document.getElementById('btn-journal')", 45000);
        await sleep(2600);
        await dismiss();
        R.fresh = {};
        R.fresh.booted = booted;
        R.fresh.title = await ev("document.title");
        R.fresh.hasDebugHook = await ev("typeof window.__MOYU__");
        R.fresh.hud0 = await ev(JS_HUD);
        R.fresh.storage = await ev("({ save: localStorage.getItem('moyu-save') ? JSON.parse(localStorage.getItem('moyu-save')) : null, records: localStorage.getItem('moyu-records') })");
        await shot("01-fresh-first-screen");
        await openJournal();
        await sleep(600);
        R.fresh.journal = await ev(JS_JOURNAL);
        R.fresh.wall = await ev(JS_WALL);
        R.fresh.wallCount = R.fresh.wall ? R.fresh.wall.count : 0;
        await shot("02-fresh-journal-top");
        await scrollTo("#ach-list", "start");
        await sleep(400);
        await shot("03-fresh-achievements");
        await scrollTo("#journal-grid", "center");
        await sleep(300);
        await shot("04-fresh-collection-grid");
        await closeJournal();
        // 队伍 3 个页签
        await ev("(function(){ document.getElementById('btn-team').click(); return true; })()");
        await sleep(500);
        R.fresh.teamColleagues = await ev(JS_PANELS);
        await shot("05-fresh-team-colleagues");
        await ev("(function(){ document.getElementById('tab-talents').click(); return true; })()");
        await sleep(400);
        R.fresh.teamTalents = await ev(JS_PANELS);
        await shot("06-fresh-team-talents");
        await ev("(function(){ document.getElementById('tab-decor').click(); return true; })()");
        await sleep(400);
        R.fresh.teamDecor = await ev(JS_PANELS);
        await shot("07-fresh-team-decor");
        await ev("(function(){ document.getElementById('team-close').click(); return true; })()");
        await sleep(300);
        // 摸鱼站
        await ev("(function(){ document.getElementById('btn-arcade').click(); return true; })()");
        await sleep(600);
        R.fresh.arcade = await ev(JS_ARCADE);
        await shot("08-fresh-arcade");
        await ev("(function(){ var b = document.getElementById('arcade-close'); if (b) b.click(); return true; })()");
        await sleep(300);
        const TODAY = await ev("new Date().toLocaleDateString('sv-SE')");
        R.today = TODAY;

        // ===== 阶段 A：seed 对照（coffee100+phone40，全图鉴 3 条成就） =====
        step("seed A control");
        await seedSave(saveBase(TODAY));
        await reload(1800);
        R.A = { hud: await ev(JS_HUD), log: await readLog() };
        await openJournal();
        R.A.journal = await ev(JS_JOURNAL);
        R.A.wall = await ev(JS_WALL);
        await closeJournal();
        log("A hud", JSON.stringify(R.A.hud));

        // ===== 阶段 B：click_1k 完成瞬间（999 → 真实点一下 → 1000） =====
        step("seed B totalClicks=999");
        await seedSave(saveBase(TODAY, { totalClicks: 999 }));
        await reload(1800);
        R.B = { before: { hud: await ev(JS_HUD), log: await readLog() } };
        await openJournal();
        R.B.before.wall = await ev(JS_WALL);
        await sleep(200);
        R.B.before.log = await readLog();
        await scrollTo("#ach-list", "start");
        await sleep(300);
        // 观察期间真实点一下画布（成就墙开着，验证面板是否 400ms 内热更新）
        const tapAt = await clickCanvas();
        await sleep(900);
        R.B.after = { hud: await ev(JS_HUD), log: await readLog(), tapAt };
        R.B.after.wall = await ev(JS_WALL);
        await shot("09-bonus-click-wall-after");
        R.B.toastDiff = {
          newToasts: R.B.after.log.toasts.filter((t) => !R.B.before.log.toasts.some((b) => b.text === t.text)),
          newAnnounces: R.B.after.log.announces.filter((t) => !R.B.before.log.announces.some((b) => b.text === t.text)),
        };
        R.B.journalBtnAfter = await ev("(function(){ var b = document.getElementById('btn-journal'); return b ? { cls: b.className, title: b.title } : null; })()");
        await closeJournal();
        // 刷新验证"永久"：不加 seed，靠页面自身 pagehide 存档
        step("reload to verify persistence of click_1k");
        await reload(1800);
        R.B.afterReload = { hud: await ev(JS_HUD) };
        await openJournal();
        R.B.afterReload.wall = await ev(JS_WALL);
        await closeJournal();
        log("B", JSON.stringify({ before: R.B.before.hud, after: R.B.after.hud, summary: R.B.after.wall.summary, toasts: R.B.toastDiff, bars: { rendered: R.B.after.wall.barsRendered, fills: R.B.after.wall.fillsRendered }, reload: R.B.afterReload.hud }));

        // ===== 阶段 C：idle_1k 由 tick 自然记录 bestIdleRate 后自动完成 =====
        step("seed C phone80 → idle_1k auto");
        await seedSave(saveBase(TODAY, { levels: { coffee: 100, phone: 80 } }));
        await reload(2000);
        R.C = { hud: await ev(JS_HUD), log: await readLog() };
        await shot("10-bonus-idle-hud");
        await openJournal();
        R.C.wall = await ev(JS_WALL);
        await scrollTo("#ach-list", "start");
        await sleep(300);
        await shot("11-bonus-idle-wall");
        await closeJournal();
        log("C hud", JSON.stringify(R.C.hud));

        // ===== 阶段 D：rank_7（rankIndex=7）自然完成 =====
        step("seed D rankIndex=7 → rank_7");
        await seedSave(saveBase(TODAY, { rankIndex: 7 }));
        await reload(2000);
        R.D = { hud: await ev(JS_HUD), log: await readLog() };
        await openJournal();
        R.D.wall = await ev(JS_WALL);
        await closeJournal();
        log("D hud", JSON.stringify(R.D.hud));

        // ===== 阶段 E：全系统拉满 → 20/22 卡死态 =====
        step("seed E maxed-out state");
        await seedSave(saveStuck(TODAY), RECORDS);
        await reload(2200);
        R.E = { hud: await ev(JS_HUD), log: await readLog() };
        await openJournal();
        R.E.journal = await ev(JS_JOURNAL);
        R.E.wall = await ev(JS_WALL);
        await scrollTo("#ach-list", "start");
        await sleep(400);
        await shot("12-stuck-wall-top");
        await scrollTo("#ach-list .ach-item:last-child", "end");
        await sleep(400);
        await shot("13-stuck-wall-bottom");
        R.E.scrollTop = await ev("(function(){ var p = document.querySelector('#journal .journal-panel'); return p ? Math.round(p.scrollTop) : null; })()");
        await closeJournal();
        // 队伍面板：满配的 5 同事 / 18 天赋（14 亮） / 8 家具
        await ev("(function(){ document.getElementById('btn-team').click(); return true; })()");
        await sleep(500);
        R.E.teamColleagues = await ev(JS_PANELS);
        await shot("14-stuck-team-colleagues");
        await ev("(function(){ document.getElementById('tab-talents').click(); return true; })()");
        await sleep(400);
        R.E.teamTalents = await ev(JS_PANELS);
        await shot("15-stuck-team-talents");
        await ev("(function(){ document.getElementById('tab-decor').click(); return true; })()");
        await sleep(400);
        R.E.teamDecor = await ev(JS_PANELS);
        await shot("16-stuck-team-decor");
        await ev("(function(){ document.getElementById('team-close').click(); return true; })()");
        await sleep(300);
        await ev("(function(){ document.getElementById('btn-arcade').click(); return true; })()");
        await sleep(500);
        R.E.arcade = await ev(JS_ARCADE);
        await shot("17-stuck-arcade");
        await ev("(function(){ var b = document.getElementById('arcade-close'); if (b) b.click(); return true; })()");
        await sleep(300);
        // 移动端 390×844 看成就墙排版
        step("mobile 390x844 wall layout");
        await viewport(390, 844, true, 2);
        await sleep(500);
        await reload(2000);
        await openJournal();
        await scrollTo("#ach-list", "start");
        await sleep(500);
        R.E.mobile = await ev(JS_MOBILE);
        R.E.mobile.hud = await ev(JS_HUD);
        await shot("18-mobile-wall");
        await viewport(1280, 800, false, 1);
        await sleep(400);

        // ===== 阶段 F：中盘进度墙（15 条未完成都带进度条） =====
        step("seed F mid-progress state");
        await seedSave(saveMid(TODAY));
        await reload(1800);
        R.F = { hud: await ev(JS_HUD), log: await readLog() };
        await openJournal();
        R.F.wall = await ev(JS_WALL);
        await scrollTo("#ach-list", "start");
        await sleep(400);
        await shot("19-mid-wall");
        R.F.journal = await ev(JS_JOURNAL);
        await closeJournal();
        log("F", JSON.stringify({ hud: R.F.hud, summary: R.F.wall.summary }));

        R.consoleErrors = (c.errors || []).slice(0, 30);
      } catch (e) {
        R.fatal = String(e && e.stack ? e.stack : e).slice(0, 1200);
        log("FATAL", R.fatal);
      } finally {
        try {
          c.close();
        } catch {
          /* ignore */
        }
      }
    },
    { timeoutMs: 420_000 },
  );
  write();
}

main().catch((e) => {
  R.fatal = String(e && e.stack ? e.stack : e).slice(0, 1200);
  write();
  console.error("FAILED", R.fatal);
  process.exit(1);
});