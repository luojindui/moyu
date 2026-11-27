// v0.6.3 新增「成就解锁提示」专项：老玩家启动是否误报刷屏、真实解锁是否提示、进度条是否可见
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor, Report, state } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const today = new Date().toLocaleDateString("sv-SE");
const dayWindow = Math.floor(new Date().getHours() / 6);
const rep = new Report("成就提示/UI");
let c = null;

const fullSave = (over = {}) => ({
  v: 2, moyu: 500, totalEarned: 5e6, lifetimeEarned: 5e6, levels: { phone: 5 },
  savedAt: Date.now(), createdAt: Date.now() - 86_400_000,
  totalClicks: 100_000,
  bestIdleRate: 1_000_000,
  rankIndex: 14,
  cardsChosenTotal: 5,
  bestSurviveStreak: 10,
  collected: { quotes: Array.from({ length: 10 }, (_, i) => i), flavors: Array.from({ length: 45 }, (_, i) => i) },
  decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
  team: { colleagues: Object.fromEntries(["zhou", "mei", "qiang", "li", "wang"].map((id) => [id, { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 50, autoRepeat: false, rewardSnapshot: 0 }])) },
  talents: { unlocked: ["click_1", "idle_1", "click_2", "idle_2", "click_3", "idle_3", "click_4", "idle_4", "event_1", "event_2", "event_3", "event_4", "click_5a"], points: 0, rankGranted: -1, overflow: 0, dailyGiftDate: "" },
  arcade: { date: today, played: 0, best: { coffee: 2000 } },
  energy: { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
  daily: { date: today, window: dayWindow, streak: 5, lastCompleteDate: today, claimed: true, claimsToday: 1, goals: [
    { id: "visit_1", target: 1, progress: 1, done: true },
    { id: "idle_earn", target: 1, progress: 1, done: true },
    { id: "click_100", target: 100, progress: 100, done: true },
  ] },
  cards: { date: today, offers: ["coffee_day", "quiet_day", "early_leave"], chosen: null, until: 0, dismissed: false, chosenDate: "", nextDayGuaranteed: null },
  ...over,
});

async function seedAndReload(blob, ms = 800) {
  await ev(c, `(() => {
    localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    return true;
  })()`);
  await c.send("Page.reload", {});
  await waitFor(c, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 20000);
  await ev(c, `window.confirm = () => true; true`);
  await sleep(ms);
}

/** 监听 2.5 秒内出现的「成就解锁」toast（MutationObserver） */
async function watchAchToasts(ms = 2500) {
  await ev(c, `(() => {
    window.__achToasts = [];
    const el = document.getElementById("dom-toast");
    if (!el) return;
    new MutationObserver(() => {
      const t = el.textContent || "";
      if (t.includes("成就解锁") && !window.__achToasts.includes(t)) window.__achToasts.push(t);
    }).observe(el, { childList: true, characterData: true, subtree: true });
    return true;
  })()`);
  await sleep(ms);
  return ev(c, `window.__achToasts`);
}

await runChrome(async ({ port }) => {
  c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  try {
    await goto(c, DEV, `typeof window.__MOYU__ === "object"`, 25000);
    await ev(c, `window.confirm = () => true; true`);
    await sleep(300);

    // ===== 1. 老玩家（22 条已达成）启动：不应误报成就解锁 =====
    await seedAndReload(fullSave());
    const toasts = await watchAchToasts(3000);
    const s = await state(c);
    const eng = await ev(c, `(async () => {
      const A = await import("/src/engine/achievements.ts");
      const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
      return { points: A.achPoints(s), level: A.achLevel(s), total: A.ACHIEVEMENTS.length };
    })()`);
    rep.expect("T1 构造档 22/22 成就达成", eng.points === 22, JSON.stringify(eng));
    rep.expect("T2 老玩家启动不误报「成就解锁」toast", (toasts ?? []).length === 0, `误报 ${JSON.stringify(toasts)}（state.totalClicks=${s.totalClicks}）`);

    // UI：成就墙 22 条 + 进度条可见
    await ev(c, `document.getElementById("btn-journal").click(); true`);
    await sleep(500);
    const ui = await ev(c, `(() => {
      const items = [...document.querySelectorAll("#ach-list .ach-item")];
      const bars = [...document.querySelectorAll("#ach-list .ach-progress")];
      const heights = bars.slice(0, 5).map((b) => Math.round(b.getBoundingClientRect().height));
      return {
        n: items.length,
        done: items.filter((x) => x.classList.contains("done")).length,
        summary: document.getElementById("ach-summary")?.textContent,
        barHeights: heights,
        barWidths: bars.slice(0, 5).map((b) => Math.round(b.getBoundingClientRect().width)),
      };
    })()`);
    rep.expect("T3 成就墙渲染 22 条且 22 完成", ui.n === 22 && ui.done === 22, JSON.stringify({ n: ui.n, done: ui.done, summary: ui.summary }));
    rep.expect("T4 进度条可见（高度≥3px、宽度>0）", ui.barHeights.every((h) => h >= 3) && ui.barWidths.every((w) => w > 0), JSON.stringify({ heights: ui.barHeights, widths: ui.barWidths }));
    rep.expect("T5 汇总 22/22 · Lv.6", /22\/22/.test(ui.summary ?? "") && /Lv\.6/.test(ui.summary ?? ""), ui.summary);
    await ev(c, `document.getElementById("journal-close").click(); true`);
    await sleep(250);

    // ===== 2. 真实解锁（第 22 条差 1 次选卡）：应弹出一次成就解锁提示 =====
    const near = fullSave({ cardsChosenTotal: 4, totalClicks: 1_000, bestIdleRate: 0, rankIndex: 1, bestSurviveStreak: 0, collected: { quotes: [], flavors: [] }, decor: [], team: { colleagues: {} }, talents: { unlocked: [], points: 0, rankGranted: -1, overflow: 0, dailyGiftDate: "" }, arcade: { date: today, played: 0, best: {} } });
    await seedAndReload(near);
    const toastsBoot = await watchAchToasts(1800);
    rep.expect("T6 缺 1 条的老玩家启动也不误报", (toastsBoot ?? []).length === 0, JSON.stringify(toastsBoot));
    // 等每日卡弹窗 → 选卡（cardsChosenTotal 4→5 → 解锁 card_5）
    const cardsShown = await waitFor(c, `!document.getElementById("cards").classList.contains("hidden")`, 8000);
    if (cardsShown) {
      await sleep(1500);
      await ev(c, `(() => { const el = document.querySelector("#cards .card"); if (el) el.click(); return true; })()`);
    }
    const toastsUnlock = await watchAchToasts(2500);
    rep.expect("T7 真实解锁有提示", (toastsUnlock ?? []).some((t) => /成就解锁/.test(t)), JSON.stringify(toastsUnlock));
    rep.expect("T8 无 JS 异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
  } catch (e) {
    rep.add("T:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 180_000 });

const summary = rep.summary();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/ach-toast-report.json`, JSON.stringify(summary, null, 2));
console.log(`\n===== 成就提示/UI：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("报告：", `${OUT}/ach-toast-report.json`);