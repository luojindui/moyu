/** R12 复验：真机（CDP headless）核对新版面板 vs 引擎实际。
 *  只写 playtest/，不改 src/。dev server: http://127.0.0.1:5173/
 *  证据：playtest/probe-r12-data-live2.json + 截图
 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const PORT = 9613;
const ev = { url: URL, at: new Date().toISOString(), steps: {} };

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

const b = await openBrowser({ port: PORT, tag: "r12-data2" });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1500, deviceScaleFactor: 2, mobile: false });
  await b.send("Page.navigate", { url: URL });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && !!document.getElementById('shop-cards')");
  await b.ev("localStorage.clear(); true");
  await b.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && __MOYU__.state.daily !== null");

  // 1) 造工位 + 招募老周
  await b.ev("__MOYU__.grant(1e11); true");
  await sleep(300);
  const buy = (n) =>
    b.ev(`(() => { let c = 0; for (let i = 0; i < ${n}; i++) { const el = document.querySelector('#shop-cards button[data-upgrade="phone"]'); if (!el) break; el.click(); c++; } return c; })()`);
  ev.steps.boughtPhone = await buy(60);
  await sleep(300);
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(500);
  await b.ev(`document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]')?.click(); true`);
  await sleep(600);
  ev.steps.recruitPanelText = await b.ev(`(() => {
    const mates = [...document.querySelectorAll('#team-body .mate')];
    const sum = document.querySelector('#team-body .team-summary');
    return { summary: sum ? sum.innerText.replace(/\\n/g, ' ') : '', firstMate: mates[0] ? mates[0].innerText.replace(/\\n/g, ' | ') : '' };
  })()`);
  ev.steps.stateAfterRecruit = await b.ev(`(() => { const s = __MOYU__.state; return { moyu: s.moyu, run: s.totalEarned, life: s.lifetimeEarned, idleText: document.getElementById('hud-idle').textContent }; })()`);

  // 2) 派老周 8h 咖啡 → 再买工位 → 直接结束任务 → 看「一键领取」显示 vs 实领
  ev.steps.dispatchEstimate = await b.ev(`(() => {
    const btns = [...document.querySelectorAll('#team-body button[data-act="dispatch"][data-id="zhou"]')];
    return btns.map((x) => x.innerText.replace(/\\n/g, ' '));
  })()`);
  await b.ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]')?.click(); true`);
  await sleep(500);
  ev.steps.boughtAfterDispatch = await buy(120);
  await sleep(400);
  await b.ev("__MOYU__.endMissions(); true");
  await sleep(600);
  const claimUI = await b.ev(`(() => {
    const all = document.querySelector('#team-body button[data-act="claim-all"]');
    const one = document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]');
    return { claimAll: all ? all.innerText : null, single: one ? one.innerText : null };
  })()`);
  const before = await b.ev("__MOYU__.state.moyu");
  await b.ev(`document.querySelector('#team-body button[data-act="claim-all"]')?.click(); true`);
  await sleep(700);
  const after = await b.ev("__MOYU__.state.moyu");
  ev.steps.oneClickClaim = { ...claimUI, actualDelta: after - before };
  ev.steps.stateAfterClaim = await b.ev(`(() => { const s = __MOYU__.state; return { moyu: s.moyu, life: s.lifetimeEarned, idleText: document.getElementById('hud-idle').textContent }; })()`);

  // 3) 再派两单 + 直接结束，逐单领取核对（面板单领按钮应=实领）
  await b.ev(`document.getElementById('team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]')?.click(); true`);
  await sleep(400);
  await b.ev("__MOYU__.endMissions(); true");
  await sleep(600);
  const singleUI = await b.ev(`(() => {
    const el = document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]');
    return el ? el.innerText : null;
  })()`);
  const b2 = await b.ev("__MOYU__.state.moyu");
  await b.ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]')?.click(); true`);
  await sleep(700);
  const a2 = await b.ev("__MOYU__.state.moyu");
  ev.steps.singleClaim = { display: singleUI, actualDelta: a2 - b2 };

  // 4) 统计面板
  await b.ev("document.getElementById('team-close')?.click(); document.getElementById('btn-journal').click(); true");
  await sleep(900);
  ev.steps.statsRows = await b.ev(`[...document.querySelectorAll('#stats-list .stat-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`);
  ev.steps.stateFinal = await b.ev(`(() => { const s = __MOYU__.state; return { moyu: s.moyu, run: s.totalEarned, life: s.lifetimeEarned, prestige: s.prestige, team: Object.keys(s.team.colleagues), levels: s.levels, col: s.collected }; })()`);

  const shot = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/probe-r12-data-live2-journal.png", Buffer.from(shot.data, "base64"));
  // 团队面板截图
  await b.ev("document.getElementById('journal-close')?.click(); document.getElementById('btn-team').click(); true");
  await sleep(700);
  const shot2 = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/probe-r12-data-live2-team.png", Buffer.from(shot2.data, "base64"));

  writeFileSync("playtest/probe-r12-data-live2.json", JSON.stringify(ev, null, 2));
  console.log(JSON.stringify(ev, null, 2));
} finally {
  await b.close?.();
}
