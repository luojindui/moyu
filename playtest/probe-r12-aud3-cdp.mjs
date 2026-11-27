/**
 * R12 第三次复验 CDP：点按成功率 / DOM 重绘频率 / 脏存档 / 降级备份 / 互斥净化 /
 * 自动重复 / 离岗折损 / 净收益展示 / 天赋 UI 花费标签 / 27 点上限。
 * 运行：MOYU_URL=http://127.0.0.1:5179/ node playtest/probe-r12-aud3-cdp.mjs
 */
import { openBrowser, sleep, setupMobilePage } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const report = { startedAt: new Date().toISOString(), scenarios: {} };
const b = await openBrowser({ port: 9501, tag: "r12aud3" });
const alive = async () => {
  try {
    return (await b.ev("!!window.__MOYU__ ? 1 : 0")) === 1;
  } catch {
    return false;
  }
};
const waitGame = async () => {
  for (let i = 0; i < 150; i++) {
    if (await alive()) return;
    await sleep(100);
  }
  throw new Error("game not ready");
};
await setupMobilePage(b, { url: URL, width: 390, height: 844 });
await waitGame();
const ev = (x) => b.ev(x);
const evj = async (x) => JSON.parse(await ev(`JSON.stringify(${x})`));
const state = () => evj(`window.__MOYU__.state`);

const today = () => new Date().toISOString().slice(0, 10);
const mate = (level = 1, over = {}) => ({
  level, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0, ...over,
});
const baseBlob = (over = {}) => ({
  v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {},
  savedAt: Date.now(), createdAt: Date.now() - 3600_000,
  collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
  visits: { date: "", count: 0 }, prestige: 0, team: { colleagues: {} },
  talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today() },
  ...over,
});
let seedId = null;
const clearSeed = async () => {
  if (seedId) {
    await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: seedId });
    seedId = null;
  }
};
const reload = async () => {
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(2000);
  await waitGame();
  await sleep(200);
};
const seedSave = async (blob) => {
  await clearSeed();
  const src = `(() => { try {
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
    localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
  } catch (e) {} })()`;
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
const resetMissions = async () => {
  const st = await state();
  if (Object.values(st.team.colleagues).some((c) => c.missionId)) {
    await ev(`window.__MOYU__.endMissions()`);
    await sleep(300);
    for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
      await ev(`(() => { const b=document.querySelector('#team-body button[data-act="claim"][data-id="${id}"]'); if (b) b.click(); })()`);
    }
    await sleep(400);
  }
};
const holdClick = async (selector, holdMs) => {
  const rect = await evj(`(() => { const el=document.querySelector('${selector}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  if (!rect) return "no-button";
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(holdMs);
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(300);
  return "ok";
};

// ---------- T1：点按成功率 + DOM mutation 频率 ----------
try {
  await seedSave(baseBlob({ moyu: 0, totalEarned: 0, lifetimeEarned: 0, team: { colleagues: { zhou: mate(1) } } }));
  await openPanel("colleagues");
  report.scenarios.T1 = { rates: {}, domMutation: {} };

  // DOM mutation：空闲面板 1.5s
  report.scenarios.T1.domMutation.idle = await b.ev(`new Promise((resolve) => {
    const body = document.getElementById('team-body');
    let childList = 0, charData = 0;
    const mo = new MutationObserver((muts) => { for (const m of muts) { if (m.type === 'childList') childList++; else if (m.type === 'characterData') charData++; } });
    mo.observe(body, { childList: true, characterData: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve({ childList, charData }); }, 1500);
  })`);

  for (const hold of [60, 90, 120, 160, 220]) {
    let success = 0;
    const details = [];
    for (let i = 0; i < 5; i++) {
      await resetMissions();
      const has = await ev(`!!document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]')`);
      if (!has) { details.push("no-btn"); continue; }
      const r = await holdClick('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]', hold);
      if (r !== "ok") { details.push(r); continue; }
      const st = await state();
      const ok = st.team.colleagues.zhou?.missionId === "quick";
      details.push(ok ? "ok" : "idle");
      if (ok) success++;
    }
    report.scenarios.T1.rates[`${hold}ms`] = { success, trials: 5, details };
  }

  // 进行中面板：倒计时刷新的 mutation 类型（应只有 characterData，无 childList 重建）
  await resetMissions();
  await ev(`(() => { const b=document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); if(b) b.click(); })()`);
  await sleep(400);
  report.scenarios.T1.domMutation.inProgress = await b.ev(`new Promise((resolve) => {
    const body = document.getElementById('team-body');
    let childList = 0, charData = 0;
    const mo = new MutationObserver((muts) => { for (const m of muts) { if (m.type === 'childList') childList++; else if (m.type === 'characterData') charData++; } });
    mo.observe(body, { childList: true, characterData: true, subtree: true });
    setTimeout(() => { mo.disconnect(); resolve({ childList, charData }); }, 1500);
  })`);
  console.log("[T1]", JSON.stringify(report.scenarios.T1));
} catch (e) {
  report.scenarios.T1 = { error: String(e) };
  console.error("[T1]", e);
}

