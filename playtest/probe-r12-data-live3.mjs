/** R12 复验 live3：一分钟内把「一键领取 vs 单领」同屏拍照 + 数字核对。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const PORT = 9614;
const ev = { url: URL, at: new Date().toISOString() };

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

const b = await openBrowser({ port: PORT, tag: "r12-data3" });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1500, deviceScaleFactor: 2, mobile: false });
  await b.send("Page.navigate", { url: URL });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && !!document.getElementById('shop-cards')");
  await b.ev("localStorage.clear(); true");
  await b.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && __MOYU__.state.daily !== null");

  await b.ev("__MOYU__.grant(1e11); true");
  await sleep(300);
  const buy = (n) =>
    b.ev(`(() => { let c = 0; for (let i = 0; i < ${n}; i++) { const el = document.querySelector('#shop-cards button[data-upgrade="phone"]'); if (!el) break; el.click(); c++; } return c; })()`);
  ev.buy1 = await buy(60);
  await sleep(300);
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(500);
  await b.ev(`document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]')?.click(); true`);
  await sleep(600);
  // 派 8h 咖啡
  await b.ev(`document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]')?.click(); true`);
  await sleep(500);
  ev.missionAfterDispatch = await b.ev("__MOYU__.state.team.colleagues.zhou");
  ev.snapshot = ev.missionAfterDispatch?.rewardSnapshot;
  // 派遣后升级工位（奖励已快照，不该变）
  ev.buy2 = await buy(120);
  await sleep(400);
  await b.ev("__MOYU__.endMissions(); true");
  await sleep(800);
  ev.panelBeforeClaim = await b.ev(`(() => {
    const all = document.querySelector('#team-body button[data-act="claim-all"]');
    const one = document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]');
    return { claimAll: all ? all.innerText : null, single: one ? one.innerText : null };
  })()`);
  const shot = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/probe-r12-data-live3-before.png", Buffer.from(shot.data, "base64"));
  // 单领核对
  const m0 = await b.ev("__MOYU__.state.moyu");
  const l0 = await b.ev("__MOYU__.state.lifetimeEarned");
  await b.ev(`document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]')?.click(); true`);
  await sleep(500);
  const m1 = await b.ev("__MOYU__.state.moyu");
  const l1 = await b.ev("__MOYU__.state.lifetimeEarned");
  ev.singleClaim = { display: ev.panelBeforeClaim.single, actualMoyuDelta: m1 - m0, actualLifetimeDelta: l1 - l0 };

  writeFileSync("playtest/probe-r12-data-live3.json", JSON.stringify(ev, null, 2));
  console.log(JSON.stringify(ev, null, 2));
} finally {
  await b.close?.();
}
