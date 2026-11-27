/**
 * R12 批次 1 复验：CDP 实机验证（领取显示=到账 / 一键领取 / 重绘点击竞态 / 天赋 18 节点与互斥
 * / 重置确认 / 脏 missionId / 降级备份 / 暴击与连击上限 / 新字段持久化）。
 * 只读 src/；不改源码。产出 playtest/r12-aud2-cdp-report.json + 截图。
 * 运行：node playtest/probe-r12-aud2-cdp.mjs（需 dev server http://127.0.0.1:5173/）
 */
import { openBrowser, sleep, setupMobilePage } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const W = 390;
const H = 844;
const report = { startedAt: new Date().toISOString(), scenarios: {} };

const b = await openBrowser({ port: 9497, tag: "r12aud2" });
await setupMobilePage(b, { url: URL, width: W, height: H });
async function waitGame(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if ((await b.ev("!!window.__MOYU__ && !!document.getElementById('stage') ? 1 : 0")) === 1) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("game not ready");
}
await waitGame();

const ev = (expr) => b.ev(expr);
const evj = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));
const state = () => evj(`window.__MOYU__.state`);

let seedId = null;
const clearSeed = async () => {
  if (seedId) {
    await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedId });
    seedId = null;
  }
};
const reload = async () => {
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(1800);
  await waitGame();
};
const baseBlob = (over = {}) => ({
  v: 2,
  moyu: 0,
  totalEarned: 0,
  lifetimeEarned: 0,
  levels: {},
  savedAt: Date.now(),
  createdAt: Date.now() - 3600_000,
  collected: { quotes: [], flavors: [] },
  daily: null,
  surviveStreak: 0,
  patrolSurvives: 0,
  totalClicks: 0,
  visits: { date: "", count: 0 },
  prestige: 0,
  team: { colleagues: {} },
  talents: { unlocked: [], points: 0, rankGranted: -1 },
  ...over,
});
const seedSave = async (blob) => {
  await clearSeed();
  const src = `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); } catch (e) {} })()`;
  const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  seedId = r.identifier;
  await reload();
  await clearSeed();
};
const openPanel = async (tab) => {
  await ev(`document.getElementById('btn-team').click()`);
  await sleep(450);
  if (tab === "talents") {
    await ev(`document.getElementById('tab-talents').click()`);
    await sleep(350);
  }
};
const closePanel = async () => {
  await ev(`document.getElementById('team-close').click()`);
  await sleep(200);
};
const mate = (level = 1, over = {}) => ({
  level,
  missionId: null,
  startedAt: 0,
  endsAt: 0,
  favor: 0,
  autoRepeat: false,
  rewardSnapshot: 0,
  ...over,
});
const t0 = () => Date.now();

// ---------- L1：真实流程 招募→派遣→endMissions→领取，显示=到账 ----------
try {
  await ev(`localStorage.clear()`);
  await reload();
  await ev(`window.__MOYU__.reset()`);
  await sleep(250);
  await ev(`window.__MOYU__.grant(30000)`);
  await sleep(250);
  await openPanel("colleagues");
  const summaryText = await ev(`document.querySelector('.team-summary').innerText`);
  await ev(`document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]').click()`);
  await sleep(250);
  await ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]').click()`);
  await sleep(300);
  const dispatched = await state();
  const countdown = await ev(`(document.querySelector('[data-countdown="zhou"]')||{}).innerText || ''`);
  await ev(`window.__MOYU__.endMissions()`);
  await sleep(500);
  const badge = await evj(`(() => { const el=document.querySelector('#btn-team .badge'); return el?el.textContent:null })()`);
  const claimText = await ev(`(document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]')||{}).innerText || ''`);
  const before = await state();
  await ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]').click()`);
  await sleep(150);
  const after = await state();
  const badgeAfter = await evj(`(() => { const el=document.querySelector('#btn-team .badge'); return el?el.textContent:null })()`);
  const snap = dispatched.team.colleagues.zhou?.rewardSnapshot;
  report.scenarios.L1 = {
    summaryText,
    countdownBeforeEnd: countdown,
    badge,
    claimText,
    snapshot: snap,
    moyuDelta: after.moyu - before.moyu,
    expectedSnapshot: snap,
    idleAccrual: after.moyu - before.moyu - snap,
    favor: after.team.colleagues.zhou?.favor,
    missionCleared: after.team.colleagues.zhou?.missionId === null,
    badgeAfter,
    note: "按钮文案=快照=实到账（差额为等待期间自然挂机）",
  };
  console.log("[L1]", JSON.stringify(report.scenarios.L1));
} catch (e) {
  report.scenarios.L1 = { error: String(e) };
  console.error("[L1]", e);
}

