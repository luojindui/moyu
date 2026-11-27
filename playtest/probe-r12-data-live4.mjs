/** R12 第三轮 live 复验：① 一键领取 1:1 ② 暴击入账 ③ 小李短任务翻盘。
 *  只写 playtest/，不改 src/。dev: http://127.0.0.1:5173/
 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const PORT = 9615;
const ev = { url: URL, at: new Date().toISOString(), phases: {} };

async function waitFor(b, expr, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await b.ev(expr)) return;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("timeout: " + expr);
}

const b = await openBrowser({ port: PORT, tag: "r12v3" });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1500, deviceScaleFactor: 2, mobile: false });

  await b.send("Page.navigate", { url: URL });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && !!document.getElementById('shop-cards')");
  const freshPage = async () => {
    await b.ev("localStorage.clear(); true");
    await b.send("Page.reload", { ignoreCache: true });
    await sleep(2400);
    await waitFor(b, "typeof window.__MOYU__ === 'object' && !!window.__MOYU__.state && __MOYU__.state.daily !== null");
  };
  const tap = (n, gapMs = 100) =>
    b.ev(`(async () => {
      const c = document.getElementById('stage');
      const r = c.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      for (let i = 0; i < ${n}; i++) {
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
        await new Promise((res) => setTimeout(res, ${gapMs}));
      }
      return __MOYU__.state.totalClicks;
    })()`);

  // ---------- Phase A：一键领取显示 = 实际 ----
  await freshPage();
  await b.ev("__MOYU__.grant(1e11); true");
  await sleep(200);
  await b.ev(`(() => { for (let i = 0; i < 60; i++) document.querySelector('#shop-cards button[data-upgrade="phone"]')?.click(); return true; })()`);
  await sleep(300);
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(400);
  await b.ev(`document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]')?.click(); true`);
  await sleep(500);
  await b.ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]')?.click(); true`);
  await sleep(400);
  const snapshot = await b.ev("__MOYU__.state.team.colleagues.zhou.rewardSnapshot");
  await b.ev(`(() => { for (let i = 0; i < 120; i++) document.querySelector('#shop-cards button[data-upgrade="phone"]')?.click(); return true; })()`);
  await sleep(300);
  await b.ev("__MOYU__.endMissions(); true");
  await sleep(600);
  const uiBefore = await b.ev(`(() => {
    const all = document.querySelector('#team-body button[data-act="claim-all"]');
    const one = document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]');
    return { claimAll: all ? all.innerText : null, single: one ? one.innerText : null };
  })()`);
  const m0 = await b.ev("__MOYU__.state.moyu");
  await b.ev(`document.querySelector('#team-body button[data-act="claim-all"]')?.click(); true`);
  await sleep(400);
  const m1 = await b.ev("__MOYU__.state.moyu");
  ev.phases.claimAll = { snapshot, ...uiBefore, actualMoyuDelta: m1 - m0 };

  // ---------- Phase B：暴击入账 ----------
  await freshPage();
  await b.ev("__MOYU__.grant(1e12); true");
  await sleep(500); // 段位天赋点由主循环发放
  const pts0 = await b.ev("__MOYU__.state.talents.points");
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(400);
  await b.ev("document.getElementById('tab-talents').click(); true");
  await sleep(400);
  const unlock = (id) => b.ev(`(() => { document.querySelector('#team-body button[data-act="talent"][data-id="${id}"]')?.click(); return __MOYU__.state.talents.unlocked; })()`);
  for (const id of ["click_1"]) { await unlock(id); await sleep(350); }
  const cp1 = await b.ev(`(() => { const s = __MOYU__.state; return { clicked: s.totalClicks, p: s.talents.unlocked }; })()`);
  await b.ev("document.getElementById('team-close').click(); true");
  await sleep(300);
  ev.phases.critPre = await b.ev(`(() => { const s = __MOYU__.state; return { levels: s.levels, prestige: s.prestige, hudClick: document.getElementById('hud-click').textContent, hudIdle: document.getElementById('hud-idle').textContent, totalClicks: s.totalClicks, unlocked: s.talents.unlocked }; })()`);
  // Round 1：仅 click_1，无暴击
  const t0 = await b.ev("__MOYU__.state.totalEarned");
  const clicks1 = await tap(40, 100);
  const t1 = await b.ev("__MOYU__.state.totalEarned");
  // 解锁 click_2/3/4（连击窗口/上限/暴击）
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(300);
  for (const id of ["click_2", "click_3", "click_4"]) { await unlock(id); await sleep(350); }
  await b.ev("document.getElementById('team-close').click(); true");
  await sleep(400); // 让连击断开
  const t2 = await b.ev("__MOYU__.state.totalEarned");
  const totalClicksBefore2 = await b.ev("__MOYU__.state.totalClicks");
  const clicks2 = await tap(40, 100);
  const t3 = await b.ev("__MOYU__.state.totalEarned");
  const endState = await b.ev("__MOYU__.state.talents.unlocked");
  // 理论值（与 main.ts 同公式）：combo 逐击 +1（初始 0），cap=20 / 30；每 20 击暴击 ×5
  const clickPower = 1.25; // 基础点击力 1 × click_1 的 1.25（无升级、无转生）
  const expect = (startClicks, cap, withCrit) => {
    let sum = 0;
    for (let k = 1; k <= 40; k++) {
      const combo = Math.min(cap, k - 1);
      const mult = 1 + 0.012 * combo;
      const totalBefore = startClicks + k - 1;
      const crit = withCrit && (totalBefore + 1) % 20 === 0 ? 5 : 1;
      sum += clickPower * mult * crit;
    }
    return sum / 40;
  };
  ev.phases.crit = {
    pointsBefore: pts0,
    轮1_无暴击: { clicks: clicks1, income: t1 - t0, avgPerClick: (t1 - t0) / 40, 理论: expect(0, 20, false) },
    轮2_含暴击: { startClicks: totalClicksBefore2, clicks: clicks2, income: t3 - t2, avgPerClick: (t3 - t2) / 40, 理论: expect(totalClicksBefore2, 30, true), 理论无暴击: expect(totalClicksBefore2, 30, false) },
    talents: endState,
  };

  // ---------- Phase C：小李短任务 ----------
  await freshPage();
  await b.ev("__MOYU__.grant(1e12); true");
  await sleep(300);
  await b.ev(`(() => { for (let i = 0; i < 80; i++) document.querySelector('#shop-cards button[data-upgrade="phone"]')?.click(); return true; })()`);
  await sleep(300);
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(500);
  await b.ev(`document.querySelector('#team-body button[data-act="recruit"][data-id="li"]')?.click(); true`);
  await sleep(600);
  ev.phases.liMissions = await b.ev(`(() => {
    const btns = [...document.querySelectorAll('#team-body button[data-act="dispatch"][data-id="li"]')];
    const mate = [...document.querySelectorAll('#team-body .mate')].find((m) => m.innerText.includes('小李'));
    return { buttons: btns.map((x) => x.innerText.replace(/\\n/g, ' ')), mateText: mate ? mate.innerText.replace(/\\n/g, ' | ') : null };
  })()`);

  const shot = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/probe-r12-data-live4.png", Buffer.from(shot.data, "base64"));
  writeFileSync("playtest/probe-r12-data-live4.json", JSON.stringify(ev, null, 2));
  console.log(JSON.stringify(ev, null, 2));
} finally {
  await b.close?.();
}
