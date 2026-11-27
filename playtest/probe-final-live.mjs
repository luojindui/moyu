/**
 * 终验硬核玩家 live CDP 探针（必须用 playtest/lib/chrome.mjs 起 headless Chrome）。
 * 覆盖：dev 版四批系统全部 UI 交互 + 生产版 v0.5.0 核对。
 * 运行：export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
 *       node playtest/probe-final-live.mjs
 */
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const DEV = "http://127.0.0.1:5173/";
const PROD = "https://luojindui.github.io/moyu/";
const OUT = "playtest/final-live-report.json";
const report = { startedAt: new Date().toISOString(), dev: {}, prod: {}, consoleErrors: [] };

async function shot(c, name) {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`playtest/final-live-${name}.png`, Buffer.from(r.data, "base64"));
}

async function waitReady(c, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await c.ev("document.readyState === 'complete' && !!window.__MOYU__");
    if (ok === true) return true;
    await sleep(200);
  }
  return false;
}

async function main() {
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    try {
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await c.send("Page.navigate", { url: DEV });
      await waitReady(c);
      await sleep(1200);

      const ver = await c.ev("document.body.innerText.match(/v\\d+\\.\\d+\\.\\d+/)?.[0] ?? '?'");
      report.dev.versionInPage = ver;
      report.dev.hasGrant = await c.ev("typeof window.__MOYU__?.grant === 'function'");
      report.dev.hasForceBoss = await c.ev("typeof window.__MOYU__?.forceBoss === 'function'");

      // ---- 1) 快进中后期 ----
      await c.ev("window.__MOYU__.grant(1e12); 'ok'");
      await sleep(400);
      const s1 = await c.ev(`(() => { const s = window.__MOYU__.state; return {
        moyu: s.moyu, totalEarned: s.totalEarned, idle: 0, levels: s.levels,
        teamSize: Object.keys(s.team.colleagues).length, decor: s.decor, talentsPts: s.talents.points,
        energy: s.energy, cards: s.cards, arcade: s.arcade, daily: s.daily && { date: s.daily.date, claimed: s.daily.claimed, streak: s.daily.streak },
        prestige: s.prestige, lifetime: s.lifetimeEarned,
      }; })()`);
      report.dev.stateAfterGrant = s1;
      await shot(c, "01-granted");

      // ---- 2) 小队面板：同事 tab ----
      await c.ev("document.getElementById('btn-team').click(); 'ok'");
      await sleep(400);
      report.dev.teamPanelOpen = await c.ev("!document.getElementById('team').classList.contains('hidden')");
      report.dev.colleagueCards = await c.ev("document.querySelectorAll('#team [data-act=\"recruit\"], #team [data-act=\"upgrade\"]').length");
      await shot(c, "02-team-colleagues");

      // 招募全部 5 人（逐个点击，等一帧）
      const recruited = [];
      for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
        const ok = await c.ev(`(() => { const b = document.querySelector('#team [data-act="recruit"][data-id="${id}"]'); if (!b) return false; b.click(); return true; })()`);
        recruited.push({ id, ok });
        await sleep(250);
      }
      await sleep(300);
      // 升星（每人点 3 次，验证上限 5 与费用）
      const ups = [];
      for (let round = 0; round < 4; round++) {
        for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
          const ok = await c.ev(`(() => { const b = document.querySelector('#team [data-act="upgrade"][data-id="${id}"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
          if (ok) ups.push(`${id}#${round}`);
          await sleep(160);
        }
      }
      report.dev.recruited = recruited;
      report.dev.upgradesClicked = ups.length;
      const teamAfter = await c.ev(`(() => { const s = window.__MOYU__.state; return {
        team: s.team.colleagues,
        favorTier: Object.values(s.team.colleagues).map((c) => c.favor),
      }; })()`);
      report.dev.teamAfter = teamAfter;
      await shot(c, "03-team-recruited-upgraded");

      // 派单：打开某个同事的派遣菜单并选 8h
      const dispatchUi = await c.ev(`(() => {
        const btns = [...document.querySelectorAll('#team [data-act="dispatch"]')];
        if (btns.length) { btns[0].click(); return { opened: true, n: btns.length }; }
        const card = [...document.querySelectorAll('#team .mate-actions button')].map((b) => b.textContent);
        return { opened: false, buttons: card };
      })()`);
      report.dev.dispatchUi = dispatchUi;
      await sleep(300);
      // 选择 8h 买咖啡
      const dispatched = await c.ev(`(() => { const b = document.querySelector('#team [data-act="dispatch"][data-mission="coffee"]'); if (!b) return false; b.click(); return true; })()`);
      await sleep(300);
      report.dev.dispatched8h = dispatched;
      // 自动重复 + 快进完成 + 领取
      const auto = await c.ev(`(() => { const b = document.querySelector('#team [data-act="auto"]'); if (!b) return false; b.click(); return true; })()`);
      await sleep(250);
      await c.ev("window.__MOYU__.endMissions(); 'ok'");
      await sleep(400);
      const claimBtn = await c.ev(`(() => { const b = document.querySelector('#team [data-act="claim"]'); if (!b) return { found: false, text: [...document.querySelectorAll('#team button')].map(x=>x.textContent).slice(0,8) }; return { found: true, text: b.textContent }; })()`);
      report.dev.claimAfterEndMissions = claimBtn;
      if (claimBtn?.found) await c.ev(`(() => { const b = document.querySelector('#team [data-act="claim"]'); b && b.click(); return true; })()`);
      await sleep(400);
      await shot(c, "04-team-claim");

      // ---- 3) 天赋 tab：点亮 + 查看互斥终局 ----
      await c.ev("document.getElementById('tab-talents').click(); 'ok'");
      await sleep(400);
      report.dev.talentTab = await c.ev(`(() => {
        const nodes = [...document.querySelectorAll('#team .talent')].map((n) => n.textContent.replace(/\\s+/g, ' ').slice(0, 40));
        const btns = [...document.querySelectorAll('#team [data-act="talent"]')].map((b) => b.textContent);
        return { nodes: nodes.length, sample: nodes.slice(0, 6), buttons: btns.slice(0, 6) };
      })()`);
      // 给点数并点亮：先 grant 触发段位天赋点（1e12 lifetime → 多档）
      await c.ev("window.__MOYU__.grant(1e12); 'ok'");
      await sleep(800); // 等段位天赋点发放（150ms HUD 节拍）
      const talentPts = await c.ev("window.__MOYU__.state.talents.points");
      report.dev.talentPointsAfterRankGrant = talentPts;
      const unlocked = [];
      for (let i = 0; i < 24; i++) {
        const id = await c.ev(`(() => { const b = [...document.querySelectorAll('#team [data-act="talent"]')].find((x) => !x.disabled); if (!b) return null; b.click(); return b.dataset.id; })()`);
        if (!id) break;
        unlocked.push(id);
        await sleep(120);
      }
      report.dev.talentsUnlocked = unlocked;
      await shot(c, "05-talents");

      // ---- 4) 工位 tab：买全部 8 件家具 ----
      await c.ev("document.getElementById('tab-decor').click(); 'ok'");
      await sleep(400);
      const decorRows = await c.ev(`(() => [...document.querySelectorAll('#team [data-act="decor"]')].map((r) => ({ id: r.dataset.id, text: r.textContent.replace(/\\s+/g, ' ').slice(0, 50), disabled: r.dataset.disabled })))()`);
      report.dev.decorRows = decorRows;
      await c.ev("window.__MOYU__.grant(2e9); 'ok'");
      await sleep(300);
      for (const d of ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"]) {
        await c.ev(`(() => { const b = document.querySelector('#team [data-act="decor"][data-id="${d}"] button'); if (b && !b.disabled) b.click(); return true; })()`);
        await sleep(160);
      }
      await c.ev("window.__MOYU__.grant(2e9); 'ok'");
      await sleep(200);
      for (const d of ["projector", "catbed"]) {
        await c.ev(`(() => { const b = document.querySelector('#team [data-act="decor"][data-id="${d}"] button'); if (b && !b.disabled) b.click(); return true; })()`);
        await sleep(200);
      }
      report.dev.decorOwned = await c.ev("window.__MOYU__.state.decor");

      // ---- 5) 精力：验证 4 项 + 省心组合 + 实测最优组合 ----
      await sleep(300);
      const energyUi = await c.ev(`(() => {
        const rows = [...document.querySelectorAll('#team [data-act="energy"]')].filter((r) => r.tagName === 'BUTTON' || r.querySelector('button'));
        const labels = [...document.querySelectorAll('#team .talent')].filter((r) => r.dataset.act === 'energy').map((r) => r.textContent.replace(/\\s+/g, ' ').slice(0, 60));
        const allBtn = document.querySelector('#team [data-act="energy-all"]');
        return { rows: labels, allButton: allBtn ? { text: allBtn.textContent, disabled: allBtn.disabled } : null, used: window.__MOYU__.state.energy.used, left: window.__MOYU__.state.energy.left };
      })()`);
      report.dev.energyUi = energyUi;
      await shot(c, "06-energy");
      // 用 slack + focus（实测最优 85 点）
      await c.ev(`(() => { const b = document.querySelector('#team [data-act="energy"][data-id="slack"] button'); b && b.click(); return true; })()`);
      await sleep(250);
      await c.ev(`(() => { const b = document.querySelector('#team [data-act="energy"][data-id="focus"] button'); b && b.click(); return true; })()`);
      await sleep(300);
      report.dev.energyAfterSlackFocus = await c.ev("window.__MOYU__.state.energy");
      // 再点一次 focus（应不可用）与 social（可）+ 检查剩余
      const social = await c.ev(`(() => { const b = document.querySelector('#team [data-act="energy"][data-id="social"] button'); if (!b) return { found: false }; if (b.disabled) return { found: true, disabled: true }; b.click(); return { found: true, clicked: true }; })()`);
      report.dev.energySocialTry = social;
      await sleep(250);
      report.dev.energyFinal = await c.ev(`(() => { const e = window.__MOYU__.state.energy; return { left: e.left, used: e.used, boosted: e.boosted }; })()`);
      await shot(c, "07-energy-used");

      // ---- 6) 关面板 → 卡牌弹窗 ----
      await c.ev("document.getElementById('team-close').click(); 'ok'");
      await sleep(500);
      // 戳 8 下触发首日卡牌弹窗（或等 12s）；用 canvas 合成 pointerdown
      await c.ev(`(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); for (let i = 0; i < 8; i++) cv.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); return 'ok'; })()`);
      await sleep(1500);
      report.dev.cardsOpen = await c.ev("!document.getElementById('cards').classList.contains('hidden')");
      if (report.dev.cardsOpen) {
        report.dev.cardOffers = await c.ev(`(() => [...document.querySelectorAll('#cards-body .card')].map((x) => ({ id: x.dataset.id, text: x.textContent.replace(/\\s+/g, ' ').slice(0, 80) })))()`);
        await shot(c, "08-cards");
        await c.ev(`(() => { const c = document.querySelector('#cards-body .card'); c && c.click(); return true; })()`);
        await sleep(500);
        report.dev.cardChosen = await c.ev("window.__MOYU__.state.cards.chosen");
      } else {
        await shot(c, "08-cards-not-open");
      }

      // ---- 7) 回合制老板 ----
      await c.ev("window.__MOYU__.forceBoss('choice'); 'ok'");
      await sleep(1600);
      report.dev.bossOpen = await c.ev("!document.getElementById('boss-choice').classList.contains('hidden')");
      if (report.dev.bossOpen) {
        report.dev.bossTell = await c.ev("document.getElementById('boss-tell').textContent");
        report.dev.bossOpts = await c.ev(`(() => [...document.querySelectorAll('#boss-opts button')].map((b) => b.textContent))()`);
        await shot(c, "09-boss-choice");
        // 按线索选对：急性子→装忙；多疑→切屏；健忘→继续摸鱼
        const tell = report.dev.bossTell || "";
        const pick = tell.includes("快又重") ? "act-busy" : tell.includes("盯着别人的屏幕") ? "switch-screen" : "keep-slacking";
        await c.ev(`(() => { const b = document.querySelector('#boss-opts [data-choice="${pick}"]'); b && b.click(); return true; })()`);
        await sleep(800);
        report.dev.bossResult = await c.ev(`(() => ({ text: document.getElementById('boss-choice').textContent.replace(/\\s+/g, ' ').slice(0, 120), surviveStreak: window.__MOYU__.state.surviveStreak }))()`);
        await shot(c, "10-boss-result");
      } else {
        await shot(c, "09-boss-not-open");
      }

      // ---- 8) 摸鱼站 ----
      await c.ev("document.getElementById('btn-arcade').click(); 'ok'");
      await sleep(500);
      report.dev.arcadeOpen = await c.ev("!document.getElementById('arcade').classList.contains('hidden')");
      report.dev.arcadeMenu = await c.ev(`(() => ({ left: document.getElementById('arcade-left').textContent.replace(/\\s+/g, ' ').slice(0, 80), body: document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').slice(0, 160) }))()`);
      await shot(c, "11-arcade-menu");
      // 开始「找老板」
      const started = await c.ev(`(() => { const b = document.querySelector('#arcade-body button[data-game="findboss"]'); if (!b || b.disabled) return false; b.click(); return true; })()`);
      report.dev.arcadeGameStarted = started;
      await sleep(1800);
      await shot(c, "12-arcade-findboss");
      const liveScore = await c.ev(`document.getElementById('arcade-body').textContent.replace(/\\s+/g, ' ').slice(0, 160)`);
      report.dev.arcadeLiveText = liveScore;
      // 点一个脸
      await c.ev(`(() => { const faces = [...document.querySelectorAll('#arcade-body button.face')]; if (faces.length) faces[0].click(); return faces.length; })()`);
      await sleep(300);
      try { await c.send("Page.handleJavaScriptDialog", { accept: true }); } catch { /* no dialog */ }
      // 不主动退出（避免 confirm 阻塞），直接记录
      const s2 = await c.ev(`(() => { const s = window.__MOYU__.state; return {
        arcade: s.arcade, cards: s.cards && { chosen: s.cards.chosen, until: s.cards.until },
        energy: s.energy, talents: { unlocked: s.talents.unlocked, points: s.talents.points, overflow: s.talents.overflow },
        decor: s.decor, team: Object.fromEntries(Object.entries(s.team.colleagues).map(([k, v]) => [k, { level: v.level, favor: v.favor, autoRepeat: v.autoRepeat }])),
        prestige: s.prestige, lifetime: s.lifetimeEarned, totalEarned: s.totalEarned,
      }; })()`);
      report.dev.stateAtEnd = s2;
      report.dev.consoleErrors = c.errors.slice(0, 20);
    } finally {
      c.close();
    }
  }, { timeoutMs: 180_000 });

  // ---- 生产版核对 ----
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    try {
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await c.send("Page.navigate", { url: PROD });
      for (let i = 0; i < 60; i++) {
        const st = await c.ev("document.readyState");
        if (st === "complete") break;
        await sleep(250);
      }
      await sleep(2500);
      report.prod.url = PROD;
      report.prod.title = await c.ev("document.title");
      report.prod.versionSeen = await c.ev("(document.body.innerText.match(/v\\d+\\.\\d+\\.\\d+/) ?? ['?'])[0]");
      report.prod.hasDebugHook = await c.ev("typeof window.__MOYU__ !== 'undefined'");
      report.prod.updates = await c.ev("fetch('./updates.json').then((r) => r.json()).then((a) => a.slice ? a.slice(0, 6) : a).catch(() => null)");
      await shot(c, "20-prod-390");
      // 点开小队 / 摸鱼站，确认四批 UI 都在
      const ui = await c.ev(`(() => {
        const has = (id) => !!document.getElementById(id);
        const tabs = [...document.querySelectorAll('#team .tab')].map((b) => b.textContent);
        return { team: has('team'), arcade: has('arcade'), cards: has('cards'), bossChoice: has('boss-choice'),
          hudButtons: [...document.querySelectorAll('header#hud button')].map((b) => b.id), tabs };
      })()`);
      report.prod.ui = ui;
      await c.ev("document.getElementById('btn-team').click(); 'ok'");
      await sleep(500);
      report.prod.teamPanelOpened = await c.ev("!document.getElementById('team').classList.contains('hidden')");
      await shot(c, "21-prod-team");
      await c.ev("document.getElementById('btn-arcade').click(); 'ok'");
      await sleep(500);
      report.prod.arcadeOpened = await c.ev("!document.getElementById('arcade').classList.contains('hidden')");
      await shot(c, "22-prod-arcade");
      report.prod.consoleErrors = c.errors.slice(0, 20);
    } finally {
      c.close();
    }
  }, { timeoutMs: 120_000 });

  report.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2).slice(0, 12000));
  console.log(`\n[written] ${OUT}`);
}

main().catch((e) => {
  console.error("[probe-final-live] FAILED", e);
  writeFileSync(OUT, JSON.stringify({ error: String(e), report }, null, 2));
  process.exit(1);
});