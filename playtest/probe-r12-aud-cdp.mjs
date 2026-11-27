/**
 * R12 批次 1 审计：实机 CDP 验证（招募→派遣→刷新→领取、天赋面板、角标/倒计时/滚动/禁用态）。
 * 只读 src/；不改源码。产出 playtest/r12-aud-cdp-report.json + 截图。
 * 运行：node playtest/probe-r12-aud-cdp.mjs （需 dev server http://127.0.0.1:5173/）
 */
import { openBrowser, sleep, setupMobilePage } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const W = 390;
const H = 844;
const report = { startedAt: new Date().toISOString(), scenarios: {}, console: [] };

const b = await openBrowser({ port: 9496, tag: "r12aud" });
await setupMobilePage(b, { url: URL, width: W, height: H });
/** 本作没有 window.__r9，用 __MOYU__ 判就绪 */
async function waitGame(timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const ok = await b.ev("!!window.__MOYU__ && !!document.getElementById('stage') ? 1 : 0");
      if (ok === 1) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("game not ready");
}
await waitGame();
b.send("Runtime.enable");

let seedId = null;
const clearSeed = async () => {
  if (seedId) {
    await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedId });
    seedId = null;
  }
};
const ev = (expr) => b.ev(expr);
const evj = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));
const reload = async () => {
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(1800);
  await waitGame();
};
/** 下一次加载前注入存档（document start 早于 main.ts，避免 pagehide 覆盖） */
const seedSave = async (blob) => {
  await clearSeed();
  const src = `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); } catch (e) {} })()`;
  const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  seedId = r.identifier;
  await reload();
  await clearSeed();
};
const now = () => Date.now();
const baseBlob = (over = {}) => ({
  v: 2,
  moyu: 0,
  totalEarned: 0,
  lifetimeEarned: 0,
  levels: {},
  savedAt: now(),
  createdAt: now() - 3600_000,
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
  await sleep(250);
};
const teamBodyText = () => ev(`document.getElementById('team-body').innerText`);
const state = () => evj(`window.__MOYU__.state`);

// ---------- S1：真实流程 招募 → 派遣 → 保存 → 刷新 → 状态保留 ----------
try {
  await ev(`localStorage.clear()`);
  await reload();
  await ev(`window.__MOYU__.reset()`);
  await sleep(300);
  await ev(`window.__MOYU__.grant(20000)`);
  await sleep(300);
  const beforeRecruit = await state();
  await openPanel("colleagues");
  const lockedDisabled = await evj(
    `[...document.querySelectorAll('#team-body button[data-act="recruit"]')].map(b=>({id:b.dataset.id,disabled:b.disabled,text:b.innerText}))`,
  );
  await ev(`document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]').click()`);
  await sleep(300);
  const afterRecruit = await state();
  const panelAfterRecruit = await teamBodyText();
  // 派遣：15 分钟「溜一圈」
  await ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]').click()`);
  await sleep(300);
  const afterDispatch = await state();
  const countdownText = await ev(
    `(document.querySelector('#team-body .mate-progress')||{}).innerText || ''`,
  );
  const busyButtons = await evj(
    `[...document.querySelectorAll('#team-body .mate-missions button')].length`,
  );
  await ev(`window.__MOYU__.saveNow()`);
  await sleep(300);
  const blobAfter = await evj(`JSON.parse(localStorage.getItem('moyu-save'))`);
  await reload(); // 真实刷新（不注入）
  await sleep(400);
  const afterReload = await state();
  await openPanel("colleagues");
  const countdownReload = await ev(
    `(document.querySelector('#team-body .mate-progress')||{}).innerText || ''`,
  );
  const savedColleague = afterReload.team?.colleagues?.zhou;
  report.scenarios.S1 = {
    beforeMoyu: beforeRecruit.moyu,
    lockedDisabled,
    afterRecruitMoyu: afterRecruit.moyu,
    recruitOk: !!afterRecruit.team.colleagues.zhou,
    panelShowsName: panelAfterRecruit.includes("老周"),
    dispatchMissionId: afterDispatch.team.colleagues.zhou?.missionId,
    countdownText,
    busyMissionButtons: busyButtons,
    saveBlobVersion: blobAfter.v,
    saveBlobColleague: blobAfter.team?.colleagues?.zhou,
    afterReloadColleague: savedColleague,
    afterReloadMissionId: savedColleague?.missionId,
    countdownReload,
    note: "真实点击招募/派遣；刷新后 mission 仍在（真实时间推进）",
  };
  console.log("[S1]", JSON.stringify(report.scenarios.S1).slice(0, 700));
} catch (e) {
  report.scenarios.S1 = { error: String(e) };
  console.error("[S1] failed", e);
}