// ---------- T2：招募按钮文案与可用态同步（不重建 DOM 下的标签陈旧） ----------
try {
  await seedSave(baseBlob({ moyu: 0, totalEarned: 0, lifetimeEarned: 0 }));
  await openPanel("colleagues");
  const before = await evj(`(() => { const b=document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]'); return b?{text:b.innerText,disabled:b.disabled}:null; })()`);
  await ev(`window.__MOYU__.grant(12000)`);
  await sleep(800);
  const after = await evj(`(() => { const b=document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]'); return b?{text:b.innerText,disabled:b.disabled}:null; })()`);
  report.scenarios.T2 = { before, after, note: "余额够后按钮应可用；若文案仍为「攒够再招」= 标签陈旧" };
  console.log("[T2]", JSON.stringify(report.scenarios.T2));
} catch (e) {
  report.scenarios.T2 = { error: String(e) };
  console.error("[T2]", e);
}

// ---------- T3：脏 missionId / endsAt=0 白领 ----------
try {
  await seedSave(
    baseBlob({
      moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000,
      team: { colleagues: { zhou: mate(1, { missionId: "ghost_mission", startedAt: 0, endsAt: 0, rewardSnapshot: 5000 }) } },
    }),
  );
  const st = await state();
  const errs = await evj(`window.__errs`);
  report.scenarios.T3 = { ghostMissionRestoredAs: st.team.colleagues.zhou?.missionId, endsAt: st.team.colleagues.zhou?.endsAt, pageErrors: errs };

  await seedSave(
    baseBlob({
      moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000,
      team: { colleagues: { zhou: mate(1, { missionId: "quick", startedAt: 0, endsAt: 0, rewardSnapshot: 5000 }) } },
    }),
  );
  const st2 = await state();
  await sleep(300);
  await openPanel("colleagues");
  const claimBtn = await evj(`(() => { const b=document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]'); return b?b.innerText:null; })()`);
  report.scenarios.T3.zeroEnds = { endsAt: st2.team.colleagues.zhou?.endsAt, claimButton: claimBtn };
  console.log("[T3]", JSON.stringify(report.scenarios.T3));
} catch (e) {
  report.scenarios.T3 = { error: String(e) };
  console.error("[T3]", e);
}

