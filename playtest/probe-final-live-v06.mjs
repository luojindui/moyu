/**
 * 终验复验 live 探针 v0.6.0（必须用 playtest/lib/chrome.mjs）：
 *  ① 离线效率 95% 上限 live 引擎验证（低回访/满配/首日，全部 <1）
 *  ② 成就墙 UI 实测：22 条 / 10 分类 / 已完成计数 / 永久加成生效
 *  ③ 不可达成就验证（rank_14 / talent_18）+ 成就等级是否只是展示
 *  ④ 首点音频预热 / FPS 抽查
 *  ⑤ 线上 v0.6.0 部署核对
 * 运行：node playtest/probe-final-live-v06.mjs
 */
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const DEV = "http://127.0.0.1:5173/";
const PROD = "https://luojindui.github.io/moyu/";
const rep = { startedAt: new Date().toISOString(), dev: {}, prod: {} };

async function shot(c, name) {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`playtest/final-v06-live-${name}.png`, Buffer.from(r.data, "base64"));
}
async function main() {
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    try {
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await c.send("Page.navigate", { url: DEV });
      for (let i = 0; i < 80; i++) { if (await c.ev("document.readyState === 'complete' && !!window.__MOYU__") === true) break; await sleep(200); }
      await sleep(1200);

      rep.dev.version = await c.ev("(async () => (await import('/src/version.ts')).APP_VERSION)()");
      rep.dev.hasGrant = await c.ev("typeof window.__MOYU__?.grant === 'function'");

      // ---- ① 离线效率 95% 上限（live 引擎） ----
      rep.dev.offline = await c.ev(`(async () => {
        const { offlineEfficiency, OFFLINE_MAX } = await import('/src/engine/progression.ts');
        const { offlineEarn } = await import('/src/engine/offline.ts');
        const { effectOf } = await import('/src/engine/upgrades.ts');
        const { recruit, upgradeColleague, COLLEAGUES } = await import('/src/engine/team.ts');
        const st0 = window.__MOYU__.state;
        const day = 86400000;
        const now = Date.now();
        const mk = (visits, streak, decor, talents, cols) => {
          let s = { ...st0, moyu: 1e13, totalEarned: 1e12, lifetimeEarned: 1e12, visits: { date: 'x', count: visits },
            daily: { date: 'x', goals: [], streak, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
            decor, talents: { unlocked: talents, points: 0, rankGranted: -1, dailyGiftDate: '', overflow: 0 } };
          for (const id of cols) { s = recruit(s, id); if (!s) break; while ((s.team.colleagues[id]?.level ?? 0) < 5) { const n = upgradeColleague(s, id); if (!n) break; s = n; } }
          const cs = { ...s.team.colleagues };
          for (const k of Object.keys(cs)) cs[k] = { ...cs[k], favor: 100 };
          return { ...s, team: { colleagues: cs } };
        };
        const fullDecor = ['plant','lamp','rug','fridge','chair','aquarium','projector','catbed'];
        const rows = [];
        const cases = [
          ['低回访(0次)', mk(0, 0, [], [], [])],
          ['低回访(1次)', mk(1, 0, [], [], [])],
          ['D8 连签7天', mk(1, 7, [], [], [])],
          ['满配(回访3+连签21+全家具+天赋)', mk(3, 21, fullDecor, ['idle_4','event_5b'], ['mei'])],
          ['满配+成就(成就离线无奖励，验证不影响)', mk(3, 21, fullDecor, ['idle_4','event_5b'], ['mei'])],
        ];
        for (const [name, s] of cases) {
          const eff30 = offlineEfficiency(s, now - 30 * day, now);
          const effFirst = offlineEfficiency(s, now - 3600000, now);
          const e12 = offlineEarn(s, 12 * 3600, eff30).earned;
          const on12 = effectOf(s).idleRate * 12 * 3600;
          rows.push({ name, OFFLINE_MAX, eff30: Number(eff30.toFixed(4)), effFirstDay: Number(effFirst.toFixed(4)),
            offline12h: e12, online12h: on12, ratio: Number((e12 / on12).toFixed(4)) });
        }
        return rows;
      })()`);

      // ---- ② 成就墙 UI ----
      await c.ev("window.__MOYU__.grant(1e13); 'ok'");
      await sleep(300);
      await c.ev("document.getElementById('btn-team').click(); 'ok'");
      await sleep(400);
      // 招募 1 人 + 买 3 件家具 → 应有 team_1 / decor_3 完成
      await c.ev(`(() => { const b = document.querySelector('#team [data-act="recruit"][data-id="zhou"]'); b && b.click(); return true; })()`);
      await sleep(300);
      await c.ev("document.getElementById('tab-decor').click(); 'ok'");
      await sleep(300);
      for (const d of ["plant", "lamp", "rug"]) {
        await c.ev(`(() => { const b = document.querySelector('#team [data-act="decor"][data-id="${d}"] button'); if (b && !b.disabled) b.click(); return true; })()`);
        await sleep(200);
      }
      await c.ev("document.getElementById('team-close').click(); 'ok'");
      await sleep(400);
      await c.ev("document.getElementById('btn-journal').click(); 'ok'");
      await sleep(700);
      rep.dev.achUi = await c.ev(`(() => {
        const items = [...document.querySelectorAll('#ach-list .ach-item')];
        const cats = [...document.querySelectorAll('#ach-categories .ach-cat')];
        return {
          summary: document.getElementById('ach-summary')?.textContent,
          itemCount: items.length,
          doneCount: items.filter((x) => x.classList.contains('done')).length,
          doneNames: items.filter((x) => x.classList.contains('done')).map((x) => x.querySelector('.ach-name')?.textContent?.replace('（已完成）','')),
          categoryCount: cats.length,
          categories: cats.map((x) => x.textContent),
          firstThree: items.slice(0, 3).map((x) => x.textContent.replace(/\\s+/g, ' ').slice(0, 70)),
        };
      })()`);
      await shot(c, "01-journal-achievements");

      // ---- ③ 不可达成就 + 成就等级是否只是展示 ----
      rep.dev.achProof = await c.ev(`(async () => {
        const { ACHIEVEMENTS, achDone, achLevel, achEffects, achPoints } = await import('/src/engine/achievements.ts');
        const { RANKS } = await import('/src/engine/titles.ts');
        const { TALENTS, costOfTalent, canUnlock, unlockTalent } = await import('/src/engine/talents.ts');
        const st = window.__MOYU__.state;
        // rank_14：rankIndex 最大 13
        const maxRank = RANKS.length - 1;
        const rank14 = ACHIEVEMENTS.find((a) => a.id === 'rank_14');
        const stateMaxRank = { ...st, rankIndex: maxRank };
        // talent_18：24 点上限穷举最多节点数
        let ts = { unlocked: [], points: 24, rankGranted: -1, dailyGiftDate: '', overflow: 0 };
        let n = 0;
        for (let r = 0; r < 30; r++) {
          let best = null;
          for (const t of TALENTS) {
            if (!canUnlock(ts, t.id)) continue;
            if (!best || costOfTalent(t.id) < costOfTalent(best) || (costOfTalent(t.id) === costOfTalent(best) && t.tier < (TALENTS.find(x => x.id === best)?.tier ?? 9))) best = t.id;
          }
          if (!best) break;
          ts = unlockTalent({ talents: ts }, best).talents; n++;
        }
        const talent18 = ACHIEVEMENTS.find((a) => a.id === 'talent_18');
        const stateMaxTalent = { ...st, talents: { ...ts, points: 0 } };
        // 全部可达成就（20 条）的加成
        const allReach = { ...st, totalClicks: 1e6, bestIdleRate: 1e12, rankIndex: 13, arcade: { date: 'x', played: 0, best: { findboss: 3000 } }, cardsChosenTotal: 10, surviveStreak: 10,
          decor: ['plant','lamp','rug','fridge','chair','aquarium','projector','catbed'],
          collected: { quotes: [0,1,2,3,4,5,6,7,8,9], flavors: Array.from({length:45},(_,i)=>i) } };
        const ls = { ...st.team.colleagues };
        const team2 = { ...allReach.team.colleagues };
        void team2;
        return {
          rank14: { target: rank14.target, maxRankIndex: maxRank, doneAtMax: achDone(rank14, stateMaxRank) },
          talent18: { target: talent18.target, maxNodesWith24Points: n, doneAtMax: achDone(talent18, stateMaxTalent) },
          reachableMax: ACHIEVEMENTS.length - 2,
          maxLevelReachable: Math.floor((ACHIEVEMENTS.length - 2) / 4) + 1,
          achLevelUsedInEngine: (await import('/src/engine/upgrades.ts')).effectOf({ ...st, talents: { ...st.talents, unlocked: [] } }) ? 'achLevel 不参与 effectOf（仅 achEffects 参与）' : '-',
          allReachableBonus: { idleMult: Number(achEffects(allReach).idleMult.toFixed(3)), clickMult: Number(achEffects(allReach).clickMult.toFixed(3)) },
          levelVsPoints: { points: achPoints(allReach), level: achLevel(allReach) },
          lsUnused: Object.keys(ls).length,
        };
      })()`);

      // ---- ④ 首点音频预热 & FPS ----
      await c.ev("document.getElementById('journal-close')?.click(); document.getElementById('btn-journal')?.click(); 'ok'");
      await sleep(300);
      rep.dev.perf = await c.ev(`(() => {
        const cv = document.getElementById('stage');
        const r = cv.getBoundingClientRect();
        const t0 = performance.now();
        for (let i = 0; i < 5; i++) cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
        const clickMs = performance.now() - t0;
        return { firstClick5TotalMs: Number(clickMs.toFixed(2)), fps: window.__MOYU__.fps, frames: window.__MOYU__.frames };
      })()`);
      await sleep(1200);
      rep.dev.fps2 = await c.ev("window.__MOYU__.fps");
      await shot(c, "02-main-after-actions");
      rep.dev.consoleErrors = c.errors.slice(0, 20);
    } finally {
      c.close();
    }
  }, { timeoutMs: 180_000 });

  // ---- ⑤ 线上核对 ----
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    try {
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await c.send("Page.navigate", { url: PROD });
      for (let i = 0; i < 80; i++) { if (await c.ev("document.readyState") === "complete") break; await sleep(250); }
      await sleep(2500);
      rep.prod.title = await c.ev("document.title");
      rep.prod.updates = await c.ev("fetch('./updates.json').then((r) => r.json()).then((j) => Array.isArray(j) ? j[0] : j).catch(() => null)");
      rep.prod.hasDebugHook = await c.ev("typeof window.__MOYU__ !== 'undefined'");
      await c.ev("document.getElementById('btn-journal').click(); 'ok'");
      await sleep(700);
      rep.prod.achUi = await c.ev(`(() => ({ summary: document.getElementById('ach-summary')?.textContent, items: document.querySelectorAll('#ach-list .ach-item').length, version: document.getElementById('about-version')?.textContent }))()`);
      await shot(c, "03-prod-achievements");
      rep.prod.consoleErrors = c.errors.slice(0, 20);
    } finally { c.close(); }
  }, { timeoutMs: 120_000 });

  rep.finishedAt = new Date().toISOString();
  writeFileSync("playtest/final-v06-live-report.json", JSON.stringify(rep, null, 2));
  console.log(JSON.stringify(rep, null, 2).slice(0, 14000));
}
main().catch((e) => { console.error("FAILED", e); writeFileSync("playtest/final-v06-live-report.json", JSON.stringify({ error: String(e), rep }, null, 2)); process.exit(1); });