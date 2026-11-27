/**
 * R12 复验：面板重绘频率 → 真实点按丢点击的量化（只读 src/）。
 * 产出 playtest/r12-aud2-tap-report.json
 * 运行：node playtest/probe-r12-aud2-tap.mjs（需 dev server 5173）
 */
import { openBrowser, sleep, setupMobilePage } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const b = await openBrowser({ port: 9498, tag: "r12audtap" });
await setupMobilePage(b, { url: "http://127.0.0.1:5173/", width: 390, height: 844 });
async function waitGame() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await b.ev("!!window.__MOYU__ ? 1 : 0")) === 1) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("game not ready");
}
await waitGame();
const ev = (x) => b.ev(x);
const evj = async (x) => JSON.parse(await ev(`JSON.stringify(${x})`));
const state = () => evj(`window.__MOYU__.state`);
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const base = {
  v: 2, moyu: 1e6, totalEarned: 1e6, lifetimeEarned: 1e6, levels: {},
  savedAt: Date.now(), createdAt: Date.now() - 3600_000, collected: { quotes: [], flavors: [] },
  daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0, visits: { date: "", count: 0 }, prestige: 0,
  team: { colleagues: { zhou: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } },
  talents: { unlocked: [], points: 0, rankGranted: -1 },
};
const r = await b.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(base))}); } catch(e){} })()`,
});
await b.send("Page.reload", { ignoreCache: false });
await sleep(2000);
await waitGame();
await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });

const report = { reRender: null, rates: {}, claimTap: null, note: "" };

// 1) 面板重绘频率：MutationObserver 观察 #team-body 子节点替换
await ev(`document.getElementById('btn-team').click()`);
await sleep(600);
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
    resolve({ renders: times.length, seconds: 1.5, rendersPerSec: +(times.length / 1.5).toFixed(2), gaps });
  }, 1500);
})`);
console.log("[reRender]", report.reRender);

// 1b) 事件目标追踪：按下/松开期间节点是否被替换（证明 click 落在祖先上）
report.eventTrace = await b.ev(`new Promise((resolve) => {
  const body = document.getElementById('team-body');
  const log = [];
  const opts = { capture: true };
  const pd = (e) => log.push('down:' + (e.target.dataset?.act || e.target.tagName));
  const pu = (e) => log.push('up:' + (e.target.dataset?.act || e.target.tagName));
  const ck = (e) => log.push('click:' + (e.target.dataset?.act || e.target.id || e.target.tagName));
  body.addEventListener('pointerdown', pd, opts);
  body.addEventListener('pointerup', pu, opts);
  body.addEventListener('click', ck, opts);
  const el = body.querySelector('button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]');
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  setTimeout(() => {
    // 用 DOM 事件模拟真实按住 120ms：先 pointerdown/mousedown，期间会发生重绘
    el.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }));
    setTimeout(() => {
      const target = document.elementFromPoint(x, y);
      target.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
      setTimeout(() => {
        body.removeEventListener('pointerdown', pd, opts);
        body.removeEventListener('pointerup', pu, opts);
        body.removeEventListener('click', ck, opts);
        resolve({ log, sameNodeAtRelease: target === el, targetActAtRelease: target.dataset?.act || target.id || target.tagName, panelHidden: document.getElementById('team').classList.contains('hidden') });
      }, 300);
    }, 120);
  }, 200);
})`);
console.log("[eventTrace]", report.eventTrace);

// 2) 不同按压时长下的派遣按钮点击成功率（每次试验后清理任务）
const holdClick = async (selector, holdMs) => {
  const rect = await evj(`(() => { const el=document.querySelector('${selector}'); if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}; })()`);
  if (!rect) return "no-button";
  await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleepMs(holdMs);
  await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(250);
};
const resetMission = async () => {
  const st = await state();
  if (st.team.colleagues.zhou?.missionId) {
    await ev(`window.__MOYU__.endMissions()`);
    await sleep(300);
    await ev(`(() => { const b=document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]'); if(b) b.click(); })()`);
    await sleep(400);
  }
};
const ensureIdlePanel = async () => {
  for (let i = 0; i < 8; i++) {
    if (await ev(`document.getElementById('team').classList.contains('hidden')`)) {
      await ev(`document.getElementById('btn-team').click()`);
      await sleep(400);
    }
    const hasBtn = await ev(`!!document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]')`);
    if (hasBtn) return true;
    await resetMission();
  }
  return false;
};
for (const hold of [30, 60, 90, 120, 160, 220]) {
  let success = 0;
  let noButton = 0;
  let busy = 0;
  const trials = 6;
  for (let i = 0; i < trials; i++) {
    await resetMission();
    if (!(await ensureIdlePanel())) {
      noButton++;
      continue;
    }
    await holdClick('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]', hold);
    const st = await state();
    if (st.team.colleagues.zhou?.missionId === "quick") success++;
    else if (st.team.colleagues.zhou?.missionId) busy++;
  }
  report.rates[`${hold}ms`] = { success, noButton, busy, trials };
  console.log(`[tap ${hold}ms] success ${success}/${trials} (noButton=${noButton}, busy=${busy})`);
}

// 3) 领取按钮同样测 120ms
await resetMission();
await ensureIdlePanel();
await ev(`(() => { const b=document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); if (b) b.click(); })()`);
await sleep(350);
await ev(`window.__MOYU__.endMissions()`);
await sleep(450);
const panelOpen = await ev(`!document.getElementById('team').classList.contains('hidden')`);
if (!panelOpen) { await ev(`document.getElementById('btn-team').click()`); await sleep(500); }
const claimBtnFound = await evj(`(() => { const el=document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]'); return el?el.getBoundingClientRect().top:null; })()`);
const favorBefore = (await state()).team.colleagues.zhou?.favor;
await holdClick('#team-body button[data-act="claim"][data-id="zhou"]', 120);
const favorAfter = (await state()).team.colleagues.zhou?.favor;
report.claimTap = { panelOpen, claimBtnFound, favorBefore, favorAfter, claimed: favorBefore !== favorAfter };
console.log("[claim tap 120ms]", report.claimTap);

report.note = "主循环每 150ms 调 teamPanel.refreshNow() → 面板打开时强制整块重建 innerHTML；真实点按跨越一次重建即丢 click";
writeFileSync("playtest/r12-aud2-tap-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
try {
  b.close();
} catch {
  /* ignore */
}
process.exit(0);
