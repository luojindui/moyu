/**
 * R14 批3「管理党」试玩探针（只读 src/，不改源码）。
 *
 * 实测「每天上线的决策链」：精力怎么分 → 派遣谁 → 家具买哪件 → 天赋点哪
 * 关注：真决策次数、最优解是否固定、与同事系统协同、发现性（有无提醒/红点）、UI 反馈。
 *
 * 注意：同批有多个 agent 并行跑探针，lib/chrome.mjs 默认端口（9900）会撞车
 * → 这里显式指定独立端口 9317，并在启动后做"新档新鲜度"断言。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const URL = "http://127.0.0.1:5173/";
const PORT = 9317;
const DIR = "playtest/r14-mgr";
mkdirSync(DIR, { recursive: true });

const EVIDENCE = { url: URL, port: PORT, steps: [], shots: [], asserts: {}, clicks: 0 };
const T0 = Date.now();
function log(step, data) {
  EVIDENCE.steps.push({ t: Math.round((Date.now() - T0) / 100) / 10, step, ...(data ?? {}) });
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${step} ${data ? JSON.stringify(data).slice(0, 460) : ""}`);
}

await runChrome(async ({ port, proc }) => {
  // 端口撞车守卫：如果这个端口上跑的不是我们 spawn 的 Chrome，直接失败
  await sleep(300);
  if (proc.exitCode !== null) throw new Error(`自己的 Chrome 已退出（端口 ${port} 可能被占用）exit=${proc.exitCode}`);

  const c = await connect(port);
  await c.send("Page.enable", {});
  await c.send("Runtime.enable", {});
  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  const ev = (expr) => c.ev(expr);

  async function shot(name) {
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    const file = `${DIR}/${name}.png`;
    writeFileSync(file, Buffer.from(r.data, "base64"));
    EVIDENCE.shots.push(file);
  }
  async function waitBoot(maxMs = 25000) {
    const t = Date.now();
    while (Date.now() - t < maxMs) {
      if (await ev("!!(window.__MOYU__ && document.getElementById('stage') && __MOYU__.frames > 3)")) return;
      await sleep(120);
    }
    throw new Error("boot timeout");
  }
  async function installRecorder() {
    await ev(`(() => {
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
  }
  const readLogs = () => ev("JSON.parse(JSON.stringify(window.__r14 || {toasts:[],announces:[]}))");
  async function snap() {
    return ev(`((s) => ({
      moyu: s.moyu, lifetime: s.lifetimeEarned, prestige: s.prestige,
      rankHud: document.getElementById('hud-rank').textContent,
      hudIdle: document.getElementById('hud-idle').textContent,
      hudClick: document.getElementById('hud-click').textContent,
      energy: s.energy, decor: s.decor,
      talents: { points: s.talents.points, unlocked: s.talents.unlocked, dailyGiftDate: s.talents.dailyGiftDate },
      team: Object.fromEntries(Object.entries(s.team.colleagues).map(([k, v]) => [k, { lv: v.level, mission: v.missionId, favor: v.favor, auto: v.autoRepeat, endsIn: Math.round((v.endsAt - Date.now()) / 1000) }])),
      cards: { chosen: s.cards && s.cards.chosen },
      badges: {
        team: document.querySelector('#btn-team .badge')?.textContent ?? null,
        talent: document.querySelector('#btn-team .talent-badge')?.textContent ?? null,
      },
      teamOpen: !document.getElementById('team').classList.contains('hidden'),
      activeTab: document.querySelector('.team-tabs .tab.active')?.textContent ?? null,
      summaryLine: document.querySelector('#team-body .team-summary span')?.textContent.trim() ?? null,
    }))(__MOYU__.state)`);
  }
  async function click(sel) {
    EVIDENCE.clicks += 1;
    return ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return { found: false };
      const disabled = !!el.disabled;
      const text = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 120);
      el.click();
      return { found: true, disabled, text };
    })()`);
  }
  async function dismissSoftModals() {
    return ev(`(() => {
      const out = [];
      const w = document.getElementById('welcome');
      if (w && !w.classList.contains('hidden')) { document.getElementById('welcome-ok').click(); out.push('welcome'); }
      const cd = document.getElementById('cards');
      if (cd && !cd.classList.contains('hidden')) { document.getElementById('cards-skip').click(); out.push('cards'); }
      const b = document.getElementById('boss-choice');
      if (b && !b.classList.contains('hidden')) {
        const tell = document.getElementById('boss-tell').textContent || '';
        const map = [['脚步', 0], ['屏幕', 1], ['手机', 2]];
        const hit = map.find(([k]) => tell.includes(k));
        const opts = document.querySelectorAll('#boss-opts button');
        if (hit && opts.length) { opts[hit[1]].click(); out.push('boss'); }
      }
      return out;
    })()`);
  }
  async function openTeamTab(tab) {
    await dismissSoftModals();
    await ev(`(() => {
      if (document.getElementById('team').classList.contains('hidden')) document.getElementById('btn-team').click();
      const t = document.getElementById('tab-${tab}');
      if (t && !t.classList.contains('active')) t.click();
    })()`);
    await sleep(430);
  }
  async function closeTeam() {
    await ev("document.getElementById('team-close').click()");
    await sleep(260);
  }
  const energyBlock = () => ev(`(() => {
    for (const b of document.querySelectorAll('#team-body .branch')) {
      const h = b.querySelector('h3');
      if (h && h.textContent.includes('精力')) return b.innerText.replace(/\\n+/g, ' | ').trim();
    }
    return null;
  })()`);
  const energyBtns = () => ev(`Array.from(document.querySelectorAll('#team-body button[data-act="energy"]')).map(b => ({ id: b.dataset.id, disabled: !!b.disabled, text: b.textContent.trim() }))`);
  const decorBtns = () => ev(`Array.from(document.querySelectorAll('#team-body button[data-act="decor"]')).map(b => ({ id: b.dataset.id, disabled: !!b.disabled, text: b.textContent.trim() }))`);
  const missionTable = () => ev(`(() => {
    const out = [];
    document.querySelectorAll('#team-body .mate').forEach(card => {
      const name = card.querySelector('.mate-name')?.textContent.trim() ?? '?';
      const btns = Array.from(card.querySelectorAll('button[data-act="dispatch"]')).map(b => {
        const text = (b.textContent || '').replace(/\\s+/g, ' ').trim();
        // 从 "净 +1234.5/h" / "净 -3.61万/h" / "净 +1.20亿/h" 里解析数值
        const m = text.match(/净\\s*([+-]?[\\d.]+)\\s*(万|亿)?\\/h/);
        let net = null;
        if (m) { net = Number(m[1]) * (m[2] === '万' ? 1e4 : m[2] === '亿' ? 1e8 : 1); }
        const matched = text.includes('★');
        return { id: b.dataset.id, mission: b.dataset.mission, text, net, matched, duration: (text.match(/(\\d+)([mh]) ·/) || [])[0] ?? null };
      });
      if (btns.length) out.push({ name, id: btns[0].id, missions: btns });
    });
    return out;
  })()`);
  /** 像"管理党"一样按界面上的净/h 选每个同事的最优任务并派出 */
  const dispatchBestNet = async () => {
    const table = await missionTable();
    const picks = [];
    for (const row of table) {
      const best = [...row.missions].sort((a, b) => b.net - a.net)[0];
      if (!best) continue;
      const res = await click(`#team-body button[data-act="dispatch"][data-id="${row.id}"][data-mission="${best.mission}"]`);
      picks.push({ colleague: row.name, id: row.id, picked: best.mission, net: best.net, matched: best.matched, wasMatchedBest: row.missions.filter((m) => m.matched).every((m) => m.net <= best.net), res });
      await sleep(190);
    }
    return { table, picks };
  };

  try {
    // ============ 0. 全新档首进 ============
    await c.send("Page.navigate", { url: URL });
    await waitBoot();
    await installRecorder();
    await sleep(1300);
    await dismissSoftModals();
    await sleep(250);
    const fresh = await snap();
    // 新鲜度守卫（防串台到同批其他 agent 的存档）
    const contaminated = fresh.lifetime > 1e6 || fresh.decor.length > 0 || fresh.energy.used.length > 0;
    EVIDENCE.asserts.freshProfile = !contaminated;
    if (contaminated) throw new Error(`浏览器不是新档（串台）：${JSON.stringify({ lifetime: fresh.lifetime, decor: fresh.decor, used: fresh.energy.used })}`);
    log("A0 全新档", fresh);
    const bootToast = await ev(`(() => { const t = document.getElementById('dom-toast'); return t ? { text: t.textContent, shown: t.classList.contains('show') } : null; })()`);
    const firstOpenTab = await ev(`(() => { document.getElementById('btn-team').click(); const tab = document.querySelector('.team-tabs .tab.active')?.textContent; document.getElementById('team-close').click(); return tab; })()`);
    const energyBadge = await ev(`(() => { const b = document.querySelector('#btn-team .energy-badge'); return b ? { text: b.textContent, rect: (r => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }))(b.getBoundingClientRect()) } : null; })()`);
    EVIDENCE.asserts.firstOpenDefaultTab = firstOpenTab;
    log("A0b 首开默认页 / boot 提示 / 精力角标", { firstOpenTab, bootToast, energyBadge });
    await shot("01-fresh");

    // 新手自然点击 15 次
    const taps = await ev(`(() => {
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      for (let i = 0; i < 15; i++) canvas.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width * 0.5, clientY: r.top + r.height * 0.6, pointerId: i + 1 }));
      return { w: Math.round(r.width), h: Math.round(r.height) };
    })()`);
    await sleep(700);
    const afterTaps = await snap();
    log("A1 真实点击 15 次", { moyu: afterTaps.moyu, hudClick: afterTaps.hudClick, hudIdle: afterTaps.hudIdle, rank: afterTaps.rankHud, canvas: taps });
    await shot("02-after-taps");

    // ============ 1. 新手第一次打开 👥：默认落在哪一页？精力找得到吗 ============
    await openTeamTab("decor");
    const freshEnergyText = await energyBlock();
    const freshEnergyBtns = await energyBtns();
    const freshDecorBtns = await decorBtns();
    const freshEnergyAll = await ev(`(() => { const b = document.querySelector('#team-body button[data-act="energy-all"]'); return b ? { found: true, disabled: !!b.disabled, text: b.textContent.trim() } : { found: false }; })()`);
    log("A2 工位页(新号)", { freshEnergyText, freshEnergyBtns, freshEnergyAll, freshDecorBtns });
    await shot("03-fresh-decor-tab");

    // ============ 2. 精力：3 项能不能全点？有无取舍 ============
    const hudIdle0 = (await snap()).hudIdle;
    const energySteps = [];
    for (const id of ["slack", "fake-work", "social"]) {
      const btn = await click(`#team-body button[data-act="energy"][data-id="${id}"]`);
      await sleep(280);
      const s = await snap();
      const logs = await readLogs();
      energySteps.push({ id, btn, energy: s.energy, hudIdle: s.hudIdle, favors: Object.fromEntries(Object.entries(s.team).map(([k, v]) => [k, v.favor])), toast: logs.toasts.at(-1)?.text ?? null, announce: logs.announces.at(-1)?.text ?? null });
      log(`A3 用精力 ${id}`, energySteps.at(-1));
    }
    const afterEnergy = await snap();
    const energyBtnsAfter = await energyBtns();
    const summaryAfterEnergy = afterEnergy.summaryLine;
    log("A3 精力全部使用后", { energy: afterEnergy.energy, hudIdle0, hudIdle: afterEnergy.hudIdle, energyBtnsAfter, summaryAfterEnergy });
    EVIDENCE.asserts.energyThreeUsableSameDay = afterEnergy.energy.used.length === 3 && afterEnergy.energy.left === 0;
    EVIDENCE.asserts.socialWorksWithoutColleagues = (await snap()).energy.used.includes("social"); // 新号用社交 = 空放
    EVIDENCE.asserts.summaryShowsEnergyBuff = /1\.25|1\.43|1\.2/.test(String(summaryAfterEnergy));
    await shot("04-energy-all-used");

    // ============ 3. grant 大钱 + 全招募（建立"中期"状态） ============
    await ev("__MOYU__.grant(1e11)");
    await sleep(1500);
    await dismissSoftModals();
    const afterGrant = await snap();
    log("A4 grant 1e11", { moyu: afterGrant.moyu, lifetime: afterGrant.lifetime, rank: afterGrant.rankHud, talents: afterGrant.talents, badges: afterGrant.badges });

    await openTeamTab("colleagues");
    const recruitRes = {};
    for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
      recruitRes[id] = await click(`#team-body button[data-act="recruit"][data-id="${id}"]`);
      await sleep(230);
    }
    await sleep(500);
    const afterRecruit = await snap();
    log("A5 招募 5 人", { team: afterRecruit.team, recruitRes });

    // 只发钱不点升级会让"工位挂机"停在 0.2/s，派遣净收益被扭曲 → 先按正常节奏把升级买到 ~850/s
    const upgradeRes = await ev(`(() => {
      const target = { phone: 6, toilet: 6, group: 5, meeting: 4, deep: 3 };
      const before = JSON.parse(JSON.stringify(__MOYU__.state.levels));
      for (const [id, want] of Object.entries(target)) {
        const card = document.querySelector('[data-upgrade="' + id + '"]');
        let guard = 0;
        while ((__MOYU__.state.levels[id] ?? 0) < want && guard++ < 300) card.click();
      }
      return { before, after: JSON.parse(JSON.stringify(__MOYU__.state.levels)), hudIdle: document.getElementById('hud-idle').textContent };
    })()`);
    await sleep(500);
    log("A5b 把工位升级买到中期水平", upgradeRes);

    // ============ 4. 派遣：读"净/h"，像管理党一样按净收益选任务 ============
    await openTeamTab("colleagues");
    const tableBefore = await missionTable();
    EVIDENCE.missionTableBeforeDecor = tableBefore;
    log("A6 派遣任务表（装修前）", tableBefore.map((r) => ({ 同事: r.name, 任务: r.missions.map((m) => `${m.mission}[${m.text}]`) })));
    await shot("05-team-missions");

    // ============ 5. 家具：价格/可买性/一次性 ============
    await openTeamTab("decor");
    const decorBefore = await decorBtns();
    const summaryBefore = (await snap()).summaryLine;
    const hudIdleBeforeDecor = (await snap()).hudIdle;
    log("A7 工位页购买前", { decorBefore, summaryBefore, hudIdleBeforeDecor });
    await shot("06-decor-before-buy");

    const buyRes = {};
    for (const d of decorBefore) {
      buyRes[d.id] = await click(`#team-body button[data-act="decor"][data-id="${d.id}"]`);
      await sleep(180);
    }
    await sleep(600);
    const afterDecor = await snap();
    const decorAfter = await decorBtns();
    const summaryAfter = afterDecor.summaryLine;
    log("A8 买完全部家具", { decor: afterDecor.decor, decorAfter, summaryBefore, summaryAfter, hudIdle: afterDecor.hudIdle, buyRes });
    EVIDENCE.asserts.decorAllBoughtOneShot = afterDecor.decor.length === 8 && decorAfter.length === 0;
    await shot("07-decor-all-owned");

    // 关面板看场景里的家具
    await closeTeam();
    await sleep(700);
    await dismissSoftModals();
    await shot("08-scene-with-decor");

    // ============ 6. 派遣（装修后）→ 看投射仪 +30% 是否生效 ============
    await openTeamTab("colleagues");
    const tableAfter = await missionTable();
    EVIDENCE.missionTableAfterDecor = tableAfter;
    log("A9 派遣任务表（装修后）", tableAfter.map((r) => ({ 同事: r.name, 任务: r.missions.map((m) => `${m.mission}[${m.text}]`) })));

    // 按界面上"净/h"选每人最优任务（管理党的自然玩法），再全部开启自动重复
    const { picks } = await dispatchBestNet();
    EVIDENCE.dispatchPicks = picks;
    const autoRes = {};
    for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
      autoRes[id] = await click(`#team-body button[data-act="auto"][data-id="${id}"]`);
      await sleep(150);
    }
    await sleep(350);
    const afterDispatch = await snap();
    log("A10 按净收益选任务 + 自动重复", { picks, autoRes, team: afterDispatch.team });
    EVIDENCE.asserts.matchedMissionEverPicked = picks.some((p) => p.matched);
    EVIDENCE.asserts.matchedSometimesNotBest = picks.some((p) => p.matched === false && p.net > 0);
    await shot("09-all-dispatched");

    // ============ 7. 一键领取 + 自动续班 ============
    await ev("__MOYU__.endMissions()");
    await sleep(600);
    const claimBtn = await ev(`(() => { const b = document.querySelector('#team-body button[data-act="claim-all"]'); return b ? { found: true, text: b.textContent.trim() } : { found: false }; })()`);
    const beforeClaim = await snap();
    if (claimBtn.found) await click('#team-body button[data-act="claim-all"]');
    await sleep(800);
    const afterClaim = await snap();
    const claimLogs = await readLogs();
    log("A11 一键领取", {
      claimBtn, beforeMoyu: Math.round(beforeClaim.moyu), afterMoyu: Math.round(afterClaim.moyu),
      team: afterClaim.team, toasts: claimLogs.toasts.slice(-2), announces: claimLogs.announces.slice(-2),
    });
    EVIDENCE.asserts.autoRepeatRedispatched = Object.values(afterClaim.team).every((t) => t.mission !== null && t.auto === true);
    await shot("10-after-claim-all");

    // ============ 8. 天赋：每日 1 点 / 免费重置 ============
    await openTeamTab("talents");
    const beforeTalent = await snap();
    const talentBtnList = await ev(`Array.from(document.querySelectorAll('#team-body button[data-act="talent"]')).map(b => ({ id: b.dataset.id, disabled: !!b.disabled, text: b.textContent.trim() }))`);
    const talentPanelText = await ev("document.getElementById('team-body').innerText.replace(/\\n+/g, ' | ').slice(0, 1200)");
    log("A12 天赋页", { points: beforeTalent.talents.points, talentBtnList, talentPanelText });
    await shot("11-talents");
    const talentClicks = [];
    for (const id of ["idle_1", "idle_2", "idle_3", "idle_4"]) {
      const b = await click(`#team-body button[data-act="talent"][data-id="${id}"]`);
      await sleep(210);
      const s = await snap();
      talentClicks.push({ id, b, points: s.talents.points, unlocked: s.talents.unlocked });
    }
    log("A13 点天赋", talentClicks);
    await ev("window.confirm = () => true");
    const resetBtn = await click('#team-body button[data-act="reset-talents"]');
    await sleep(450);
    const afterReset = await snap();
    log("A14 免费重置", { resetBtn, points: afterReset.talents.points, unlocked: afterReset.talents.unlocked });
    EVIDENCE.asserts.talentFreeRespec = afterReset.talents.unlocked.length === 0 && afterReset.talents.points >= 4;

    // ============ 9. 跨日：精力重置 & 有无提醒 ============
    const saveInfo = await ev(`(() => {
      const raw = localStorage.getItem('moyu-save');
      if (!raw) return { ok: false, reason: 'no save' };
      const blob = JSON.parse(raw);
      blob.energy = { date: '2020-01-01', left: 0, used: ['slack','fake-work','social'], boosted: { idleMult: 1.25, patrolRewardMult: 1.8 } };
      blob.savedAt = Date.now() - 3600 * 1000;
      const orig = localStorage.setItem.bind(localStorage);
      orig('moyu-save', JSON.stringify(blob));
      const verify = JSON.parse(localStorage.getItem('moyu-save')).energy;
      // 阻止 pagehide 自动存档把内存态（今日精力已用）写回，覆盖我们的"昨日"存档
      localStorage.setItem = () => {};
      return { ok: true, verify, keys: Object.keys(blob).slice(0, 12) };
    })()`);
    log("A15 存档改为昨日精力", saveInfo);
    await ev("location.reload()");
    await waitBoot();
    await installRecorder();
    await sleep(1600);
    await dismissSoftModals();
    const afterReload = await snap();
    const reloadLogs = await readLogs();
    log("A16 跨日重载", { energy: afterReload.energy, hudIdle: afterReload.hudIdle, badges: afterReload.badges, toasts: reloadLogs.toasts, announces: reloadLogs.announces.slice(-8) });
    EVIDENCE.asserts.energyResetsNextDay = afterReload.energy.left === 100 && afterReload.energy.used.length === 0;
    EVIDENCE.asserts.energyResetNotified = reloadLogs.toasts.some((t) => /精力/.test(t.text)) || reloadLogs.announces.slice(-10).some((a) => /精力/.test(a.text));
    await shot("12-next-day");
    // 第二天：新会话首开 👥 默认哪一页？精力入口是否要自己找？
    const day2FirstTab = await ev(`(() => { document.getElementById('btn-team').click(); const tab = document.querySelector('.team-tabs .tab.active')?.textContent; return tab; })()`);
    await ev(`document.getElementById('tab-decor').click()`);
    await sleep(430);
    const day2EnergyText = await energyBlock();
    const day2EnergyBtns = await energyBtns();
    const day2EnergyAll = await ev(`(() => { const b = document.querySelector('#team-body button[data-act="energy-all"]'); return b ? { found: true, disabled: !!b.disabled, text: b.textContent.trim() } : { found: false }; })()`);
    const allRes = await click('#team-body button[data-act="energy-all"]');
    await sleep(500);
    const afterAllEnergy = await snap();
    const allLogs = await readLogs();
    log("A17 第二天工位页 + 一键全用", { day2FirstTab, day2EnergyText, day2EnergyBtns, day2EnergyAll, allRes, energy: afterAllEnergy.energy, hudIdle: afterAllEnergy.hudIdle, toast: allLogs.toasts.at(-1)?.text ?? null, announces: allLogs.announces.slice(-2) });
    EVIDENCE.asserts.oneClickAllEnergy = afterAllEnergy.energy.used.length === 3 && afterAllEnergy.energy.left === 0;
    await shot("14-day2-oneclick-all");
    EVIDENCE.asserts.day2FirstTab = day2FirstTab;
    EVIDENCE.asserts.day2EnergyUsable = day2EnergyBtns.length === 3 && day2EnergyBtns.every((b) => b.disabled === false);
    await shot("13-next-day-decor");

    EVIDENCE.asserts.energyTabsAndTaps = { firstOpenDefaultTab: EVIDENCE.asserts.firstOpenDefaultTab, tapsToEnergyFromNewSession: 2 };
    EVIDENCE.finalState = await snap();
    EVIDENCE.logs = await readLogs();
    EVIDENCE.ok = true;
  } catch (e) {
    EVIDENCE.ok = false;
    EVIDENCE.error = String((e && e.stack) || e).slice(0, 2000);
    console.error("PROBE ERROR", e);
  } finally {
    writeFileSync(`${DIR}/evidence.json`, JSON.stringify(EVIDENCE, null, 2));
    c.close();
  }
}, { timeoutMs: 200_000, port: PORT });

console.log("DONE", JSON.stringify({ ok: EVIDENCE.ok, asserts: EVIDENCE.asserts }, null, 2));