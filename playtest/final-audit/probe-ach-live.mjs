// v0.6.0 终验：成就墙 live 验证（UI 渲染/加成真生效/永久性/存档净化/转生保留/重复发放）
import { runChrome, connect } from "../lib/chrome.mjs";
import {
  DEV, sleep, setViewport, goto, ev, click, count, text, visible, state, waitFor,
  Report, hud, closeAllModals, openPanel, modEval, waitFrames,
} from "./lib.mjs";

const OUT = process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out";
const today = new Date().toLocaleDateString("sv-SE");
const rep = new Report("成就墙 live");
let c = null;

async function boot() {
  await goto(c, DEV, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 25000);
  await ev(c, `window.confirm = () => true; window.alert = () => {}; true`);
  await sleep(450);
}
async function reload(ms = 500) {
  await c.send("Page.reload", {});
  const ok = await waitFor(c, `typeof window.__MOYU__ === "object" && document.readyState === "complete"`, 20000);
  if (!ok) throw new Error("reload 未就绪");
  await ev(c, `window.confirm = () => true; true`);
  await sleep(ms);
}
async function blobFromState() {
  const s = await state(c);
  const savedAt = await ev(c, `window.__MOYU__.savedAt`);
  return {
    v: 2, moyu: s.moyu, totalEarned: s.totalEarned, levels: s.levels,
    savedAt: savedAt ?? Date.now(), createdAt: Date.now() - 60000,
    collected: s.collected, daily: s.daily, surviveStreak: s.surviveStreak,
    patrolSurvives: s.patrolSurvives, cards: s.cards, decor: s.decor, energy: s.energy,
    arcade: s.arcade, totalClicks: s.totalClicks, visits: s.visits,
    lifetimeEarned: s.lifetimeEarned, prestige: s.prestige, team: s.team, talents: s.talents,
    bestIdleRate: s.bestIdleRate, rankIndex: s.rankIndex, cardsChosenTotal: s.cardsChosenTotal, bestSurviveStreak: s.bestSurviveStreak,
  };
}
async function writeSaveAndReload(blob, ms = 500) {
  await ev(c, `(() => {
    localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(blob))});
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return real.call(this, k, v); };
    return true;
  })()`);
  await reload(ms);
}
/** 引擎侧一次性求值（返回 {achPoints, achDoneIds, idleMult, clickMult, offlineBonus, idleRate, clickPower}） */
async function engineAch() {
  return ev(c, `(async () => {
    const A = await import("/src/engine/achievements.ts");
    const U = await import("/src/engine/upgrades.ts");
    const AC = await import("/src/engine/actions.ts");
    const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const e = A.achEffects(s);
    return {
      points: A.achPoints(s),
      done: A.ACHIEVEMENTS.filter((a) => a.progress(s) >= a.target).map((a) => a.id),
      idleMult: e.idleMult, clickMult: e.clickMult, offlineBonus: e.offlineBonus,
      idleRate: U.effectOf(s).idleRate, clickPower: AC.clickPowerOf(s),
      bestIdleRate: s.bestIdleRate, rankIndex: s.rankIndex, cardsChosenTotal: s.cardsChosenTotal, bestSurviveStreak: s.bestSurviveStreak, bestSurviveStreak: s.bestSurviveStreak,
    };
  })()`);
}
/** 页面内算 HUD 挂机期望（含成就加成） */
async function hudExpectedIdle() {
  return ev(c, `(async () => {
    const U = await import("/src/engine/upgrades.ts");
    const F = await import("/src/engine/format.ts");
    return F.formatMoyu(U.effectOf(window.__MOYU__.state).idleRate);
  })()`);
}
async function journalAchSummary() {
  return ev(c, `({
    summary: document.getElementById("ach-summary")?.textContent ?? null,
    items: document.querySelectorAll("#ach-list .ach-item").length,
    cats: [...document.querySelectorAll("#ach-categories .ach-cat")].map((x) => x.textContent),
    doneItems: document.querySelectorAll("#ach-list .ach-item.done").length,
  })`);
}

