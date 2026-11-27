/**
 * R12 · 碎片党试玩探针（CDP，390×844 DPR3，只读 src/）。
 *
 * 模拟画像：通勤/排队，每次开 2-3 分钟，一天 4-6 次，从不专门坐 30 分钟。
 * 做法：
 *  - 用存档 seed + `__MOYU__.grant(1e9)` 模拟"玩了几天的中后期玩家"（跳过早期积累）
 *  - 每次"离开"用注入的 Date.now 偏移 + reload 模拟（真实结算离线收益 + 任务是按真实时钟推移的）
 *  - 4 次打开，每次真实 2-2.5 分钟，间隔依次 4/6/6 分钟（16 分钟内开 4 次，正好覆盖"15 分钟任务"窗口）
 *
 * 产出：playtest/probe-r12-frag-evidence.json、/tmp/frag-*.png
 */
import { writeFileSync } from "node:fs";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const PORT = 9533;
const URL_ = "http://127.0.0.1:5173/";
const EVIDENCE = "playtest/probe-r12-frag-evidence.json";

/* ---------------- 页面注入：时间偏移 + announce 抓取 ---------------- */
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
    frag.mark = (name) => frag.log.push({ t: Math.round(performance.now()), kind: "mark", text: String(name) });
    window.__frag = frag;
    window.__r9 = { errors: [] };
    window.addEventListener("error", (e) => window.__r9.errors.push(String(e && e.message)));
    document.addEventListener("DOMContentLoaded", () => {
      const sr = document.getElementById("sr-live");
      if (!sr) return;
      new MutationObserver(() => {
        const t = (sr.textContent || "").trim();
        if (t) frag.log.push({ t: Math.round(performance.now()), kind: "announce", text: t });
      }).observe(sr, { childList: true, subtree: true, characterData: true });
    });
  } catch (e) {}
})()`;

/* ---------------- 页面状态快照 ---------------- */
const SNAP = `JSON.stringify((() => { try {
  const s = window.__MOYU__.state;
  const body = document.getElementById("team-body");
  const cards = [...document.querySelectorAll("#team-body .mate")];
  const btns = [...document.querySelectorAll("#team-body button[data-act]")];
  const shopCards = [...document.querySelectorAll(".shop-card")];
  const d = s.daily;
  const badge = document.querySelector("#btn-team .badge");
  const teamEl = document.getElementById("team");
  const welcomeEl = document.getElementById("welcome");
  const journalEl = document.getElementById("journal");
  const claimBtn = document.getElementById("journal-claim");
  const bodyRect = body ? body.getBoundingClientRect() : null;
  return {
    badge: badge ? badge.textContent : null,
    teamOpen: teamEl ? !teamEl.classList.contains("hidden") : false,
    teamTab: document.getElementById("tab-talents").classList.contains("active") ? "talents" : "colleagues",
    teamPoints: document.getElementById("team-points").textContent,
    panel: body ? {
      scrollH: body.scrollHeight,
      clientH: body.clientHeight,
      scrollTop: body.scrollTop,
      cards: cards.length,
      visibleCards: cards.filter((c) => { const r = c.getBoundingClientRect(); return bodyRect && r.top >= bodyRect.top - 2 && r.bottom <= bodyRect.bottom + 2; }).length,
      cardTexts: cards.map((c) => c.innerText),
      actionBtns: btns.map((b) => ({ act: b.dataset.act, id: b.dataset.id, mission: b.dataset.mission || null, disabled: b.disabled, text: b.innerText })),
      btnRects: btns.slice(0, 10).map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })
    } : null,
    colleagues: s.team.colleagues,
    talents: s.talents,
    daily: d ? { window: d.window, claimed: d.claimed, claimsToday: d.claimsToday, goals: d.goals.map((g) => ({ id: g.id, progress: g.progress, target: g.target, done: g.done })) } : null,
    journalOpen: journalEl ? !journalEl.classList.contains("hidden") : false,
    journalClaim: claimBtn ? { disabled: claimBtn.disabled, text: claimBtn.textContent } : null,
    welcomeOpen: welcomeEl ? !welcomeEl.classList.contains("hidden") : false,
    welcomeGain: document.getElementById("welcome-gain").textContent,
    welcomeTime: document.getElementById("welcome-time").textContent,
    shopAffordable: shopCards.filter((c) => !c.disabled).length,
    shopTotal: shopCards.length,
    hudMoyu: document.getElementById("hud-moyu").textContent,
    hudIdle: document.getElementById("hud-idle").textContent,
    hudClick: document.getElementById("hud-click").textContent,
    moyuValue: s.moyu,
    lifetimeValue: s.lifetimeEarned,
    rank: document.getElementById("hud-rank").textContent,
    streakVisible: !document.getElementById("hud-streak").classList.contains("hidden"),
    announce: window.__frag ? window.__frag.log.slice(-8) : [],
    errors: window.__r9 ? window.__r9.errors.slice(-3) : []
  };
} catch (e) { return { error: String(e) }; } })())`;

/* ---------------- 存档 seed ---------------- */
function seedBlob(kind) {
  const base = {
    v: 2,
    moyu: 120000,
    totalEarned: 100000000,
    levels: { coffee: 12, water: 10, chair: 8, phone: 18, toilet: 16, group: 14, meeting: 10, deep: 6, retire: 2 },
    savedAt: 0,
    createdAt: 0,
    collected: { quotes: [], flavors: [] },
    daily: null,
    surviveStreak: 0,
    patrolSurvives: 0,
    totalClicks: 400,
    visits: { date: "", count: 0 },
    lifetimeEarned: 100000000,
    prestige: 0,
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: -1 },
  };
  if (kind === "all5") {
    const c = (level, favor) => ({ level, missionId: null, startedAt: 0, endsAt: 0, favor });
    base.team = {
      colleagues: {
        zhou: c(3, 30),
        mei: c(3, 20),
        qiang: c(2, 10),
        li: c(2, 0),
        wang: c(1, 0),
      },
    };
    base.talents = { unlocked: ["click_1", "idle_1"], points: 2, rankGranted: 4 };
    base.moyu = 1000000000;
  }
  return base;
}

/* ---------------- 启动浏览器 ---------------- */
const b = await openBrowser({ port: PORT, tag: "frag" });
const out = {
  meta: { url: URL_, viewport: "390x844@3x", startedAt: new Date().toISOString(), profile: "碎片党：每次 2-3 分钟，一天 4-6 次，从不专门坐 30 分钟" },
  seed: null,
  boot: [],
  sessions: [],
  measurements: {},
  phaseF: {},
  errors: [],
};

const ev = async (expression) => {
  try {
    return await b.ev(expression);
  } catch (e) {
    out.errors.push(String(e && e.message ? e.message : e).slice(0, 300));
    return null;
  }
};
const evj = async (expression) => {
  const v = await ev(expression);
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const snap = () => evj(SNAP);
const shot = (p) => b.shot(p);
const log = (m) => console.log(`[frag] ${m}`);

async function waitGame(timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await ev(`typeof window.__MOYU__ !== "undefined" && !!document.getElementById("stage") ? 1 : 0`);
    if (ok === 1) return Date.now() - t0;
    await sleep(120);
  }
  throw new Error("game not ready");
}

async function reloadReady(tag) {
  const t0 = Date.now();
  await ev(`setTimeout(() => location.reload(), 40); 1`);
  await sleep(400);
  const readyMs = await waitGame();
  await sleep(1600);
  const ms = Date.now() - t0;
  out.boot.push({ tag, reloadToReadyMs: ms, waitGameMs: readyMs });
  log(`${tag} 重载就绪 ${ms}ms`);
  return ms;
}

async function seedAndReload(kind, daysOld, tag) {
  const t0 = Date.now();
  await ev(`(() => {
    const blob = ${JSON.stringify(seedBlob(kind))};
    const now = Date.now();
    blob.savedAt = now;
    blob.createdAt = now - ${daysOld} * 86400000;
    try { localStorage.clear(); } catch (e) {}
    try { localStorage.setItem("moyu-save", JSON.stringify(blob)); } catch (e) {}
    // 关键：拦掉 pagehide 的 saveNow，否则 seed 会被当前内存状态覆盖
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === "moyu-save") return; return orig.call(this, k, v); };
    setTimeout(() => location.reload(), 80);
    return 1;
  })()`);
  await sleep(500);
  const ready = await waitGame();
  await sleep(1800);
  const ms = Date.now() - t0;
  out.boot.push({ tag, reloadToReadyMs: ms, waitGameMs: ready, seeded: kind });
  log(`${tag} 就绪 ${ms}ms`);
  return ms;
}

function startSession(index) {
  return { index, t0: Date.now(), actions: [], samples: [], taps: 0 };
}
let cur = null;
async function act(desc, fn) {
  const at = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  let result;
  try {
    result = await fn();
  } catch (e) {
    result = { error: String(e && e.message ? e.message : e) };
    out.errors.push(`S${cur.index} ${desc}: ${result.error}`.slice(0, 300));
  }
  cur.actions.push({ at, desc, result: result === undefined ? null : result });
  log(`S${cur.index} +${at}s ${desc}`);
  await sleep(120);
  return result;
}
async function tap(sel) {
  cur.taps++;
  return ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 0; el.click(); return 1; })()`);
}
async function tapExpr(expr) {
  cur.taps++;
  return ev(expr);
}

