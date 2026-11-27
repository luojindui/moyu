// v0.6.1 终验：新手引导（目标链步数/推进/角标恢复/跳过卡死锁/老玩家误判）
// 种子注入：写 localStorage + 拦截 pagehide 自动存档 + reload（已验证可靠）
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor, Report, state } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const today = new Date().toLocaleDateString("sv-SE");
const dayWindow = Math.floor(new Date().getHours() / 6);
const rep = new Report("新手引导 v0.6.1");
let c = null;

const baseSeed = (over = {}) => ({
  v: 2, moyu: 0, totalEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 60_000,
  daily: {
    date: today, window: dayWindow, streak: 0, lastCompleteDate: null, claimed: false, claimsToday: 0,
    goals: [
      { id: "visit_1", target: 1, progress: 0, done: false },
      { id: "idle_earn", target: 1, progress: 0, done: false },
      { id: "click_100", target: 100, progress: 0, done: false },
    ],
  },
  energy: { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
  arcade: { date: today, played: 0, best: {} },
  ...over,
});

async function seedAndReload(blob, ms = 700) {
  await ev(c, `(() => {
    localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    return true;
  })()`);
  await c.send("Page.reload", {});
  const ok = await waitFor(c, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 20000);
  await ev(c, `window.confirm = () => true; window.alert = () => {}; true`);
  // boot 完成（onboarding class 在资产加载后添加）：等其出现或已进阶
  await waitFor(c, `(() => {
    if (!window.__MOYU__) return false;
    const s = window.__MOYU__.state;
    return document.body.classList.contains("onboarding") || s.prestige > 0 || s.lifetimeEarned > 1e6 || !document.getElementById("quest").classList.contains("hidden");
  })()`, 20000);
  await sleep(ms);
  return ok;
}
async function questInfo() {
  const r = await ev(c, `(() => {
    const q = document.getElementById("quest");
    if (!q) return null;
    return {
      hidden: q.classList.contains("hidden"),
      text: (document.getElementById("quest-text")?.textContent ?? "").trim(),
      onboarding: document.body.classList.contains("onboarding"),
    };
  })()`);
  return r ?? { hidden: true, text: "", onboarding: false, missing: true };
}
async function badgeVisibility() {
  return ev(c, `(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return "absent"; return getComputedStyle(el).display === "none" ? "none" : "shown"; };
    return { arcade: pick("#btn-arcade .arcade-badge"), energy: pick("#btn-team .energy-badge"), talent: pick("#btn-team .talent-badge") };
  })()`);
}
async function bossAnswerIfOpen() {
  const vis = await ev(c, `!document.getElementById("boss-choice").classList.contains("hidden")`);
  if (!vis) return false;
  const tell = await ev(c, `document.getElementById("boss-tell")?.textContent ?? ""`);
  const choice = /快|两三步/.test(tell) ? "act-busy" : /盯|屏幕/.test(tell) ? "switch-screen" : "keep-slacking";
  await sleep(220);
  await ev(c, `(() => { const b = document.querySelector('#boss-opts button[data-choice="${choice}"]'); if (b) b.click(); return true; })()`);
  await sleep(400);
  return true;
}
async function cardsVisible() {
  return ev(c, `!document.getElementById("cards").classList.contains("hidden")`);
}
async function chooseCard() {
  await sleep(1500);
  await ev(c, `(() => { const el = document.querySelector("#cards .card"); if (el) el.click(); return true; })()`);
  await sleep(400);
}
async function skipCard() {
  await sleep(200);
  await ev(c, `document.getElementById("cards-skip").click(); true`);
  await sleep(400);
}
async function money() { return ev(c, `window.__MOYU__.state.moyu`); }
async function clicks() { return ev(c, `window.__MOYU__.state.totalClicks`); }
async function tapN(n) {
  for (let i = 0; i < n; i++) {
    const p = await ev(c, `(() => { const el = document.getElementById("stage"); const b = el.getBoundingClientRect(); return { x: b.left + b.width * (0.35 + Math.random() * 0.3), y: b.top + b.height * (0.3 + Math.random() * 0.4) }; })()`);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(95);
  }
}

/** 公共动作：把当前步骤往前推（chooseMode: "choose" 正常选卡；"skip" 跳过卡） */
async function stepOnce(seen, mode) {
  let q;
  try { q = await questInfo(); } catch { return { q: { hidden: false, text: "", onboarding: true }, action: "retry" }; }
  if (q.missing) { await sleep(400); return { q, action: "retry" }; }
  if (q.hidden) return { q, action: "done" };
  if (q.text && !seen.includes(q.text)) seen.push(q.text);
  if (await bossAnswerIfOpen()) return { q, action: "boss" };
  const cv = await cardsVisible();
  if (cv) {
    if (mode === "skip") { await skipCard(); return { q, action: "skip-card" }; }
    await chooseCard();
    return { q, action: "choose-card" };
  }
  if (!q.text) return { q, action: "wait" };
  if (/再戳|解锁「咖啡续命」|买下点亮的「咖啡续命」/.test(q.text) && !/刷手机/.test(q.text)) {
    const m = await money();
    if (m < 15 || /再戳/.test(q.text)) { await tapN(12); return { q, action: "tap12" }; }
    await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="coffee"]'); if (b && !b.disabled) b.click(); return true; })()`);
    await sleep(400);
    return { q, action: "buy-coffee" };
  }
  if (/解锁「刷手机」/.test(q.text)) { await tapN(26); return { q, action: "tap26" }; }
  if (/买下「刷手机」/.test(q.text)) {
    let m = await money(); let guard = 0;
    while (m < 50 && guard++ < 6) { await tapN(4); m = await money(); }
    if (m < 50) await ev(c, "window.__MOYU__.grant(60)");
    await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="phone"]'); if (b && !b.disabled) b.click(); return true; })()`);
    await sleep(400);
    return { q, action: "buy-phone" };
  }
  if (/等 10 秒/.test(q.text)) { await sleep(1200); return { q, action: "idle-wait" }; }
  if (/打开日报|领掉今天的工资/.test(q.text)) {
    let cl = await clicks(); let guard = 0;
    while (cl < 102 && guard++ < 10) { await tapN(Math.max(1, Math.min(30, 102 - cl))); cl = await clicks(); }
    await sleep(1500);
    await ev(c, `document.getElementById("btn-journal").click(); true`);
    await sleep(350);
    const claim = await ev(c, `(() => { const b = document.getElementById("journal-claim"); return b ? { disabled: b.disabled, text: b.textContent } : null; })()`);
    if (claim && !claim.disabled) await ev(c, `document.getElementById("journal-claim").click(); true`);
    await sleep(400);
    await ev(c, `document.getElementById("journal-close").click(); true`);
    await sleep(250);
    return { q, action: "claim", claim };
  }
  if (/招募第一位同事|再招同事/.test(q.text)) {
    const price = await ev(c, `(async () => { const M = await import("/src/engine/team.ts"); return M.recruitCostOf(window.__MOYU__.state, "zhou"); })()`);
    if ((await money()) < price) await ev(c, `window.__MOYU__.grant(${Math.ceil(price) + 500})`);
    await ev(c, `document.getElementById("btn-team").click(); true`);
    await sleep(400);
    await ev(c, `(() => { const b = document.querySelector('button[data-act="recruit"][data-id="zhou"]'); if (b && !b.disabled) b.click(); return true; })()`);
    await sleep(500);
    await ev(c, `document.getElementById("team-close").click(); true`);
    await sleep(250);
    return { q, action: "recruit" };
  }
  if (/分配今天的精力/.test(q.text)) {
    await ev(c, `document.getElementById("btn-team").click(); true`);
    await sleep(350);
    await ev(c, `document.getElementById("tab-decor").click(); true`);
    await sleep(350);
    await ev(c, `(() => { const b = document.querySelector('button[data-act="energy"][data-id="slack"]'); if (b && !b.disabled) b.click(); return true; })()`);
    await sleep(500);
    await ev(c, `document.getElementById("team-close").click(); true`);
    await sleep(250);
    return { q, action: "energy" };
  }
  if (/玩一局摸鱼站/.test(q.text)) {
    await ev(c, `document.getElementById("btn-arcade").click(); true`);
    await waitFor(c, `document.getElementById("arcade").classList.contains("hidden") === false`, 3000);
    await ev(c, `(() => { const b = document.querySelector('button[data-game="rhythm"]'); if (b) b.click(); return true; })()`);
    await sleep(2600);
    await ev(c, `document.getElementById("arcade-close").click(); true`);
    await sleep(1200);
    return { q, action: "arcade" };
  }
  await sleep(300);
  return { q, action: "unknown" };
}