await runChrome(async ({ port }) => {
  c = await connect(port);
  await setViewport(c, { width: 1100, height: 800 });
  try {
    await boot();
    await closeAllModals(c);

    // ============ A. 新号成就墙 UI ============
    await openPanel(c, "#btn-journal", "#journal");
    await sleep(400);
    let ui = await journalAchSummary();
    rep.expect("A1 成就墙 22 条", ui.items === 22, JSON.stringify({ items: ui.items }));
    rep.expect("A2 分类 10 个且合计=22", ui.cats.length === 10 && ui.cats.reduce((n, s) => { const m = /(\d+)\/(\d+)/.exec(s); return n + (m ? Number(m[2]) : 0); }, 0) === 22, JSON.stringify(ui.cats));
    rep.expect("A3 新号汇总 0/22 · Lv.1", /0\/22/.test(ui.summary ?? "") && /Lv\.1/.test(ui.summary ?? ""), ui.summary);
    const eng0 = await engineAch();
    rep.expect("A4 UI 完成数与引擎一致", ui.doneItems === eng0.points && /(\d+)\/22/.test(ui.summary ?? "") && Number(/(\d+)\/22/.exec(ui.summary)[1]) === eng0.points, `${ui.summary} vs engine ${eng0.points}`);
    rep.expect("A5 新号加成中性", eng0.idleMult === 1 && eng0.clickMult === 1 && eng0.offlineBonus === 0, JSON.stringify({ idle: eng0.idleMult, click: eng0.clickMult, off: eng0.offlineBonus }));
    await closeAllModals(c);

    // ============ B. 挂机/点击成就：真生效 + UI 同步 ============
    await ev(c, "window.__MOYU__.saveNow()");
    const b0 = await blobFromState();
    b0.decor = ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"];
    b0.levels = { phone: 5 };
    b0.bestIdleRate = 0;
    await writeSaveAndReload(b0);
    const engB = await engineAch();
    const hudIdleB = await text(c, "#hud-idle");
    const expectIdleB = await hudExpectedIdle();
    rep.expect("B1 家具成就达成（decor_3/decor_8）", engB.done.includes("decor_3") && engB.done.includes("decor_8"), JSON.stringify(engB.done));
    rep.expect("B2 挂机加成生效（idleMult > 1）", engB.idleMult > 1.05, String(engB.idleMult));
    rep.expect("B3 HUD 挂机 = 引擎含成就值", hudIdleB === expectIdleB, `${hudIdleB} vs ${expectIdleB}`);
    await openPanel(c, "#btn-journal", "#journal");
    await sleep(400);
    const uiB = await journalAchSummary();
    rep.expect("B4 成就墙完成数 = 引擎", uiB.doneItems === engB.points, `${uiB.doneItems} vs ${engB.points}（${uiB.summary}）`);
    rep.expect("B5 工位分类 2/2 标绿", uiB.cats.some((x) => /工位 2\/2/.test(x)), JSON.stringify(uiB.cats));
    // B6：成就等级加成（4 条完成 → Lv.2 → 额外 +2% 挂机）
    await ev(c, "window.__MOYU__.saveNow()");
    const b2 = await blobFromState();
    b2.totalClicks = 100_000; // 点击 3 条 + 挂机 1 条 = 4 点 → Lv.2（等级 +2%）
    b2.bestIdleRate = 1_000;
    b2.bestSurviveStreak = 0;
    b2.decor = [];
    b2.levels = {};
    b2.collected = { quotes: [], flavors: [] };
    b2.team = { colleagues: {} };
    b2.talents = { ...(b2.talents ?? {}), unlocked: [], points: 0 };
    b2.cardsChosenTotal = 0;
    b2.surviveStreak = 0;
    b2.rankIndex = 1;
    b2.arcade = { ...(b2.arcade ?? {}), best: {} };
    await writeSaveAndReload(b2);
    const engB2 = await engineAch();
    const lvExpected = await ev(c, `(async () => {
      const A = await import("/src/engine/achievements.ts");
      const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
      const done = A.ACHIEVEMENTS.filter((a) => a.progress(s) >= a.target);
      const points = done.length;
      const level = Math.floor(points / 4) + 1;
      let idle = 1 + 0.02 * (level - 1);
      for (const a of done) idle *= 1 + (a.reward?.idleBonus ?? 0);
      return { points, level, idle };
    })()`);
    rep.expect("B6 成就等级每级 +2% 挂机（live）", lvExpected.points >= 4 && Math.abs(engB2.idleMult - lvExpected.idle) < 1e-9, `points=${lvExpected.points} lv=${lvExpected.level} idleMult=${engB2.idleMult.toFixed(6)} 期望 ${lvExpected.idle.toFixed(6)}`);
    await closeAllModals(c);

    // ============ C. 点击成就加成重复接入检测（升级点击力被平方） ============
    await ev(c, "window.__MOYU__.saveNow()");
    const cb = await blobFromState();
    cb.levels = { water: 10 };
    cb.totalClicks = 1000;
    cb.decor = [];
    cb.bestIdleRate = 0;
    cb.cardChosen = null;
    await writeSaveAndReload(cb);
    const engC = await engineAch();
    const collBonus = await ev(c, `(async () => { const U = await import("/src/engine/upgrades.ts"); return U.collectionBonus(window.__MOYU__.state); })()`);
    const expectedSingle = (1 + 20 * collBonus) * engC.clickMult;
    rep.expect("C1 点击成就倍率 = 1.02", Math.abs(engC.clickMult - 1.02) < 1e-9, String(engC.clickMult));
    rep.expect("C2 点击加成只计一次", Math.abs(engC.clickPower - expectedSingle) < 1e-6, `实际 ${engC.clickPower.toFixed(4)}，单次接入应为 ${expectedSingle.toFixed(4)}（图鉴×${collBonus.toFixed(2)}）`);

    // ============ D. 老板成就永久性（被抓后是否丢失） ============
    await ev(c, "window.__MOYU__.saveNow()");
    const d0 = await blobFromState();
    d0.surviveStreak = 10;
    d0.bestSurviveStreak = 0; // 旧档只有当前连胜 → 主循环应把历史最高补上
    d0.decor = [];
    d0.levels = { phone: 5 };
    d0.bestIdleRate = 0;
    await writeSaveAndReload(d0, 800);
    const engD1 = await engineAch();
    const hudD1 = await text(c, "#hud-idle");
    d0.surviveStreak = 0;
    d0.bestSurviveStreak = engD1.bestSurviveStreak; // 模拟被抓一次（历史最高保留）
    await writeSaveAndReload(d0);
    const engD2 = await engineAch();
    const hudD2 = await text(c, "#hud-idle");
    rep.expect("D1 连胜 10 时 boss_3/boss_10 达成", engD1.done.includes("boss_3") && engD1.done.includes("boss_10"), JSON.stringify(engD1.done));
    rep.expect("D2 游戏把当前连胜写入历史最高", engD1.bestSurviveStreak === 10, String(engD1.bestSurviveStreak));
    rep.expect("D3 被老板抓后 boss 成就仍保持（永久）", engD2.done.includes("boss_10") && engD2.done.includes("boss_3"), `被抓后 done=${JSON.stringify(engD2.done)}；HUD 挂机 ${hudD1}→${hudD2}`);

    // ============ E. 天赋成就永久性（重置天赋后是否丢失） ============
    await ev(c, "window.__MOYU__.saveNow()");
    const e0 = await blobFromState();
    e0.talents = { ...(e0.talents ?? {}), unlocked: ["click_1", "idle_1", "click_2", "idle_2", "click_3", "idle_3"], points: 0, rankGranted: -1, overflow: 0, dailyGiftDate: "" };
    await writeSaveAndReload(e0);
    const engE1 = await engineAch();
    await openPanel(c, "#btn-team", "#team");
    await click(c, "#tab-talents");
    await waitFor(c, `document.querySelector('button[data-act="reset-talents"]') !== null`, 4000);
    await click(c, 'button[data-act="reset-talents"]');
    await sleep(500);
    const engE2 = await engineAch();
    await closeAllModals(c);
    rep.expect("E1 6 天赋时 talent_6 达成", engE1.done.includes("talent_6"), JSON.stringify(engE1.done));
    rep.expect("E2 重置天赋后 talent_6 仍应保持（永久）", engE2.done.includes("talent_6"), `重置后 done=${JSON.stringify(engE2.done)}；idleMult ${engE1.idleMult.toFixed(4)}→${engE2.idleMult.toFixed(4)}`);

    // ============ F. 存档净化（负数/极值/空值） ============
    await ev(c, "window.__MOYU__.saveNow()");
    const fBad = await blobFromState();
    fBad.bestIdleRate = -5; fBad.rankIndex = -3; fBad.cardsChosenTotal = -1;
    await writeSaveAndReload(fBad);
    const sBad = await state(c);
    const sanBad = await ev(c, `(async () => {
      const S = await import("/src/engine/save.ts");
      let raw = JSON.stringify({ v: 2, moyu: 10, totalEarned: 10, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 1000, bestIdleRate: -5, rankIndex: -3, cardsChosenTotal: -1 });
      const ad = { getItem: () => raw, setItem: (_k, v) => { raw = v; }, removeItem: () => { raw = ""; } };
      const st = S.restore(ad, Date.now()).state;
      return { b: st.bestIdleRate, r: st.rankIndex, c: st.cardsChosenTotal };
    })()`);
    rep.expect("F1 负数净化 → 0", sanBad.b === 0 && sanBad.r === 0 && sanBad.c === 0, JSON.stringify(sanBad));
    rep.expect("F1b 实机负值 bestIdleRate 被游戏立刻上调为合法值（无负值残留）", Number.isFinite(sBad.bestIdleRate) && sBad.bestIdleRate >= 0 && sBad.rankIndex === 1 && sBad.cardsChosenTotal === 0, JSON.stringify({ b: sBad.bestIdleRate, r: sBad.rankIndex, c: sBad.cardsChosenTotal }));
    await ev(c, "window.__MOYU__.saveNow()");
    const fNull = await blobFromState();
    fNull.bestIdleRate = null; fNull.rankIndex = "x"; fNull.cardsChosenTotal = null;
    await writeSaveAndReload(fNull);
    const sNull = await state(c);
    const sanNull = await ev(c, `(async () => {
      const S = await import("/src/engine/save.ts");
      let raw = JSON.stringify({ v: 2, moyu: 10, totalEarned: 10, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 1000, bestIdleRate: null, rankIndex: "x", cardsChosenTotal: null });
      const ad = { getItem: () => raw, setItem: (_k, v) => { raw = v; }, removeItem: () => { raw = ""; } };
      const st = S.restore(ad, Date.now()).state;
      return { b: st.bestIdleRate, r: st.rankIndex, c: st.cardsChosenTotal };
    })()`);
    rep.expect("F2 非法类型净化 → 0", sanNull.b === 0 && sanNull.r === 0 && sanNull.c === 0, JSON.stringify(sanNull));
    rep.expect("F2b 实机非法类型不残留", Number.isFinite(sNull.bestIdleRate) && sNull.bestIdleRate >= 0 && sNull.rankIndex === 1 && sNull.cardsChosenTotal === 0, JSON.stringify({ b: sNull.bestIdleRate, r: sNull.rankIndex, c: sNull.cardsChosenTotal }));
    await ev(c, "window.__MOYU__.saveNow()");
    const fMax = await blobFromState();
    fMax.bestIdleRate = 1e308; fMax.rankIndex = 999; fMax.cardsChosenTotal = 1e9;
    await writeSaveAndReload(fMax);
    const sMax = await state(c);
    rep.expect("F3 极值钳制（1e30 / 20 / 100000）", sMax.bestIdleRate === 1e30 && sMax.rankIndex === 20 && sMax.cardsChosenTotal === 100000, JSON.stringify({ b: sMax.bestIdleRate, r: sMax.rankIndex, c: sMax.cardsChosenTotal }));
    const h = await hud(c);
    rep.expect("F4 极值档 HUD 无 NaN/Infinity 且可操作", !/NaN|Infinity/.test(JSON.stringify(h)) && (await waitFrames(c, 3)), JSON.stringify(h).slice(0, 120));

    // ============ G. 转生保留三个新字段 + boss 成就丢失 ============
    await ev(c, "window.__MOYU__.saveNow()");
    const g0 = await blobFromState();
    g0.totalEarned = 2e8; g0.lifetimeEarned = 2e8;
    g0.bestIdleRate = 5000; g0.rankIndex = 7; g0.cardsChosenTotal = 6;
    g0.surviveStreak = 10; g0.bestSurviveStreak = 10; g0.decor = []; g0.levels = { phone: 5 }; g0.talents = { ...(g0.talents ?? {}), unlocked: [], points: 0 };
    await writeSaveAndReload(g0);
    const engG1 = await engineAch();
    await openPanel(c, "#btn-journal", "#journal");
    const pBtn = await ev(c, `(() => { const b = document.getElementById("prestige-btn"); return b ? { disabled: b.disabled, text: b.textContent.slice(0, 40) } : null; })()`);
    rep.expect("G1 转生按钮可用", pBtn && pBtn.disabled === false, JSON.stringify(pBtn));
    await click(c, "#prestige-btn");
    await sleep(800);
    const sG = await state(c);
    const engG2 = await engineAch();
    await closeAllModals(c);
    rep.expect("G2 转生保留 bestIdleRate/rankIndex/cardsChosenTotal", sG.bestIdleRate === 5000 && sG.rankIndex === 7 && sG.cardsChosenTotal === 6, JSON.stringify({ b: sG.bestIdleRate, r: sG.rankIndex, c: sG.cardsChosenTotal }));
    rep.expect("G3 转生后 rank/idle/card 类成就仍在", engG1.done.includes("rank_7") && engG1.done.includes("idle_1k") && engG1.done.includes("card_5"), JSON.stringify(engG1.done));
    rep.expect("G4 转生后 boss 成就保留（历史最高连胜不清）", engG2.done.includes("boss_10"), `转生后 done=${JSON.stringify(engG2.done)}`);

    // ============ H. 重复发放 / 幂等 ============
    const engH1 = await engineAch();
    const engH2 = await engineAch();
    rep.expect("H1 同状态重复求值恒定（不重复叠加）", engH1.points === engH2.points && Math.abs(engH1.idleMult - engH2.idleMult) < 1e-12 && Math.abs(engH1.clickPower - engH2.clickPower) < 1e-9, JSON.stringify({ p1: engH1.points, p2: engH2.points }));
    rep.expect("H2 无异常", c.errors.length === 0, JSON.stringify(c.errors.slice(0, 3)));
    await shotSafe("ACH-live");
  } catch (e) {
    rep.add("ACH:EXCEPTION", false, String(e?.message ?? e).slice(0, 300));
    console.error(e);
  } finally {
    c.close();
  }
}, { timeoutMs: 240_000 });

async function shotSafe(name) {
  try {
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    const fs = await import("node:fs");
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
  } catch { /* ignore */ }
}

const summary = rep.summary();
const fs = await import("node:fs");
fs.writeFileSync(`${OUT}/ach-live-report.json`, JSON.stringify(summary, null, 2));
console.log(`\n===== 成就墙 live：${summary.pass}/${summary.total} 通过 =====`);
if (summary.failed.length) console.log("失败：", summary.failed.join(" | "));
console.log("报告：", `${OUT}/ach-live-report.json`);