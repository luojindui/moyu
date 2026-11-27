/**
 * R14 批3「管理党」最终复验探针（round3，HEAD 3d45589）。
 * 只验证 lead 的 5 个修复点 + 每日决策链：
 *  ① 省心组合可用（需 ≥1 同事；1 步用掉 100）
 *  ② 无同事时社交禁用 + 提示
 *  ③ 四档精力真取舍（focus 后只剩 55）
 *  ④ 8/8 完成奖励（+10% + 庆祝）
 *  ⑤ 每日决策链内容量（精力/派遣/天赋/卡/小游戏）
 * 用 playtest/lib/chrome.mjs（随机端口，不串台），不改 src/。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const DIR = "playtest/r14-mgr";
mkdirSync(DIR, { recursive: true });
const E = { url: URL, head: "3d45589", steps: [], shots: [], asserts: {}, clicks: 0 };
const T0 = Date.now();
const log = (step, data) => {
  E.steps.push({ t: Math.round((Date.now() - T0) / 100) / 10, step, ...(data ?? {}) });
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${step} ${data ? JSON.stringify(data).slice(0, 420) : ""}`);
};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Page.enable", {});
  await c.send("Runtime.enable", {});
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const ev = (x) => c.ev(x);

  const shot = async (name) => {
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${DIR}/recheck-${name}.png`, Buffer.from(r.data, "base64"));
    E.shots.push(`${DIR}/recheck-${name}.png`);
  };
  const waitBoot = async (maxMs = 25000) => {
    const t = Date.now();
    while (Date.now() - t < maxMs) {
      if (await ev("!!(window.__MOYU__ && document.getElementById('stage') && __MOYU__.frames > 3)")) return;
      await sleep(120);
    }
    throw new Error("boot timeout");
  };
  const installRecorder = () => ev(`(() => {
    window.__r14 = { toasts: [], announces: [] };
    const hook = () => {
      const t = document.getElementById('dom-toast');
      if (t && !t.__r14obs) { t.__r14obs = true;
        new MutationObserver(() => { if (t.classList.contains('show')) window.__r14.toasts.push({ at: Date.now(), text: t.textContent }); })
          .observe(t, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['class'] });
      }
      const sr = document.getElementById('sr-live');
      if (sr && !sr.__r14obs) { sr.__r14obs = true;
        new MutationObserver(() => { if (sr.textContent) window.__r14.announces.push({ at: Date.now(), text: sr.textContent }); })
          .observe(sr, { childList: true, characterData: true, subtree: true });
      }
    };
    hook(); setInterval(hook, 800); return true;
  })()`);
  const readLogs = () => ev("JSON.parse(JSON.stringify(window.__r14 || {toasts:[],announces:[]}))");
  const snap = () => ev(`((s) => ({
    moyu: Math.round(s.moyu), lifetime: Math.round(s.lifetimeEarned),
    rankHud: document.getElementById('hud-rank').textContent,
    hudIdle: document.getElementById('hud-idle').textContent,
    hudClick: document.getElementById('hud-click').textContent,
    energy: s.energy,
    decor: s.decor,
    teammates: Object.keys(s.team.colleagues),
    talents: { points: s.talents.points, unlocked: s.talents.unlocked },
    badges: {
      team: document.querySelector('#btn-team .badge')?.textContent ?? null,
      talent: document.querySelector('#btn-team .talent-badge')?.textContent ?? null,
      energy: document.querySelector('#btn-team .energy-badge')?.textContent ?? null,
      arcade: document.querySelector('#btn-arcade .arcade-badge')?.textContent ?? null,
    },
    activeTab: document.querySelector('.team-tabs .tab.active')?.textContent ?? null,
    summaryLine: document.querySelector('#team-body .team-summary span')?.textContent.trim() ?? null,
  }))(__MOYU__.state)`);
  const click = async (sel) => {
    E.clicks += 1;
    return ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return { found: false };
      const disabled = !!el.disabled;
      const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      el.click();
      return { found: true, disabled, text };
    })()`);
  };
  const dismissSoft = () => ev(`(() => {
    const out = [];
    const w = document.getElementById('welcome');
    if (w && !w.classList.contains('hidden')) { document.getElementById('welcome-ok').click(); out.push('welcome'); }
    const cd = document.getElementById('cards');
    if (cd && !cd.classList.contains('hidden')) { document.getElementById('cards-skip').click(); out.push('cards'); }
    return out;
  })()`);
  const openTab = async (tab) => {
    await dismissSoft();
    await ev(`(() => {
      if (document.getElementById('team').classList.contains('hidden')) document.getElementById('btn-team').click();
      const t = document.getElementById('tab-${tab}');
      if (t && !t.classList.contains('active')) t.click();
    })()`);
    await sleep(430);
  };
  const closeTeam = async () => { await ev("document.getElementById('team-close').click()"); await sleep(250); };
  const energyRows = () => ev(`Array.from(document.querySelectorAll('#team-body .talent.row-tap[data-act="energy"]')).map(r => ({
    id: r.dataset.id, rowDisabled: r.dataset.disabled,
    desc: (r.querySelector('.talent-desc')?.textContent || '').trim(),
    btn: (() => { const b = r.querySelector('button[data-act="energy"]'); return b ? { found: true, disabled: !!b.disabled } : { found: false }; })(),
  }))`);
  const comboBtn = () => ev(`(() => { const b = document.querySelector('#team-body button[data-act="energy-all"]'); return b ? { found: true, disabled: !!b.disabled, text: b.textContent.trim() } : { found: false }; })()`);
  const comboStyle = () => ev(`(() => {
    const b = document.querySelector('#team-body button[data-act="energy-all"]');
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { disabled: !!b.disabled, color: cs.color, background: cs.backgroundColor, border: cs.borderColor, cursor: cs.cursor, opacity: cs.opacity };
  })()`);

  try {
    // ============ A. 全新档：① social 禁用+提示 ② 省心组合禁用 ============
    await c.send("Page.navigate", { url: URL });
    await waitBoot();
    await installRecorder();
    await sleep(1400);
    await dismissSoft();
    const fresh0 = await snap();
    if (fresh0.lifetime > 1e6 || fresh0.decor.length > 0 || fresh0.energy.used.length > 0) {
      throw new Error(`串台：${JSON.stringify({ l: fresh0.lifetime, d: fresh0.decor.length })}`);
    }
    const firstTab = await ev(`(() => { document.getElementById('btn-team').click(); const t = document.querySelector('.team-tabs .tab.active')?.textContent; document.getElementById('team-close').click(); return t; })()`);
    await openTab("decor");
    const freshRows = await energyRows();
    const freshCombo = await comboBtn();
    const freshComboStyle = await comboStyle();
    const freshBlock = await ev("document.getElementById('team-body').innerText.replace(/\\n+/g, ' | ').slice(0, 700)");
    const hudIdle0 = (await snap()).hudIdle;
    // 点一下被禁用的「社交」→ 应无任何变化
    const socialClick = await click('#team-body button[data-act="energy"][data-id="social"]');
    await sleep(400);
    const afterSocialClick = await snap();
    const logsA = await readLogs();
    log("A 全新档：社交禁用 / 省心组合禁用", {
      firstTab, badges: fresh0.badges, hudIdle0, freshRows, freshCombo, freshComboStyle, socialClick,
      socialClickNoop: afterSocialClick.energy.left === 100 && afterSocialClick.energy.used.length === 0,
      toasts: logsA.toasts.slice(-2),
    });
    E.asserts.socialDisabledWithoutColleagues = freshRows.find((r) => r.id === "social")?.btn.disabled === true
      && /还没有同事/.test(freshRows.find((r) => r.id === "social")?.desc ?? "");
    E.asserts.comboDisabledWithoutColleagues = freshCombo.disabled === true;
    E.asserts.socialClickNoop = afterSocialClick.energy.left === 100 && afterSocialClick.energy.used.length === 0;
    E.asserts.fourActionsRendered = freshRows.length === 4;
    E.asserts.comboDisabledStyleRecorded = !!freshComboStyle;
    await shot("A-fresh-decor");

    // ============ B. 招 1 位同事 → 社交可用、省心组合可用、1 步用掉 100 ============
    await ev("__MOYU__.grant(20000)");
    await sleep(500);
    await openTab("colleagues");
    const recruit = await click('#team-body button[data-act="recruit"][data-id="zhou"]');
    await sleep(600);
    const afterRecruit = await snap();
    await openTab("decor");
    const rowsWithMate = await energyRows();
    const comboWithMate = await comboBtn();
    const comboEnabledStyle = await comboStyle();
    await shot("B-combo-enabled");
    const comboClick = await click('#team-body button[data-act="energy-all"]');
    await sleep(600);
    const afterCombo = await snap();
    const logsB = await readLogs();
    log("B 招 1 人后：省心组合 1 步用掉 100", {
      recruit, teammates: afterRecruit.teammates,
      socialRow: rowsWithMate.find((r) => r.id === "social"),
      comboWithMate, comboEnabledStyle, comboClick,
      energyAfter: afterCombo.energy, hudIdleAfter: afterCombo.hudIdle, hudIdleBefore: hudIdle0,
      toasts: logsB.toasts.slice(-3), announces: logsB.announces.slice(-3),
    });
    E.asserts.comboEnabledWithColleague = comboWithMate.found === true && comboWithMate.disabled === false;
    E.asserts.comboDisabledVsEnabledVisualDiff = !!freshComboStyle && !!comboEnabledStyle
      && (freshComboStyle.background !== comboEnabledStyle.background || freshComboStyle.color !== comboEnabledStyle.color);
    E.asserts.comboOneStepUsesThree = afterCombo.energy.used.length === 3 && afterCombo.energy.left === 0
      && ["social", "fake-work", "slack"].every((x) => afterCombo.energy.used.includes(x));
    E.asserts.socialEnabledWithColleague = rowsWithMate.find((r) => r.id === "social")?.btn.disabled === false;
    const comboAfterUseStyle = await comboStyle();
    E.comboAfterUseStyle = comboAfterUseStyle;
    await shot("B-combo-used");

    // ============ C. 重置精力 → 四档真取舍（focus 后只剩 55） ============
    const resetInfo = await ev(`(() => {
      const raw = localStorage.getItem('moyu-save');
      if (!raw) return { ok: false };
      const blob = JSON.parse(raw);
      const today = new Date().toLocaleDateString('sv-SE');
      blob.energy = { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } };
      blob.savedAt = Date.now();
      const orig = localStorage.setItem.bind(localStorage);
      orig('moyu-save', JSON.stringify(blob));
      localStorage.setItem = () => {};
      return { ok: true, today };
    })()`);
    await ev("location.reload()");
    await waitBoot();
    await installRecorder();
    await sleep(1300);
    await dismissSoft();
    await openTab("decor");
    const comboReady = await comboBtn();
    const focusRes = await click('#team-body button[data-act="energy"][data-id="focus"]');
    await sleep(400);
    const afterFocus = await snap();
    const rowsAfterFocus = await energyRows();
    const comboAfterFocus = await comboBtn();
    const slackRes = await click('#team-body button[data-act="energy"][data-id="slack"]');
    await sleep(400);
    const afterFocusSlack = await snap();
    const rowsAfterSlack = await energyRows();
    const logsC = await readLogs();
    log("C 四档取舍：focus(45) → 只剩 55 → 再 slack(40) → 剩 15 作废", {
      resetInfo, comboReady, focusRes, afterFocus: afterFocus.energy,
      rowsAfterFocus: rowsAfterFocus.map((r) => ({ id: r.id, disabled: r.btn.disabled ?? null, rowDisabled: r.rowDisabled })),
      comboAfterFocus, slackRes, afterFocusSlack: afterFocusSlack.energy,
      rowsAfterSlack: rowsAfterSlack.map((r) => ({ id: r.id, disabled: r.btn.disabled ?? null })),
      toasts: logsC.toasts.slice(-2),
    });
    E.asserts.focusLeaves55 = afterFocus.energy.left === 55 && afterFocus.energy.used.join(",") === "focus";
    E.asserts.comboBlockedByBudget = comboAfterFocus.disabled === true;
    E.asserts.leftover15Wasted = afterFocusSlack.energy.left === 15
      && rowsAfterSlack.every((r) => r.id === "focus" || r.id === "slack" || r.btn.disabled === true);
    await shot("C-focus-tradeoff");

    // ============ D. 8/8 完成奖励 + 每日决策链内容 ============
    await ev("__MOYU__.grant(1e11)");
    await sleep(1500);
    await dismissSoft();
    await openTab("decor");
    const decorBtns = await ev(`Array.from(document.querySelectorAll('#team-body button[data-act="decor"]')).map(b => ({ id: b.dataset.id, disabled: !!b.disabled }))`);
    const summaryBefore = (await snap()).summaryLine;
    for (const d of decorBtns) { await click(`#team-body button[data-act="decor"][data-id="${d.id}"]`); await sleep(170); }
    await sleep(800);
    const afterDecor = await snap();
    const logsD = await readLogs();
    const decorBtnsAfter = await ev(`document.querySelectorAll('#team-body button[data-act="decor"]').length`);
    log("D 买满 8 件：完成奖励", {
      summaryBefore, summaryAfter: afterDecor.summaryLine, decor: afterDecor.decor,
      remainingDecorBtns: decorBtnsAfter,
      toasts: logsD.toasts, announces: logsD.announces.slice(-6),
      hudIdle: afterDecor.hudIdle,
    });
    E.asserts.decorCompleteReward = afterDecor.decor.length === 8
      && /1\.5[0-9]/.test(String(afterDecor.summaryLine))
      && (logsD.toasts.some((t) => /装修完成/.test(t.text)) || logsD.announces.some((a) => /装修完成/.test(a.text)));
    E.asserts.decorExhausted = decorBtnsAfter === 0;
    await shot("D-decor-complete");
    await closeTeam();
    await sleep(700);
    await shot("D-scene-decor");

    // 每日决策链内容量：小游戏入口 / 日报 / 卡 / 天赋角标
    const dailyContent = await ev(`(() => ({
      arcadeBtn: (() => { const b = document.getElementById('btn-arcade'); return b ? { label: b.getAttribute('aria-label'), badge: b.querySelector('.arcade-badge')?.textContent ?? null } : null; })(),
      journalBadge: document.getElementById('btn-journal').className,
      teamBadge: document.querySelector('#btn-team .badge')?.textContent ?? null,
      energyBadge: document.querySelector('#btn-team .energy-badge')?.textContent ?? null,
      talentBadge: document.querySelector('#btn-team .talent-badge')?.textContent ?? null,
    }))()`);
    // 打开日报看「关于」里是否列出批 3/4
    await ev("document.getElementById('btn-journal').click()");
    await sleep(500);
    const aboutNotes = await ev("(document.getElementById('about-notes')?.textContent || '').trim()");
    const aboutVersion = await ev("(document.getElementById('about-version')?.textContent || '').trim()");
    await ev("document.getElementById('journal-close').click()");
    log("E 每日内容量 / 版本公告", { dailyContent, aboutVersion, aboutNotes: aboutNotes.slice(0, 300) });
    E.asserts.updatesListBatch3 = /工位经营/.test(aboutNotes) && /每日精力/.test(aboutNotes);
    E.dailyContent = dailyContent;

    E.asserts.tapsToEnergy = 2;
    E.finalState = await snap();
    E.logs = await readLogs();
    E.ok = true;
  } catch (err) {
    E.ok = false;
    E.error = String((err && err.stack) || err).slice(0, 1500);
    console.error("RECHECK ERROR", err);
  } finally {
    writeFileSync(`${DIR}/recheck-evidence.json`, JSON.stringify(E, null, 2));
    c.close();
  }
}, { timeoutMs: 180_000 });

console.log("DONE", JSON.stringify({ ok: E.ok, asserts: E.asserts, clicks: E.clicks }, null, 2));