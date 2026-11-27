// 系统完整性探针：天赋 / 日报 / 图鉴 / 段位 / 转生 / 每日卡跨日保留
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, click, count, text, visible, state, waitFor, Report, hud, closeAllModals, openPanel, modEval, tapCanvas, waitFrames } from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const results = [];
const rep = new Report("S 系统完整性");
let c = null;
const today = new Date().toLocaleDateString("sv-SE");
const dayWindow = Math.floor(new Date().getHours() / 6);

async function boot() {
  await goto(c, DEV, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 25000);
  await ev(c, `window.confirm = () => true; window.alert = () => {}; true`);
  await sleep(500);
}
async function reload(ms = 500) {
  await c.send("Page.reload", {});
  await waitFor(c, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 20000);
  await ev(c, `window.confirm = () => true; true`);
  await sleep(ms);
}
async function blobFromState() {
  const s = await state(c);
  const savedAt = await ev(c, `window.__MOYU__.savedAt`);
  return { v: 2, moyu: s.moyu, totalEarned: s.totalEarned, levels: s.levels, savedAt: savedAt ?? Date.now(), createdAt: Date.now() - 60000, collected: s.collected, daily: s.daily, surviveStreak: s.surviveStreak, patrolSurvives: s.patrolSurvives, cards: s.cards, decor: s.decor, energy: s.energy, arcade: s.arcade, totalClicks: s.totalClicks, visits: s.visits, lifetimeEarned: s.lifetimeEarned, prestige: s.prestige, team: s.team, talents: s.talents };
}
async function writeSaveAndReload(blob, ms = 500) {
  await ev(c, `(() => {
    localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    return true;
  })()`);
  await reload(ms);
}

