/**
 * R12 碎片党「第二次体验（复验）」探针 —— 验证 8 项改动：
 *  ① 3 分钟档「就近溜达」是否让每次打开都有事做
 *  ② 任务到点是否有明显提醒（页面开着 / 回来时）
 *  ③ 面板排序是否让"可领"第一屏可见
 *  ④ 每日 +1 天赋点是否让天赋页有决策
 *  ⑤ 顶部「一键领取」是否首屏可见
 *  ⑥ 领取提示是否还重复（flash + toast）
 *  ⑦ 好感 20/60 是否生效
 *  ⑧ 15m 档 per-hour 是否还垫底
 *
 * 节奏：碎片党 4×/天、每次 2-3 分钟、间隔约 2 分钟；用 Date.now 偏移 + **单次 reload** 模拟离开
 *（上一轮双 reload 会吃掉离线/欢迎面板）。
 * 产出：playtest/probe-r12-frag2-evidence.json、/tmp/r12f2-*.png
 */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const PORT = 9544;
const URL_ = "http://127.0.0.1:5173/";
const EVIDENCE = "playtest/probe-r12-frag2-evidence.json";

const INJECT = `(() => {
  try {
    const KEY = "__frag.offset";
    let off = 0;
    try { off = Number(localStorage.getItem(KEY) || 0) || 0; } catch (e) {}
    const realNow = Date.now.bind(Date);
    let extra = 0;
    Date.now = () => realNow() + off + extra;
    const frag = { off, log: [] };
    Object.defineProperty(frag, "extra", { get: () => extra });
    frag.advance = (ms) => { extra += ms; };
    frag.jump = (ms) => {
      try { localStorage.setItem(KEY, String(off + extra + ms)); } catch (e) {}
      setTimeout(() => location.reload(), 60);
    };
    window.__frag = frag;
    window.__r9 = { errors: [] };
    window.addEventListener("error", (e) => window.__r9.errors.push(String(e && e.message)));
    document.addEventListener("DOMContentLoaded", () => {
      const sr = document.getElementById("sr-live");
      if (sr) new MutationObserver(() => { const t = (sr.textContent || "").trim(); if (t) frag.log.push({ t: Date.now(), kind: "announce", text: t }); }).observe(sr, { childList: true, subtree: true, characterData: true });
      let lastShown = "";
      let lastFlash = 0;
      setInterval(() => {
        const t = document.getElementById("dom-toast");
        if (t) {
          const shown = t.classList.contains("show");
          const txt = (t.textContent || "").trim();
          if (shown && txt && txt !== lastShown) { frag.log.push({ t: Date.now(), kind: "toast", text: txt }); lastShown = txt; }
          if (!shown) lastShown = "";
        }
        const n = document.querySelectorAll(".team-flash").length;
        if (n > lastFlash) {
          const els = document.querySelectorAll(".team-flash");
          const el = els[els.length - 1];
          frag.log.push({ t: Date.now(), kind: "flash", text: el ? (el.textContent || "").trim() : "" });
        }
        lastFlash = n;
      }, 80);
    });
  } catch (e) {}
})()`;