async function measureIdle(ms = 2000) {
  const r = await evj(`(async () => {
    const a = window.__MOYU__.state.moyu; const t0 = performance.now();
    await new Promise((r) => setTimeout(r, ${ms}));
    const b = window.__MOYU__.state.moyu; const dt = (performance.now() - t0) / 1000;
    return JSON.stringify({ from: a, to: b, seconds: Math.round(dt * 100) / 100, idlePerSec: Math.round((b - a) / dt) });
  })()`);
  return r;
}

async function watch(sec, stepMs = 15000) {
  const t0 = Date.now();
  const samples = [];
  while ((Date.now() - t0) / 1000 < sec) {
    const s = await snap();
    samples.push({
      at: Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10,
      badge: s.badge,
      teamPoints: s.teamPoints,
      shopAffordable: s.shopAffordable,
      daily: s.daily,
      journalClaim: s.journalClaim,
      welcome: s.welcomeOpen,
      hudIdle: s.hudIdle,
      announces: (s.announce || []).map((x) => x.text).slice(-2),
      teammatesBusy: s.colleagues ? Object.values(s.colleagues).filter((c) => c.missionId).length : 0,
      teammatesDone: s.colleagues
        ? Object.values(s.colleagues).filter((c) => c.missionId && c.endsAt <= Date.now()).length
        : 0,
    });
    cur.samples = samples;
    await sleep(stepMs);
  }
  return samples;
}