// ---------- L2：一键领取显示值 vs 实到账（快照 vs 当前挂机率） ----------
try {
  const now = t0();
  await seedSave(
    baseBlob({
      levels: { retire: 10 },
      moyu: 0,
      totalEarned: 0,
      lifetimeEarned: 0,
      team: {
        colleagues: {
          zhou: mate(1, { missionId: "quick", startedAt: now - 900_000, endsAt: now - 1000, rewardSnapshot: 5000 }),
          mei: mate(1, { missionId: "chat", startedAt: now - 1_800_000, endsAt: now - 1000, rewardSnapshot: 6000 }),
        },
      },
    }),
  );
  await openPanel("colleagues");
  const summary = await ev(`document.querySelector('.team-summary').innerText`);
  const claimAllText = await ev(`(document.querySelector('#team-body button[data-act="claim-all"]')||{}).innerText || ''`);
  const cardTexts = await evj(`[...document.querySelectorAll('#team-body button[data-act="claim"]')].map(b=>b.innerText)`);
  const before = await state();
  await ev(`document.querySelector('#team-body button[data-act="claim-all"]').click()`);
  await sleep(200);
  const after = await state();
  report.scenarios.L2 = {
    summary,
    claimAllText,
    cardTexts,
    moyuDelta: after.moyu - before.moyu,
    snapshotSum: 11_000,
    idleAccrual: after.moyu - before.moyu - 11_000,
    note: "一键按钮显示值按当前挂机率重算（虚高），实到账=快照之和 11000",
  };
  await b.shot("playtest/r12-aud2-team-live.png");
  console.log("[L2]", JSON.stringify(report.scenarios.L2));
} catch (e) {
  report.scenarios.L2 = { error: String(e) };
  console.error("[L2]", e);
}