const SNAP = `JSON.stringify((() => { try {
  const s = window.__MOYU__.state;
  const body = document.getElementById("team-body");
  const cards = [...document.querySelectorAll("#team-body .mate")];
  const btns = [...document.querySelectorAll("#team-body button[data-act]")];
  const btnTeam = document.getElementById("btn-team");
  const badge = btnTeam ? btnTeam.querySelector(".badge") : null;
  const talentBadge = btnTeam ? btnTeam.querySelector(".talent-badge") : null;
  const summary = document.querySelector("#team-body .team-summary");
  const claimAll = document.querySelector('#team-body button[data-act="claim-all"]');
  const toastEl = document.getElementById("dom-toast");
  const teamEl = document.getElementById("team");
  const welcomeEl = document.getElementById("welcome");
  const journalEl = document.getElementById("journal");
  const claimBtn = document.getElementById("journal-claim");
  const bodyRect = body ? body.getBoundingClientRect() : null;
  const rectOf = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
  return {
    badge: badge ? badge.textContent : null,
    talentBadge: talentBadge ? talentBadge.textContent : null,
    order: [...document.querySelectorAll("#team-body .mate")].map((c) => {
      const n = c.querySelector(".mate-name");
      const p = c.querySelector(".mate-progress");
      const claim = c.querySelector('button[data-act="claim"]');
      return { name: n ? n.innerText : "?", progress: p ? p.innerText : null, hasClaim: !!claim };
    }),
    summary: summary ? summary.innerText : null,
    claimAll: claimAll ? { text: claimAll.innerText, rect: rectOf(claimAll) } : null,
    bodyRect,
    panel: body ? {
      scrollTop: body.scrollTop, scrollH: body.scrollHeight, clientH: body.clientHeight,
      cards: cards.length,
      firstCardTop: cards[0] ? Math.round(cards[0].getBoundingClientRect().top - bodyRect.top) : null,
      missionLabels: btns.filter((b) => b.dataset.act === "dispatch").map((b) => b.innerText),
    } : null,
    teamOpen: teamEl ? !teamEl.classList.contains("hidden") : false,
    teamTab: document.getElementById("tab-talents").classList.contains("active") ? "talents" : "colleagues",
    teamPoints: document.getElementById("team-points").textContent,
    talents: { points: s.talents.points, unlocked: s.talents.unlocked, dailyGiftDate: s.talents.dailyGiftDate },
    colleagues: Object.fromEntries(Object.entries(s.team.colleagues).map(([k, v]) => [k, { level: v.level, missionId: v.missionId, endsAt: v.endsAt, favor: v.favor, autoRepeat: v.autoRepeat }])),
    toast: toastEl && toastEl.classList.contains("show") ? (toastEl.textContent || "").trim() : null,
    flashCount: document.querySelectorAll(".team-flash").length,
    welcomeOpen: welcomeEl ? !welcomeEl.classList.contains("hidden") : false,
    welcomeGain: document.getElementById("welcome-gain").textContent,
    welcomeTime: document.getElementById("welcome-time").textContent,
    journalOpen: journalEl ? !journalEl.classList.contains("hidden") : false,
    journalClaim: claimBtn ? { disabled: claimBtn.disabled, text: claimBtn.textContent } : null,
    daily: s.daily ? { claimed: s.daily.claimed, goals: s.daily.goals.map((g) => ({ id: g.id, done: g.done, progress: g.progress, target: g.target })) } : null,
    moyuValue: s.moyu,
    idleText: document.getElementById("hud-idle").textContent,
    rank: document.getElementById("hud-rank").textContent,
    errors: window.__r9 ? window.__r9.errors.slice(-3) : []
  };
} catch (e) { return { error: String(e) }; } })())`;

/* ---------------- seed：中后期 + 三种同事状态（可领/派遣中/空闲/未招募） ---------------- */
const SEED = {
  v: 2,
  moyu: 500000000,
  totalEarned: 1000000000,
  levels: { coffee: 12, water: 10, chair: 8, phone: 18, toilet: 16, group: 14, meeting: 10, deep: 6, retire: 2 },
  collected: { quotes: [], flavors: [] },
  daily: null,
  surviveStreak: 0,
  patrolSurvives: 0,
  totalClicks: 400,
  visits: { date: "", count: 0 },
  lifetimeEarned: 1000000000,
  prestige: 0,
  team: {
    colleagues: {
      zhou: { level: 3, missionId: "quick", startedAt: 0, endsAt: 0, favor: 30, autoRepeat: false, rewardSnapshot: 0 },
      mei: { level: 2, missionId: "chat", startedAt: 0, endsAt: 0, favor: 20, autoRepeat: false, rewardSnapshot: 0 },
      qiang: { level: 1, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 },
    },
  },
  talents: { unlocked: [], points: 0, rankGranted: 4, dailyGiftDate: "" },
};

