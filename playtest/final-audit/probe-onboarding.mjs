// v0.6.0 终验：新手引导（目标链 9/10 步、角标隐藏/恢复、跳过卡死锁、老玩家误判）
// 用 Page.addScriptToEvaluateOnNewDocument 在 app 启动前注入构造存档，保证链路可复现
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, ev, click, visible, state, waitFor, Report, closeAllModals, tapCanvas } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const today = new Date().toLocaleDateString("sv-SE");
const dayWindow = Math.floor(new Date().getHours() / 6);
const rep = new Report("新手引导");
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
const seedScript = (blobJson) => `(() => { try { localStorage.clear(); localStorage.setItem("moyu-save", ${JSON.stringify(blobJson)}); } catch (e) {} })();`;

/** 装/换种子并重新加载页面 */
async function seedAndNavigate(blob) {
  if (c._seedId) await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: c._seedId }).catch(() => undefined);
  const r = await c.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript(JSON.stringify(blob)) });
  c._seedId = r.identifier;
  await c.send("Page.navigate", { url: DEV });
  const ok = await waitFor(c, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 25000);
  await ev(c, `window.confirm = () => true; window.alert = () => {}; true`);
  await sleep(500);
  return ok;
}
async function questInfo() {
  return ev(c, `({
    hidden: document.getElementById("quest").classList.contains("hidden"),
    text: (document.getElementById("quest-text")?.textContent ?? "").trim(),
    onboarding: document.body.classList.contains("onboarding"),
  })`);
}
async function badgeVisibility() {
  return ev(c, `(() => {
    const pick = (sel) => { const el = document.querySelector(sel); if (!el) return "absent"; return getComputedStyle(el).display === "none" ? "none" : "shown"; };
    return {
      arcade: pick("#btn-arcade .arcade-badge"),
      energy: pick("#btn-team .energy-badge"),
      talent: pick("#btn-team .talent-badge"),
      team: pick("#btn-team .badge"),
    };
  })()`);
}
async function bossAnswerIfOpen() {
  const vis = await ev(c, `!document.getElementById("boss-choice").classList.contains("hidden")`);
  if (!vis) return false;
  const tell = await ev(c, `document.getElementById("boss-tell")?.textContent ?? ""`);
  const choice = /快|两三步/.test(tell) ? "act-busy" : /盯|屏幕/.test(tell) ? "switch-screen" : "keep-slacking";
  await sleep(200);
  await ev(c, `(() => { const b = document.querySelector('#boss-opts button[data-choice="${choice}"]'); if (b) b.click(); return true; })()`);
  await sleep(400);
  return true;
}
async function chooseCardIfOpen() {
  const vis = await ev(c, `!document.getElementById("cards").classList.contains("hidden")`);
  if (!vis) return false;
  await sleep(1500); // 防误触 1.2s
  await ev(c, `(() => { const el = document.querySelector("#cards .card"); if (el) el.click(); return true; })()`);
  await sleep(400);
  return true;
}
async function skipCardIfOpen() {
  const vis = await ev(c, `!document.getElementById("cards").classList.contains("hidden")`);
  if (!vis) return false;
  await sleep(200);
  await ev(c, `document.getElementById("cards-skip").click(); true`);
  await sleep(400);
  return true;
}
async function money() {
  return ev(c, `window.__MOYU__.state.moyu`);
}
async function clicks() {
  return ev(c, `window.__MOYU__.state.totalClicks`);
}
async function tapN(n, gap = 95) {
  await tapCanvas(c, n, gap);
}
async function openJournal() {
  await ev(c, `document.getElementById("btn-journal").click(); true`);
  await sleep(350);
}