// ---------- L3：面板高频重绘 → 按住超过一次重绘间隔的点击失效（真实鼠标/触摸手势） ----------
try {
  const holdClick = async (selector, holdMs) => {
    const rect = await evj(`(() => { const el=document.querySelector('${selector}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
    if (!rect) return { error: "button not found" };
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await sleep(holdMs);
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await sleep(350);
    return { rect };
  };
  const seedIdle = async (moyu = 0) =>
    seedSave(
      baseBlob({
        moyu,
        totalEarned: moyu,
        lifetimeEarned: moyu,
        team: { colleagues: { zhou: mate(1) } },
      }),
    );

  // 重绘频率：打标记后 200ms 是否还在
  await seedIdle(1e6);
  await openPanel("colleagues");
  const rerender = await evj(`(() => {
    const btn = document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]');
    btn.dataset.mark = "x";
    return { found: !!btn };
  })()`);
  await sleep(220);
  const markAfter220 = await ev(`(() => { const b=document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); return b ? (b.dataset.mark === "x" ? "same-node" : "same-pos-new-node") : "gone"; })()`);

  // A：快速点（30ms）应生效
  await closePanel();
  await seedIdle(1e6);
  await openPanel("colleagues");
  const fast = await holdClick('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]', 30);
  const afterFast = await state();

  // B：慢按（250ms，跨越 150ms 重绘）是否失效
  await closePanel();
  await seedIdle(1e6);
  await openPanel("colleagues");
  const slow = await holdClick('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]', 250);
  const afterSlow = await state();

  // C：模拟真实点按时长（100~150ms）×3
  const trials = [];
  for (let i = 0; i < 3; i++) {
    await closePanel();
    await seedIdle(1e6);
    await openPanel("colleagues");
    await holdClick('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]', 120);
    const st = await state();
    trials.push(st.team.colleagues.zhou?.missionId ?? null);
  }
  report.scenarios.L3 = {
    firstDispatchButton: rerender,
    markAfter220ms: markAfter220,
    fast30ms: { rect: fast, missionId: afterFast.team.colleagues.zhou?.missionId },
    slow250ms: { rect: slow, missionId: afterSlow.team.colleagues.zhou?.missionId },
    tap120msTrials: trials,
    note: "面板每 ~150ms 全量重建 → 按住超过一次重建的点击落在被替换的节点上，click 不触发（120ms 点按也可能丢）",
  };
  console.log("[L3]", JSON.stringify(report.scenarios.L3));
} catch (e) {
  report.scenarios.L3 = { error: String(e) };
  console.error("[L3]", e);
}

// ---------- L4：天赋面板 18 节点 / 互斥终极 / 2 点 / 重置二次确认 ----------
try {
  await seedSave(baseBlob({ moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, talents: { unlocked: [], points: 10, rankGranted: 12 } }));
  await openPanel("talents");
  const countTalents = await ev(`document.querySelectorAll('#team-body .talent').length`);
  const ultLabels = await evj(`[...document.querySelectorAll('#team-body .talent')].filter(el=>el.innerText.includes('终极')).map(el=>el.querySelector('.talent-name').innerText)`);
  const pointsLabelBefore = await ev(`document.getElementById('team-points').innerText`);
  // 点 click_1..click_4，再点 click_5a
  for (const id of ["click_1", "click_2", "click_3", "click_4"]) {
    await ev(`(() => { const b=document.querySelector('#team-body button[data-act="talent"][data-id="${id}"]'); if(b && !b.disabled) b.click(); })()`);
    await sleep(180);
  }
  const afterLinear = await state();
  await ev(`document.querySelector('#team-body button[data-act="talent"][data-id="click_5a"]').click()`);
  await sleep(250);
  const afterUlt = await state();
  const ult5b = await evj(`(() => { const b=document.querySelector('#team-body button[data-act="talent"][data-id="click_5b"]'); return b?{disabled:b.disabled,text:b.innerText,desc:document.querySelector('#team-body button[data-act="talent"][data-id="click_5b"]').closest('.talent').innerText}:null; })()`);
  // 重置：确认弹窗计数
  await ev(`window.__confirmCalls=0; window.confirm=function(){ window.__confirmCalls++; return true; }`);
  await ev(`document.querySelector('#team-body button[data-act="reset-talents"]').click()`);
  await sleep(350);
  const afterReset = await state();
  const confirmCalls = await ev(`window.__confirmCalls`);
  report.scenarios.L4 = {
    talentNodeCount: countTalents,
    ultimateLabels: ultLabels,
    pointsLabelBefore,
    pointsAfterLinear: afterLinear.talents?.points,
    unlockedAfterLinear: afterLinear.talents?.unlocked,
    pointsAfterUlt: afterUlt.talents?.points,
    unlockedAfterUlt: afterUlt.talents?.unlocked,
    ult5b,
    resetPoints: afterReset.talents?.points,
    resetUnlocked: afterReset.talents?.unlocked,
    confirmCalls,
    note: "18 节点 / 终极标 2 点 / 选 5a 后 5b 禁用 / 重置有 confirm",
  };
  await b.shot("playtest/r12-aud2-talents.png");
  console.log("[L4]", JSON.stringify(report.scenarios.L4));
} catch (e) {
  report.scenarios.L4 = { error: String(e) };
  console.error("[L4]", e);
}

// ---------- L5：脏 missionId 实机（P1-4 复验） ----------
try {
  const now = t0();
  await seedSave(
    baseBlob({
      moyu: 1000,
      totalEarned: 1000,
      lifetimeEarned: 1000,
      team: { colleagues: { zhou: mate(1, { missionId: "ghost_mission", endsAt: now - 1000 }) } },
    }),
  );
  await openPanel("colleagues");
  const claimBtn = await evj(`(() => { const b=document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]'); return b?b.innerText:null; })()`);
  await ev(`window.__errs=[]; window.addEventListener('error', e => window.__errs.push(String(e.message)))`);
  const before = await state();
  await ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]').click()`);
  await sleep(450);
  const errs = await evj(`window.__errs`);
  const after = await state();
  report.scenarios.L5 = {
    claimButton: claimBtn,
    errors: errs,
    favorBefore: before.team.colleagues.zhou?.favor,
    favorAfter: after.team.colleagues.zhou?.favor,
    missionStill: after.team.colleagues.zhou?.missionId,
    note: "P1-4 复验：未知 missionId 仍抛 TypeError、状态不变、同事卡死",
  };
  await b.shot("playtest/r12-aud2-ghost.png");
  console.log("[L5]", JSON.stringify(report.scenarios.L5));
} catch (e) {
  report.scenarios.L5 = { error: String(e) };
  console.error("[L5]", e);
}