const b = await openBrowser({ port: PORT, tag: "frag2" });
const out = {
  meta: {
    url: URL_, viewport: "390x844@3x", phase: "复验（第二次体验）",
    startedAt: new Date().toISOString(),
    profile: "碎片党：每次 2-3 分钟、一天 4-6 次、从不专门坐 30 分钟",
    git: (() => { try { return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim(); } catch { return null; } })(),
    gitStatusAtStart: (() => { try { return execSync("git status --porcelain", { encoding: "utf8" }).trim().split("\n").filter((x) => x.trim().startsWith("M src")); } catch { return []; } })(),
    gitRevAtEnd: null,
    notes: "离开用 Date.now 偏移 + 单次 reload 模拟；偏差：headless 无法验证音效，只验证视觉提示；",
  },
  seed: SEED,
  boot: [],
  sessions: [],
  checks: {},
  errors: [],
};

const ev = async (expression) => {
  try { return await b.ev(expression); } catch (e) { out.errors.push(String(e && e.message ? e.message : e).slice(0, 240)); return null; }
};
const evj = async (expression) => {
  const v = await ev(expression);
  if (typeof v !== "string") return v;
  try { return JSON.parse(v); } catch { return v; }
};
const snap = () => evj(SNAP);
const takeLog = async () => (await evj(`JSON.stringify((window.__frag && window.__frag.log ? window.__frag.log.splice(0) : []))`)) || [];
const shot = (p) => b.shot(p);
const log = (m) => console.log(`[frag2] ${m}`);

async function waitGame(timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await ev(`typeof window.__MOYU__ !== "undefined" && !!document.getElementById("stage") ? 1 : 0`);
    if (ok === 1) return Date.now() - t0;
    await sleep(120);
  }
  throw new Error("game not ready");
}

/** 单次 reload 的 seed（拦掉 pagehide saveNow 覆盖） */
async function seedAndReload(tag) {
  const t0 = Date.now();
  await ev(`(() => {
    const blob = ${JSON.stringify(SEED)};
    const now = Date.now();
    blob.savedAt = now; blob.createdAt = now - 3 * 86400000;
    blob.team.colleagues.zhou.startedAt = now - 600000;
    blob.team.colleagues.zhou.endsAt = now - 1000;
    blob.team.colleagues.mei.startedAt = now - 60000;
    blob.team.colleagues.mei.endsAt = now + 5 * 60000;
    try { localStorage.clear(); } catch (e) {}
    try { localStorage.setItem("moyu-save", JSON.stringify(blob)); } catch (e) {}
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return orig.call(this, k, v); };
    setTimeout(() => location.reload(), 80);
    return 1;
  })()`);
  await sleep(500);
  const ready = await waitGame();
  await sleep(1800);
  const ms = Date.now() - t0;
  out.boot.push({ tag, reloadToReadyMs: ms, waitGameMs: ready });
  log(`${tag} 就绪 ${ms}ms`);
  return ms;
}

/** 单次 reload 的"离开"跳转 */
async function jumpGap(ms, tag) {
  const t0 = Date.now();
  await ev(`window.__MOYU__.saveNow(); window.__frag.jump(${ms}); 1`);
  await sleep(500);
  const ready = await waitGame();
  await sleep(1700);
  out.boot.push({ tag, reloadToReadyMs: Date.now() - t0, waitGameMs: ready });
  log(`${tag} 就绪 ${Date.now() - t0}ms`);
}