/** 完整跑通新手链路（选择卡牌），返回观测到的步骤文本序列 */
async function runOnboardingHappyPath(timeoutMs = 150_000) {
  const seen = [];
  let lastText = "";
  const t0 = Date.now();
  let finished = false;
  while (Date.now() - t0 < timeoutMs) {
    const q = await questInfo();
    if (q.hidden && !q.onboarding) { finished = true; break; }
    if (q.text && q.text !== lastText) { seen.push(q.text); lastText = q.text; }
    if (await bossAnswerIfOpen()) continue;
    if (await chooseCardIfOpen()) continue;
    if (!q.text) { await sleep(250); continue; }
    if (/再戳|解锁「咖啡续命」|买下点亮的「咖啡续命」/.test(q.text) && !/刷手机/.test(q.text)) {
      const m = await money();
      if (m < 15 || /再戳/.test(q.text)) { await tapN(12); continue; }
      await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="coffee"]'); if (b && !b.disabled) b.click(); return true; })()`);
      await sleep(400);
      continue;
    }
    if (/解锁「刷手机」/.test(q.text)) { await tapN(26); continue; }
    if (/买下「刷手机」/.test(q.text)) {
      let m = await money();
      let guard = 0;
      while (m < 50 && guard++ < 6) { await tapN(4); m = await money(); }
      if (m < 50) await ev(c, "window.__MOYU__.grant(60)");
      await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="phone"]'); if (b && !b.disabled) b.click(); return true; })()`);
      await sleep(400);
      continue;
    }
    if (/等 10 秒/.test(q.text)) { await sleep(1200); continue; }
    if (/打开日报|领掉今天的工资/.test(q.text)) {
      let cl = await clicks();
      let guard = 0;
      while (cl < 102 && guard++ < 8) { await tapN(Math.max(1, Math.min(30, 102 - cl))); cl = await clicks(); }
      await sleep(1500); // 等 idle/visit 目标达成
      await openJournal();
      const claim = await ev(c, `(() => { const b = document.getElementById("journal-claim"); return b ? { disabled: b.disabled, text: b.textContent } : null; })()`);
      if (claim && !claim.disabled) await ev(c, `document.getElementById("journal-claim").click(); true`);
      await sleep(400);
      await ev(c, `document.getElementById("journal-close").click(); true`);
      await sleep(250);
      continue;
    }
    if (/招募第一位同事/.test(q.text)) {
      if ((await money()) < 12000) await ev(c, "window.__MOYU__.grant(13000)");
      await ev(c, `document.getElementById("btn-team").click(); true`);
      await sleep(400);
      await ev(c, `(() => { const b = document.querySelector('button[data-act="recruit"][data-id="zhou"]'); if (b && !b.disabled) b.click(); return true; })()`);
      await sleep(500);
      await ev(c, `document.getElementById("team-close").click(); true`);
      await sleep(250);
      continue;
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
      continue;
    }
    if (/玩一局摸鱼站/.test(q.text)) {
      await ev(c, `document.getElementById("btn-arcade").click(); true`);
      await waitFor(c, `document.getElementById("arcade").classList.contains("hidden") === false`, 3000);
      await ev(c, `(() => { const b = document.querySelector('button[data-game="rhythm"]'); if (b) b.click(); return true; })()`);
      await sleep(2600);
      await ev(c, `document.getElementById("arcade-close").click(); true`);
      await sleep(1200);
      continue;
    }
    await sleep(300);
  }
  return { seen, finished, ms: Date.now() - t0 };
}