// ---------- L6：降级覆盖备份（P1-5 复验） ----------
try {
  const future = JSON.stringify({ v: 3, moyu: 999, levels: { retire: 40 }, savedAt: Date.now(), team: { colleagues: {} }, talents: { unlocked: [] }, patrolSurvives: 3 });
  await seedSave(JSON.parse(future));
  // 引导完成后再写一次档
  await ev(`window.__MOYU__.saveNow()`);
  await sleep(300);
  const keys = await evj(`Object.keys(localStorage).sort()`);
  const raw = await evj(`(() => { try { return JSON.parse(localStorage.getItem('moyu-save')); } catch(e){ return null; } })()`);
  const bak = await ev(`localStorage.getItem('moyu-save.newer.bak')`);
  report.scenarios.L6 = {
    keys,
    saveVersionAfterBoot: raw?.v,
    saveMoyuAfterBoot: raw?.moyu,
    newerBackup: bak,
    note: "P1-5 复验：v3 档被 v2 客户端覆盖，moyu-save.newer.bak 未生成（备份函数仍未调用）",
  };
  console.log("[L6]", JSON.stringify(report.scenarios.L6));
} catch (e) {
  report.scenarios.L6 = { error: String(e) };
  console.error("[L6]", e);
}

// ---------- L7：暴击缺失 / 连击上限已接入（实机） ----------
try {
  await seedSave(
    baseBlob({
      moyu: 0,
      totalEarned: 0,
      lifetimeEarned: 0,
      talents: { unlocked: ["click_1", "click_2", "click_3", "click_4"], points: 0, rankGranted: 12 },
    }),
  );
  const deltas = await b.ev(`(async () => {
    const c = document.getElementById('stage');
    const out = [];
    let i = 0;
    await new Promise((resolve) => {
      const tick = () => {
        const before = window.__MOYU__.state.moyu;
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 200, bubbles: true, isPrimary: true, pointerType: 'touch' }));
        const after = window.__MOYU__.state.moyu;
        out.push(+(after - before).toFixed(4));
        if (++i >= 26) resolve(); else setTimeout(tick, 120);
      };
      setTimeout(tick, 80);
    });
    return out;
  })()`);
  await sleep(400);
  const comboHud = await evj(`(() => { const el=document.getElementById('hud-combo'); return {text:el.textContent, hidden:el.classList.contains('hidden')}; })()`);
  report.scenarios.L7 = {
    clickDeltas: deltas,
    minDelta: Math.min(...deltas),
    maxDelta: Math.max(...deltas),
    comboHud,
    note: "有 click_3/click_4：HUD 连击应 >20（证明 click_3 接入）；delta 最大值应≈最小值（证明 click_4 暴击未接入）",
  };
  console.log("[L7]", JSON.stringify(report.scenarios.L7));
} catch (e) {
  report.scenarios.L7 = { error: String(e) };
  console.error("[L7]", e);
}

