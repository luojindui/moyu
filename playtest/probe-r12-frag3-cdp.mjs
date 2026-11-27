/**
 * R12 碎片党「第三次体验（复验 2，最新版 bcb2a7b/62f1486/5a26f62+）」探针 —— 验证 8 项改动：
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
 * 产出：playtest/probe-r12-frag3-evidence.json、/tmp/r12f3-*.png
 */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const PORT = 9557;
const URL_ = "http://127.0.0.1:5173/";
const EVIDENCE = "playtest/probe-r12-frag3-evidence.json";

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

const b = await openBrowser({ port: PORT, tag: "frag3" });
const out = {
  meta: {
    url: URL_, viewport: "390x844@3x", phase: "复验 2（最新版 bcb2a7b/62f1486/5a26f62+）",
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
  await seedAndReload("seed-frag3");
  await shot("/tmp/r12f3-0-seed.png");

  const LIGHT = `JSON.stringify((() => { const s = window.__MOYU__.state; const c = s.team.colleagues.zhou; const t = document.getElementById("dom-toast"); return { now: Date.now(), moyu: s.moyu, zhou: c ? { missionId: c.missionId, endsAt: c.endsAt, favor: c.favor, autoRepeat: c.autoRepeat, rewardSnapshot: c.rewardSnapshot } : null, toast: t && t.classList.contains("show") ? t.textContent : null, badge: (document.querySelector("#btn-team .badge") || {}).textContent || null }; })())`;
  const light = () => evj(LIGHT);

  async function waitAutoClaim(sec, label) {
    const t0 = Date.now();
    let prev = await light();
    let claimEvent = null;
    const toasts = [];
    while ((Date.now() - t0) / 1000 < sec) {
      const logs = await collectLogs();
      for (const l of logs) {
        if (l.kind === "toast") toasts.push(l.text);
        if (l.kind === "toast" && /回来了|领取/.test(l.text || "")) {
          try { await shot(`/tmp/r12f3-${label}-toast.png`); } catch { /* ignore */ }
        }
      }
      const now = await light();
      const rz = prev && prev.zhou;
      const nz = now && now.zhou;
      if (!claimEvent && rz && nz && nz.endsAt > rz.endsAt + 30 && nz.missionId) {
        claimEvent = {
          at: Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10,
          favorBefore: rz.favor, favorAfter: nz.favor,
          endsAtBefore: rz.endsAt, endsAtAfter: nz.endsAt,
          moyuBeforeClaimSample: rz.moyu, moyuAtDetect: now.moyu,
          toastAtDetect: now.toast,
          prevToast: rz.toast,
        };
        try { await shot(`/tmp/r12f3-${label}-autoclaim.png`); } catch { /* ignore */ }
      }
      prev = now;
      await sleep(700);
    }
    return { claimEvent, toasts, final: prev };
  }

  /* ============ S1：签到 / 可领排序 / 一键领取 / 3 分钟档 + 自动重复 ============ */
  await sessionStart(1);
  await act("首屏 1.2s：签到/回来提示、红点、天赋点、余额", async () => {
    await sleep(1200);
    const s = await snap();
    const logs = await collectLogs();
    const allToasts = cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text));
    await shot("/tmp/r12f3-s1-open.png");
    return {
      toasts: allToasts,
      announces: cur.notifications.filter((l) => l.kind === "announce").map((l) => l.text).slice(-4),
      badge: s.badge, talentBadge: s.talentBadge, points: s.talents.points, dailyGiftDate: s.talents.dailyGiftDate,
      welcome: s.welcomeOpen, moyu: s.moyuValue, idle: s.idleText, rank: s.rank,
    };
  });
  await act("开👥：排序 + 首屏「一键领取」+ 3m/8h 按钮的「净 +X/h」", async () => {
    await sleep(800);
    const s = await snap();
    await shot("/tmp/r12f3-s1-team.png");
    return { order: s.order, summary: s.summary, claimAll: s.claimAll, bodyRect: s.bodyRect, firstCardTop: s.panel ? s.panel.firstCardTop : null, missionLabels: s.panel ? s.panel.missionLabels : [], badge: s.badge };
  });
  await act("一键领取（1 下）：奖励 + 是否重复提示", async () => {
    const before = await snap();
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f3-s1-claim.png");
    return {
      clicked, rewardExact: Math.round((s.moyuValue || 0) - (before.moyuValue || 0)),
      toasts: logs.filter((l) => l.kind === "toast").map((l) => l.text),
      flashes: logs.filter((l) => l.kind === "flash").map((l) => l.text),
      duplicateFeedback: logs.some((l) => l.kind === "toast") && logs.some((l) => l.kind === "flash"),
      zhou: s.colleagues.zhou, claimAllNow: s.claimAll,
    };
  });
  await act("派老周「就近溜达」3 分钟 + 自动重复：开", async () => {
    const before = await snap();
    const zhouLabels = (before.panel ? before.panel.missionLabels : []).slice(0, 6);
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="stroll"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(500);
    const auto = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="auto"][data-id="zhou"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(500);
    const s = await snap();
    await shot("/tmp/r12f3-s1-dispatched.png");
    await tap("#team-close");
    await sleep(300);
    return { zhouMissionLabelsBeforeDispatch: zhouLabels, clicked, auto, zhou: s.colleagues.zhou, orderAfterDispatch: s.order };
  });
  await act("等 3 分钟到点：自动领取 + 自动续班 + 提醒（页面开着）", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    const r = await waitAutoClaim(Math.max(30, 195 - elapsed), "s1");
    return r;
  });
  await act("天赋页：签到 1 点点掉（1 下，看是不是 1 个决策）", async () => {
    await tap("#btn-team");
    await sleep(500);
    await tap("#tab-talents");
    await sleep(600);
    const before = await snap();
    const enabled = await evj(`JSON.stringify([...document.querySelectorAll('#team-body button[data-act="talent"]:not([disabled])')].map((b) => b.dataset.id))`);
    await shot("/tmp/r12f3-s1-talents.png");
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="talent"]:not([disabled])'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(600);
    const s = await snap();
    await shot("/tmp/r12f3-s1-talents-done.png");
    await tap("#team-close");
    await sleep(300);
    return { pointsBefore: before.talents.points, enabledTier1: enabled, clicked, pointsAfter: s.talents.points, unlocked: s.talents.unlocked };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S1 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ S2：离开 2 分钟 → 回来（自动续班/排序/第二次打开天赋点） ============ */
  await jumpGap(2 * 60 * 1000, "gap+2min");
  await sessionStart(2);
  await act("回来首屏：到点任务是否已自动领/续班 + 提示", async () => {
    await sleep(400);
    const s1 = await light();
    await sleep(1600);
    const s2 = await light();
    const logs = await collectLogs();
    const snapS = await snap();
    await shot("/tmp/r12f3-s2-open.png");
    return {
      toasts: cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text)),
      welcome: snapS.welcomeOpen, welcomeGain: snapS.welcomeGain, welcomeTime: snapS.welcomeTime,
      badge: snapS.badge, zhouAtLoad: s1.zhou, zhouAfter1_6s: s2.zhou,
      moyuAtLoad: s1.moyu, moyuAfter1_6s: s2.moyu,
      autoClaimedAtLoad: s1.zhou && s2.zhou ? s1.zhou.favor !== s2.zhou.favor || s1.zhou.endsAt !== s2.zhou.endsAt : null,
    };
  });
  await act("关欢迎 → 开👥：排序（可领第一）+ 一键领取 + 净/h 口径", async () => {
    if ((await snap()).welcomeOpen) { await tap("#welcome-ok"); await sleep(400); }
    await tap("#btn-team");
    await sleep(800);
    const s = await snap();
    await shot("/tmp/r12f3-s2-team.png");
    const before = await snap();
    const claimAllText = s.claimAll ? s.claimAll.text : null;
    const claimAllVisible = s.claimAll && s.bodyRect ? s.claimAll.rect.top >= s.bodyRect.top - 2 && s.claimAll.rect.bottom <= s.bodyRect.bottom + 2 : null;
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s2 = await snap();
    const logs = await collectLogs();
    await shot("/tmp/r12f3-s2-claim.png");
    await tap("#team-close");
    await sleep(300);
    return {
      order: s.order, claimAllText, claimAllVisible, firstCardTop: s.panel ? s.panel.firstCardTop : null,
      missionLabels: s.panel ? s.panel.missionLabels : [],
      clicked, rewardExact: Math.round((s2.moyuValue || 0) - (before.moyuValue || 0)),
      toasts: logs.filter((l) => l.kind === "toast").map((l) => l.text),
      flashes: logs.filter((l) => l.kind === "flash").map((l) => l.text),
      duplicateFeedback: logs.some((l) => l.kind === "toast") && logs.some((l) => l.kind === "flash"),
      meifavorAfter: s2.colleagues.mei ? s2.colleagues.mei.favor : null,
    };
  });
  await act("天赋页：第二次打开当天还有没有点", async () => {
    await tap("#btn-team");
    await sleep(400);
    await tap("#tab-talents");
    await sleep(600);
    const s = await snap();
    await shot("/tmp/r12f3-s2-talents.png");
    const enabled = await evj(`JSON.stringify([...document.querySelectorAll('#team-body button[data-act="talent"]:not([disabled])')].map((b) => b.dataset.id))`);
    await tap("#team-close");
    await sleep(300);
    return { points: s.talents.points, enabledButtons: enabled };
  });
  await act("余下时间：看还有没有别的事做", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    const samples = await poll(Math.max(15, 135 - elapsed), 8000);
    return { samples: samples.map((x) => ({ at: x.at, badge: x.badge, claimAll: x.claimAll, points: x.points })) };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S2 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ S3：再离开 2 分钟 → 回来（多可领/离线自动续班/提醒延迟） ============ */
  await jumpGap(2 * 60 * 1000, "gap+2min");
  await sessionStart(3);
  await act("回来首屏：离开期间到点是否已自动领 + 提示", async () => {
    await sleep(300);
    const s1 = await light();
    await sleep(1600);
    const s2 = await light();
    const logs = await collectLogs();
    const snapS = await snap();
    await shot("/tmp/r12f3-s3-open.png");
    return {
      toasts: cur.notifications.filter((l) => l.kind === "toast").map((l) => l.text).concat(logs.filter((l) => l.kind === "toast").map((l) => l.text)),
      welcome: snapS.welcomeOpen, badge: snapS.badge,
      zhouAtLoad: s1.zhou, zhouAfter1_6s: s2.zhou,
      moyuAtLoad: s1.moyu, moyuAfter1_6s: s2.moyu,
      autoClaimedAtLoad: s1.zhou && s2.zhou ? s1.zhou.favor !== s2.zhou.favor || s1.zhou.endsAt !== s2.zhou.endsAt : null,
    };
  });
  await act("关欢迎 → 开👥：排序 + 一键领取（首屏可见性）", async () => {
    if ((await snap()).welcomeOpen) { await tap("#welcome-ok"); await sleep(400); }
    await tap("#btn-team");
    await sleep(800);
    const s = await snap();
    await shot("/tmp/r12f3-s3-team.png");
    const before = await snap();
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim-all"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(900);
    const s2 = await snap();
    await collectLogs();
    await shot("/tmp/r12f3-s3-claim.png");
    return {
      order: s.order, claimAll: s.claimAll ? s.claimAll.text : null,
      claimAllVisible: s.claimAll && s.bodyRect ? s.claimAll.rect.top >= s.bodyRect.top - 2 && s.claimAll.rect.bottom <= s.bodyRect.bottom + 2 : null,
      clicked, rewardExact: Math.round((s2.moyuValue || 0) - (before.moyuValue || 0)),
      zhouAfter: s2.colleagues.zhou,
    };
  });
  await act("页面开着时 endMissions → 提醒延迟", async () => {
    const t0 = Date.now();
    await ev("window.__MOYU__.endMissions(); 1");
    let found = null;
    while (Date.now() - t0 < 3000) {
      const logs = await collectLogs();
      const hit = logs.find((l) => /回来了/.test(l.text || ""));
      if (hit) { found = { latencyMs: Date.now() - t0, text: hit.text }; await shot("/tmp/r12f3-s3-endm.png"); break; }
      await sleep(120);
    }
    const s = await light();
    await shot("/tmp/r12f3-s3-endm-after.png");
    return { endMissionsToast: found, badgeNow: s.badge, zhouNow: s.zhou };
  });
  await act("收尾快照", async () => {
    const elapsed = (Date.now() - cur.t0) / 1000;
    await poll(Math.max(10, 120 - elapsed), 8000);
    const s = await snap();
    return { points: s.talents.points, daily: s.daily, badge: s.badge };
  });
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  out.sessions.push(cur);
  log(`S3 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ============ 汇总 ============ */
  const sess = out.sessions;
  out.checks.sessions = sess.map((s) => ({
    index: s.index,
    simMinutes: Math.round(((s.simNow - sess[0].simNow) / 60000) * 100) / 100,
    realDurationSec: s.durationSec,
    taps: s.taps,
    actions: s.actions.map((a) => `${a.at}s ${a.desc}`),
    toasts: s.notifications.filter((l) => l.kind === "toast").map((l) => l.text),
    flashes: s.notifications.filter((l) => l.kind === "flash").map((l) => l.text),
  }));
  out.checks.s1PanelLabels = (sess[0].actions.find((a) => /开👥/.test(a.desc)) || {}).result || null;
  out.checks.s1AutoClaim = (sess[0].actions.find((a) => /等 3 分钟到点/.test(a.desc)) || {}).result || null;
  out.checks.s2Return = (sess[1].actions.find((a) => /回来首屏/.test(a.desc)) || {}).result || null;
  out.checks.s3Return = (sess[2].actions.find((a) => /回来首屏/.test(a.desc)) || {}).result || null;
  out.checks.s3EndMissions = (sess[2].actions.find((a) => /endMissions/.test(a.desc)) || {}).result || null;
  out.checks.talentPointBySession = sess.map((s) => {
    const a = s.actions.find((x) => /天赋页/.test(x.desc));
    return { session: s.index, result: a ? a.result : null };
  });
  try {
    out.meta.gitRevAtEnd = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    out.meta.gitStatusAtEnd = execSync("git status --porcelain", { encoding: "utf8" }).trim().split("\n").filter((x) => x.trim().startsWith("M src"));
  } catch { /* ignore */ }
  writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
  log(`已写 ${EVIDENCE}`);
  console.log("SESSIONS", JSON.stringify(sess.map((s) => ({ i: s.index, dur: s.durationSec, taps: s.taps }))));
  console.log("CHECKS", JSON.stringify(out.checks, null, 1).slice(0, 6000));
} catch (e) {
  out.fatal = String(e && e.stack ? e.stack : e).slice(0, 2000);
  try { writeFileSync(EVIDENCE, JSON.stringify(out, null, 2)); } catch { /* ignore */ }
  console.error("FATAL", e);
} finally {
  try { b.close(); } catch { /* ignore */ }
}
