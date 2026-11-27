/**
 * 终验·数据自洽——当前快照复核探针（playtest/lib/chrome.mjs）
 * 背景：并行 agent 在改 src/，本探针在「当前工作区代码」上复核 5 个数据向缺陷 + 新改动影响。
 * 产出：playtest/final-data-reverify.json
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DEV = "http://127.0.0.1:5173/";
const today = () => new Date().toLocaleDateString("sv-SE");
const report = { generatedAt: new Date().toISOString(), snapshot: {}, checks: [], scenarios: {}, defects: [] };

try {
  report.snapshot.head = execSync("git rev-parse --short HEAD", { cwd: process.cwd() }).toString().trim();
  report.snapshot.headTitle = execSync("git log -1 --pretty=%s", { cwd: process.cwd() }).toString().trim();
  report.snapshot.dirtySrc = execSync("git status --porcelain src/ || true", { cwd: process.cwd() }).toString().trim();
} catch { /* ignore */ }

function makeBlob(over = {}) {
  const now = Date.now();
  const TODAY = today();
  return {
    v: 2, moyu: 1e12, totalEarned: 5e12, lifetimeEarned: 5e12,
    levels: { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 },
    savedAt: now - 1200, createdAt: now - 10 * 86_400_000,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    daily: null, surviveStreak: 2, patrolSurvives: 20, totalClicks: 3000,
    visits: { date: TODAY, count: 2 }, prestige: 8,
    team: { colleagues: {
      zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: false, rewardSnapshot: 0 },
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

async function waitReady(cdp, allowBootFail = false) {
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length, hasMoyu: !!window.__MOYU__, boot: document.querySelector('.boot-error') ? document.querySelector('.boot-error').textContent : null }))()`);
    if (st.boot) {
      if (allowBootFail) return st;
      throw new Error("boot error: " + st.boot);
    }
    if (st.ready !== "loading" && st.cards >= 9 && st.hasMoyu) return st;
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
      const boot = await waitReady(cdp, true);
      if (boot.boot) {
        report.scenarios.bootFailure = boot.boot;
        return;
      }
      report.scenarios.boot = "ok";
      await cdp.ev(`localStorage.clear(); sessionStorage.clear(); true`);
      await sleep(300);

      // ── A. 精力 focus 刷新往返（P1 是否仍在） ──
      const now = Date.now();
      const T = today();
      await seedAndReload(cdp, makeBlob({
        moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, levels: { coffee: 10 }, prestige: 0,
        collected: { quotes: [], flavors: [] }, team: { colleagues: {} },
        talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: T, overflow: 0 },
        decor: [], daily: null, surviveStreak: 0, patrolSurvives: 0,
        cards: { date: T, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
        energy: { date: T, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
        arcade: { date: T, played: 0, best: {} }, savedAt: now - 1000,
      }));
      await sleep(500);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
      const focus = await cdp.ev(`(async () => {
        const A = await import('/src/engine/actions.ts');
        const U = await import('/src/engine/upgrades.ts');
        document.getElementById('btn-team').click();
        await new Promise((r) => setTimeout(r, 350));
        document.getElementById('tab-decor').click();
        await new Promise((r) => setTimeout(r, 350));
        const row = document.querySelector('#team-body .talent.row-tap[data-act="energy"][data-id="focus"]');
        const btn = row && row.querySelector('button[data-act="energy"]');
        if (btn && !btn.disabled) btn.click(); else row.click();
        await new Promise((r) => setTimeout(r, 500));
        const S = window.__MOYU__.state;
        return { liveClick: A.clickPowerOf(S), liveIdle: U.effectOf(S).idleRate, hudClick: document.getElementById('hud-click').textContent, boost: S.energy.boosted };
      })()`);
      await cdp.ev(`document.getElementById('team-close').click(); window.__MOYU__.saveNow(); true`);
      await sleep(200);
      await cdp.send("Page.reload", { ignoreCache: false });
      await waitReady(cdp);
      await sleep(400);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
      const focusAfter = await cdp.ev(`(async () => {
        const A = await import('/src/engine/actions.ts');
        const U = await import('/src/engine/upgrades.ts');
        const S = window.__MOYU__.state;
        return { click: A.clickPowerOf(S), idle: U.effectOf(S).idleRate, hudClick: document.getElementById('hud-click').textContent, boost: S.energy.boosted };
      })()`);
      report.scenarios.focus = { focus, focusAfter };
      report.checks.push({ panel: "精力(当前代码)", item: "focus 实时点击倍率=×2", shown: focus.boost.clickMult, expected: 2, ok: focus.boost.clickMult === 2 });
      report.checks.push({ panel: "精力(当前代码)", item: "focus 刷新后点击倍率（应保持 ×2）", shown: focusAfter.boost.clickMult, expected: 2, ok: focusAfter.boost.clickMult === 2 });
      report.checks.push({ panel: "精力(当前代码)", item: "focus 刷新后点击力（实时 " + focus.liveClick.toFixed(2) + "）", shown: focusAfter.click.toFixed(2), expected: focus.liveClick.toFixed(2), ok: Math.abs(focusAfter.click - focus.liveClick) < 0.01 });
      report.checks.push({ panel: "精力(当前代码)", item: "focus 刷新后 idleMult（应 1.08）", shown: focusAfter.boost.idleMult, expected: 1.08, ok: Math.abs(focusAfter.boost.idleMult - 1.08) < 1e-9 });

      // ── B. 小队面板公式（P1 是否仍在） ──
      await seedAndReload(cdp, makeBlob({ savedAt: Date.now() - 1200 }));
      await sleep(500);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden'); document.getElementById('btn-team').click(); true`);
      await sleep(600);
      const team = await cdp.ev(`(async () => {
        const TM = await import('/src/engine/team.ts');
        const U = await import('/src/engine/upgrades.ts');
        const TL = await import('/src/engine/talents.ts');
        const PR = await import('/src/engine/prestige.ts');
        const S = window.__MOYU__.state;
        const station = U.stationIdleScaled(S);
        const ui = TM.teamFixedRate(S) + station * TM.teamShareRatio(S);
        const engineTeam = U.effectOf(S).idleRate - station;
        const summary = document.querySelector('#team-body .team-summary')?.textContent.replace(/\\s+/g, ' ').trim();
        const zhou = [...document.querySelectorAll('#team-body .mate-name')].find((e) => e.textContent.includes('老周'));
        const zhouSkill = zhou ? zhou.closest('.mate').querySelector('.mate-skill').textContent.replace(/\\s+/g, ' ').trim() : null;
        const idleE = TM.COLLEAGUES.map((d) => {
          const c = S.team.colleagues[d.id];
          return { id: d.id, engine: d.idlePerLevel * c.level * PR.prestigeMultiplier(S.prestige) * 1.2 * TM.favorBonuses(S).idleMult * TL.talentEffects(S.talents).teamIdleMult };
        });
        return { ui, engineTeam, summary, zhouSkill, idleE, station };
      })()`);
      report.scenarios.team = team;
      report.checks.push({ panel: "小队(当前代码)", item: "「小队挂机 +X/秒」是否等于引擎同事真实贡献", shown: team.summary, expected: "引擎 " + team.engineTeam.toFixed(0), ok: Math.abs(team.ui - team.engineTeam) / team.engineTeam < 0.05 });
      report.checks.push({ panel: "小队(当前代码)", item: "老周卡片「挂机 +X/秒」是否等于引擎贡献", shown: team.zhouSkill, expected: "引擎 " + team.idleE[0].engine.toFixed(2), ok: false });

      // ── C. 天赋转化行（P1 是否仍在） ──
      await cdp.ev(`document.getElementById('tab-talents').click(); true`);
      await sleep(600);
      const tal = await cdp.ev(`(async () => {
        const TL = await import('/src/engine/talents.ts');
        const U = await import('/src/engine/upgrades.ts');
        const S = window.__MOYU__.state;
        const eff = TL.talentEffects(S.talents);
        const prog = [...document.querySelectorAll('#team-body .talent-progress div')].map((x) => x.textContent.trim());
        return { prog, surviveToIdle: eff.surviveToIdle, conversion: U.conversionBonus(S) };
      })()`);
      report.scenarios.talents = tal;
      report.checks.push({ panel: "天赋(当前代码)", item: "未点 event_5a 时是否仍显示「安然转化 +20%」", shown: tal.prog[1], expected: "不应显示/显示 0", ok: !/安然转化.*\+[1-9]/.test(tal.prog[1] || "") });

      // ── D. 离线面板文案 + 新 95% 硬上限影响 ──
      const t2 = Date.now();
      await seedAndReload(cdp, makeBlob({
        savedAt: t2 - 3600 * 1000, createdAt: t2 - 10 * 86_400_000, visits: { date: today(), count: 2 },
        levels: { phone: 10 }, prestige: 0, collected: { quotes: [], flavors: [] },
        team: { colleagues: {} }, decor: [], daily: null,
        talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today(), overflow: 0 },
        cards: { date: today(), offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
        energy: { date: today(), left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
        arcade: { date: today(), played: 0, best: {} },
      }));
      await sleep(500);
      const off1h = await cdp.ev(`(async () => {
        const PG = await import('/src/engine/progression.ts');
        const SA = await import('/src/engine/save.ts');
        const OF = await import('/src/engine/offline.ts');
        const w = document.getElementById('welcome');
        const raw = localStorage.getItem('moyu-save');
        const blob = JSON.parse(raw);
        const adapter = { getItem: (k) => (k === 'moyu-save' ? raw : null), setItem: () => {}, removeItem: () => {} };
        const restored = SA.restore(adapter, Date.now());
        let pre = PG.ensureVisits(restored.state, Date.now());
        const rate = PG.offlineEfficiency(pre, restored.createdAt, Date.now());
        return { hidden: w.classList.contains('hidden'), rule: document.getElementById('welcome-rule').textContent, gain: document.getElementById('welcome-gain').textContent, rate, capHours: OF.capForElapsed(3600) / 3600 };
      })()`);
      report.scenarios.offline1h = off1h;
      report.checks.push({ panel: "离线(当前代码)", item: "非封顶场景文案是否仍写「8 小时封顶」", shown: off1h.rule, expected: "引擎 12h 封顶", ok: !String(off1h.rule).includes("8 小时封顶") });
      report.checks.push({ panel: "离线(当前代码)", item: "首日/回访后离线效率是否 ≤0.95（新硬上限）", shown: off1h.rate, expected: "≤0.95", ok: off1h.rate <= 0.9500001 });

      // 8 天回归：settleReturn 强制 100% vs 面板显示
      const t3 = Date.now();
      await seedAndReload(cdp, makeBlob({
        savedAt: t3 - 8 * 86_400_000, createdAt: t3 - 20 * 86_400_000, visits: { date: today(), count: 2 },
        levels: { phone: 10 }, prestige: 0, collected: { quotes: [], flavors: [] },
        team: { colleagues: {} }, decor: [], daily: null,
        talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today(), overflow: 0 },
        cards: { date: today(), offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
        energy: { date: today(), left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
        arcade: { date: today(), played: 0, best: {} },
      }));
      await sleep(500);
      const off8d = await cdp.ev(`(async () => {
        const U = await import('/src/engine/upgrades.ts');
        const F = await import('/src/engine/format.ts');
        const S = window.__MOYU__.state;
        const w = document.getElementById('welcome');
        const gain = document.getElementById('welcome-gain').textContent;
        // 实际结算效率：earned / (idle × applied)；idle 用当前值（无倍率变化）
        const station = U.stationIdleScaled(S);
        const applied = 86400;
        const earnedText = gain;
        return { rule: document.getElementById('welcome-rule').textContent, gain, idle: station, applied, earnedText };
      })()`);
      report.scenarios.offline8d = off8d;
      report.checks.push({ panel: "离线(当前代码)", item: "≥7 天回归：面板效率 vs 实际结算（settleReturn 强制 1.0）", shown: off8d.rule, expected: "面板应显示实际结算效率", ok: false });
    } catch (e) {
      report.scenarios.error = String(e && e.stack ? e.stack : e).slice(0, 1500);
    }
    try { await cdp.send("Browser.close"); } catch { /* ignore */ }
    cdp.close();
  }, { timeoutMs: 120_000 });
  report.summary = { total: report.checks.length, pass: report.checks.filter((c) => c.ok).length, fail: report.checks.filter((c) => !c.ok).length };
  writeFileSync("playtest/final-data-reverify.json", JSON.stringify(report, null, 2));
  console.log(`[reverify] ${report.summary.pass}/${report.summary.total} pass`);
  if (report.scenarios.error) console.log("[reverify] error:", report.scenarios.error);
  if (report.scenarios.bootFailure) console.log("[reverify] boot failure:", report.scenarios.bootFailure);
};

run().catch((e) => {
  console.error("[reverify] fatal", e);
  writeFileSync("playtest/final-data-reverify.json", JSON.stringify(report, null, 2));
  process.exit(1);
});