await runChrome(async ({ port }) => {
  c = await connect(port);
  await setViewport(c);
  try {
    await boot();

    // ===== S1 天赋 =====
    await closeAllModals(c);
    // 每日首开 +1 天赋点（HUD tick 内发放）
    const gotPoint = await waitFor(c, `window.__MOYU__.state.talents.points >= 1`, 6000);
    rep.expect("S1 每日首开送 1 天赋点", gotPoint, JSON.stringify((await state(c)).talents));
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-talents");
    await waitFor(c, `document.getElementById("team-body").textContent.includes("点击流")`, 3000);
    const beforeT = await state(c);
    const btnInfo = await ev(c, `(() => { const b = document.querySelector('button[data-act="talent"][data-id="click_1"]'); return b ? { disabled: b.disabled, text: b.textContent } : null; })()`);
    rep.expect("S2 天赋按钮可点亮", btnInfo && !btnInfo.disabled, JSON.stringify(btnInfo));
    await click(c, 'button[data-act="talent"][data-id="click_1"]');
    await sleep(400);
    const afterT = await state(c);
    rep.expect("S3 点亮写入状态", afterT.talents.unlocked.includes("click_1") && afterT.talents.points === beforeT.talents.points - 1, JSON.stringify({ unlocked: afterT.talents.unlocked, points: afterT.talents.points }));
    const expClick = await modEval(c, "/src/engine/actions.ts", "M.clickPowerOf(window.__MOYU__.state)");
    const fmtClick = await ev(c, `(async () => { const F = await import("/src/engine/format.ts"); return F.formatMoyu(${expClick}); })()`);
    await sleep(200);
    rep.expect("S4 天赋效果生效（HUD 点击力）", (await text(c, "#hud-click")) === fmtClick, `${await text(c, "#hud-click")} vs ${fmtClick}`);
    await closeAllModals(c);

    // ===== S2 图鉴 =====
    const col0 = await state(c);
    const n0 = col0.collected.flavors.length;
    await tapCanvas(c, 30, 95);
    await sleep(300);
    // 买挂机线升级（刷手机）→ Lv1 解锁该升级第一档彩蛋（图鉴 +1）；点击线彩蛋按点击数解锁，不随购买
    await ev(c, "window.__MOYU__.grant(500)");
    await sleep(200);
    const buyRes = await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="phone"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
    await sleep(500);
    rep.expect("S5a 图鉴前置：挂机线首购成功", buyRes === true && (await state(c)).levels.phone === 1, JSON.stringify((await state(c)).levels));
    const col1 = await state(c);
    const n1 = col1.collected.flavors.length;
    rep.expect("S5b 购买推进图鉴解锁", n1 === n0 + 1, `${n0}→${n1}`);
    await openPanel(c, "#btn-journal", "#journal");
    await sleep(300);
    const total = await text(c, "#journal-total");
    const cells = await count(c, "#journal-grid .c-item");
    const onCells = await count(c, "#journal-grid .c-item.on");
    rep.expect("S6 图鉴面板 55 格", cells === 55, `cells=${cells} total=${total}`);
    rep.expect("S7 图鉴计数与已解锁格一致", total === `${onCells}/55`, `total=${total} 实际点亮=${onCells}`);
    await closeAllModals(c);

    // ===== S3 日报（3/3 全完成 → 领取） =====
    await ev(c, "window.__MOYU__.saveNow()");
    const blobD = await blobFromState();
    blobD.daily = {
      date: today, window: dayWindow, streak: 3, lastCompleteDate: new Date(Date.now() - 86400_000).toLocaleDateString("sv-SE"), claimed: false, claimsToday: 0,
      goals: [
        { id: "visit_1", target: 1, progress: 1, done: true },
        { id: "idle_earn", target: 1, progress: 1, done: true },
        { id: "click_100", target: 100, progress: 100, done: true },
      ],
    };
    await writeSaveAndReload(blobD);
    await closeAllModals(c);
    await openPanel(c, "#btn-journal", "#journal");
    const claimDisabled = await ev(c, `(() => { const b = document.getElementById("journal-claim"); return b ? { disabled: b.disabled, text: b.textContent } : null; })()`);
    rep.expect("S8 日报 3/3 可领取", claimDisabled && !claimDisabled.disabled, JSON.stringify(claimDisabled));
    const beforeClaim = await state(c);
    const expDaily = await modEval(c, "/src/engine/daily.ts", "M.dailyReward(window.__MOYU__.state)");
    await click(c, "#journal-claim");
    await sleep(500);
    const afterClaim = await state(c);
    rep.expect("S9 领取后 claimed/连续天数 +1", afterClaim.daily.claimed === true && afterClaim.daily.streak === 4, JSON.stringify({ claimed: afterClaim.daily.claimed, streak: afterClaim.daily.streak }));
    rep.expect("S10 日报奖励入账", afterClaim.moyu - beforeClaim.moyu >= expDaily * 0.98, `+${(afterClaim.moyu - beforeClaim.moyu).toFixed(1)} 期望 ${expDaily}`);
    const againDisabled = await ev(c, `(() => { const b = document.getElementById("journal-claim"); return { disabled: b.disabled, text: b.textContent }; })()`);
    rep.expect("S11 已领取按钮不可再点", againDisabled.disabled === true, JSON.stringify(againDisabled));
    const money = (await state(c)).moyu;
    await click(c, "#journal-claim");
    await sleep(300);
    rep.expect("S12 重复领取无效", Math.abs((await state(c)).moyu - money) < 5, `${money.toFixed(1)}→${(await state(c)).moyu.toFixed(1)}`);
    await closeAllModals(c);

    // ===== S4 段位 =====
    await ev(c, "window.__MOYU__.grant(200000000)");
    await sleep(400);
    const sRank = await state(c);
    const rankExp = await modEval(c, "/src/engine/titles.ts", "M.rankFor(window.__MOYU__.state.lifetimeEarned).current");
    const rankHud = await text(c, "#hud-rank");
    const shortName = rankExp.replace(/^带薪/, "").replace(/^摸鱼/, "");
    rep.expect("S13 段位随生涯累计提升", rankHud.includes(shortName), `HUD=${rankHud} 期望含 ${shortName}`);
    rep.expect("S14 lifetime ≥ 段位门槛", sRank.lifetimeEarned >= 2e8, JSON.stringify({ lifetime: sRank.lifetimeEarned }));

    // ===== S5 转生 =====
    // 当前 totalEarned 已 ≥1e8 → 可转生
    await openPanel(c, "#btn-journal", "#journal");
    const pBtn = await ev(c, `(() => { const b = document.getElementById("prestige-btn"); return { disabled: b.disabled, text: b.textContent }; })()`);
    rep.expect("S15 转生按钮解锁", pBtn && pBtn.disabled === false, JSON.stringify(pBtn));
    const gain = await modEval(c, "/src/engine/prestige.ts", "M.prestigeGain(window.__MOYU__.state)");
    const beforeP = await state(c);
    await click(c, "#prestige-btn");
    await sleep(600);
    const afterP = await state(c);
    rep.expect("S16 转生点数到账", afterP.prestige === beforeP.prestige + gain && gain > 0, `prestige ${beforeP.prestige}→${afterP.prestige} 期望 +${gain}`);
    rep.expect("S17 转生重置本局余额/累计", afterP.moyu < 100 && afterP.totalEarned < 100, JSON.stringify({ moyu: afterP.moyu, total: afterP.totalEarned }));
    rep.expect("S18 转生保留等级 80%", afterP.levels.phone === Math.floor((beforeP.levels.phone ?? 0) * 0.8), JSON.stringify({ before: beforeP.levels, after: afterP.levels }));
    rep.expect("S19 转生保留图鉴/历史累计/家具", afterP.lifetimeEarned >= beforeP.lifetimeEarned && JSON.stringify(afterP.collected) === JSON.stringify(beforeP.collected) && afterP.decor.length === beforeP.decor.length, JSON.stringify({ beforeLife: beforeP.lifetimeEarned, afterLife: afterP.lifetimeEarned, decor: afterP.decor.length }));
    const mult = await modEval(c, "/src/engine/prestige.ts", "M.prestigeMultiplier(window.__MOYU__.state.prestige)");
    rep.expect("S20 永久倍率 = 1+0.75×点数", Math.abs(mult - (1 + 0.75 * afterP.prestige)) < 1e-9, `${mult} vs ${1 + 0.75 * afterP.prestige}`);
    await closeAllModals(c);

    // ===== S6 每日卡跨日保留（24h 生效，跨日可再选） =====
    await ev(c, "window.__MOYU__.saveNow()");
    const blobC = await blobFromState();
    const until = Date.now() + 3600_000;
    blobC.cards = { ...(blobC.cards ?? {}), date: today, offers: ["coffee_day"], chosen: "coffee_day", until, dismissed: false, chosenDate: today, nextDayGuaranteed: null };
    await writeSaveAndReload(blobC);
    const sCard = await state(c);
    rep.expect("S21 已选卡刷新后保留", sCard.cards.chosen === "coffee_day" && sCard.cards.until > Date.now(), JSON.stringify({ chosen: sCard.cards.chosen }));
    await sleep(300);
    rep.expect("S22 HUD 显示今日卡", /卡·/.test((await text(c, "#hud-card")) ?? ""), await text(c, "#hud-card"));
    const cardEff = await modEval(c, "/src/engine/cards.ts", "M.cardEffects(window.__MOYU__.state, Date.now()).idleMult");
    rep.expect("S23 卡效果在刷新后仍生效", cardEff > 1, String(cardEff));
    // 跨日：把 chosenDate 改成昨天 → 今天可再次选，但旧卡效果若未过期仍生效
    const blobC2 = { ...(await blobFromState()), };
    blobC2.cards = { ...blobC2.cards, chosenDate: new Date(Date.now() - 86400000).toLocaleDateString("sv-SE"), date: new Date(Date.now() - 86400000).toLocaleDateString("sv-SE") };
    await writeSaveAndReload(blobC2);
    await closeAllModals(c);
    const sNext = await state(c);
    rep.expect("S24 跨日可再选卡（chosenDate 非今日）", sNext.cards.chosenDate !== today && sNext.cards.offers.length === 3, JSON.stringify({ chosenDate: sNext.cards.chosenDate, offers: sNext.cards.offers.length }));
    const oldBuff = await modEval(c, "/src/engine/cards.ts", "M.activeCard(window.__MOYU__.state, Date.now())?.id");
    rep.expect("S25 未过期的昨日卡仍生效", oldBuff === "coffee_day", String(oldBuff));
    await waitFrames(c, 3);
    rep.expect("S26 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
  } catch (e) {
    rep.add("S:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 240_000 });

const summary = rep.summary();
results.push(summary);
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/systems-report.json`, JSON.stringify({ summary, stages: results }, null, 2));
console.log(`\n===== 系统完整性：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("报告：", `${OUT}/systems-report.json`);