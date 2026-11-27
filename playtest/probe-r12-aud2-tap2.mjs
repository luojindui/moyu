/**
 * R12 复验：面板重绘频率与真实点按丢失率（v2，带页面存活守卫；防并发 HMR 全量重载打断）。
 * 运行：node playtest/probe-r12-aud2-tap2.mjs（需 dev server 5173）
 */
import { openBrowser, sleep, setupMobilePage } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const b = await openBrowser({ port: 9499, tag: "r12audtap2" });
const report = { startedAt: new Date().toISOString(), rates: {}, reRender: null, claimTap: null, eventTrace: null };

const alive = async () => {
  try {
    return (await b.ev("!!window.__MOYU__ ? 1 : 0")) === 1;
  } catch {
    return false;
  }
};
async function waitGame() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await b.ev("!!window.__MOYU__ ? 1 : 0")) === 1) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("game not ready");
}
await setupMobilePage(b, { url: process.env.MOYU_URL ?? "http://127.0.0.1:5173/", width: 390, height: 844 });
await waitGame();
const ev = (x) => b.ev(x);
const evj = async (x) => JSON.parse(await ev(`JSON.stringify(${x})`));
const state = () => evj(`window.__MOYU__.state`);

const base = {
  v: 2, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, levels: {},
  savedAt: Date.now(), createdAt: Date.now() - 3600_000, collected: { quotes: [], flavors: [] },
  daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0, visits: { date: "", count: 0 }, prestige: 0,
  team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } },
  talents: { unlocked: [], points: 0, rankGranted: -1 },
};
const inj = await b.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(base))}); } catch(e){} })()`,
});
await b.send("Page.reload", { ignoreCache: false });
await sleep(2200);
await waitGame();
await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: inj.identifier });

const ensurePanel = async () => {
  if (!(await alive())) {
    await waitGame();
    await sleep(400);
  }
  const hidden = await ev(`document.getElementById('team').classList.contains('hidden')`);
  if (hidden) {
    await ev(`document.getElementById('btn-team').click()`);
    await sleep(450);
  }
};
const resetMission = async () => {
  const st = await state();
  if (st.team.colleagues.zhou?.missionId) {
    await ev(`window.__MOYU__.endMissions()`);
    await sleep(300);
    await ev(`(() => { const b=document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]'); if(b) b.click(); })()`);
    await sleep(450);
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

await ensurePanel();
// 1) 重绘频率
report.reRender = await b.ev(`new Promise((resolve) => {
  const body = document.getElementById('team-body');
  const times = [];
  const mo = new MutationObserver((muts) => {
    for (const m of muts) if (m.type === 'childList' && m.addedNodes.length) times.push(performance.now());
  });
  mo.observe(body, { childList: true });
  setTimeout(() => {
    mo.disconnect();
    const gaps = times.slice(1).map((t, i) => +(t - times[i]).toFixed(1));
    const avg = gaps.length ? gaps.reduce((a, c) => a + c, 0) / gaps.length : 0;
    resolve({ rendersIn1500ms: times.length, rendersPerSec: +(times.length / 1.5).toFixed(2), avgGapMs: +avg.toFixed(1), gaps });
  }, 1500);
})`);
console.log("[reRender]", report.reRender);

// 2) 点按丢失率（每种时长 5 次）
for (const hold of [60, 90, 120, 160, 220]) {
  let success = 0, noButton = 0, trials = 5;
  const details = [];
  for (let i = 0; i < trials; i++) {
    await ensurePanel();
    await resetMission();
    await ensurePanel();
    const has = await ev(`!!document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]')`);
    if (!has) { noButton++; details.push("no-btn"); continue; }
    const r = await holdClick('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]', hold);
    if (r !== "ok") { noButton++; details.push(r); continue; }
    const st = await state();
    const ok = st.team.colleagues.zhou?.missionId === "quick";
    details.push(ok ? "ok" : st.team.colleagues.zhou?.missionId ?? "idle");
    if (ok) success++;
  }
  report.rates[`${hold}ms`] = { success, trials, noButton, details };
  console.log(`[tap ${hold}ms]`, JSON.stringify(report.rates[`${hold}ms`]));
}

// 3) 领取按钮 120ms 点按
try {
  await ensurePanel();
  await resetMission();
  await ensurePanel();
  const hasDispatch = await ev(`!!document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]')`);
  if (hasDispatch) {
    await ev(`(() => { const b=document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); if(b) b.click(); })()`);
    await sleep(350);
    const pending = await state();
    const favorPre = pending.team.colleagues.zhou?.favor;
    await ev(`window.__MOYU__.endMissions()`);
    await sleep(450);
    const claimBtn = await evj(`(() => { const el=document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]'); return el?el.innerText:null; })()`);
    const favorBefore = (await state()).team.colleagues.zhou?.favor;
    await holdClick('#team-body button[data-act="claim"][data-id="zhou"]', 120);
    const after = await state();
    report.claimTap = { favorPre, claimBtn, favorBefore, favorAfter: after.team.colleagues.zhou?.favor, missionId: after.team.colleagues.zhou?.missionId, claimed: (after.team.colleagues.zhou?.favor ?? 0) !== favorBefore };
  } else {
    report.claimTap = { error: "no dispatch button" };
  }
  console.log("[claimTap]", JSON.stringify(report.claimTap));
} catch (e) {
  report.claimTap = { error: String(e) };
  console.error("[claimTap]", e);
}

report.finishedAt = new Date().toISOString();
writeFileSync("playtest/r12-aud2-tap-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
try {
  b.close();
} catch {
  /* ignore */
}
process.exit(0);
