/** R12 数据党：真机（CDP headless）只读核对面板显示 vs 引擎实际。
 *  只写 playtest/，不改 src/。dev server: http://127.0.0.1:5173/
 *  证据：playtest/probe-r12-data-live.json
 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const PORT = 9612;
const evidence = { url: URL, at: new Date().toISOString(), steps: {} };

async function waitFor(b, expr, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      if (await b.ev(expr)) return Date.now() - t0;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("timeout: " + expr);
}

const b = await openBrowser({ port: PORT, tag: "r12-data" });
try {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1400, deviceScaleFactor: 2, mobile: false });
  await b.send("Page.navigate", { url: URL });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && !!document.getElementById('shop-cards')");

  // 清档（reload 让初始化补日报）+ 注入摸鱼值（dev 钩子）
  await b.ev("localStorage.clear(); true");
  await b.send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  await waitFor(b, "typeof window.__MOYU__ === 'object' && !!document.getElementById('shop-cards')");
  await waitFor(b, "__MOYU__.state.daily !== null");
  await b.ev("__MOYU__.grant(1e11); true");
  await sleep(400);

  // 买 60 次 phone（造工位挂机）
  const bought = await b.ev(`(() => {
    let n = 0;
    for (let i = 0; i < 60; i++) {
      const card = document.querySelector('#shop-cards button[data-upgrade="phone"]');
      if (!card) break;
      card.click(); n++;
    }
    return n;
  })()`);
  await sleep(300);

  // 打开小队面板，招募老周
  await b.ev("document.getElementById('btn-team').click(); true");
  await sleep(400);
  const recruited = await b.ev(`(() => {
    const btn = document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(500);
  const afterRecruit = await b.ev(`(() => {
    const s = __MOYU__.state;
    return {
      moyu: s.moyu, run: s.totalEarned, lifetime: s.lifetimeEarned,
      idleText: document.getElementById('hud-idle').textContent,
      hasZhou: !!s.team.colleagues.zhou,
      colleag: s.team.colleagues.zhou ?? null,
      levelsPhone: s.levels.phone ?? 0,
    };
  })()`);
  evidence.steps.teamPanelMateText = await b.ev(`(() => {
    const m = document.querySelector('#team-body .mate .mate-skill');
    return m ? m.textContent.trim() : 'none';
  })()`);
  evidence.steps.buyPhone = bought;
  evidence.steps.recruit = recruited;
  evidence.steps.afterRecruit = afterRecruit;

  // 派遣老周：楼下买咖啡 8h
  const dispatched = await b.ev(`(() => {
    const btn = document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]');
    if (!btn) return 'no-button';
    btn.click();
    return 'clicked';
  })()`);
  await sleep(500);
  evidence.steps.dispatch = dispatched;

  // 时间快进 8h+：覆盖 Date.now（仅领取判定用），让任务立即完成
  evidence.steps.timeFastForward = await b.ev(`(() => {
    const real = Date.now;
    const frozen = real();
    Date.now = () => frozen + 8 * 3600 * 1000 + 5000;
    return 'ok';
  })()`);
  await sleep(1500); // 等面板 refresh 循环重绘

  // 面板显示的领取奖励
  const preview = await b.ev(`(() => {
    const btn = document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]');
    return btn ? btn.textContent.trim() : 'no-claim-button';
  })()`);
  const shotTeam = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/probe-r12-data-live-team.png", Buffer.from(shotTeam.data, "base64"));
  const before = await b.ev(`(() => { const s = __MOYU__.state; return { moyu: s.moyu, lifetime: s.lifetimeEarned, run: s.totalEarned }; })()`);
  await b.ev(`(() => {
    const btn = document.querySelector('#team-body button[data-act="claim"][data-id="zhou"]');
    if (btn) btn.click();
    return true;
  })()`);
  await sleep(700);
  const after = await b.ev(`(() => { const s = __MOYU__.state; return { moyu: s.moyu, lifetime: s.lifetimeEarned, run: s.totalEarned }; })()`);
  evidence.steps.dispatchReward = {
    panelPreviewText: preview,
    panelPreviewNumberGuess: Number((preview.match(/[\d.]+/)?.[0] ?? "0")),
    actualMoyuDelta: after.moyu - before.moyu,
    actualLifetimeDelta: after.lifetime - before.lifetime,
    actualRunDelta: after.run - before.run,
  };

  // 统计面板：读「摸鱼数据」各行
  await b.ev("document.getElementById('team-close')?.click(); document.getElementById('btn-journal').click(); true");
  await sleep(900);
  const journalInfo = await b.ev(`(() => {
    const root = document.getElementById('journal');
    return {
      journalClass: root.className,
      rows: [...document.querySelectorAll('#stats-list .stat-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim()),
      statsHtmlLen: document.getElementById('stats-list').innerHTML.length,
    };
  })()`);
  evidence.steps.statsRows = journalInfo.rows;
  evidence.steps.journalClass = journalInfo.journalClass;
  evidence.steps.statsHtmlLen = journalInfo.statsHtmlLen;
  evidence.steps.stateAfter = await b.ev(`(() => { const s = __MOYU__.state; return {
    moyu: s.moyu, run: s.totalEarned, lifetime: s.lifetimeEarned, prestige: s.prestige,
    team: Object.keys(s.team.colleagues), levelsPhone: s.levels.phone ?? 0,
  }; })()`);

  // 截图
  const shot = await b.send("Page.captureScreenshot", { format: "png" });
  writeFileSync("playtest/probe-r12-data-live.png", Buffer.from(shot.data, "base64"));

  writeFileSync("playtest/probe-r12-data-live.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await b.close?.();
}
