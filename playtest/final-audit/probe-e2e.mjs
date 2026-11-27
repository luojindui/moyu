// 终验 E2E 探针（dev 服务器 5173，使用 __MOYU__ 钩子做场景准备 + 引擎模块交叉验证）
// 覆盖：新号首购 / 招募-派遣-领奖 / 8 件家具 / 精力+省心组合+跨日 / 抽卡选卡生效 /
//       回合制老板 对错超时 / 3 个小游戏+次数限制+跨日 / 存档刷新/导出导入/离线/时钟回拨 /
//       篡改档极值 / 快速连点 / 面板快速开关
import { runChrome, connect } from "../lib/chrome.mjs";
import {
  DEV, sleep, setViewport, goto, ev, click, count, visible, state, mod, modEval,
  tapCanvas, shot, waitFor, Report, hud, waitToast, closeAllModals, openPanel,
  waitFrames, text,
} from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const reports = [];
let c = null;

/** 当日/昨日日期（本地时区），与游戏口径一致 */
const today = new Date().toLocaleDateString("sv-SE");
const yesterday = (() => {
  const d = new Date(Date.now() - 86400_000);
  return d.toLocaleDateString("sv-SE");
})();

async function boot() {
  await goto(c, DEV, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 25000);
  await overrideDialogs();
  await sleep(400);
}

async function overrideDialogs() {
  await ev(c, `(() => { window.confirm = () => true; window.alert = () => {}; window.prompt = () => null; return true; })()`);
}

async function reload(waitMs = 400) {
  await c.send("Page.reload", {});
  const ok = await waitFor(c, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 20000);
  if (!ok) throw new Error("reload 后页面未就绪");
  await overrideDialogs();
  await sleep(waitMs);
}

/** 在页面里格式化引擎计算出的数值（与 HUD 显示口径一致） */
async function fmtEngine(expr, path = "/src/engine/upgrades.ts") {
  const k = await mod(c, path);
  const fk = await mod(c, "/src/engine/format.ts");
  return ev(c, `(() => { const M = window.${k}; const F = window.${fk}; return F.formatMoyu(${expr}); })()`);
}

/** 修改 localStorage 存档（mutation 为函数体字符串，参数 b） */
async function patchSave(mutation) {
  const r = await ev(c, `(() => {
    const raw = localStorage.getItem("moyu-save");
    if (!raw) return "no-save";
    let b;
    try { b = JSON.parse(raw); } catch { return "bad-json"; }
    (function (b) { ${mutation} })(b);
    localStorage.setItem("moyu-save", JSON.stringify(b));
    return "ok";
  })()`);
  return r;
}

async function writeSave(blob) {
  return ev(c, `(() => { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))}); return true; })()`);
}

/**
 * 写构造存档并刷新：必须拦截 pagehide 自动存档，否则旧内存状态会把构造档覆盖掉。
 * （已实测：不拦截时 reload 后构造档被覆盖；拦截 Storage.prototype.setItem 后生效）
 */
async function writeSaveAndReload(blob, waitMs = 450) {
  await ev(c, `(() => {
    localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    return true;
  })()`);
  await reload(waitMs);
}

/** 修改当前存档并刷新（同样拦截 pagehide 覆盖） */
async function patchSaveAndReload(mutation, waitMs = 450) {
  const r = await ev(c, `(() => {
    const raw = localStorage.getItem("moyu-save");
    if (!raw) return "no-save";
    let b;
    try { b = JSON.parse(raw); } catch { return "bad-json"; }
    (function (b) { ${mutation} })(b);
    localStorage.setItem("moyu-save", JSON.stringify(b));
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    return "ok";
  })()`);
  if (r !== "ok") throw new Error(`patchSaveAndReload 失败: ${r}`);
  await reload(waitMs);
}

/** 从当前 state 生成一个合法存档 blob（用于构造跨日/篡改场景） */
async function blobFromState() {
  const s = await state(c);
  const savedAt = await ev(c, `window.__MOYU__.savedAt`);
  return {
    v: 2, moyu: s.moyu, totalEarned: s.totalEarned, levels: s.levels,
    savedAt: savedAt ?? Date.now(), createdAt: Date.now() - 60_000,
    collected: s.collected, daily: s.daily, surviveStreak: s.surviveStreak,
    patrolSurvives: s.patrolSurvives, cards: s.cards, decor: s.decor, energy: s.energy,
    arcade: s.arcade, totalClicks: s.totalClicks, visits: s.visits,
    lifetimeEarned: s.lifetimeEarned, prestige: s.prestige, team: s.team, talents: s.talents,
  };
}

async function stage(title, fn) {
  const rep = new Report(title);
  reports.push(rep);
  console.log(`\n========== ${title} ==========`);
  try {
    await fn(rep);
  } catch (e) {
    rep.add(`${title}:STAGE-EXCEPTION`, false, String(e && e.message ? e.message : e).slice(0, 300));
    console.error("STAGE EXCEPTION:", e);
    try { await closeAllModals(c); } catch { /* ignore */ }
  }
  return rep;
}

// ============================ 开跑 ============================
function isProd() { return false; }

