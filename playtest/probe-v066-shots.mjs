/** v0.6.6 复验·证据截图（playtest/lib/chrome.mjs） */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const DEV = "http://127.0.0.1:5173/";
const DIR = "playtest/v066-shots";
mkdirSync(DIR, { recursive: true });
const today = () => new Date().toLocaleDateString("sv-SE");
const T = today();

function makeBlob(over = {}) {
  const now = Date.now();
  return {
    v: 2, moyu: 1e12, totalEarned: 5e12, lifetimeEarned: 5e12,
    levels: { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 },
    savedAt: now - 1500, createdAt: now - 10 * 86_400_000,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    daily: null, surviveStreak: 3, patrolSurvives: 20, totalClicks: 3000,
    visits: { date: T, count: 2 }, prestige: 8,
    team: { colleagues: {
      zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      mei: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      qiang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      li: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      wang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
    } },
    talents: { unlocked: ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"], points: 0, rankGranted: 12, dailyGiftDate: T, overflow: 4 },
    cards: { date: T, offers: [], chosen: "coffee_day", until: now + 3600_000, nextDayGuaranteed: null, dismissed: true, chosenDate: T },
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    energy: { date: T, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: T, played: 0, best: { coffee: 300 } },
    bestIdleRate: 2000, rankIndex: 7, cardsChosenTotal: 5, bestSurviveStreak: 3, bestTalentsUnlocked: 13,
    ...over,
  };
}

async function waitReady(cdp) {
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length, hasMoyu: !!window.__MOYU__ }))()`);
    if (st.ready !== "loading" && st.cards >= 9 && st.hasMoyu) return;
    await sleep(100);
  }
  throw new Error("not ready");
}
async function seed(cdp, blob) {
  await cdp.ev(`(() => {
    const proto = Storage.prototype; const orig = proto.setItem;
    proto.setItem = function (k, v) { if (k === 'moyu-save' && this === localStorage) return; return orig.call(this, k, v); };
    orig.call(localStorage, 'moyu-save', ${JSON.stringify(JSON.stringify(blob))});
    return true;
  })()`);
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitReady(cdp);
}
async function shot(cdp, name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${DIR}/${name}.png`, Buffer.from(r.data, "base64"));
  return name;
}

await runChrome(async ({ port }) => {
  const cdp = await connect(port);
  await cdp.send("Page.enable");
  try {
    await cdp.send("Page.navigate", { url: DEV });
    await waitReady(cdp);
    await cdp.ev(`localStorage.clear(); sessionStorage.clear(); true`);
    await sleep(300);
    await seed(cdp, makeBlob());
    await sleep(700);
    await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
    // 成就墙截图
    await cdp.ev(`document.getElementById('btn-journal').click(); true`);
    await sleep(900);
    await cdp.ev(`(() => { const el = document.getElementById('ach-summary'); if (el) el.scrollIntoView({ block: 'start' }); return true; })()`);
    await sleep(400);
    await shot(cdp, "01-ach-wall");
    await cdp.ev(`document.getElementById('journal-close').click(); true`);
    // 小队面板（① 小队挂机 & 每人贡献）
    await cdp.ev(`document.getElementById('btn-team').click(); true`);
    await sleep(800);
    await shot(cdp, "02-team-panel");
    // 天赋转化行（⑥）
    await cdp.ev(`document.getElementById('tab-talents').click(); true`);
    await sleep(700);
    await cdp.ev(`(() => { const el = document.querySelector('#team-body .talent-progress'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()`);
    await sleep(300);
    await shot(cdp, "03-talent-transform");
    await cdp.ev(`document.getElementById('team-close').click(); true`);
    // 工位面板（离线收益倍率）
    await cdp.ev(`document.getElementById('btn-team').click(); document.getElementById('tab-decor').click(); true`);
    await sleep(800);
    await shot(cdp, "04-decor-offline");
    await cdp.ev(`document.getElementById('team-close').click(); true`);
    // 8 天回归欢迎面板（⑤：面板 95%）
    const now = Date.now();
    const offBlob = {
      v: 2, moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000, levels: { phone: 10 },
      savedAt: now - 8 * 86400_000, createdAt: now - 20 * 86400_000,
      collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
      visits: { date: T, count: 2 }, prestige: 0, team: { colleagues: {} },
      talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: T, overflow: 0 },
      cards: { date: T, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
      decor: ["rug", "chair", "catbed"], energy: { date: T, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
      arcade: { date: T, played: 0, best: {} },
    };
    await seed(cdp, offBlob);
    await sleep(800);
    await shot(cdp, "05-welcome-8d");
    console.log("[shots] done");
  } catch (e) {
    console.error("[shots] error", e);
  }
  try { await cdp.send("Browser.close"); } catch { /* ignore */ }
  cdp.close();
}, { timeoutMs: 120_000 });