/** 场景 1：正常 10 步链路（选卡），带 HMR 重载检测与重试 */
async function runHappyPath() {
  const seen = [];
  const t0 = Date.now();
  const origin0 = await ev(c, `performance.timeOrigin`);
  let reloads = 0;
  while (Date.now() - t0 < 150_000) {
    const origin = await ev(c, `performance.timeOrigin`);
    if (origin !== origin0) { reloads++; return { reloaded: true, seen, reloads }; }
    const r = await stepOnce(seen, "choose");
    if (r.q.hidden && !r.q.onboarding) return { finished: true, seen, ms: Date.now() - t0 };
    if (r.q.hidden) { await sleep(400); continue; }
  }
  return { finished: false, seen, ms: Date.now() - t0 };
}

const runs = [];
await runChrome(async ({ port }) => {
  c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  try {
    await goto(c, DEV, `typeof window.__MOYU__ === "object"`, 25000);
    await ev(c, `window.confirm = () => true; window.alert = () => {}; true`);
    await sleep(300);

    // ---------- 场景 1：完整链路（最多重试 2 次以避开 HMR 重载） ----------
    let happy = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await seedAndReload(baseSeed());
      const q0 = await questInfo();
      const b0 = await badgeVisibility();
      if (attempt === 1) {
        rep.expect("H1 新号 onboarding 激活/目标链可见", q0.onboarding === true && q0.hidden === false, JSON.stringify(q0));
        rep.expect("H2 新手期系统角标隐藏", b0.arcade === "none" && b0.energy === "none" && b0.talent === "none", JSON.stringify(b0));
      }
      happy = await runHappyPath();
      runs.push({ scenario: `happy-attempt${attempt}`, ...happy });
      if (happy.finished) break;
      await sleep(500);
    }
    rep.expect("H3 目标链可完整走通（无重载时）", !!happy?.finished, JSON.stringify({ seen: happy?.seen?.length, reloads: happy?.reloads, ms: happy?.ms }));
    if (happy?.finished) {
      const qEnd = await questInfo();
      rep.expect("H4 完成后 quest 隐藏 + onboarding class 移除", qEnd.hidden === true && qEnd.onboarding === false, JSON.stringify(qEnd));
      let bEnd = await badgeVisibility();
      for (let i = 0; i < 10 && Object.values(bEnd).some((v) => v !== "shown"); i++) { await sleep(300); bEnd = await badgeVisibility(); }
      rep.expect("H5 完成后系统角标恢复显示", bEnd.arcade === "shown" && bEnd.energy === "shown" && bEnd.talent === "shown", JSON.stringify(bEnd));
      const sEnd = await state(c);
      rep.expect("H6 状态闭环（日报领/招募/精力/小游戏/点击≥100）",
        sEnd.daily.claimed === true && Object.keys(sEnd.team.colleagues).length >= 1 && sEnd.energy.used.length >= 1 && sEnd.arcade.played >= 1 && sEnd.totalClicks >= 100,
        JSON.stringify({ claimed: sEnd.daily.claimed, team: Object.keys(sEnd.team.colleagues).length, energy: sEnd.energy.used.length, arcade: sEnd.arcade.played, clicks: sEnd.totalClicks }));
      const stepCount = happy.seen.length;
      rep.expect("H7a 目标链可完整走通且步数可观测", stepCount >= 9, `实际观测 ${stepCount} 步：${JSON.stringify(happy.seen)}`);
      rep.expect("H7b 目标链步数应为 9（任务书/提交信息），实际实现", stepCount === 9, `实际观测 ${stepCount} 步（实现为 10 步）：${JSON.stringify(happy.seen)}`);
      await shotSafe("ONB2-happy-end");
    }

    // ---------- 场景 2：中途跳过每日卡 → 是否卡死 ----------
    await seedAndReload(baseSeed());
    const seenSkip = [];
    let skipped = false;
    let stuckObserved = false;
    let stuckText = "";
    const t2 = Date.now();
    const origin2 = await ev(c, `performance.timeOrigin`);
    let reload2 = false;
    while (Date.now() - t2 < 100_000) {
      if ((await ev(c, `performance.timeOrigin`)) !== origin2) { reload2 = true; break; }
      const q = await questInfo();
      if (q.hidden && !q.onboarding) break;
      if (q.text && !seenSkip.includes(q.text)) seenSkip.push(q.text);
      if (await bossAnswerIfOpen()) continue;
      const cv = await cardsVisible();
      if (cv && !skipped) { await skipCard(); skipped = true; continue; }
      if (cv && skipped) { // 已跳过却又出现（不应发生）
        await skipCard();
        continue;
      }
      if (/选一张「今日摸鱼卡」/.test(q.text)) {
        // 到达卡牌步骤：等弹窗出现（最多 6s），点「今天先不选」，再观察是否卡住
        let vis = await cardsVisible();
        const tw = Date.now();
        while (!vis && Date.now() - tw < 6000) { await sleep(200); vis = await cardsVisible(); }
        if (vis) { await skipCard(); skipped = true; }
        stuckText = q.text;
        await sleep(2600);
        const q2 = await questInfo();
        stuckObserved = !q2.hidden && /选一张「今日摸鱼卡」/.test(q2.text ?? "") && !(await cardsVisible());
        break;
      }
      const r = await stepOnce(seenSkip, "skip");
      if (r.action === "done") break;
    }
    const qStuck = await questInfo();
    runs.push({ scenario: "skipCard", seen: seenSkip, skipped, stuckText, onboarding: qStuck.onboarding, text: qStuck.text, reload2 });
    rep.expect("H8 跳过每日卡会卡在「选卡」步骤（当天无法补选）", skipped && stuckObserved && qStuck.onboarding === true && /选一张「今日摸鱼卡」/.test(qStuck.text ?? ""), JSON.stringify({ skipped, stuckObserved, text: qStuck.text, onboarding: qStuck.onboarding, seen: seenSkip.length }));

    // ---------- 场景 3：老玩家是否被误判为新手 ----------
    const veteran = baseSeed({
      moyu: 100, totalEarned: 500_000, lifetimeEarned: 500_000, totalClicks: 5000,
      levels: { phone: 5 }, bestIdleRate: 12345, rankIndex: 3, cardsChosenTotal: 5,
      decor: ["plant", "lamp", "rug"],
      team: { colleagues: {
        zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 },
        mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 5, autoRepeat: false, rewardSnapshot: 0 },
      } },
      energy: { date: today, left: 60, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1, clickMult: 1 } },
      arcade: { date: today, played: 1, best: { coffee: 600 } },
      cards: { date: today, offers: ["coffee_day", "quiet_day", "early_leave"], chosen: "coffee_day", until: Date.now() + 3600_000, dismissed: true, chosenDate: today, nextDayGuaranteed: null },
      daily: { date: today, window: dayWindow, streak: 2, lastCompleteDate: today, claimed: true, claimsToday: 1, goals: [
        { id: "visit_1", target: 1, progress: 1, done: true },
        { id: "idle_earn", target: 1, progress: 1, done: true },
        { id: "click_100", target: 100, progress: 100, done: true },
      ] },
    });
    await seedAndReload(veteran);
    const qv = await questInfo();
    const bv = await badgeVisibility();
    runs.push({ scenario: "veteran500k", onboarding: qv.onboarding, text: qv.text, badges: bv });
    rep.expect("H9 老玩家（lifetime 50 万，已有小队/家具/精力/卡）不应被当新手", qv.onboarding === false, `onboarding=${qv.onboarding} quest="${qv.text}" badges=${JSON.stringify(bv)}`);

    await seedAndReload({ ...veteran, totalEarned: 2e6, lifetimeEarned: 2e6 });
    const qv2 = await questInfo();
    rep.expect("H10 lifetime >100 万不触发新手引导", qv2.onboarding === false && qv2.hidden === true, JSON.stringify(qv2));

    await seedAndReload({ ...veteran, prestige: 2 });
    const qv3 = await questInfo();
    rep.expect("H11 转生玩家不触发新手引导", qv3.onboarding === false && qv3.hidden === true, JSON.stringify(qv3));

    rep.expect("H12 无 JS 异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
  } catch (e) {
    rep.add("ONB:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 400_000 });

async function shotSafe(name) {
  try {
    const r2 = await c.send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r2.data, "base64"));
  } catch { /* ignore */ }
}

const summary = rep.summary();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/onboarding2-report.json`, JSON.stringify({ summary, runs }, null, 2));
console.log(`\n===== 新手引导 v0.6.1：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("运行概况：", JSON.stringify(runs.map((x) => ({ s: x.scenario, finished: x.finished, n: x.seen?.length, reloads: x.reloads, onboarding: x.onboarding, text: x.text }))));
console.log("报告：", `${OUT}/onboarding2-report.json`);