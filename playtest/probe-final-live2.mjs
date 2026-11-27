/**
 * 终验 live 探针 #2（用 playtest/lib/chrome.mjs）：
 *  1) 「省心组合」live 实测 vs 引擎最优组合（slack+focus）
 *  2) 离线效率 >100% 的 live 引擎验证（动态 import dev 模块）
 *  3) 日报/图鉴/转生面板 UI 与文案
 * 运行：node playtest/probe-final-live2.mjs
 */
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const DEV = "http://127.0.0.1:5173/";
const rep = {};

async function shot(c, name) {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`playtest/final-live-${name}.png`, Buffer.from(r.data, "base64"));
}

await runChrome(async ({ port }) => {
  const c = await connect(port);
  try {
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send("Page.navigate", { url: DEV });
    for (let i = 0; i < 80; i++) {
      if (await c.ev("document.readyState === 'complete' && !!window.__MOYU__") === true) break;
      await sleep(200);
    }
    await sleep(1000);

    // ---------- 1) 省心组合 live ----------
    await c.ev("window.__MOYU__.grant(1e12); 'ok'");
    await sleep(300);
    await c.ev("document.getElementById('btn-team').click(); 'ok'");
    await sleep(400);
    await c.ev("document.getElementById('tab-decor').click(); 'ok'");
    await sleep(300);
    rep.energyBefore = await c.ev("window.__MOYU__.state.energy");
    await c.ev("(() => { const b = document.querySelector('#team [data-act=\"energy-all\"]'); b && b.click(); return true; })()");
    await sleep(400);
    rep.energyAfterSimpleCombo = await c.ev(`(() => { const e = window.__MOYU__.state.energy; return { left: e.left, used: e.used, boosted: e.boosted }; })()`);
    // 引擎最优组合（slack+focus）在同一状态下的期望值：用 dev 引擎函数算
    rep.energyEngine = await c.ev(`(async () => {
      const { ENERGY_ACTIONS, useEnergy } = await import('/src/engine/energy.ts');
      const { effectOf } = await import('/src/engine/upgrades.ts');
      const s = window.__MOYU__.state;
      // 重置精力后再组合
      const base = { ...s, energy: { date: '2026-11-27', left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } } };
      const out = {};
      for (const combo of [['slack', 'focus'], ['slack', 'fake-work', 'social'], ['slack', 'social', 'fake-work', 'focus']]) {
        let st = base;
        let ok = true;
        for (const a of combo) { st = useEnergy(st, a); if (!st) { ok = false; break; } }
        out[combo.join('+')] = ok ? { idleMult: st.energy.boosted.idleMult, left: st.energy.left, effectiveRate: effectOf(st).idleRate } : '不可用';
      }
      return out;
    })()`);

    // ---------- 2) 离线效率 live（dev 动态 import 引擎） ----------
    rep.offlineEngine = await c.ev(`(async () => {
      const { offlineEfficiency } = await import('/src/engine/progression.ts');
      const { offlineEarn } = await import('/src/engine/offline.ts');
      const { EXIT } = {};
      const s = window.__MOYU__.state;
      const now = Date.now();
      const day = 86400000;
      const mk = (visits, streak, decor, talents) => ({
        ...s,
        visits: { date: '2026-11-20', count: visits },
        daily: { date: '2026-11-20', goals: [], streak, lastCompleteDate: null, claimed: false, window: 0, claimsToday: 0 },
        decor,
        talents: { unlocked: talents, points: 0, rankGranted: -1, dailyGiftDate: '', overflow: 0 },
      });
      const rows = [];
      const cases = [
        ['D2 无加成（访问1, 连签0）', mk(1, 0, [], [])],
        ['D8 连签7天', mk(1, 7, [], [])],
        ['D22 连签21+回访3+小美', mk(3, 21, [], ['idle_4'])],
        ['D22 + 全套家具', mk(3, 21, ['plant','lamp','rug','fridge','chair','aquarium','projector','catbed'], ['idle_4'])],
        ['D22 + 家具 + 事件终极', mk(3, 21, ['plant','lamp','rug','fridge','chair','aquarium','projector','catbed'], ['idle_4','event_1','event_2','event_3','event_4','event_5b'])],
      ];
      for (const [name, st] of cases) {
        const eff = offlineEfficiency(st, now - 30 * day, now);
        const e12 = offlineEarn(st, 12 * 3600, eff).earned;
        const online12 = (await import('/src/engine/upgrades.ts')).effectOf(st).idleRate * 12 * 3600;
        rows.push({ name, eff: Number(eff.toFixed(4)), offline12h: e12, online12h: online12, ratio: Number((e12 / online12).toFixed(4)) });
      }
      return rows;
    })()`);

    // ---------- 3) 日报/图鉴/转生 UI ----------
    await c.ev("document.getElementById('team-close').click(); 'ok'");
    await sleep(400);
    await c.ev("document.getElementById('btn-journal').click(); 'ok'");
    await sleep(600);
    rep.journalOpen = await c.ev("!document.getElementById('journal').classList.contains('hidden')");
    rep.journalText = await c.ev("document.getElementById('journal').innerText.replace(/\\n{2,}/g,'\\n').slice(0, 1500)");
    await shot(c, "30-journal");
    rep.prestigeUi = await c.ev(`(() => { const b = document.getElementById('prestige-btn'); return b ? { text: b.textContent, disabled: b.disabled, info: document.getElementById('prestige-info').textContent } : null; })()`);
    // 图鉴
    const tabs = await c.ev(`[...document.querySelectorAll('#journal .tab, #journal [role="tab"]')].map((b) => b.textContent)`);
    rep.journalTabs = tabs;
    await shot(c, "31-journal-page");
    rep.consoleErrors = c.errors.slice(0, 20);
  } finally {
    c.close();
  }
}, { timeoutMs: 120_000 });

writeFileSync("playtest/final-live2-report.json", JSON.stringify(rep, null, 2));
console.log(JSON.stringify(rep, null, 2).slice(0, 9000));