// ---------- S2：领取显示值 vs 实际到账、角标、好感 ----------
try {
  const t = now();
  const cols = {
    zhou: { level: 5, missionId: "quick", startedAt: t - 901_000, endsAt: t - 1000, favor: 0 },
    mei: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0 },
    qiang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0 },
    li: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0 },
    wang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0 },
  };
  await seedSave(
    baseBlob({
      levels: { retire: 10 },
      team: { colleagues: cols },
      moyu: 0,
      totalEarned: 0,
      lifetimeEarned: 0,
    }),
  );
  await sleep(400);
  const badge = await evj(
    `(() => { const el=document.querySelector('#btn-team .badge'); return el?{text:el.textContent}:null })()`,
  );
  await openPanel("colleagues");
  const claimBtnText = await ev(
    `(document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]')||{}).innerText || ''`,
  );
  const before = await state();
  await ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]').click()`);
  await sleep(120);
  const after = await state();
  const badgeAfter = await evj(
    `(() => { const el=document.querySelector('#btn-team .badge'); return el?{text:el.textContent}:null })()`,
  );
  // 引擎口径复算实际到账（station = 7000.2；固定 5100；share 0.2）
  const station = 7000.2;
  const base = Math.max(300, station * 900 * 0.011);
  const expectActual = Math.floor(base * 1.2 * 1.5); // 溜一圈 ×1.2，老周不匹配，lv5 系数 1.5
  report.scenarios.S2 = {
    badge,
    claimBtnText,
    moyuBefore: before.moyu,
    moyuAfter: after.moyu,
    delta: after.moyu - before.moyu,
    expectActual,
    favor: after.team.colleagues.zhou?.favor,
    missionCleared: after.team.colleagues.zhou?.missionId === null,
    badgeAfter,
    idleDuringWaitApprox: (after.moyu - before.moyu) - expectActual,
    note: "按钮文案（effectOf 口径）应显著大于实际到账（stationIdleScaled 口径）",
  };
  console.log("[S2]", JSON.stringify(report.scenarios.S2));
} catch (e) {
  report.scenarios.S2 = { error: String(e) };
  console.error("[S2] failed", e);
}

// ---------- S3：面板滚动 / 8h 倒计时格式 / 顶部汇总缺失 ----------
try {
  const t = now();
  const cols = {};
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
    cols[id] = { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: id === "zhou" ? 80 : 10 };
  }
  await seedSave(baseBlob({ levels: { retire: 10 }, team: { colleagues: cols }, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6 }));
  await openPanel("colleagues");
  const metrics = await evj(`(() => {
    const body = document.getElementById('team-body');
    const panel = document.querySelector('.team-panel');
    const pr = panel.getBoundingClientRect();
    const cards = [...body.querySelectorAll('.mate')];
    const last = cards[cards.length-1].getBoundingClientRect();
    return { bodyClientH: body.clientHeight, bodyScrollH: body.scrollHeight, panelTop: pr.top, panelBottom: pr.bottom, innerH: innerHeight, lastCardBottom: last.bottom, cardCount: cards.length };
  })()`);
  await ev(`(() => { const body=document.getElementById('team-body'); body.scrollTop = body.scrollHeight; })()`);
  await sleep(300);
  const afterScrollTop = await ev(`document.getElementById('team-body').scrollTop`);
  const lastVisible = await evj(`(() => {
    const body = document.getElementById('team-body');
    const pr = document.querySelector('.team-panel').getBoundingClientRect();
    const cards = [...body.querySelectorAll('.mate')];
    const last = cards[cards.length-1].getBoundingClientRect();
    return { lastCardBottom: last.bottom, panelBottom: pr.bottom, lastBtnVisible: !!cards[cards.length-1].querySelector('button')?.offsetParent };
  })()`);
  const headerText = await ev(`document.querySelector('.team-head').innerText`);
  const hasSummary = await ev(
    `/(已招募|小队总挂机|总挂机收益)/.test(document.getElementById('team').innerText)`,
  );
  // 8h 任务倒计时格式
  await ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]').click()`);
  await sleep(600);
  const longCountdown = await ev(`(document.querySelector('#team-body .mate-progress')||{}).innerText || ''`);
  report.scenarios.S3 = {
    metrics,
    afterScrollTop,
    lastVisible,
    headerText,
    hasSummary,
    longCountdown,
    note: "滚动可用性 / 顶部无「已招募人数·小队总挂机」汇总 / 8h 任务显示 480:00 而非 hh:mm",
  };
  await b.shot("playtest/r12-aud-team-scroll.png");
  console.log("[S3]", JSON.stringify(report.scenarios.S3));
} catch (e) {
  report.scenarios.S3 = { error: String(e) };
  console.error("[S3] failed", e);
}