const r = { results: [] };
await runChrome(async ({ port }) => {
  c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  try {
    // ==================== 场景 1：完整链路（选卡） ====================
    let ok = await seedAndNavigate(baseSeed());
    rep.expect("S1 构造新档启动", ok);
    const q0 = await questInfo();
    rep.expect("S2 新号 onboarding 激活且目标链可见", q0.onboarding === true && q0.hidden === false, JSON.stringify(q0));
    const b0 = await badgeVisibility();
    rep.expect("S3 新手期系统角标隐藏", b0.arcade === "none" && b0.energy === "none" && b0.talent === "none", JSON.stringify(b0));
    const run = await runOnboardingHappyPath();
    r.results.push({ scenario: "happy", ...run });
    rep.expect("S4 目标链全部走完（quest 隐藏 + onboarding 移除）", run.finished, `steps=${run.seen.length} ms=${run.ms}`);
    const qEnd = await questInfo();
    rep.expect("S5 完成后 onboarding class 已移除", qEnd.onboarding === false, JSON.stringify(qEnd));
    await sleep(900);
    const bEnd = await badgeVisibility();
    rep.expect("S6 完成后角标恢复显示", bEnd.arcade === "shown" && bEnd.energy === "shown" && bEnd.talent === "shown", JSON.stringify(bEnd));
    const sEnd = await state(c);
    rep.expect("S7 状态闭环（日报已领/招募1人/精力已用/小游戏已玩/点击≥100）",
      sEnd.daily.claimed === true && Object.keys(sEnd.team.colleagues).length >= 1 && sEnd.energy.used.length >= 1 && sEnd.arcade.played >= 1 && sEnd.totalClicks >= 100,
      JSON.stringify({ claimed: sEnd.daily.claimed, team: Object.keys(sEnd.team.colleagues).length, energy: sEnd.energy.used.length, arcade: sEnd.arcade.played, clicks: sEnd.totalClicks }));
    rep.expect("S8 无 JS 异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
    await shotSafe("ONB-happy-end");

    // ==================== 场景 2：跳过每日卡 → 是否卡死 ====================
    ok = await seedAndNavigate(baseSeed());
    const seenSkip = [];
    let lastText = "";
    let stuckAtCard = false;
    let cardSkipped = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 90_000) {
      const q = await questInfo();
      if (q.hidden) break;
      if (q.text && q.text !== lastText) { seenSkip.push(q.text); lastText = q.text; }
      if (await bossAnswerIfOpen()) continue;
      if (/选一张「今日摸鱼卡」/.test(q.text)) {
        if (!cardSkipped) {
          const vis = await ev(c, `!document.getElementById("cards").classList.contains("hidden")`);
          if (vis) { await skipCardIfOpen(); cardSkipped = true; stuckAtCard = true; continue; }
        }
        // 已跳过：观察是否还能推进
        await sleep(400);
        continue;
      }
      if (await chooseCardIfOpen()) continue;
      if (/再戳|买下点亮的「咖啡续命」/.test(q.text)) { await tapN(12); continue; }
      if (/解锁「刷手机」/.test(q.text)) { await tapN(26); continue; }
      if (/买下「刷手机」/.test(q.text)) {
        let m = await money(); let guard = 0;
        while (m < 50 && guard++ < 6) { await tapN(4); m = await money(); }
        if (m < 50) await ev(c, "window.__MOYU__.grant(60)");
        await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="phone"]'); if (b && !b.disabled) b.click(); return true; })()`);
        await sleep(400); continue;
      }
      if (/等 10 秒/.test(q.text)) { await sleep(1200); continue; }
      await sleep(300);
    }
    const qSkip = await questInfo();
    const cardsHiddenAfterSkip = await ev(c, `document.getElementById("cards").classList.contains("hidden")`);
    r.results.push({ scenario: "skipCard", seen: seenSkip, cardSkipped, stuckAtCard, endText: qSkip.text, onboarding: qSkip.onboarding });
    rep.expect("S9 跳过每日卡后可复现卡在中途", cardSkipped && qSkip.onboarding === true && /选一张「今日摸鱼卡」/.test(qSkip.text ?? ""), JSON.stringify({ endText: qSkip.text, onboarding: qSkip.onboarding, cardsHidden: cardsHiddenAfterSkip, seen: seenSkip.length }));
    rep.expect("S10 跳过卡后弹窗不再出现（当天无法补选）", cardsHiddenAfterSkip === true, `cardsHidden=${cardsHiddenAfterSkip}`);
    await shotSafe("ONB-skipcard-stuck");

    // ==================== 场景 3：老玩家是否被误判为新手 ====================
    const veteran = baseSeed({
      moyu: 100, totalEarned: 500000, lifetimeEarned: 500000, totalClicks: 5000,
      levels: { phone: 5 }, bestIdleRate: 12345, rankIndex: 3, cardsChosenTotal: 5,
      decor: ["plant", "lamp", "rug"],
      team: { colleagues: {
        zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 10, autoRepeat: false, rewardSnapshot: 0 },
        mei: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 5, autoRepeat: false, rewardSnapshot: 0 },
      } },
      energy: { date: today, left: 60, used: ["slack"], boosted: { idleMult: 1.25, patrolRewardMult: 1, clickMult: 1 } },
      arcade: { date: today, played: 1, best: { coffee: 600 } },
      daily: { date: today, window: dayWindow, streak: 2, lastCompleteDate: today, claimed: true, claimsToday: 1, goals: [
        { id: "visit_1", target: 1, progress: 1, done: true },
        { id: "idle_earn", target: 1, progress: 1, done: true },
        { id: "click_100", target: 100, progress: 100, done: true },
      ] },
    });
    ok = await seedAndNavigate(veteran);
    const qv = await questInfo();
    const bv = await badgeVisibility();
    r.results.push({ scenario: "veteran500k", onboarding: qv.onboarding, questText: qv.text, badges: bv });
    rep.expect("S11 老玩家（lifetime 50 万，已有小队/家具/精力/卡）不应被当新手", qv.onboarding === false, `onboarding=${qv.onboarding} quest="${qv.text}" badges=${JSON.stringify(bv)}`);
    // 老玩家但 lifetime 200 万 → 应不触发
    const vet2 = { ...veteran, totalEarned: 2e6, lifetimeEarned: 2e6 };
    ok = await seedAndNavigate(vet2);
    const qv2 = await questInfo();
    rep.expect("S12 lifetime >100 万不触发新手引导", qv2.onboarding === false, JSON.stringify(qv2));
    // 转生玩家 → 不触发（即使 lifetime 低）
    const vet3 = { ...veteran, prestige: 2, totalEarned: 500000, lifetimeEarned: 500000 };
    ok = await seedAndNavigate(vet3);
    const qv3 = await questInfo();
    rep.expect("S13 转生玩家不触发新手引导", qv3.onboarding === false, JSON.stringify(qv3));
    rep.expect("S14 无 JS 异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
  } catch (e) {
    rep.add("ONB:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 360_000 });

async function shotSafe(name) {
  try {
    const r2 = await c.send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r2.data, "base64"));
  } catch { /* ignore */ }
}

const summary = rep.summary();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/onboarding-report.json`, JSON.stringify({ summary, runs: r.results }, null, 2));
console.log(`\n===== 新手引导：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("步骤序列：", JSON.stringify(r.results.map((x) => ({ s: x.scenario, n: x.seen?.length, end: x.endText ?? "", onboarding: x.onboarding }))));
console.log("报告：", `${OUT}/onboarding-report.json`);