/* 每会话"新系统可做的事"与"老系统可做的事"统计 */
function categorize(samples) {
  const first = samples[0] || {};
  const newActionable = samples.filter((x) => Number(x.badge || 0) > 0 || Number((x.teamPoints || "天赋点 0").replace(/\D/g, "")) > 0).length;
  const oldActionable = samples.filter((x) => x.shopAffordable > 0 || (x.journalClaim && !x.journalClaim.disabled)).length;
  return { samples: samples.length, samplesWithNewSystemAction: newActionable, samplesWithOldSystemAction: oldActionable, first };
}

try {
  /* ================= 0. 载入 + seed ================= */
  await setupMobilePage(b, { injectSource: INJECT, url: URL_ });
  const boot0 = await waitGame();
  out.boot.push({ tag: "first-load", waitGameMs: boot0 });
  await sleep(1200);
  const bootSeed = await seedAndReload("mid", 3, "seed-mid");
  out.seed = { kind: "mid（lifetime 1e8，等级中段，未招募）", bootSeed };
  await shot("/tmp/frag-0-seed.png");

  /* ================= 会话 1（t≈0，150s） ================= */
  cur = startSession(1);
  cur.simNow = (await ev("Date.now()")) || 0;
  await act("首屏：看 HUD / 红点 / 段位（等 1.2s 让天赋点发放飘字出现）", async () => {
    const s = await snap();
    cur.open = s;
    await shot("/tmp/frag-1.png");
    return { badge: s.badge, welcome: s.welcomeOpen, rank: s.rank, hudIdle: s.hudIdle, announces: (s.announce || []).map((x) => x.text) };
  });
  await act("__MOYU__.grant(1e9)（模拟几天积累，跳过早期）", async () => {
    await ev(`window.__MOYU__.grant(1e9); 1`);
    await sleep(900);
    const s = await snap();
    return { hudMoyu: s.hudMoyu, rank: s.rank, announces: (s.announce || []).map((x) => x.text) };
  });
  const idle1 = await measureIdle(2000);
  cur.idle = idle1;
  await act("量挂机速率 2s", async () => idle1);
  await act("点 👥 打开摸鱼小队（同事页）", async () => {
    await tap("#btn-team");
    await sleep(500);
    const s = await snap();
    await shot("/tmp/frag-s1-team.png");
    return {
      teamPoints: s.teamPoints,
      panel: s.panel ? { scrollH: s.panel.scrollH, clientH: s.panel.clientH, cards: s.panel.cards, visibleCards: s.panel.visibleCards } : null,
      missionButtons: s.panel ? s.panel.actionBtns.filter((x) => x.act === "dispatch").length : null,
      recruitButtons: s.panel ? s.panel.actionBtns.filter((x) => x.act === "recruit").length : null,
    };
  });
  await act("招募老周（1.2万）", async () => {
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="recruit"][data-id="zhou"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(600);
    const s = await snap();
    return { clicked, colleagues: Object.keys(s.colleagues), announces: (s.announce || []).map((x) => x.text).slice(-2) };
  });
  await act("给老周派「溜一圈」15 分钟", async () => {
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(700);
    const s = await snap();
    await shot("/tmp/frag-s1-dispatch.png");
    return {
      clicked,
      cardText: s.panel && s.panel.cardTexts[0],
      dispatchButtonsShowRewardPreview: /\+|奖励/.test((s.panel && s.panel.cardTexts[0]) || ""),
      announces: (s.announce || []).map((x) => x.text).slice(-2),
    };
  });
  await act("关面板", async () => {
    await tap("#team-close");
    await sleep(300);
    return { teamOpen: (await snap()).teamOpen };
  });
  await act("再开 👥 → 切「天赋」页", async () => {
    await tap("#btn-team");
    await sleep(450);
    await tap("#tab-talents");
    await sleep(450);
    const s = await snap();
    await shot("/tmp/frag-s1-talents.png");
    return {
      teamPoints: s.teamPoints,
      panel: s.panel ? { scrollH: s.panel.scrollH, clientH: s.panel.clientH } : null,
      enabledTalentButtons: s.panel ? s.panel.actionBtns.filter((x) => x.act === "talent" && !x.disabled).length : null,
      totalTalentButtons: s.panel ? s.panel.actionBtns.filter((x) => x.act === "talent").length : null,
    };
  });
  await act("点「点亮」第 1 点", async () => {
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="talent"]:not([disabled])'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(500);
    const s = await snap();
    return { clicked, talents: s.talents, teamPoints: s.teamPoints };
  });
  await act("点「点亮」第 2 点", async () => {
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="talent"]:not([disabled])'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(500);
    const s = await snap();
    await shot("/tmp/frag-s1-talents-done.png");
    return { clicked, talents: s.talents, teamPoints: s.teamPoints };
  });
  await act("关面板", async () => {
    await tap("#team-close");
    await sleep(300);
    return { teamOpen: (await snap()).teamOpen };
  });
  await act("老系统：商店买 3 次升级", async () => {
    const before = await snap();
    for (let i = 0; i < 3; i++) {
      const clicked = await tapExpr(`(() => { const el = document.querySelector('.shop-card:not([disabled])'); if (!el) return 0; el.click(); return 1; })()`);
      if (clicked !== 1) break;
      await sleep(450);
    }
    const s = await snap();
    return { shopAffordableBefore: before.shopAffordable, shopAffordableAfter: s.shopAffordable, daily: s.daily };
  });
  {
    const elapsed = (Date.now() - cur.t0) / 1000;
    cur.watch = await watch(Math.max(20, 150 - elapsed), 15000);
    await shot("/tmp/frag-1-end.png");
  }
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  cur.categorize = categorize(cur.watch);
  out.sessions.push(cur);
  log(`S1 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ================= 间隔 4 分钟 → 会话 2（t≈6.5min，110s） ================= */
  await ev(`window.__MOYU__.saveNow(); window.__frag.jump(4 * 60 * 1000); 1`);
  await sleep(500);
  const boot2 = await reloadReady("gap+4min");
  await sleep(600);
  cur = startSession(2);
  cur.simNow = (await ev("Date.now()")) || 0;
  await act("回来：欢迎面板是否挡住 + 红点", async () => {
    const s = await snap();
    cur.open = s;
    await shot("/tmp/frag-2.png");
    return { welcome: s.welcomeOpen, welcomeGain: s.welcomeGain, welcomeTime: s.welcomeTime, badge: s.badge, announce: (s.announce || []).map((x) => x.text) };
  });
  await act("点「继续摸鱼」关掉欢迎面板（每次回来多 1 下）", async () => {
    await tap("#welcome-ok");
    await sleep(400);
    return { welcome: (await snap()).welcomeOpen };
  });
  await act("开 👥 看派遣进度", async () => {
    await tap("#btn-team");
    await sleep(500);
    const s = await snap();
    await shot("/tmp/frag-s2-countdown.png");
    return { cardText: s.panel && s.panel.cardTexts[0], actionBtns: s.panel && s.panel.actionBtns, badge: s.badge };
  });
  await act("关面板", async () => {
    await tap("#team-close");
    await sleep(250);
    return null;
  });
  await act("开 📔 日报看今日目标", async () => {
    await tap("#btn-journal");
    await sleep(600);
    const s = await snap();
    await shot("/tmp/frag-s2-journal.png");
    return { daily: s.daily, journalClaim: s.journalClaim };
  });
  await act("关日报", async () => {
    await tap("#journal-close");
    await sleep(250);
    return null;
  });
  await act("手头没事：招募小美（80万）", async () => {
    await tap("#btn-team");
    await sleep(450);
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="recruit"][data-id="mei"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(600);
    const s = await snap();
    return { clicked, colleagues: Object.keys(s.colleagues), announces: (s.announce || []).map((x) => x.text).slice(-2) };
  });
  await act("试图给小美派活（看最短任务多久）", async () => {
    const s0 = await snap();
    const missions = s0.panel ? s0.panel.actionBtns.filter((x) => x.act === "dispatch" && x.id === "mei") : [];
    return { missionOptions: missions.map((m) => m.text) };
  });
  await act("关面板（不派：最短 15 分钟现在派了也是等）", async () => {
    await tap("#team-close");
    await sleep(250);
    return null;
  });
  {
    const elapsed = (Date.now() - cur.t0) / 1000;
    cur.watch = await watch(Math.max(20, 110 - elapsed), 12000);
    await shot("/tmp/frag-2-end.png");
  }
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  cur.categorize = categorize(cur.watch);
  out.sessions.push(cur);
  log(`S2 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ================= 间隔 6 分钟 → 会话 3（t≈14min，145s，任务在会话内完成） ================= */
  await ev(`window.__MOYU__.saveNow(); window.__frag.jump(6 * 60 * 1000); 1`);
  await sleep(500);
  await reloadReady("gap+6min");
  await sleep(500);
  cur = startSession(3);
  cur.simNow = (await ev("Date.now()")) || 0;
  await act("回来：欢迎面板 + 红点", async () => {
    const s = await snap();
    cur.open = s;
    await shot("/tmp/frag-3.png");
    return { welcome: s.welcomeOpen, welcomeGain: s.welcomeGain, badge: s.badge };
  });
  await act("关欢迎面板", async () => {
    await tap("#welcome-ok");
    await sleep(300);
    return null;
  });
  await act("开 👥 看老周还剩多久", async () => {
    await tap("#btn-team");
    await sleep(500);
    const s = await snap();
    await shot("/tmp/frag-s3-countdown.png");
    return { cardText: s.panel && s.panel.cardTexts[0], badge: s.badge };
  });
  await act("关面板", async () => {
    await tap("#team-close");
    await sleep(250);
    return null;
  });
  {
    const elapsed = (Date.now() - cur.t0) / 1000;
    cur.watch = await watch(Math.max(30, 145 - elapsed), 10000);
    const change = cur.samples.find((x) => Number(x.badge || 0) > 0);
    cur.completionWhileOpen = change || null;
    cur.completionAnnounce = (await snap()).announce;
    await shot("/tmp/frag-3-end.png");
  }
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  cur.categorize = categorize(cur.watch);
  out.sessions.push(cur);
  log(`S3 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ================= 间隔 6 分钟 → 会话 4（t≈22min，150s，领奖） ================= */
  await ev(`window.__MOYU__.saveNow(); window.__frag.jump(6 * 60 * 1000); 1`);
  await sleep(500);
  await reloadReady("gap+6min");
  await sleep(500);
  cur = startSession(4);
  cur.simNow = (await ev("Date.now()")) || 0;
  await act("回来：不点 👥，先看 HUD 上有没有任务完成提示", async () => {
    const s = await snap();
    cur.open = s;
    await shot("/tmp/frag-4.png");
    return {
      badge: s.badge,
      welcome: s.welcomeOpen,
      announceOnReturn: (s.announce || []).map((x) => x.text),
      toastTextOnScreen: s.announce && s.announce.length ? s.announce[s.announce.length - 1].text : null,
    };
  });
  await act("关欢迎面板", async () => {
    await tap("#welcome-ok");
    await sleep(300);
    return null;
  });
  await act("开 👥 领老周奖励", async () => {
    await tap("#btn-team");
    await sleep(500);
    const before = await snap();
    const claimBtn = before.panel ? before.panel.actionBtns.find((x) => x.act === "claim") : null;
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="claim"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(700);
    const s = await snap();
    await shot("/tmp/frag-s4-claim.png");
    return {
      claimButtonText: claimBtn ? claimBtn.text : null,
      clicked,
      favorAfter: s.colleagues && s.colleagues.zhou,
      announces: (s.announce || []).map((x) => x.text).slice(-2),
      moyuBefore: before.moyuValue,
      moyuAfter: s.moyuValue,
      rewardExact: Math.round((s.moyuValue || 0) - (before.moyuValue || 0)),
      hudMoyu: s.hudMoyu,
    };
  });
  await act("再派老周「溜一圈」15 分钟", async () => {
    const clicked = await tapExpr(`(() => { const el = document.querySelector('#team-body button[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); if (!el) return 0; el.click(); return 1; })()`);
    await sleep(600);
    const s = await snap();
    return { clicked, cardText: s.panel && s.panel.cardTexts[0] };
  });
  await act("关面板", async () => {
    await tap("#team-close");
    await sleep(250);
    return null;
  });
  await act("天赋页：确认没有可点的（点数为 0）", async () => {
    await tap("#btn-team");
    await sleep(400);
    await tap("#tab-talents");
    await sleep(400);
    const s = await snap();
    await shot("/tmp/frag-s4-talents.png");
    await tap("#team-close");
    await sleep(250);
    return { teamPoints: s.teamPoints, enabledTalentButtons: s.panel ? s.panel.actionBtns.filter((x) => x.act === "talent" && !x.disabled).length : null };
  });
  await act("【实验】页面开着时任务到点：只快进时钟，看有没有提示", async () => {
    await ev(`window.__frag.advance(16 * 60 * 1000); 1`);
    await sleep(1800);
    const s = await snap();
    await shot("/tmp/frag-s4-badge-only.png");
    return { badge: s.badge, announces: (s.announce || []).map((x) => x.text), welcome: s.welcomeOpen };
  });
  {
    const elapsed = (Date.now() - cur.t0) / 1000;
    cur.watch = await watch(Math.max(20, 150 - elapsed), 10000);
  }
  cur.durationSec = Math.round(((Date.now() - cur.t0) / 1000) * 10) / 10;
  cur.categorize = categorize(cur.watch);
  out.sessions.push(cur);
  log(`S4 结束 ${cur.durationSec}s taps=${cur.taps}`);

  /* ================= Phase F：全同事面板 / 天赋树 滚动量 ================= */
  await seedAndReload("all5", 6, "seed-all5");
  await sleep(800);
  const f = {};
  // 同事页
  await ev(`document.getElementById("btn-team").click(); 1`);
  await sleep(700);
  let s = await snap();
  await shot("/tmp/frag-panel-all5-top.png");
  f.colleaguesPanel = {
    cards: s.panel && s.panel.cards,
    scrollH: s.panel && s.panel.scrollH,
    clientH: s.panel && s.panel.clientH,
    screens: s.panel ? Math.round(((s.panel.scrollH - s.panel.clientH) / s.panel.clientH) * 100) / 100 : null,
    visibleCardsAtTop: s.panel && s.panel.visibleCards,
    dispatchButtons: s.panel && s.panel.actionBtns.filter((x) => x.act === "dispatch").length,
    missionButtonRects: s.panel && s.panel.btnRects,
  };
  // 真手势滑 1 次，看能滑多少
  const swipe = async (fromY, toY) => {
    await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: fromY, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await b.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: Math.round(fromY + ((toY - fromY) * i) / 6), id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
      await sleep(30);
    }
    await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(400);
    return evj(`JSON.stringify({ scrollTop: document.getElementById("team-body").scrollTop, visible: [...document.querySelectorAll("#team-body .mate")].filter((c) => { const b = document.getElementById("team-body").getBoundingClientRect(); const r = c.getBoundingClientRect(); return r.top >= b.top - 2 && r.bottom <= b.bottom + 2; }).length })`);
  };
  f.swipe1 = await swipe(700, 320);
  await shot("/tmp/frag-panel-all5-mid.png");
  f.swipe2 = await swipe(700, 320);
  await shot("/tmp/frag-panel-all5-bottom.png");
  const s2 = await snap();
  f.colleaguesPanel.afterScrolls = { scrollTop: s2.panel && s2.panel.scrollTop, scrollH: s2.panel && s2.panel.scrollH, clientH: s2.panel && s2.panel.clientH };
  // 天赋页
  await ev(`document.getElementById("tab-talents").click(); 1`);
  await sleep(600);
  s = await snap();
  await shot("/tmp/frag-talents-top.png");
  f.talentsPanel = {
    scrollH: s.panel && s.panel.scrollH,
    clientH: s.panel && s.panel.clientH,
    screens: s.panel ? Math.round(((s.panel.scrollH - s.panel.clientH) / s.panel.clientH) * 100) / 100 : null,
    teamPoints: s.teamPoints,
    talentRows: s.panel ? s.panel.actionBtns.filter((x) => x.act === "talent").length : null,
    enabled: s.panel ? s.panel.actionBtns.filter((x) => x.act === "talent" && !x.disabled).length : null,
  };
  await b.ev(`document.getElementById("team-body").scrollTop = 99999; 1`);
  await sleep(300);
  await shot("/tmp/frag-talents-bottom.png");
  f.talentsPanel.scrolledToBottom = await evj(`JSON.stringify((() => { const b = document.getElementById("team-body"); return { scrollTop: b.scrollTop, endText: b.innerText.slice(-120) }; })())`);
  out.phaseF = f;
  log(`phaseF 完成：同事面板 ${f.colleaguesPanel.scrollH}px/${f.colleaguesPanel.clientH}px`);

  /* ================= Phase G：本地复算（奖励比 / 节奏） ================= */
  const idle = (out.sessions[0] && out.sessions[0].idle && out.sessions[0].idle.idlePerSec) || 0;
  const claim = out.sessions[3] && out.sessions[3].actions.find((a) => /领老周奖励/.test(a.desc));
  const rewardExact = claim && claim.result ? claim.result.rewardExact : null;
  const station = idle; // 上界近似：把"总挂机（含同事）"都当作工位挂机
  const coef = 0.011;
  const mk = (label, seconds, mult) => {
    const r = Math.floor(station * seconds * coef * mult);
    return {
      label,
      seconds,
      combinedMult: Math.round(mult * 100) / 100,
      reward: r,
      pctOfSameDurationIdle: Math.round((r / (station * seconds)) * 1000) / 10,
      idleSecondsEquivalent: Math.round(r / station),
    };
  };
  const simBase = out.sessions[0] ? out.sessions[0].simNow : null;
  out.measurements = {
    idlePerSecMeasured: idle,
    idleHudText: out.sessions[0] ? out.sessions[0].open.hudIdle : null,
    claimButtonText: claim ? claim.result.claimButtonText : null,
    rewardExactMeasured: rewardExact,
    dispatchFormulaCheck: (() => {
      // 老周 lv1、溜一圈(errand)不匹配 chat、mult 1.2
      const expected = Math.max(300, station * 900 * coef) * 1.2;
      return {
        expected,
        measured: rewardExact,
        note: "老周 lv1 + 溜一圈 15 分钟（不匹配，倍率 1.2）；实测含 0.7s 挂机误差",
        measuredMinutesOfIdle: rewardExact ? Math.round((rewardExact / station / 60) * 100) / 100 : null,
      };
    })(),
    missionValueTable: [
      mk("溜一圈 15m（lv1 不匹配）", 900, 1.2),
      mk("溜一圈 15m（lv5+匹配+好感100）", 900, 1.2 * 1.5 * 2 * 1.5),
      mk("楼下买咖啡 8h（lv1 不匹配）", 28800, 2.8),
      mk("楼下买咖啡 8h（lv5+匹配+好感100）", 28800, 2.8 * 1.5 * 2 * 1.5),
    ],
    sessionTimeline: out.sessions.map((s) => ({
      session: s.index,
      simMinutesFromStart: simBase ? Math.round(((s.simNow - simBase) / 60000) * 100) / 100 : null,
      realDurationSec: s.durationSec,
      taps: s.taps,
      actions: s.actions.length,
      badgesSeen: s.watch ? [...new Set(s.watch.map((x) => x.badge))] : [],
      claimableSamples: s.watch ? s.watch.filter((x) => Number(x.badge || 0) > 0).length : 0,
      sampleCount: s.watch ? s.watch.length : 0,
    })),
    newSystemActionBySession: out.sessions.map((s) => ({ session: s.index, ...s.categorize })),
    completionWhileOpen: out.sessions[2] ? out.sessions[2].completionWhileOpen : null,
    completionAnnounce: out.sessions[2] ? out.sessions[2].completionAnnounce : null,
  };

  writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
  log(`已写 ${EVIDENCE}`);
  console.log("SESSIONS", JSON.stringify(out.sessions.map((s) => ({ i: s.index, dur: s.durationSec, taps: s.taps, actions: s.actions.length })), null, 0));
  console.log("MEASUREMENTS", JSON.stringify(out.measurements.formula));
  console.log("PHASEF", JSON.stringify(out.phaseF));
} catch (e) {
  out.fatal = String(e && e.stack ? e.stack : e).slice(0, 2000);
  try {
    writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
  } catch {
    /* ignore */
  }
  console.error("FATAL", e);
} finally {
  try {
    b.close();
  } catch {
    /* ignore */
  }
}