// ---------- T4：v3 档备份 ----------
try {
  const rawFuture = JSON.stringify({ v: 3, moyu: 999, levels: { retire: 40 }, savedAt: Date.now(), team: { colleagues: {} }, talents: { unlocked: [] }, patrolSurvives: 3 });
  await clearSeed();
  const src = `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(rawFuture)}); } catch(e){} })()`;
  const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  seedId = r.identifier;
  await reload();
  await clearSeed();
  const bakAfterBoot = await ev(`localStorage.getItem('moyu-save.newer.bak')`);
  await ev(`window.__MOYU__.saveNow()`);
  await sleep(300);
  const afterWrite = await evj(`({ save: (() => { try { return JSON.parse(localStorage.getItem('moyu-save')); } catch(e){ return null; } })(), bak: localStorage.getItem('moyu-save.newer.bak') })`);
  report.scenarios.T4 = {
    bakExistsAfterBoot: !!bakAfterBoot,
    bakEqualsFuture: bakAfterBoot === rawFuture,
    saveVersionAfterOldClientWrite: afterWrite.save?.v,
    bakStillFuture: afterWrite.bak === rawFuture,
  };
  console.log("[T4]", JSON.stringify(report.scenarios.T4));
} catch (e) {
  report.scenarios.T4 = { error: String(e) };
  console.error("[T4]", e);
}

// ---------- T5：存档净化（互斥/去重/点数/快照/rank） ----------
try {
  await seedSave(
    baseBlob({
      moyu: 100, totalEarned: 100, lifetimeEarned: 100,
      talents: { unlocked: ["click_5a", "click_5b", "click_1", "click_1", "event_5a", "event_5b"], points: 99, rankGranted: 99, dailyGiftDate: "bad" },
      team: { colleagues: { zhou: mate(1, { missionId: "quick", startedAt: 0, endsAt: 0, rewardSnapshot: 1e19 }) } },
    }),
  );
  const st = await state();
  report.scenarios.T5 = {
    unlocked: st.talents.unlocked,
    points: st.talents.points,
    rankGranted: st.talents.rankGranted,
    dailyGiftDate: st.talents.dailyGiftDate,
    rewardSnapshot: st.team.colleagues.zhou?.rewardSnapshot,
    note: "期望：互斥各留一个、去重、27 点、rank<=12、日期置空、快照<=1e18",
  };
  console.log("[T5]", JSON.stringify(report.scenarios.T5));
} catch (e) {
  report.scenarios.T5 = { error: String(e) };
  console.error("[T5]", e);
}

// ---------- T6：autoRepeat 自动领取并续班（含提示文案） ----------
try {
  const now = Date.now();
  await seedSave(
    baseBlob({
      moyu: 0, totalEarned: 0, lifetimeEarned: 0,
      team: { colleagues: { zhou: mate(1, { missionId: "quick", startedAt: now - 900_000, endsAt: now - 1000, autoRepeat: true, rewardSnapshot: 1000 }) } },
    }),
  );
  await sleep(900);
  const st = await state();
  const toastText = await ev(`(document.getElementById('dom-toast') || {}).textContent || ''`);
  report.scenarios.T6 = {
    missionId: st.team.colleagues.zhou?.missionId,
    endsAtInFuture: (st.team.colleagues.zhou?.endsAt ?? 0) > Date.now(),
    favor: st.team.colleagues.zhou?.favor,
    moyu: st.moyu,
    domToast: toastText,
    note: "自动续班后 missionId 应仍为 quick、endsAt 未来、好感+2、余额≥1000；toast 若提示「回来了，点领取」但与自动领取矛盾=文案误导",
  };
  console.log("[T6]", JSON.stringify(report.scenarios.T6));
} catch (e) {
  report.scenarios.T6 = { error: String(e) };
  console.error("[T6]", e);
}

