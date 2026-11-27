/**
 * R17 收集成就党 探针2：成就墙"进度条"是否真的渲染 + 排版细节
 * 背景：CSS 里 .ach-name/.ach-desc/.ach-progress 都是 span 且无 display:block/flex，
 *       .ach-progress 是 inline 元素（height:4px 对 inline 无效），怀疑视觉上根本没有进度条。
 * 本探针在线上生产包 seed 一个中盘存档，量算 .ach-progress / >i 的 computed style + 实际盒子，
 * 并抓一张 2x 放大的单条卡片截图作为证据。
 * 运行：node playtest/r17-collector-layout.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PROD = "https://luojindui.github.io/moyu/";
const SHOTS = "playtest/r17-collector-shots-v061";
mkdirSync(SHOTS, { recursive: true });
const OUT = "playtest/r17-collector-layout-v061.json";
const log = (...a) => console.log("[r17-layout]", ...a);
const R = { startedAt: new Date().toISOString(), url: PROD };

const saveMid = (today) => {
  const now = Date.now();
  return {
    v: 2, moyu: 5000, totalEarned: 8000, lifetimeEarned: 8000,
    levels: { coffee: 1 }, savedAt: now, createdAt: now,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
    daily: null, surviveStreak: 2, totalClicks: 5000, visits: { date: "", count: 0 }, prestige: 0,
    team: {
      colleagues: {
        zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 30, autoRepeat: false, rewardSnapshot: 0 },
        mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 },
      },
    },
    talents: { unlocked: ["click_1", "idle_1", "event_1", "click_2"], points: 0, rankGranted: 0, dailyGiftDate: today, overflow: 0 },
    patrolSurvives: 0,
    cards: { date: today, offers: [], chosen: null, until: 0, dismissed: true, chosenDate: "", nextDayGuaranteed: null },
    decor: ["plant", "lamp", "rug"],
    energy: { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: today, played: 1, best: { findboss: 900 } },
    bestIdleRate: 800, rankIndex: 3, cardsChosenTotal: 2,
  };
};

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    try {
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await c.send("Page.navigate", { url: PROD });
      for (let i = 0; i < 200; i++) {
        if ((await c.ev("document.readyState === 'complete' && !!document.getElementById('btn-journal')")) === true) break;
        await sleep(150);
      }
      await sleep(2200);
      const today = await c.ev("new Date().toLocaleDateString('sv-SE')");
      const seed = JSON.stringify(JSON.stringify(saveMid(today)));
      R.seed = await c.ev(`(() => {
        var orig = Storage.prototype.setItem;
        orig.call(localStorage, 'moyu-save', ${seed});
        Storage.prototype.setItem = function(k, v) { if (typeof k === 'string' && k.indexOf('moyu-') === 0) return; return orig.call(this, k, v); };
        return 'seeded';
      })()`);
      await c.send("Page.reload", { ignoreCache: false });
      for (let i = 0; i < 200; i++) {
        if ((await c.ev("document.readyState === 'complete' && !!document.getElementById('btn-journal')")) === true) break;
        await sleep(150);
      }
      await sleep(1800);
      await c.ev("document.getElementById('btn-journal').click(); 'ok'");
      await sleep(700);
      await c.ev("document.querySelector('#ach-list .ach-item:nth-child(2)').scrollIntoView({block:'center'}); 'ok'");
      await sleep(500);

      R.layout = await c.ev(`(() => {
        function box(sel, root) { var e = (root || document).querySelector(sel); if (!e) return null; var r = e.getBoundingClientRect(); var s = getComputedStyle(e); return { display: s.display, position: s.position, height: s.height, width: s.width, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, bg: s.backgroundColor, overflow: s.overflow }; }
        var items = Array.prototype.slice.call(document.querySelectorAll('#ach-list .ach-item'));
        var sample = items[1]; // 键盘杀手 5000/10000 = 50%
        var sampleItem2 = items[3]; // 躺平起步 800/1000 = 80%
        var info = sample ? sample.querySelector('.ach-info') : null;
        var i2 = sampleItem2 ? sampleItem2.querySelector('.ach-progress > i') : null;
        return {
          cssLoaded: !!document.querySelector('style, link[rel=stylesheet]'),
          achItemBox: box('#ach-list .ach-item:nth-child(2)'),
          achInfoBox: info ? (function(){ var r = info.getBoundingClientRect(); var s = getComputedStyle(info); return { display: s.display, rect: { w: Math.round(r.width), h: Math.round(r.height) } }; })() : null,
          nameBox: box('#ach-list .ach-item:nth-child(2) .ach-name'),
          descBox: box('#ach-list .ach-item:nth-child(2) .ach-desc'),
          progressBox: box('#ach-list .ach-item:nth-child(2) .ach-progress'),
          progressFillBox: box('#ach-list .ach-item:nth-child(2) .ach-progress > i'),
          progress2FillBox: box('#ach-list .ach-item:nth-child(4) .ach-progress > i'),
          progress2InlineWidth: i2 ? i2.style.width : null,
          nameDescSameLine: (function(){
            var n = sample.querySelector('.ach-name').getBoundingClientRect();
            var d = sample.querySelector('.ach-desc').getBoundingClientRect();
            return Math.abs(n.y - d.y) < 4 && d.x > n.x;
          })(),
          visibleBarCount: items.filter(function(it){
            var f = it.querySelector('.ach-progress > i');
            if (!f) return false;
            var r = f.getBoundingClientRect();
            return r.height >= 2 && r.width >= 4;
          }).length,
          itemCount: items.length,
          itemHeights: items.map(function(it){ return Math.round(it.getBoundingClientRect().height); }),
          categoriesVisible: Array.prototype.slice.call(document.querySelectorAll('#ach-categories .ach-cat')).filter(function(el){ return el.getBoundingClientRect().height > 0; }).length,
          achSummary: (document.getElementById('ach-summary')||{}).textContent
        };
      })()`);

      // 2x 放大截图：截取"键盘杀手"整条卡片区域，直观看进度条
      const clip = await c.ev(`(() => { var e = document.querySelector('#ach-list .ach-item:nth-child(2)'); var r = e.getBoundingClientRect(); return { x: Math.round(r.x) - 4, y: Math.round(r.y) - 4, width: Math.round(r.width) + 8, height: Math.round(r.height) + 8 }; })()`);
      if (clip && clip.width > 0) {
        const shot = await c.send("Page.captureScreenshot", { format: "png", clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: 3 } });
        writeFileSync(`${SHOTS}/20-wall-item-zoom.png`, Buffer.from(shot.data, "base64"));
        R.zoomClip = clip;
        log("zoomed item screenshot ->", "20-wall-item-zoom.png");
      }
      // 整墙截图（放大 1.5x 便于看条）
      const wallShot = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${SHOTS}/21-wall-mid-full.png`, Buffer.from(wallShot.data, "base64"));
      R.consoleErrors = (c.errors || []).slice(0, 10);
    } catch (e) {
      R.fatal = String(e && e.stack ? e.stack : e).slice(0, 800);
      log("FATAL", R.fatal);
    } finally {
      try {
        c.close();
      } catch { /* ignore */ }
    }
  },
  { timeoutMs: 180_000 },
);
R.finishedAt = new Date().toISOString();
writeFileSync(OUT, JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 2));
process.exit(0);