// ---------- L8：UI 规格（hh:mm:ss / 满级文案 / 汇总）与存档持久化 ----------
try {
  const now = t0();
  const cols = {};
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) cols[id] = mate(5);
  cols.zhou = mate(5, { missionId: "coffee", startedAt: now - 2000, endsAt: now + 8 * 3600 * 1000, autoRepeat: true, rewardSnapshot: 123456 });
  await seedSave(baseBlob({ levels: { retire: 10 }, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, team: { colleagues: cols } }));
  await openPanel("colleagues");
  const countdown = await ev(`(document.querySelector('[data-countdown="zhou"]')||{}).innerText || ''`);
  const upgradeTexts = await evj(`[...document.querySelectorAll('#team-body button[data-act="upgrade"]')].map(b=>b.innerText)`);
  const summary = await ev(`document.querySelector('.team-summary').innerText`);
  const autoText = await evj(`[...document.querySelectorAll('#team-body button[data-act="auto"]')].map(b=>b.innerText)`);
  // 刷新后新字段保留
  await ev(`window.__MOYU__.saveNow()`);
  await sleep(200);
  const blobBeforeReload = await evj(`JSON.parse(localStorage.getItem('moyu-save'))`);
  await reload();
  await openPanel("colleagues");
  const afterReload = await state();
  report.scenarios.L8 = {
    countdown,
    upgradeTexts,
    summary,
    autoText,
    blobSnapshotBeforeReload: blobBeforeReload?.team?.colleagues?.zhou,
    afterReload: afterReload.team.colleagues.zhou,
    note: "hh:mm:ss / 已满级 Lv.5 / 顶部汇总 / autoRepeat+rewardSnapshot 刷新后保留",
  };
  await b.shot("playtest/r12-aud2-ui.png");
  console.log("[L8]", JSON.stringify(report.scenarios.L8));
} catch (e) {
  report.scenarios.L8 = { error: String(e) };
  console.error("[L8]", e);
}

// ---------- L9：面板打开时领取 → 角标是否同步（refreshNow 绕过 refresh） ----------
try {
  const now = t0();
  await seedSave(
    baseBlob({
      moyu: 1000,
      totalEarned: 1000,
      lifetimeEarned: 1000,
      team: { colleagues: { zhou: mate(1, { missionId: "quick", startedAt: now - 900_000, endsAt: now - 1000, rewardSnapshot: 1000 }) } },
    }),
  );
  await sleep(300);
  const badgeBefore = await evj(`(() => { const el=document.querySelector('#btn-team .badge'); return el?el.textContent:null })()`);
  await openPanel("colleagues");
  const badgeOpenBefore = await evj(`(() => { const el=document.querySelector('#btn-team .badge'); return el?el.textContent:null })()`);
  await ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]').click()`);
  await sleep(600);
  const badgeOpenAfter = await evj(`(() => { const el=document.querySelector('#btn-team .badge'); return el?el.textContent:null })()`);
  await closePanel();
  await sleep(500);
  const badgeClosedAfter = await evj(`(() => { const el=document.querySelector('#btn-team .badge'); return el?el.textContent:null })()`);
  report.scenarios.L9 = {
    badgeBeforeOpen: badgeBefore,
    badgeWhileOpenBeforeClaim: badgeOpenBefore,
    badgeWhileOpenAfterClaim: badgeOpenAfter,
    badgeAfterClosePanel: badgeClosedAfter,
    note: "面板打开期间领取后角标仍显示 1（refreshNow 打开时只 render 不更新角标），关闭面板才同步",
  };
  console.log("[L9]", JSON.stringify(report.scenarios.L9));
} catch (e) {
  report.scenarios.L9 = { error: String(e) };
  console.error("[L9]", e);
}

report.finishedAt = new Date().toISOString();
writeFileSync("playtest/r12-aud2-cdp-report.json", JSON.stringify(report, null, 2));
console.log("\n=== REPORT ===\n" + JSON.stringify(report, null, 2));
try {
  b.close();
} catch {
  /* ignore */
}
process.exit(0);