// ---------- S4：天赋页：点数/逐级解锁禁用态/重置无二次确认/刷新保留 ----------
try {
  await seedSave(baseBlob({ talents: { unlocked: [], points: 5, rankGranted: -1 }, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6 }));
  await openPanel("talents");
  const pointsLabel = await ev(`document.getElementById('team-points').innerText`);
  const tier1Enabled = await ev(
    `!document.querySelector('#team-body button[data-act="talent"][data-id="click_1"]').disabled`,
  );
  const tier2Disabled = await ev(
    `document.querySelector('#team-body button[data-act="talent"][data-id="click_2"]').disabled`,
  );
  await ev(`document.querySelector('#team-body button[data-act="talent"][data-id="click_1"]').click()`);
  await sleep(300);
  const afterUnlock = await state();
  const pointsLabelAfter = await ev(`document.getElementById('team-points').innerText`);
  const clickPower = await ev(`window.__MOYU__.state && 0`); // 占位
  void clickPower;
  await ev(`window.__MOYU__.saveNow()`);
  await sleep(200);
  await reload();
  const talentsAfterReload = await evj(`window.__MOYU__.state.talents`);
  // 重置：先劫持 confirm 计数
  await openPanel("talents");
  await ev(`window.__confirmCalls = 0; window.confirm = function(){ window.__confirmCalls++; return true; }`);
  await ev(`document.querySelector('#team-body button[data-act="reset-talents"]').click()`);
  await sleep(300);
  const afterReset = await state();
  const confirmCalls = await ev(`window.__confirmCalls`);
  report.scenarios.S4 = {
    pointsLabel,
    tier1Enabled,
    tier2Disabled,
    unlockOk: afterUnlock.talents?.unlocked,
    pointsLabelAfter,
    talentsAfterReload,
    resetUnlocked: afterReset.talents?.unlocked,
    resetPoints: afterReset.talents?.points,
    confirmCalls,
    note: "重置一键生效：confirmCalls=0（平衡决策书要求二次确认）",
  };
  await b.shot("playtest/r12-aud-talents.png");
  console.log("[S4]", JSON.stringify(report.scenarios.S4));
} catch (e) {
  report.scenarios.S4 = { error: String(e) };
  console.error("[S4] failed", e);
}

// ---------- S5：未知 missionId 实机崩溃（点击领取无反应） ----------
try {
  const t = now();
  await seedSave(
    baseBlob({
      moyu: 1000,
      totalEarned: 1000,
      lifetimeEarned: 1000,
      team: {
        colleagues: {
          zhou: { level: 1, missionId: "ghost_mission", startedAt: 0, endsAt: t - 1000, favor: 0 },
        },
      },
    }),
  );
  await sleep(400);
  await openPanel("colleagues");
  const claimText = await ev(
    `(document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]')||{}).innerText || ''`,
  );
  await ev(`window.__errs=[]; window.addEventListener('error', e => window.__errs.push(String(e.message)))`);
  const before = await state();
  await ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]').click()`);
  await sleep(500);
  const errs = await evj(`window.__errs`);
  const after = await state();
  report.scenarios.S5 = {
    claimText,
    errors: errs,
    favorBefore: before.team.colleagues.zhou?.favor,
    favorAfter: after.team.colleagues.zhou?.favor,
    missionStill: after.team.colleagues.zhou?.missionId,
    note: "存档中未知 missionId → 领取按钮存在但点击抛 TypeError，状态不变，无法恢复",
  };
  await b.shot("playtest/r12-aud-ghost-mission.png");
  console.log("[S5]", JSON.stringify(report.scenarios.S5));
} catch (e) {
  report.scenarios.S5 = { error: String(e) };
  console.error("[S5] failed", e);
}

report.finishedAt = new Date().toISOString();
writeFileSync("playtest/r12-aud-cdp-report.json", JSON.stringify(report, null, 2));
console.log("\n=== REPORT ===");
console.log(JSON.stringify(report, null, 2));
try {
  b.close();
} catch (e) {
  /* ignore */
}
process.exit(0);