let cur = null;
function startSession(index) { return { index, t0: Date.now(), actions: [], samples: [], notifications: [], taps: 0 }; }
async function act(desc, fn) {
  const at = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  let result;
  try { result = await fn(); } catch (e) { result = { error: String(e && e.message ? e.message : e) }; out.errors.push(`S${cur.index} ${desc}: ${result.error}`.slice(0, 240)); }
  cur.actions.push({ at, desc, result: result === undefined ? null : result });
  log(`S${cur.index} +${at}s ${desc}`);
  await sleep(100);
  return result;
}
async function tap(sel) {
  cur.taps++;
  return ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0; el.click(); return 1; })()`);
}
async function tapExpr(expr) { cur.taps++; return ev(expr); }
async function collectLogs() { const l = await takeLog(); for (const x of l) cur.notifications.push(x); return l; }

async function poll(sec, snapEveryMs = 10000) {
  const t0 = Date.now();
  let lastSnap = 0;
  while ((Date.now() - t0) / 1000 < sec) {
    const logs = await collectLogs();
    for (const l of logs) {
      if (/回来了|签到|领取/.test(l.text || "")) {
        try { await shot(`/tmp/r12f2-s${cur.index}-notify-${l.kind}.png`); } catch { /* ignore */ }
      }
    }
    if (Date.now() - lastSnap >= snapEveryMs) {
      const s = await snap();
      cur.samples.push({
        at: Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10,
        badge: s.badge, points: s.talents.points, toast: s.toast, flashCount: s.flashCount,
        claimAll: s.claimAll ? s.claimAll.text : null, welcome: s.welcomeOpen,
        journalClaim: s.journalClaim && !s.journalClaim.disabled ? s.journalClaim.text : null,
        colleaguesBusy: s.colleagues ? Object.values(s.colleagues).filter((c) => c.missionId).length : 0,
        idle: s.idleText,
      });
      cur.samples = cur.samples;
      lastSnap = Date.now();
    }
    await sleep(450);
  }
  return cur.samples;
}

async function sessionStart(index) {
  cur = startSession(index);
  cur.simNow = (await ev("Date.now()")) || 0;
  await collectLogs();
  return cur;
}

try {
  /* ============ 0. 载入 + seed ============ */
  await setupMobilePage(b, { injectSource: INJECT, url: URL_ });
  out.boot.push({ tag: "first-load", waitGameMs: await waitGame() });
  await sleep(1200);
  await seedAndReload("seed-frag2");
  await shot("/tmp/r12f2-0-seed.png");

  /* ============ S1：打开 → 签到天赋点 / 可领排序 / 一键领取 / 派 3 分钟 ============ */
  await sessionStart(1);
  await act("首屏 1.2s：签到/回来提示、红点、天赋角标", async () => {
    await sleep(1200);
    const s = await snap();
    const logs = await collectLogs();
    const allToasts = cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text));
    await shot("/tmp/r12f2-s1-open.png");
    return {
      toasts: allToasts,
      announces: logs.filter((l) => l.kind === "announce").map((l) => l.text).slice(-4),
      badge: s.badge, talentBadge: s.talentBadge, points: s.talents.points,
      dailyGiftDate: s.talents.dailyGiftDate, welcome: s.welcomeOpen, rank: s.rank,
    };
  });
  await act("开 👥：看排序 + 顶部一键领取是否第一屏", async () => {
    await sleep(800);
    const s = await snap();
    await shot("/tmp/r12f2-s1-team.png");
    return {
      order: s.order, summary: s.summary, claimAll: s.claimAll, bodyRect: s.bodyRect,
      panel: s.panel, badge: s.badge,
    };
  });
  await act("点「一键领取」（1 下）", async () => {
    const before = await snap();
    await sleep(700);
    const s0 = await snap();
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f2-s1-claim.png");
    return {
      clicked, rewardExact: Math.round((s.moyuValue || 0) - (before.moyuValue || 0)),
      toastAfter: logs.filter((l) => l.kind === "toast").map((l) => l.text),
      flashAfter: logs.filter((l) => l.kind === "flash").map((l) => l.text),
      duplicateFeedback: logs.some((l) => l.kind === "toast") && logs.some((l) => l.kind === "flash"),
      zhouAfter: s.colleagues.zhou, claimAllNow: s.claimAll,
    };
  });
  await act("派老周+强哥「就近溜达」3 分钟并开自动重复", async () => {
    const before = await snap();
    const zhouLabels = before.panel ? before.panel.missionLabels : [];
    const out1 = { zhouLabels };
    for (const id of ["zhou", "qiang"]) {
      const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="dispatch"][data-id="${id}"][data-mission="stroll"]'); if (!el) return 0; el.click(); return 1; })()`);
      await sleep(500);
      const auto = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="auto"][data-id="${id}"]'); if (!el) return 0; el.click(); return 1; })()`);
      await sleep(400);
      out1[id] = { dispatchClicked: clicked, autoClicked: auto };
    }
    const s = await snap();
    await shot("/tmp/r12f2-s1-dispatched.png");
    out1.colleagues = s.colleagues;
    out1.orderAfter = s.order;
    return out1;
  });
  await act("天赋页：签到 1 点点掉（点 1 下）", async () => {
    await tap("#tab-talents");
    await sleep(600);
    const before = await snap();
    const enabled = await evj(`JSON.stringify([...document.querySelectorAll('#team-body button[data-act="talent"]:not([disabled])')].map((b) => b.dataset.id))`);
    await shot("/tmp/r12f2-s1-talents.png");
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="talent"]:not([disabled])'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(600);
    const s = await snap();
    await shot("/tmp/r12f2-s1-talents-done.png");
    await tap("#team-close");
    await sleep(300);
    return { pointsBefore: before.talents.points, enabledTier1: enabled, clicked, pointsAfter: s.talents.points, unlocked: s.talents.unlocked };
  });
  await act("剩余时间：等 3 分钟任务到点（页面开着）", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    const wait = Math.max(20, 198 - elapsed);
    const samples = await poll(wait, 8000);
    const logs = cur.notifications.filter((l) => l.kind === "toast" || l.kind === "flash" || l.kind === "announce");
    const notify = cur.notifications.find((l) => /回来了/.test(l.text || ""));
    return {
      waitSeconds: Math.round(wait),
      notifications: logs.map((l) => `${l.kind}:${l.text}`).slice(-6),
      completionToastAt: notify ? notify.t : null,
      completionToastText: notify ? notify.text : null,
      badgeSamples: samples.map((x) => x.badge),
      lastPoints: samples.length ? samples[samples.length - 1].points : null,
    };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S1 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ S2：离开 2 分钟 → 回来（应看到"回来了"提示 + 可领） ============ */
  await jumpGap(2 * 60 * 1000, "gap+2min");
  await sessionStart(2);
  await act("回来首屏：回来提示 / 红点 / 欢迎面板", async () => {
    await sleep(1200);
    const s = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f2-s2-open.png");
    return {
      toasts: cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text)),
      badge: s.badge, welcome: s.welcomeOpen, welcomeGain: s.welcomeGain, welcomeTime: s.welcomeTime,
      points: s.talents.points, dailyGiftDate: s.talents.dailyGiftDate,
    };
  });
  await act("关欢迎面板 → 开 👥 → 一键领取", async () => {
    if ((await snap()).welcomeOpen) { await tap("#welcome-ok"); await sleep(400); }
    await tap("#btn-team");
    await sleep(700);
    const s = await snap();
    await shot("/tmp/r12f2-s2-team.png");
    const before = await snap();
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s2 = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f2-s2-claim.png");
    await tap("#team-close");
    await sleep(300);
    return {
      order: s.order, claimAll: s.claimAll ? s.claimAll.text : null, firstCardTop: s.panel ? s.panel.firstCardTop : null,
      clicked, rewardExact: Math.round((s2.moyuValue || 0) - (before.moyuValue || 0)),
      toastAfter: logs.filter((l) => l.kind === "toast").map((l) => l.text),
      flashAfter: logs.filter((l) => l.kind === "flash").map((l) => l.text),
      colleagues: s2.colleagues,
    };
  });
  await act("校验每日天赋点：第二次打开当天还有没有点", async () => {
    await tap("#btn-team");
    await sleep(400);
    await tap("#tab-talents");
    await sleep(600);
    const s = await snap();
    await shot("/tmp/r12f2-s2-talents.png");
    const enabled = await evj(`JSON.stringify([...document.querySelectorAll('#team-body button[data-act="talent"]:not([disabled])')].map((b) => b.dataset.id))`);
    await tap("#team-close");
    await sleep(300);
    return { points: s.talents.points, enabledButtons: enabled, hint: s.bodyRect ? true : null };
  });
  await act("余下时间（看还有没有别的事做）", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    const samples = await poll(Math.max(20, 130 - elapsed), 8000);
    return { samples: samples.map((x) => ({ at: x.at, badge: x.badge, claimAll: x.claimAll, points: x.points })) };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S2 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ S3：离开 2 分钟 → 回来领 → 用 endMissions 测"页面开着"提醒延迟 ============ */
  await jumpGap(2 * 60 * 1000, "gap+2min");
  await sessionStart(3);
  await act("回来首屏", async () => {
    await sleep(1100);
    const s = await snap();
    const logs = await collectLogs();
    return { toasts: cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text)), badge: s.badge, welcome: s.welcomeOpen };
  });
  await act("关欢迎 → 开👥 一键领取（含首屏按钮可见性）", async () => {
    if ((await snap()).welcomeOpen) { await tap("#welcome-ok"); await sleep(400); }
    await tap("#btn-team");
    await sleep(700);
    const s = await snap();
    await shot("/tmp/r12f2-s3-team.png");
    const before = await snap();
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s2 = await snap();
    await collectLogs();
    return {
      order: s.order, claimAllText: s.claimAll ? s.claimAll.text : null,
      claimAllVisible: s.claimAll && s.bodyRect ? s.claimAll.rect.top >= s.bodyRect.top - 2 && s.claimAll.rect.bottom <= s.bodyRect.bottom + 2 : null,
      clicked, rewardExact: Math.round((s2.moyuValue || 0) - (before.moyuValue || 0)),
      colleagues: s2.colleagues,
    };
  });
  await act("页面开着时用 endMissions 快进 → 测提醒延迟", async () => {
    const t0 = Date.now();
    await ev("window.__MOYU__.endMissions(); 1");
    let found = null;
    while (Date.now() - t0 < 3000) {
      const logs = await collectLogs();
      const hit = logs.find((l) => /回来了/.test(l.text || ""));
      if (hit) { found = { latencyMs: Date.now() - t0, text: hit.text }; await shot("/tmp/r12f2-s3-endm-toast.png"); break; }
      await sleep(120);
    }
    const s = await snap();
    await shot("/tmp/r12f2-s3-endm.png");
    return { endMissionsToast: found, badgeNow: s.badge, toastNow: s.toast };
  });
  await act("余下时间", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    const samples = await poll(Math.max(20, 140 - elapsed), 8000);
    return { samples: samples.map((x) => ({ at: x.at, badge: x.badge, claimAll: x.claimAll })) };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S3 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ S4：离开 2 分钟 → 回来（多可领排序 + 一键领取） ============ */
  await jumpGap(2 * 60 * 1000, "gap+2min");
  await sessionStart(4);
  await act("回来首屏", async () => {
    await sleep(1100);
    const s = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f2-s4-open.png");
    return { toasts: cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text)), badge: s.badge, welcome: s.welcomeOpen, welcomeGain: s.welcomeGain };
  });
  await act("关欢迎 → 开👥：多可领排序 + 一键领取", async () => {
    if ((await snap()).welcomeOpen) { await tap("#welcome-ok"); await sleep(400); }
    await tap("#btn-team");
    await sleep(700);
    const s = await snap();
    await shot("/tmp/r12f2-s4-team.png");
    const before = await snap();
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s2 = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f2-s4-claim.png");
    await tap("#team-close");
    await sleep(300);
    return {
      order: s.order, claimAll: s.claimAll ? s.claimAll.text : null, firstCardTop: s.panel ? s.panel.firstCardTop : null,
      clicked, rewardExact: Math.round((s2.moyuValue || 0) - (before.moyuValue || 0)),
      toastAfter: logs.filter((l) => l.kind === "toast").map((l) => l.text),
      flashAfter: logs.filter((l) => l.kind === "flash").map((l) => l.text),
      duplicate: logs.some((l) => l.kind === "toast") && logs.some((l) => l.kind === "flash"),
    };
  });
  await act("余下时间 + 结束快照", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    const samples = await poll(Math.max(15, 110 - elapsed), 8000);
    const s = await snap();
    return { samples: samples.map((x) => ({ at: x.at, badge: x.badge, claimAll: x.claimAll })), finalPoints: s.talents.points, finalDaily: s.daily };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S4 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ P5：签到提示隔离测试（无任务完成冲突时是否可见） ============ */
  await ev(`(() => {
    const raw = JSON.parse(localStorage.getItem("moyu-save") || "{}");
    raw.talents = { unlocked: raw.talents ? raw.talents.unlocked : [], points: 0, rankGranted: raw.talents ? raw.talents.rankGranted : 4, dailyGiftDate: "" };
    raw.team = { colleagues: {} };
    raw.savedAt = Date.now();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return orig.call(this, k, v); };
    localStorage.setItem("moyu-save", JSON.stringify(raw));
    setTimeout(() => location.reload(), 80);
    return 1;
  })()`);
  await sleep(500);
  await waitGame();
  await sleep(1000);
  const dailyToast = (await evj(`JSON.stringify((window.__frag && window.__frag.log ? window.__frag.log.splice(0) : []))`)) || [];
  await shot("/tmp/r12f2-daily-toast.png");
  out.checks.dailyTalentToastIsolated = {
    toasts: dailyToast.filter((l) => l.kind === "toast").map((l) => l.text),
    announces: dailyToast.filter((l) => l.kind === "announce").map((l) => l.text),
    points: (await snap()).talents.points,
    dailyGiftDate: (await snap()).talents.dailyGiftDate,
  };

  /* ============ 汇总 ============ */
  const sess = out.sessions;
  out.checks.sessions = sess.map((s) => ({
    index: s.index,
    simMinutes: Math.round(((s.simNow - sess[0].simNow) / 60000) * 100) / 100,
    realDurationSec: s.durationSec,
    taps: s.taps,
    badgeAtOpen: (s.actions[0] && s.actions[0].result && s.actions[0].result.badge) || null,
    toastsAtOpen: s.actions[0] && s.actions[0].result && s.actions[0].result.toasts ? s.actions[0].result.toasts : [],
    claimAllAtOpen: s.actions.find((a) => /一键领取/.test(a.desc)) ? (s.actions.find((a) => /一键领取/.test(a.desc)).result.claimAllText || s.actions.find((a) => /一键领取/.test(a.desc)).result.claimAll || null) : null,
    notifications: s.notifications.filter((l) => l.kind !== "announce").map((l) => `${l.kind}:${l.text}`),
  }));
  out.checks.missionLabelsFromS1 = (sess[0].actions.find((a) => /就近溜达/.test(a.desc)) || {}).result || null;
  out.checks.completionNotifyWhileOpen = ((sess[0].actions.find((a) => /等 3 分钟任务到点/.test(a.desc)) || {}).result || null);
  out.checks.endMissionsNotify = ((sess[2].actions.find((a) => /endMissions/.test(a.desc)) || {}).result || null);
  out.checks.latency = (() => {
    const e2 = out.checks.endMissionsNotify;
    return e2 ? { endMissionsToastLatencyMs: e2.endMissionsToast ? e2.endMissionsToast.latencyMs : null } : null;
  })();
  try {
    out.meta.gitRevAtEnd = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    out.meta.gitStatusAtEnd = execSync("git status --porcelain", { encoding: "utf8" }).trim().split("\n").filter((x) => x.trim().startsWith("M src"));
  } catch { /* ignore */ }
  writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
  log(`已写 ${EVIDENCE}`);
  console.log("SESSIONS", JSON.stringify(sess.map((s) => ({ i: s.index, dur: s.durationSec, taps: s.taps }))));
  console.log("CHECKS", JSON.stringify(out.checks, null, 1).slice(0, 4000));
} catch (e) {
  out.fatal = String(e && e.stack ? e.stack : e).slice(0, 2000);
  try { writeFileSync(EVIDENCE, JSON.stringify(out, null, 2)); } catch { /* ignore */ }
  console.error("FATAL", e);
} finally {
  try { b.close(); } catch { /* ignore */ }
}
