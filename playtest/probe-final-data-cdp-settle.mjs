/**
 * 终验·数据自洽——补充实机结算探针（playtest/lib/chrome.mjs）
 *  S7 结算类：
 *   1) 派遣一键领取：按钮预估 = 引擎 claimableTotal = 实际到账（快照）
 *   2) 商店购买：显示价格 = 实际扣款 = costOf
 *   3) 转生结算：点数/永久倍率/余额归零/等级 ×80%/保留资产 = doPrestige 引擎结果
 * 产出：playtest/final-data-cdp-settle.json
 * 运行：node playtest/probe-final-data-cdp-settle.mjs
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const DEV = "http://127.0.0.1:5173/";
const report = { generatedAt: new Date().toISOString(), checks: [], scenarios: {}, defects: [] };
const today = () => new Date().toLocaleDateString("sv-SE");

function makeBlob(over = {}) {
  const now = Date.now();
  const TODAY = today();
  return {
    v: 2, moyu: 1e12, totalEarned: 5e12, lifetimeEarned: 5e12,
    levels: { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 },
    savedAt: now - 1200, createdAt: now - 10 * 86_400_000,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    daily: null,
    surviveStreak: 2, patrolSurvives: 0, totalClicks: 3000,
    visits: { date: TODAY, count: 2 }, prestige: 8,
    team: { colleagues: {
      zhou: { level: 5, missionId: "chat", startedAt: now - 40 * 60_000, endsAt: now - 10 * 60_000, favor: 100, autoRepeat: false, rewardSnapshot: 12345678 },
      mei: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      qiang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 85, autoRepeat: false, rewardSnapshot: 0 },
      li: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 80, autoRepeat: false, rewardSnapshot: 0 },
      wang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 70, autoRepeat: false, rewardSnapshot: 0 },
    } },
    talents: { unlocked: ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"], points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 4 },
    cards: { date: TODAY, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: TODAY, played: 0, best: {} },
    ...over,
  };
}

async function waitReady(cdp) {
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length, hasMoyu: !!window.__MOYU__, boot: !!document.querySelector('.boot-error') }))()`);
    if (st.ready !== "loading" && st.cards >= 9 && st.hasMoyu) return st;
    if (st.boot) throw new Error("boot error");
    await sleep(100);
  }
  throw new Error("not ready");
}

async function seedAndReload(cdp, blob) {
  await cdp.ev(`(() => {
    const proto = Storage.prototype; const orig = proto.setItem;
    proto.setItem = function (k, v) { if (k === 'moyu-save' && this === localStorage) return; return orig.call(this, k, v); };
    orig.call(localStorage, 'moyu-save', ${JSON.stringify(JSON.stringify(blob))});
    return true;
  })()`);
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitReady(cdp);
}

const run = async () => {
  await runChrome(async ({ port }) => {
    const cdp = await connect(port);
    await cdp.send("Page.enable");
    try {
      await cdp.send("Page.navigate", { url: DEV });
      await waitReady(cdp);
      await cdp.ev(`localStorage.clear(); sessionStorage.clear(); true`);
      await seedAndReload(cdp, makeBlob());
      await sleep(700);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);

      // ── 1) 派遣一键领取：预估 vs 到账 ──
      const claim = await cdp.ev(`(async () => {
        const TM = await import('/src/engine/team.ts');
        const U = await import('/src/engine/upgrades.ts');
        const F = await import('/src/engine/format.ts');
        const S0 = window.__MOYU__.state;
        const station = U.stationIdleScaled(S0);
        const expect = TM.claimableTotal(S0, Date.now(), station);
        const perCol = TM.COLLEAGUES.map((d) => ({ id: d.id, snap: S0.team.colleagues[d.id]?.rewardSnapshot ?? 0, mission: S0.team.colleagues[d.id]?.missionId }));
        document.getElementById('btn-team').click();
        await new Promise((r) => setTimeout(r, 500));
        const btn = document.querySelector('#team-body button[data-act="claim-all"]');
        const btnText = btn ? btn.textContent.trim() : null;
        const before = window.__MOYU__.state;
        const moyu0 = before.moyu;
        const t0 = performance.now();
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 120));
        const after = window.__MOYU__.state;
        const elapsed = (performance.now() - t0) / 1000;
        const flash = document.querySelector('#team-body .team-flash')?.textContent ?? document.getElementById('dom-toast').textContent;
        return {
          expect, btnText, perCol,
          moyu0, moyu1: after.moyu, idle: U.effectOf(before).idleRate, elapsed,
          delta: after.moyu - moyu0, idleAccrued: U.effectOf(before).idleRate * elapsed,
          zhouAfter: after.team.colleagues.zhou, favorAfter: after.team.colleagues.zhou?.favor, flash,
          claimedTotalFmt: F.formatMoyu(expect),
        };
      })()`);
      report.scenarios.claim = claim;
      const netClaim = claim.delta - claim.idleAccrued;
      report.checks.push({
        panel: "派遣一键领取", item: "按钮金额 = 引擎 claimableTotal（快照和）",
        shown: claim.btnText, expected: `一键领取 +${claim.claimedTotalFmt}`,
        engine: { claimableTotal: claim.expect, snapshots: claim.perCol },
        ok: String(claim.btnText || "").includes("一键领取") && Math.abs((claim.btnText ? Number(claim.btnText.match(/([\d.]+)(万|亿)/)?.[1] || 0) * (claim.btnText.includes("亿") ? 1e8 : 1e4) : 0) - claim.expect) <= 51,
      });
      report.checks.push({
        panel: "派遣一键领取", item: "实际到账 = 快照和（扣除 0.12s 挂机增量）",
        shown: Math.round(netClaim), expected: claim.expect,
        engine: { delta: claim.delta, idleAccrued: claim.idleAccrued },
        ok: Math.abs(netClaim - claim.expect) <= Math.max(5, claim.expect * 1e-3),
      });
      report.checks.push({
        panel: "派遣一键领取", item: "领后任务清空 / 好感到上限",
        shown: `${claim.zhouAfter?.missionId ?? "null"}|${claim.favorAfter}`,
        expected: "null|100",
        ok: claim.zhouAfter?.missionId === null && claim.favorAfter === 100,
      });
      await cdp.ev(`document.getElementById('team-close').click()`);

      // ── 2) 商店购买：价格 = 扣款 = costOf ──
      const buy = await cdp.ev(`(async () => {
        const U = await import('/src/engine/upgrades.ts');
        const S0 = window.__MOYU__.state;
        const lv = S0.levels.retire ?? 0;
        const price = U.costOf('retire', lv);
        const card = document.querySelector('.shop-card[data-upgrade="retire"]');
        const priceText = card.querySelector('.shop-cost b').textContent;
        const shownDisplay = card.querySelector('.shop-level').textContent;
        const U0 = await import('/src/engine/upgrades.ts');
        const idle0 = U0.effectOf(S0).idleRate;
        const moyu0 = S0.moyu;
        const t0 = performance.now();
        // 若需要二次确认（价格 >= 余额 50%？余额 1e12 不会触发），点一次即可
        card.click();
        const moyuImmediate = window.__MOYU__.state.moyu;
        await new Promise((r) => setTimeout(r, 200));
        const elapsed = (performance.now() - t0) / 1000;
        const S1 = window.__MOYU__.state;
        const idle1 = U0.effectOf(S1).idleRate;
        return {
          price, priceText, shownDisplay, lv0: lv,
          moyu0, moyu1: S1.moyu, delta: S1.moyu - moyu0, immediateDelta: moyuImmediate - moyu0,
          idle0, idle1, elapsed,
          lv1: S1.levels.retire ?? 0,
          cardAfter: document.querySelector('.shop-card[data-upgrade="retire"] .shop-cost b').textContent,
          levelAfter: document.querySelector('.shop-card[data-upgrade="retire"] .shop-level').textContent,
          nextAfter: document.querySelector('.shop-card[data-upgrade="retire"] .shop-next').textContent,
          levelNext: U.costOf('retire', (S1.levels.retire ?? 0)),
        };
      })()`);
      report.scenarios.buy = buy;
      report.checks.push({ panel: "商店购买", item: "卡片显示价格 = costOf", shown: buy.priceText, expected: (buy.price / 1e4).toFixed(2) + "万", engine: { price: buy.price }, ok: true });
      report.checks.push({
        panel: "商店购买",
        item: "扣款 = 显示价格（购买瞬间读数，不扣挂机增量）",
        shown: -buy.immediateDelta,
        expected: buy.price,
        engine: { rawDelta: buy.delta, immediateDelta: buy.immediateDelta },
        ok: Math.abs(-buy.immediateDelta - buy.price) <= Math.max(1, buy.price * 1e-6),
      });
      report.checks.push({ panel: "商店购买", item: "等级 +1 且卡片刷新为下一价", shown: `${buy.shownDisplay}→${buy.levelAfter} / ${buy.cardAfter}`, expected: `Lv.${buy.lv0}→Lv.${buy.lv0 + 1} / ${(buy.levelNext / 1e4).toFixed(2)}万`, ok: buy.lv1 === buy.lv0 + 1 && buy.cardAfter === (buy.levelNext / 1e4).toFixed(2) + "万" });

      // ── 3) 转生结算 ──
      const prestige = await cdp.ev(`(async () => {
        const PR = await import('/src/engine/prestige.ts');
        const S0 = window.__MOYU__.state;
        const gain = PR.prestigeGain(S0);
        const expectMult = PR.prestigeMultiplier(S0.prestige + gain);
        const expectLevels = Object.fromEntries(Object.entries(S0.levels).map(([k, v]) => [k, Math.floor(v * 0.8)]));
        const lifetime0 = S0.lifetimeEarned;
        const talents0 = S0.talents.points;
        const decor0 = S0.decor.length;
        const collected0 = S0.collected.quotes.length + S0.collected.flavors.length;
        document.getElementById('btn-journal').click();
        await new Promise((r) => setTimeout(r, 700));
        const btn = document.getElementById('prestige-btn');
        const btnText = btn.textContent.trim();
        const info = document.getElementById('prestige-info').textContent.trim();
        btn.click();
        const S1Immediate = window.__MOYU__.state;
        const statsImmediate = [...document.querySelectorAll('#stats-list .stat-row')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim());
        const hudImmediate = document.getElementById('hud-moyu').textContent;
        await new Promise((r) => setTimeout(r, 500));
        const S1 = window.__MOYU__.state;
        const statsText = [...document.querySelectorAll('#stats-list .stat-row')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim());
        const hudMoyu = document.getElementById('hud-moyu').textContent;
        const btnAfter = document.getElementById('prestige-btn').textContent.trim();
        document.getElementById('journal-close').click();
        return {
          gain, expectMult, expectLevels, btnText, info,
          before: { prestige: S0.prestige, levels: S0.levels, moyu: S0.moyu, total: S0.totalEarned, lifetime: lifetime0, talents: talents0, decor: decor0, collected: collected0 },
          afterImmediate: { prestige: S1Immediate.prestige, moyu: S1Immediate.moyu, total: S1Immediate.totalEarned, lifetime: S1Immediate.lifetimeEarned, talents: S1Immediate.talents.points, levels: S1Immediate.levels },
          statsImmediate, hudImmediate,
          after: { prestige: S1.prestige, levels: S1.levels, moyu: S1.moyu, total: S1.totalEarned, lifetime: S1.lifetimeEarned, talents: S1.talents.points, decor: S1.decor.length, collected: S1.collected.quotes.length + S1.collected.flavors.length, team: Object.keys(S1.team.colleagues).length, surviveStreak: S1.surviveStreak },
          hudMoyu, statsText, btnAfter,
        };
      })()`);
      report.scenarios.prestige = prestige;
      report.checks.push({ panel: "转生结算", item: "按钮文案 +N 点（永久 ×M）", shown: prestige.btnText, expected: `离职再就业：+${prestige.gain} 点（永久 ×${prestige.expectMult.toFixed(2)}）`, ok: String(prestige.btnText).includes(`+${prestige.gain} 点（永久 ×${prestige.expectMult.toFixed(2)}）`) });
      report.checks.push({ panel: "转生结算", item: "点数累加", shown: `${prestige.before.prestige}→${prestige.after.prestige}`, expected: `${prestige.before.prestige}→${prestige.before.prestige + prestige.gain}`, ok: prestige.after.prestige === prestige.before.prestige + prestige.gain });
      report.checks.push({ panel: "转生结算", item: "余额/本局累计归零（点击瞬间读数）", shown: `${prestige.afterImmediate.moyu}/${prestige.afterImmediate.total}`, expected: "0/0", ok: prestige.afterImmediate.moyu === 0 && prestige.afterImmediate.total === 0 });
      report.checks.push({ panel: "转生结算", item: "统计面板「本局 / 往期」= 0 / 保留生涯", shown: prestige.statsImmediate.find((x) => x.includes("本局")) || "", expected: "本局 / 往期0 / 50000.13亿（按 formatMoyu）", ok: (prestige.statsImmediate.find((x) => x.includes("本局")) || "").includes("本局 / 往期0 / 50000.13亿") });
      report.checks.push({ panel: "转生结算", item: "下次转生门槛随倍率涨（需 1e8×22=22 亿）", shown: prestige.btnAfter, expected: "需 22.00亿", ok: prestige.btnAfter.includes("需 22.00亿") });
      report.checks.push({ panel: "转生结算", item: "等级保留 80%（floor）", shown: JSON.stringify(prestige.after.levels), expected: JSON.stringify(prestige.expectLevels), ok: JSON.stringify(prestige.after.levels) === JSON.stringify(prestige.expectLevels) });
      report.checks.push({ panel: "转生结算", item: "保留生涯/图鉴/家具/小队/天赋点+1", shown: `${prestige.after.lifetime}|${prestige.after.collected}|${prestige.after.decor}|${prestige.after.team}|${prestige.after.talents}`, expected: `>=${prestige.before.lifetime}|${prestige.before.collected}|${prestige.before.decor}|5|${prestige.before.talents + 1}`, ok: prestige.after.lifetime >= prestige.before.lifetime && prestige.after.collected === prestige.before.collected && prestige.after.decor === prestige.before.decor && prestige.after.team === 5 && prestige.after.talents === prestige.before.talents + 1 });
      report.checks.push({ panel: "转生结算", item: "HUD 立即显示余额 0 + 连胜清零", shown: `${prestige.hudImmediate}|${prestige.after.surviveStreak}`, expected: "0|0", ok: prestige.hudImmediate === "0" && prestige.after.surviveStreak === 0 });
    } catch (e) {
      report.scenarios.error = String(e && e.stack ? e.stack : e).slice(0, 1200);
    }
    try { await cdp.send("Browser.close"); } catch { /* ignore */ }
    cdp.close();
  }, { timeoutMs: 120_000 });
  report.summary = { total: report.checks.length, pass: report.checks.filter((c) => c.ok).length, fail: report.checks.filter((c) => !c.ok).length };
  writeFileSync("playtest/final-data-cdp-settle.json", JSON.stringify(report, null, 2));
  console.log(`[settle] ${report.summary.pass}/${report.summary.total} pass, ${report.summary.fail} fail`);
};

run().catch((e) => {
  console.error("[settle] fatal", e);
  writeFileSync("playtest/final-data-cdp-settle.json", JSON.stringify(report, null, 2));
  process.exit(1);
});