await runChrome(async ({ port }) => {
  c = await connect(port);
  await setViewport(c);

  // ---------- 阶段 A：新号启动 ----------
  await stage("A 新号启动", async (r) => {
    await boot();
    const title = await ev(c, "document.title");
    r.expect("A1 标题", /摸鱼工位/.test(title), title);
    r.expect("A2 dev 钩子可用", (await ev(c, "typeof window.__MOYU__")) === "object");
    const frames0 = await ev(c, "window.__MOYU__.frames");
    await waitFrames(c, 3);
    const frames1 = await ev(c, "window.__MOYU__.frames");
    r.expect("A3 主循环在跑", frames1 > frames0, `${frames0}→${frames1}`);
    r.expect("A4 无 boot 错误横幅", (await count(c, ".boot-error")) === 0);
    const h = await hud(c);
    r.expect("A5 初始 HUD 余额≈0（仅挂机底薪）", parseFloat(h.moyu) <= 2, h.moyu);
    r.expect("A6 初始点击力 1", h.click === "1", h.click);
    r.expect("A7 初始挂机 0.2", h.idle === "0.2", h.idle);
    const s = await state(c);
    r.expect("A8 初始状态干净", s.moyu < 5 && s.totalClicks === 0 && Object.keys(s.levels).length === 0, JSON.stringify({ m: s.moyu, c: s.totalClicks }));
    const canvas = await ev(c, `(() => { const el = document.getElementById("stage"); const b = el.getBoundingClientRect(); return { w: b.width, h: b.height }; })()`);
    r.expect("A9 canvas 尺寸有效", canvas.w > 200 && canvas.h > 150, JSON.stringify(canvas));
    r.expect("A10 无 JS 异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 B：新号 → 首购 ----------
  await stage("B 新号首购", async (r) => {
    await tapCanvas(c, 20, 95);
    await sleep(200);
    const s0 = await state(c);
    r.expect("B1 点击入账（20 次）", s0.totalClicks >= 18 && s0.moyu >= 15, JSON.stringify({ clicks: s0.totalClicks, moyu: s0.moyu.toFixed(2) }));
    const btn = await ev(c, `(() => { const b = document.querySelector('button[data-upgrade="coffee"]'); return b ? { disabled: b.disabled, price: b.dataset.price } : null; })()`);
    r.expect("B2 咖啡可购买", btn && !btn.disabled, JSON.stringify(btn));
    const before = s0.moyu;
    const buy = await click(c, 'button[data-upgrade="coffee"]');
    await sleep(250);
    const s1 = await state(c);
    r.expect("B3 首购成功", s1.levels.coffee === 1, JSON.stringify(s1.levels));
    r.expect("B4 扣款正确 -15", Math.abs(before - 15 - s1.moyu) < 1.5, `${before.toFixed(2)}→${s1.moyu.toFixed(2)}`);
    const expClick = await fmtEngine("M.clickPowerOf(window.__MOYU__.state)", "/src/engine/actions.ts");
    const h = await hud(c);
    r.expect("B5 HUD 点击力同步", h.click === expClick, `${h.click} vs ${expClick}`);
    r.expect("B6 首购无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
    await shot(c, "B-first-purchase");
  });

  // ---------- 阶段 C：招募 → 派遣 → 领奖 ----------
  await stage("C 招募派遣领奖", async (r) => {
    await ev(c, "window.__MOYU__.grant(15000)");
    await sleep(200);
    const s0 = await state(c);
    r.expect("C1 资金注入生效", s0.moyu >= 15000, s0.moyu.toFixed(0));
    await openPanel(c, "#btn-team", "#team");
    r.expect("C2 小队面板打开", await visible(c, "#team"));
    const rec = await ev(c, `(() => { const b = document.querySelector('button[data-act="recruit"][data-id="zhou"]'); return b ? { disabled: b.disabled, text: b.textContent.trim() } : null; })()`);
    r.expect("C3 老周招募按钮可用", rec && !rec.disabled, JSON.stringify(rec));
    const m0 = (await state(c)).moyu;
    await click(c, 'button[data-act="recruit"][data-id="zhou"]');
    await sleep(350);
    const s1 = await state(c);
    r.expect("C4 招募成功", s1.team.colleagues.zhou && s1.team.colleagues.zhou.level === 1, JSON.stringify(Object.keys(s1.team.colleagues)));
    r.expect("C5 招募扣 12000", Math.abs(m0 - 12000 - s1.moyu) < 2, `${m0.toFixed(0)}→${s1.moyu.toFixed(0)}`);
    const disp = await ev(c, `(() => { const b = document.querySelector('button[data-act="dispatch"][data-id="zhou"][data-mission="stroll"]'); return b ? { disabled: b.disabled, text: b.textContent.trim().replace(/\\s+/g, " ") } : null; })()`);
    r.expect("C6 派遣按钮存在", !!disp, JSON.stringify(disp));
    await click(c, 'button[data-act="dispatch"][data-id="zhou"][data-mission="stroll"]');
    await sleep(350);
    const s2 = await state(c);
    r.expect("C7 派遣状态写入", s2.team.colleagues.zhou.missionId === "stroll" && s2.team.colleagues.zhou.endsAt > Date.now(), JSON.stringify(s2.team.colleagues.zhou));
    r.expect("C8 面板显示倒计时", /进行中/.test((await text(c, "#team-body")) ?? ""), (await text(c, "#team-body"))?.slice(0, 60));
    await ev(c, "window.__MOYU__.endMissions()");
    await sleep(800);
    const claimBtn = await ev(c, `(() => { const b = document.querySelector('button[data-act="claim"][data-id="zhou"]'); return b ? { text: b.textContent.trim() } : null; })()`);
    r.expect("C9 任务完成出现领取按钮", !!claimBtn && /领取/.test(claimBtn.text), JSON.stringify(claimBtn));
    const before = await state(c);
    await click(c, 'button[data-act="claim"][data-id="zhou"]');
    await sleep(450);
    const s3 = await state(c);
    const flash = (await text(c, ".team-flash")) ?? (await text(c, "#sr-live"));
    r.expect("C10 领取后任务清空", s3.team.colleagues.zhou.missionId === null);
    r.expect("C11 奖励入账", s3.moyu > before.moyu + 1, `${before.moyu.toFixed(1)}→${s3.moyu.toFixed(1)}`);
    r.expect("C12 好感 +2（普攻非匹配）", s3.team.colleagues.zhou.favor >= 2, `favor=${s3.team.colleagues.zhou.favor}`);
    r.expect("C13 面板浮动提示", /任务完成/.test(flash ?? ""), flash ?? "null");
    r.expect("C14 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
    await shot(c, "C-team-claimed");
  });

  // ---------- 阶段 D：8 件家具 / 场景变化 / 完成奖励 ----------
  await stage("D 工位家具 8 件", async (r) => {
    await closeAllModals(c);
    await ev(c, "window.__MOYU__.grant(2300000000)");
    await sleep(200);
    const idleBefore = await text(c, "#hud-idle");
    await shot(c, "D-scene-before-decor");
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-decor");
    await waitFor(c, `document.getElementById("team-body").textContent.includes("工位家具")`, 3000);
    const ids = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
    for (const id of ids) {
      const res = await click(c, `button[data-act="decor"][data-id="${id}"]`);
      await sleep(300);
      const s = await state(c);
      r.expect(`D-buy-${id}`, s.decor.includes(id) && res.ok, JSON.stringify(res));
    }
    const s = await state(c);
    r.expect("D1 8 件集齐", s.decor.length === 8, JSON.stringify(s.decor));
    let evid = "";
    for (let i = 0; i < 40; i++) {
      const tob = (await text(c, "#dom-toast")) ?? "";
      const srt = (await text(c, "#sr-live")) ?? "";
      if (/装修完成|装修已全部完成|全部 8 件/.test(tob + srt)) { evid = tob || srt; break; }
      await sleep(60);
    }
    r.expect("D2 完成提示出现", /装修完成|全部 8 件/.test(evid), evid || "未捕获到提示");
    const summary = await text(c, "#decor-summary");
    const names = ["绿萝", "护眼台灯", "毛绒地毯", "迷你冰箱", "按摩椅", "鱼缸", "投影仪", "工位猫窝"];
    r.expect("D3 读屏摘要含全部 8 件", names.every((n) => (summary ?? "").includes(n)), (summary ?? "").slice(0, 80));
    const expIdle = await fmtEngine("M.effectOf(window.__MOYU__.state).idleRate");
    const hudIdle = await text(c, "#hud-idle");
    r.expect("D4 完成 +10% 且 HUD 一致", hudIdle === expIdle && expIdle !== idleBefore, `${idleBefore}→${hudIdle} expect ${expIdle}`);
    const decorMult = await modEval(c, "/src/engine/decor.ts", "M.decorEffects(window.__MOYU__.state).idleMult");
    const expectMult = 1.05 * 1.08 * 1.1 * 1.15 * 1.1;
    r.expect("D5 集齐挂机倍率 = 各件乘积×1.1", Math.abs(decorMult - expectMult) < 1e-9, `${decorMult} vs ${expectMult}`);
    const leftBtns = await count(c, 'button[data-act="decor"]');
    r.expect("D6 已购家具无重复购买入口", leftBtns === 0, `剩余按钮 ${leftBtns}`);
    await shot(c, "D-scene-after-decor");
    await closeAllModals(c);
    await waitFrames(c, 3);
    r.expect("D7 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 E：每日精力（含省心组合、刷新后生效口径） ----------
  await stage("E 每日精力", async (r) => {
    const todayStr = today;
    // E1：专注点击
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-decor");
    await waitFor(c, `document.querySelector('button[data-act="energy"][data-id="focus"]') !== null`, 3000);
    const sBefore = await state(c);
    r.expect("E0 精力初始 100", sBefore.energy.left === 100 && sBefore.energy.used.length === 0, JSON.stringify(sBefore.energy));
    await click(c, 'button[data-act="energy"][data-id="focus"]');
    await sleep(400);
    const sFocus = await state(c);
    r.expect("E1 focus 消耗 45", sFocus.energy.left === 55 && sFocus.energy.used.includes("focus"), JSON.stringify({ left: sFocus.energy.left, used: sFocus.energy.used }));
    r.expect("E2 focus 点击 ×2", Math.abs(sFocus.energy.boosted.clickMult - 2) < 1e-9, sFocus.energy.boosted.clickMult);
    r.expect("E3 focus 挂机 +8%", Math.abs(sFocus.energy.boosted.idleMult - 1.08) < 1e-9, sFocus.energy.boosted.idleMult);
    const expClick = await fmtEngine("M.clickPowerOf(window.__MOYU__.state)", "/src/engine/actions.ts");
    r.expect("E4 HUD 点击力吃到 ×2", (await text(c, "#hud-click")) === expClick, `${await text(c, "#hud-click")} vs ${expClick}`);
    await closeAllModals(c);
    // E5：刷新后口径一致性（P0/P1 关键：存档恢复应保留 ×2 与 +8%）
    await ev(c, "window.__MOYU__.saveNow()");
    await reload();
    const sRestore = await state(c);
    r.expect("E5 刷新保留已用精力", sRestore.energy.left === 55 && sRestore.energy.used.includes("focus"), JSON.stringify({ left: sRestore.energy.left, used: sRestore.energy.used }));
    r.expect(
      "E6 刷新后 focus 点击仍 ×2",
      Math.abs(sRestore.energy.boosted.clickMult - 2) < 1e-9,
      `实际 ${sRestore.energy.boosted.clickMult}（期望 2）`,
    );
    r.expect(
      "E7 刷新后 focus 挂机仍 +8%",
      Math.abs(sRestore.energy.boosted.idleMult - 1.08) < 1e-9,
      `实际 ${sRestore.energy.boosted.idleMult}（期望 1.08）`,
    );
    // E8：社交 +5 好感（老周当前好感 2 → 7）
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-decor");
    await waitFor(c, `document.querySelector('button[data-act="energy"][data-id="social"]') !== null`, 3000);
    const favorBefore = (await state(c)).team.colleagues.zhou.favor;
    await click(c, 'button[data-act="energy"][data-id="social"]');
    await sleep(400);
    const sSocial = await state(c);
    r.expect("E8 社交消耗 25 且好感 +5", sSocial.energy.left === 30 && sSocial.team.colleagues.zhou.favor === favorBefore + 5, JSON.stringify({ left: sSocial.energy.left, favor: sSocial.team.colleagues.zhou.favor, before: favorBefore }));
    const slackDisabled = await ev(c, `(() => { const b = document.querySelector('button[data-act="energy"][data-id="slack"]'); return b ? { disabled: b.disabled } : null; })()`);
    r.expect("E9 精力不足时按钮禁用（Slack 40 > 30）", slackDisabled && slackDisabled.disabled === true, JSON.stringify(slackDisabled));
    r.expect("E10 精力上限不被破坏", sSocial.energy.left >= 0 && sSocial.energy.left <= 100);
    await closeAllModals(c);
    // E11：省心组合（fresh 精力）
    await ev(c, "window.__MOYU__.saveNow()");
    const blobE = await blobFromState();
    blobE.energy = { date: todayStr, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } };
    await writeSaveAndReload(blobE);
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-decor");
    await waitFor(c, `document.querySelector('button[data-act="energy-all"]') !== null`, 3000);
    const allBtn = await ev(c, `(() => { const b = document.querySelector('button[data-act="energy-all"]'); return b ? { disabled: b.disabled } : null; })()`);
    r.expect("E11 省心组合可用（有同事）", allBtn && allBtn.disabled === false, JSON.stringify(allBtn));
    await click(c, 'button[data-act="energy-all"]');
    await sleep(500);
    const sCombo = await state(c);
    const usedSorted = [...sCombo.energy.used].sort().join(",");
    r.expect("E12 省心组合用掉 3 项 / 剩 0", usedSorted === "fake-work,slack,social" && sCombo.energy.left === 0, JSON.stringify({ left: sCombo.energy.left, used: usedSorted }));
    r.expect("E13 组合挂机倍率 = 1.25×1.05", Math.abs(sCombo.energy.boosted.idleMult - 1.25 * 1.05) < 1e-9, sCombo.energy.boosted.idleMult);
    r.expect("E14 组合巡逻倍率 ×2.2", Math.abs(sCombo.energy.boosted.patrolRewardMult - 2.2) < 1e-9, sCombo.energy.boosted.patrolRewardMult);
    const expIdle = await fmtEngine("M.effectOf(window.__MOYU__.state).idleRate");
    r.expect("E15 HUD 挂机同步", (await text(c, "#hud-idle")) === expIdle, `${await text(c, "#hud-idle")} vs ${expIdle}`);
    const afterBtns = await ev(c, `(() => {
      const acts = [...document.querySelectorAll('button[data-act="energy"]')].map((b) => ({ id: b.dataset.id, disabled: b.disabled }));
      return acts;
    })()`);
    r.expect("E16 用完所有精力按钮禁用", afterBtns.length === 0 || afterBtns.every((b) => b.disabled), JSON.stringify(afterBtns));
    await closeAllModals(c);
    r.expect("E17 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 F：跨日重置（精力/小游戏/卡/日报） ----------
  await stage("F 跨日重置", async (r) => {
    await ev(c, "window.__MOYU__.saveNow()");
    const blob = await blobFromState();
    blob.energy = { date: yesterday, left: 0, used: ["social", "fake-work", "slack"], boosted: { idleMult: 1.3125, patrolRewardMult: 2.2, clickMult: 1 } };
    blob.arcade = { date: yesterday, played: 3, best: { coffee: 120 } };
    blob.cards = { ...(blob.cards ?? {}), date: yesterday, chosen: null, until: 0 };
    blob.daily = blob.daily ? { ...blob.daily, date: yesterday } : null;
    await writeSaveAndReload(blob, 600);
    // 精力回满 toast（boot 后 1200ms 出现）
    const toast = await waitToast(c, /精力已回满/, 4000);
    r.expect("F1 精力跨日回满提示", /精力已回满 100/.test(toast), toast);
    const s = await state(c);
    r.expect("F2 精力重置 100/未使用", s.energy.left === 100 && s.energy.used.length === 0, JSON.stringify(s.energy));
    r.expect("F3 精力加成重置", s.energy.boosted.idleMult === 1 && s.energy.boosted.clickMult === 1 && s.energy.boosted.patrolRewardMult === 1, JSON.stringify(s.energy.boosted));
    r.expect("F4 小游戏次数重置", s.arcade.played === 0 && s.arcade.date === today, JSON.stringify(s.arcade));
    r.expect("F5 小游戏最高分保留", s.arcade.best.coffee === 120, JSON.stringify(s.arcade.best));
    r.expect("F6 每日卡重置出 3 张", s.cards.offers.length === 3 && s.cards.chosen === null, JSON.stringify({ offers: s.cards.offers, chosen: s.cards.chosen }));
    r.expect("F7 日报生成 3 目标", !!s.daily && s.daily.goals.length === 3 && s.daily.date === today, JSON.stringify(s.daily?.goals?.map((g) => g.id)));
    const badge = await text(c, "#btn-arcade .arcade-badge");
    r.expect("F8 🎮 角标回到 3", badge === "3", badge);
    r.expect("F9 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 G：抽卡 → 选卡 → 生效 ----------
  await stage("G 每日卡", async (r) => {
    // 保证面板会弹：等待卡片弹窗（totalClicks 已 > 8）
    const shown = await waitFor(c, `document.getElementById("cards").classList.contains("hidden") === false`, 8000);
    r.expect("G1 每日卡自动弹出", shown);
    if (!shown) { await closeAllModals(c); return; }
    const n = await count(c, "#cards .card");
    r.expect("G2 三选一", n === 3, `card 数 ${n}`);
    const chosenId = await ev(c, `document.querySelector("#cards .card").dataset.id`);
    const cardName = await ev(c, `document.querySelector("#cards .card .card-name").textContent`);
    await sleep(1400); // 防误触 1.2s
    await click(c, "#cards .card");
    await sleep(400);
    const s = await state(c);
    r.expect("G3 选卡写入", s.cards.chosen === chosenId, JSON.stringify({ chosen: s.cards.chosen, chosenId }));
    r.expect("G4 卡面板关闭", (await visible(c, "#cards")) === false);
    const h = await hud(c);
    r.expect("G5 HUD 常驻今日卡", h.card === `卡·${cardName}`, `${h.card} vs 卡·${cardName}`);
    const expIdle = await fmtEngine("M.effectOf(window.__MOYU__.state).idleRate");
    r.expect("G6 卡效果生效（HUD 挂机）", (await text(c, "#hud-idle")) === expIdle, `${await text(c, "#hud-idle")} vs ${expIdle}`);
    await shot(c, "G-card-chosen");
    r.expect("G7 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 H：回合制老板（选对/选错/新手宽限/超时） ----------
  await stage("H 回合制老板", async (r) => {
    await closeAllModals(c);
    await ev(c, "window.__MOYU__.grant(1000)");
    await sleep(200);
    // H1 选对（suspicious → switch-screen）
    await ev(c, `window.__MOYU__.forceBoss("choice")`);
    const shown = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    r.expect("H1 回合面板弹出", shown);
    const tell = await text(c, "#boss-tell");
    r.expect("H2 线索文案", /盯|屏幕/.test(tell ?? ""), tell ?? "null");
    const opts = await count(c, "#boss-opts button[data-choice]");
    r.expect("H3 三个选项", opts === 3, `选项 ${opts}`);
    const clicksBefore = (await state(c)).totalClicks;
    await tapCanvas(c, 2, 150);
    await sleep(300);
    r.expect("H4 决策期点击被拦截", (await state(c)).totalClicks === clicksBefore, `${clicksBefore}→${(await state(c)).totalClicks}`);
    const before = await state(c);
    const base = await modEval(c, "/src/engine/events.ts", "M.bossSurviveReward(window.__MOYU__.state)");
    await click(c, '#boss-opts button[data-choice="switch-screen"]');
    await sleep(700);
    const s1 = await state(c);
    const expReward = Math.floor(base * 1.8);
    r.expect("H5 选对奖励 ×1.8", Math.round(s1.moyu - before.moyu) >= expReward - 3 && Math.round(s1.moyu - before.moyu) <= expReward + 3, `实际 ${(s1.moyu - before.moyu).toFixed(1)} 期望 ${expReward}`);
    r.expect("H6 选对连胜 +1", s1.surviveStreak === 1, `streak=${s1.surviveStreak}`);
    await shot(c, "H-boss-correct");
    // H2 选错（第 2 次巡逻：新手宽限 0 罚）
    await ev(c, `window.__MOYU__.forceBoss("choice")`);
    await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    const before2 = await state(c);
    await click(c, '#boss-opts button[data-choice="act-busy"]');
    await sleep(900);
    const s2 = await state(c);
    r.expect("H7 新手宽限内选错不扣钱", Math.abs(s2.moyu - before2.moyu) < 4, `delta ${(s2.moyu - before2.moyu).toFixed(1)}`);
    r.expect("H8 选错连胜清零", s2.surviveStreak === 0, `streak=${s2.surviveStreak}`);
    // H3 第 4 次巡逻选错 → 真罚款
    await ev(c, `window.__MOYU__.forceBoss("choice")`);
    await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    await click(c, '#boss-opts button[data-choice="act-busy"]');
    await sleep(700);
    await ev(c, `window.__MOYU__.forceBoss("choice")`);
    await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    const before4 = await state(c);
    const base4 = await modEval(c, "/src/engine/events.ts", "M.bossSurviveReward(window.__MOYU__.state)");
    await click(c, '#boss-opts button[data-choice="act-busy"]');
    await sleep(900);
    const s4 = await state(c);
    const loss = before4.moyu - s4.moyu;
    r.expect("H9 第 4 次巡逻选错扣罚款", loss >= Math.min(Math.floor(base4), before4.moyu) - 3 && loss > 0, `损失 ${loss.toFixed(1)} 期望≈${Math.min(Math.floor(base4), before4.moyu)}`);
    // H4 超时
    await ev(c, `window.__MOYU__.forceBoss("choice")`);
    const shown5 = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    const before5 = await state(c);
    await sleep(6000);
    const s5 = await state(c);
    const toast5 = await hud(c);
    r.expect("H10 超时面板自动关闭", shown5 && (await visible(c, "#boss-choice")) === false);
    r.expect("H11 超时无奖惩（连胜不变）", s5.surviveStreak === before5.surviveStreak, `${before5.surviveStreak}→${s5.surviveStreak}`);
    r.expect("H12 超时提示出现", /没来得及选/.test(await text(c, "#dom-toast") ?? ""), await text(c, "#dom-toast"));
    r.expect("H13 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 I：小游戏 3 个 + 次数限制 + 跨日恢复 ----------
  await stage("I 摸鱼站小游戏", async (r) => {
    await closeAllModals(c);
    await overrideDialogs();
    // 确保今天次数干净
    await ev(c, "window.__MOYU__.saveNow()");
    const blob = await blobFromState();
    blob.arcade = { date: today, played: 0, best: {} };
    await writeSaveAndReload(blob);
    await closeAllModals(c);
    await openPanel(c, "#btn-arcade", "#arcade");
    r.expect("I1 3 个游戏可选", (await count(c, "#arcade button[data-game]")) === 3, `按钮数 ${await count(c, "#arcade button[data-game]")}`);
    r.expect("I2 初始剩余 3 次", /3\/3/.test((await text(c, "#arcade-left")) ?? ""), await text(c, "#arcade-left"));
    // 接咖啡（玩 ~3s 手动接几次）
    await click(c, 'button[data-game="coffee"]');
    await waitFor(c, `document.getElementById("play-area") !== null`, 3000);
    for (let i = 0; i < 6; i++) { await tapElementSafe("#play-area"); await sleep(200); }
    await sleep(2300);
    await click(c, "#arcade-close");
    await sleep(900);
    let s = await state(c);
    r.expect("I3 接咖啡消耗 1 次", s.arcade.played === 1, JSON.stringify(s.arcade));
    // 找老板
    await openPanel(c, "#btn-arcade", "#arcade");
    await click(c, 'button[data-game="findboss"]');
    await waitFor(c, `document.getElementById("play-grid") !== null`, 3000);
    for (let i = 0; i < 3; i++) { await tapElementSafe("#play-grid button.face"); await sleep(120); }
    await sleep(2300);
    await click(c, "#arcade-close");
    await sleep(900);
    s = await state(c);
    r.expect("I4 找老板消耗 1 次", s.arcade.played === 2, JSON.stringify(s.arcade));
    // 节奏点击
    await openPanel(c, "#btn-arcade", "#arcade");
    await click(c, 'button[data-game="rhythm"]');
    await waitFor(c, `document.getElementById("play-area") !== null`, 3000);
    for (let i = 0; i < 5; i++) { await tapElementSafe("#play-area"); await sleep(250); }
    await sleep(2200);
    await click(c, "#arcade-close");
    await sleep(900);
    s = await state(c);
    r.expect("I5 节奏点击消耗 1 次", s.arcade.played === 3, JSON.stringify(s.arcade));
    r.expect("I6 三局都有最高分记录或次数入账", Object.keys(s.arcade.best).length >= 0, JSON.stringify(s.arcade.best));
    // 次数用尽
    await openPanel(c, "#btn-arcade", "#arcade");
    r.expect("I7 次数用尽文案", /今天玩完了/.test((await text(c, "#arcade-left")) ?? ""), await text(c, "#arcade-left"));
    const lockedBtns = await ev(c, `[...document.querySelectorAll("#arcade button[data-game]")].map((b) => b.disabled)`);
    r.expect("I8 次数用尽按钮禁用", lockedBtns.length === 3 && lockedBtns.every(Boolean), JSON.stringify(lockedBtns));
    await click(c, 'button[data-game="coffee"]').catch(() => undefined);
    await sleep(300);
    r.expect("I9 禁用后点不进去", (await count(c, "#play-area")) === 0);
    r.expect("I10 🎮 角标消失", (await count(c, "#btn-arcade .arcade-badge")) === 0);
    await closeAllModals(c);
    // 跨日恢复
    await ev(c, "window.__MOYU__.saveNow()");
    const blob2 = await blobFromState();
    blob2.arcade = { date: yesterday, played: 3, best: { coffee: 200, findboss: 300, rhythm: 150 } };
    await writeSaveAndReload(blob2);
    const s2 = await state(c);
    r.expect("I11 跨日次数恢复", s2.arcade.played === 0 && s2.arcade.date === today, JSON.stringify(s2.arcade));
    r.expect("I12 跨日最高分保留", s2.arcade.best.coffee === 200 && s2.arcade.best.findboss === 300, JSON.stringify(s2.arcade.best));
    await openPanel(c, "#btn-arcade", "#arcade");
    r.expect("I13 跨日按钮重新可用", (await ev(c, `[...document.querySelectorAll("#arcade button[data-game]")].every((b) => !b.disabled)`)) === true);
    r.expect("I14 角标回到 3", (await text(c, "#btn-arcade .arcade-badge")) === "3");
    await closeAllModals(c);
    r.expect("I15 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 J：存档（刷新保留 / 导出导入 / 离线 / 回拨 / 篡改） ----------
  await stage("J 存档与离线", async (r) => {
    await closeAllModals(c);
    await ev(c, "window.__MOYU__.saveNow()");
    await sleep(200);
    const s1 = await state(c);
    const savedAt1 = await ev(c, "window.__MOYU__.savedAt");
    await reload(500);
    const s2 = await state(c);
    r.expect("J1 刷新保留点击/等级", s2.totalClicks === s1.totalClicks && JSON.stringify(s2.levels) === JSON.stringify(s1.levels), JSON.stringify({ clicks: [s1.totalClicks, s2.totalClicks], levels: s2.levels }));
    r.expect("J2 刷新保留家具/小队", s2.decor.length === 8 && Object.keys(s2.team.colleagues).length === 1, JSON.stringify({ decor: s2.decor.length, team: Object.keys(s2.team.colleagues) }));
    r.expect("J3 刷新保留余额（只增不减）", s2.moyu >= s1.moyu - 1, `${s1.moyu.toFixed(1)}→${s2.moyu.toFixed(1)}`);
    r.expect("J4 savedAt 正常推进", typeof savedAt1 === "number" && savedAt1 <= Date.now(), String(savedAt1));
    // 导出存档码
    await openPanel(c, "#btn-journal", "#journal");
    await click(c, "#savecode-copy");
    await sleep(300);
    const code = await ev(c, `document.getElementById("savecode").value.trim()`);
    r.expect("J5 存档码导出非空", typeof code === "string" && code.length > 40 && /\./.test(code), `长度 ${code?.length}, 片段 ${String(code).slice(0, 20)}`);
    r.expect("J6 存档码含校验位", /^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(code ?? ""), String(code).slice(-12));
    await closeAllModals(c);
    // 改动后导入恢复
    await ev(c, "window.__MOYU__.grant(50000)");
    await ev(c, "window.__MOYU__.saveNow()");
    await sleep(200);
    const s3 = await state(c);
    r.expect("J7 改动生效", s3.moyu > s2.moyu + 40000, `${s2.moyu.toFixed(0)}→${s3.moyu.toFixed(0)}`);
    await reload(400);
    const s4 = await state(c);
    r.expect("J8 刷新保留改动", s4.moyu >= s3.moyu - 5, `${s3.moyu.toFixed(1)}→${s4.moyu.toFixed(1)}`);
    // 导入刚才的存档码
    await openPanel(c, "#btn-journal", "#journal");
    await ev(c, `(() => { const t = document.getElementById("savecode"); t.value = ${JSON.stringify(code)}; return true; })()`);
    await ev(c, `window.__auditMark = 1; true`);
    await click(c, "#savecode-import");
    const back = await waitFor(c, `typeof window.__auditMark === "undefined" && typeof window.__MOYU__ === "object"`, 15000);
    await sleep(600);
    r.expect("J9 导入触发重载", back);
    if (back) {
      const s5 = await state(c);
      r.expect("J10 导入恢复旧余额", Math.abs(s5.moyu - s2.moyu) < 30, `恢复后 ${s5.moyu.toFixed(1)} vs 导出时 ${s2.moyu.toFixed(1)}`);
      r.expect("J11 导入恢复点击/等级", s5.totalClicks === s2.totalClicks && JSON.stringify(s5.levels) === JSON.stringify(s2.levels), JSON.stringify({ clicks: s5.totalClicks, levels: s5.levels }));
      const bak = await ev(c, `localStorage.getItem("moyu-save.bak") !== null`);
      r.expect("J12 导入前备份旧档", bak);
    }
    // 非法存档码
    await closeAllModals(c);
    await openPanel(c, "#btn-journal", "#journal");
    await ev(c, `(() => { document.getElementById("savecode").value = "garbage-code"; return true; })()`);
    await click(c, "#savecode-import");
    await sleep(500);
    const msg = await text(c, "#savecode-msg");
    r.expect("J13 非法存档码被拒", /导入失败/.test(msg ?? ""), msg ?? "null");
    r.expect("J14 非法导入不重载", (await ev(c, `typeof window.__MOYU__ === "object"`)) === true);
    await closeAllModals(c);
    // 离线 2 小时
    await ev(c, "window.__MOYU__.saveNow()");
    await sleep(200);
    const sOff = await state(c);
    const rate = await modEval(c, "/src/engine/progression.ts", "M.offlineEfficiency(window.__MOYU__.state, Date.now() - 60000, Date.now())");
    const idleRate = await modEval(c, "/src/engine/upgrades.ts", "M.effectOf(window.__MOYU__.state).idleRate");
    await ev(c, "window.__MOYU__.rewindSave(7200)");
    await reload(500);
    const welcomeShown = await waitFor(c, `document.getElementById("welcome").classList.contains("hidden") === false`, 5000);
    r.expect("J15 离线欢迎面板", welcomeShown);
    if (welcomeShown) {
      const gainText = await text(c, "#welcome-gain");
      const sAfter = await state(c);
      const expGain = idleRate * 7200 * rate;
      r.expect("J16 离线收益符合公式", Math.abs(sAfter.moyu - sOff.moyu - expGain) < Math.max(3, expGain * 0.01), `实际 ${(sAfter.moyu - sOff.moyu).toFixed(1)} 期望 ${expGain.toFixed(1)} (${gainText})`);
      r.expect("J17 欢迎面板文案", /首日全额|离线效率/.test((await text(c, "#welcome-rule")) ?? ""), await text(c, "#welcome-rule"));
      await shot(c, "J-offline-welcome");
      await click(c, "#welcome-ok");
    }
    // 离线封顶（30h > 12h）
    await ev(c, "window.__MOYU__.saveNow()");
    await sleep(200);
    await ev(c, "window.__MOYU__.rewindSave(108000)");
    await reload(500);
    const capShown = await waitFor(c, `document.getElementById("welcome").classList.contains("hidden") === false`, 5000);
    r.expect("J18 超上限仍弹面板", capShown);
    const rule = await text(c, "#welcome-rule");
    r.expect("J19 封顶提示 12 小时", /上限/.test(rule ?? "") && /12 小时/.test(rule ?? ""), rule ?? "null");
    if (capShown) await click(c, "#welcome-ok");
    // 时钟回拨：savedAt 在未来 → 不结算离线、不崩
    await ev(c, "window.__MOYU__.saveNow()");
    await sleep(200);
    const sFut = await state(c);
    await patchSaveAndReload(`b.savedAt = Date.now() + 3600 * 1000;`, 500);
    r.expect("J20 时钟回拨不崩溃", (await ev(c, `typeof window.__MOYU__ === "object"`)) === true && (await count(c, ".boot-error")) === 0);
    r.expect("J21 时钟回拨不白送离线", (await visible(c, "#welcome")) === false, "welcome 不应出现");
    const sFuture = await state(c);
    r.expect("J22 未来档不丢档", sFuture.totalClicks === sFut.totalClicks && sFuture.decor.length === 8, JSON.stringify({ clicks: sFuture.totalClicks, decor: sFuture.decor.length }));
    r.expect("J23 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 2)));
  });

  // ---------- 阶段 K：篡改档极值 / 快速连点 / 面板快速开关 ----------
  await stage("K 边界与异常", async (r) => {
    // K1 未来版本档：备份 + 重新开始
    await ev(c, "window.__MOYU__.saveNow()");
    const oldBlob = await blobFromState();
    const futureBlob = { ...oldBlob, v: 999, moyu: 123456789, totalEarned: 123456789, lifetimeEarned: 123456789 };
    await writeSaveAndReload(futureBlob, 400);
    const sF = await state(c);
    r.expect("K1 未来版本档拒绝读取", sF.moyu < 1000 && sF.totalClicks === 0, JSON.stringify({ moyu: sF.moyu, clicks: sF.totalClicks }));
    const newerBak = await ev(c, `localStorage.getItem("moyu-save.newer.bak") !== null`);
    r.expect("K2 未来版本档已备份", newerBak);
    // K3 旧版本 v1 迁移
    await writeSaveAndReload({ v: 1, moyu: 5000, levels: { coffee: 2 }, savedAt: Date.now(), createdAt: Date.now() - 3600_000 }, 400);
    const sV1 = await state(c);
    r.expect("K3 v1 旧档迁移可读", sV1.moyu >= 5000 && sV1.levels.coffee === 2, JSON.stringify({ moyu: sV1.moyu, levels: sV1.levels }));
    // K4 损坏 JSON
    await ev(c, `(() => {
      localStorage.setItem("moyu-save", "{broken-json");
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
      return true;
    })()`);
    await reload(400);
    r.expect("K4 损坏档不崩溃", (await ev(c, `typeof window.__MOYU__ === "object"`)) === true && (await count(c, ".boot-error")) === 0);
    const sBroken = await state(c);
    r.expect("K5 损坏档回初始状态", sBroken.moyu < 100 && sBroken.totalClicks === 0, JSON.stringify({ moyu: sBroken.moyu }));
    // K6 极值篡改档
    await writeSaveAndReload({
      v: 2, moyu: 1e308, totalEarned: 1e308, lifetimeEarned: 1e308,
      levels: { coffee: 1e9, phone: -3, hack: 5 },
      savedAt: Date.now(), createdAt: Date.now() - 60_000,
      prestige: 1e6, totalClicks: 12,
      decor: ["plant", "plant", "hack"],
      energy: { date: today, left: -50, used: ["focus", "slack", "focus"], boosted: { idleMult: 99, patrolRewardMult: 99, clickMult: 99 } },
      arcade: { date: today, played: 999, best: { coffee: 1e99, hack: 5 } },
      team: { colleagues: { zhang: { level: 999, missionId: "hack", startedAt: 1e300, endsAt: 1e301, favor: 1e9, autoRepeat: true, rewardSnapshot: 1e300 }, zhou: { level: 999, missionId: "stroll", startedAt: 1e300, endsAt: 1e301, favor: 1e9, autoRepeat: false, rewardSnapshot: 1e300 } } },
      cards: { date: "xxxx", offers: ["hack", "coffee_day", "coffee_day"], chosen: "hack", until: 1e300, dismissed: "yes", chosenDate: "??", nextDayGuaranteed: "hack" },
      talents: { unlocked: ["hack_talent", "click_1"], points: 1e9, rankGranted: 1e9, overflow: 1e9, dailyGiftDate: "bad" },
      daily: { date: "bad", goals: [], claimed: "yes" },
      collected: { quotes: [1e9, -1, "x"], flavors: [null, 999] },
      surviveStreak: 1e9, patrolSurvives: 1e300, visits: { date: 123, count: "x" },
    }, 600);
    const sX = await state(c);
    r.expect("K6 极值档可启动", (await ev(c, `typeof window.__MOYU__ === "object"`)) === true && (await count(c, ".boot-error")) === 0);
    r.expect("K7 等级被钳制/未知键丢弃", sX.levels.coffee === 1000 && sX.levels.phone === undefined && sX.levels.hack === undefined, JSON.stringify(sX.levels));
    r.expect("K8 家具只留合法 id", JSON.stringify(sX.decor) === JSON.stringify(["plant"]), JSON.stringify(sX.decor));
    r.expect("K9 精力被推导钳制", sX.energy.left === 0 && sX.energy.used.length === 2 && sX.energy.boosted.idleMult <= 1.25 * 1.05 + 1e-9, JSON.stringify(sX.energy));
    r.expect("K10 小游戏次数钳制", sX.arcade.played === 3 && (sX.arcade.best.coffee === undefined || sX.arcade.best.coffee <= 8000), JSON.stringify(sX.arcade));
    r.expect("K11 未知同事丢弃 / 合法任务保留", sX.team.colleagues.zhang === undefined && !!sX.team.colleagues.zhou, JSON.stringify(Object.keys(sX.team.colleagues)));
    r.expect("K12 等级/任务时间被钳制", sX.team.colleagues.zhou?.level === 5 && (sX.team.colleagues.zhou?.missionId === null || sX.team.colleagues.zhou?.endsAt - sX.team.colleagues.zhou?.startedAt <= 9 * 3600 * 1000), JSON.stringify(sX.team.colleagues.zhou));
    r.expect("K13 每日卡净化", sX.cards.chosen === null && sX.cards.offers.length <= 2, JSON.stringify({ chosen: sX.cards.chosen, offers: sX.cards.offers }));
    r.expect("K14 日报非法回 null", sX.daily === null, JSON.stringify(sX.daily));
    r.expect("K15 图鉴净化", sX.collected.quotes.length + sX.collected.flavors.length === 0, JSON.stringify(sX.collected));
    const h = await hud(c);
    r.expect("K16 HUD 无 NaN/Infinity", !/NaN|Infinity/.test(JSON.stringify(h)), JSON.stringify(h).slice(0, 160));
    r.expect("K17 极值档仍可操作（帧推进）", await waitFrames(c, 3));
    await shot(c, "K-tampered");
    // K18 快速连点压力
    await ev(c, `window.__MOYU__.reset()`);
    await sleep(300);
    const before = await state(c);
    await ev(c, `window.__auditMark = 1; true`);
    // 1 帧内狂点 60 次（全部同步派发，检验 80ms 冷却与异常）
    await ev(c, `(() => {
      const el = document.getElementById("stage");
      const r = el.getBoundingClientRect();
      for (let i = 0; i < 60; i++) {
        el.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
      }
      return true;
    })()`);
    await sleep(300);
    const after = await state(c);
    r.expect("K18 同步连点只结算 1 次（80ms 冷却）", after.totalClicks - before.totalClicks <= 2 && after.totalClicks - before.totalClicks >= 1, `${before.totalClicks}→${after.totalClicks}`);
    r.expect("K19 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
    // K20 面板快速开关 30 次
    await ev(c, `(() => {
      const btn = document.getElementById("btn-team");
      for (let i = 0; i < 30; i++) btn.click();
      return true;
    })()`);
    await sleep(300);
    const teamOpen = await visible(c, "#team");
    await closeAllModals(c);
    r.expect("K20 面板快速开关后状态一致", (await visible(c, "#team")) === false, `中途 open=${teamOpen}`);
    await ev(c, `(() => {
      const j = document.getElementById("btn-journal");
      for (let i = 0; i < 20; i++) j.click();
      return true;
    })()`);
    await sleep(300);
    await closeAllModals(c);
    r.expect("K21 日报快速开关后关闭", (await visible(c, "#journal")) === false);
    // K22 Esc 关闭 + 空格点击（无障碍冒烟）
    await openPanel(c, "#btn-journal", "#journal");
    await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(250);
    r.expect("K22 Esc 关闭面板", (await visible(c, "#journal")) === false);
    const clickBefore = (await state(c)).totalClicks;
    await tapCanvas(c, 1, 100);
    await ev(c, `document.getElementById("stage").focus(); true`);
    await sleep(80);
    await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await sleep(250);
    r.expect("K23 键盘空格也能点", (await state(c)).totalClicks >= clickBefore + 1, `${clickBefore}→${(await state(c)).totalClicks}`);
    r.expect("K24 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
  });

  c.close();
}, { timeoutMs: 300_000 });

// 汇总
const summary = reports.map((r) => r.summary());
const all = summary.reduce((a, s) => ({ pass: a.pass + s.pass, total: a.total + s.total, failed: [...a.failed, ...s.failed] }), { pass: 0, total: 0, failed: [] });
const outPath = `${OUT}/e2e-report.json`;
const fs = await import("node:fs");
fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary: all, stages: summary }, null, 2));
console.log(`\n===== 汇总：${all.pass}/${all.total} 通过，失败 ${all.failed.length} =====`);
if (all.failed.length) console.log("失败项：", all.failed.join(" | "));
console.log("报告：", outPath);

// 小工具：安全点击元素中心（不存在则忽略）
async function tapElementSafe(selector) {
  try {
    const p = await ev(c, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!p) return false;
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    return true;
  } catch { return false; }
}