// ---------- T7：离岗折损（实时）与「净收益」展示偏差 ----------
try {
  const cols = { zhou: mate(5), mei: mate(5), qiang: mate(5), li: mate(5), wang: mate(5) };
  await seedSave(baseBlob({ levels: { retire: 10 }, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, team: { colleagues: cols } }));
  await openPanel("colleagues");
  const idleBefore = await ev(`document.getElementById('hud-idle').innerText`);
  const quickBtn = await evj(`(document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]')||{}).innerText || ''`);
  await ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]').click()`);
  await sleep(400);
  const idleAway = await ev(`document.getElementById('hud-idle').innerText`);
  await ev(`window.__MOYU__.endMissions()`);
  await sleep(400);
  const idleDone = await ev(`document.getElementById('hud-idle').innerText`);
  report.scenarios.T7 = { idleBefore, quickButtonText: quickBtn, idleAway, idleDone, note: "按钮「净 +X/h」未扣自身离岗损失；派遣中 HUD 挂机率下降，完成后恢复" };
  console.log("[T7]", JSON.stringify(report.scenarios.T7));
} catch (e) {
  report.scenarios.T7 = { error: String(e) };
  console.error("[T7]", e);
}

// ---------- T8：天赋 UI 花费标签 / 27 点上限 ----------
try {
  await seedSave(
    baseBlob({
      moyu: 0, totalEarned: 0, lifetimeEarned: 0,
      talents: { unlocked: ["click_1", "click_2", "click_3", "click_4"], points: 3, rankGranted: 12, dailyGiftDate: today() },
    }),
  );
  await openPanel("talents");
  const ultInfo = await evj(`(() => {
    const rows=[...document.querySelectorAll('#team-body .talent')];
    const row = rows.find(r=>r.innerText.includes('指尖风暴'));
    const foot = document.querySelector('#team-body .talent-progress');
    const pts = document.getElementById('team-points').innerText;
    return { name: row?.querySelector('.talent-name')?.innerText, btn: row?.querySelector('button')?.innerText, disabled: row?.querySelector('button')?.disabled, footer: foot?.innerText, points: pts };
  })()`);
  const before = await state();
  await ev(`(() => { const rows=[...document.querySelectorAll('#team-body .talent')]; const row=rows.find(r=>r.innerText.includes('指尖风暴')); row?.querySelector('button')?.click(); })()`);
  await sleep(350);
  const after = await state();
  report.scenarios.T8 = {
    ultInfo,
    pointsBefore: before.talents?.points,
    pointsAfter: after.talents?.points,
    unlockedAfter: after.talents?.unlocked,
    note: "标签写「点亮 2」/「终极·2点」/底部上限 18，实际终极扣 3、上限 27",
  };
  console.log("[T8]", JSON.stringify(report.scenarios.T8));
} catch (e) {
  report.scenarios.T8 = { error: String(e) };
  console.error("[T8]", e);
}

// ---------- T9：27 点上限实机 + 领取显示=快照 ----------
try {
  await seedSave(
    baseBlob({
      moyu: 0, totalEarned: 0, lifetimeEarned: 0,
      talents: { unlocked: [], points: 30, rankGranted: 12, dailyGiftDate: today() },
      team: { colleagues: { zhou: mate(1, { missionId: "quick", startedAt: Date.now() - 900_000, endsAt: Date.now() - 1000, rewardSnapshot: 5000 }) } },
    }),
  );
  const st = await state();
  await sleep(300);
  await openPanel("colleagues");
  const claimText = await ev(`(document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]')||{}).innerText || ''`);
  const before = await state();
  await ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]').click()`);
  await sleep(250);
  const after = await state();
  report.scenarios.T9 = {
    pointsAfterClamp: st.talents?.points,
    claimButtonText: claimText,
    claimDelta: after.moyu - before.moyu,
    expectedSnapshot: 5000,
    idleAccrual: after.moyu - before.moyu - 5000,
  };
  console.log("[T9]", JSON.stringify(report.scenarios.T9));
} catch (e) {
  report.scenarios.T9 = { error: String(e) };
  console.error("[T9]", e);
}

report.finishedAt = new Date().toISOString();
writeFileSync("playtest/r12-aud3-cdp-report.json", JSON.stringify(report, null, 2));
console.log("\n=== REPORT ===\n" + JSON.stringify(report, null, 2));
try {
  b.close();
} catch {
  /* ignore */
}
process.exit(0);
