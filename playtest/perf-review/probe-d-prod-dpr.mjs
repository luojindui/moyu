import { runChrome, connect, sleep } from "../lib/chrome.mjs";
import { INSTRUMENT } from "./instrument.mjs";
import { writeFileSync } from "node:fs";

const DEV = "http://127.0.0.1:5173/";
const PROD_LOCAL = "http://127.0.0.1:5199/";
const PROD_ONLINE = "https://luojindui.github.io/moyu/";
const out = { dev: {}, prod: {}, errors: [] };
const J = (o) => JSON.stringify(o, null, 1);

const topFns = (profile, n = 12) => {
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const agg = new Map();
  for (const [id, us] of self) {
    const cf = nodes.get(id)?.callFrame;
    if (!cf) continue;
    const k = `${cf.functionName || "(anon)"} @ ${(cf.url || "").replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "")}`;
    agg.set(k, (agg.get(k) ?? 0) + us);
  }
  return [...agg].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, us]) => ({ k, ms: +(us / 1000).toFixed(1) }));
};
const busyMs = (profile) => {
  let total = 0, idle = 0;
  const nodes = new Map(profile.nodes.map((x) => [x.id, x]));
  for (let i = 0; i < profile.samples.length; i++) {
    const cf = nodes.get(profile.samples[i])?.callFrame;
    const dt = (profile.timeDeltas[i] ?? 0) / 1000;
    total += dt;
    if (cf?.functionName === "(idle)") idle += dt;
  }
  return { totalMs: +total.toFixed(0), busyMs: +(total - idle).toFixed(0), busyPct: +(((total - idle) / total) * 100).toFixed(1) };
};

const gapStats = (g) => {
  if (!g || !g.length) return null;
  const s = [...g].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: g.length, avg: +(g.reduce((a, b) => a + b, 0) / g.length).toFixed(1), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1], over33: g.filter((x) => x > 33.4).length };
};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send; const rawEv = c.ev;
  const ev = (e) => Promise.race([rawEv(e), new Promise((r) => setTimeout(() => r({ __timeout: true }), 10000))]);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  const waitReady = async () => { for (let i = 0; i < 600; i++) { if (await ev("!!(window.__perf && window.__perf.firstDrawAt)")) return true; await sleep(50); } return false; };

  // ---------- A. dev: 首次点击音频卡顿 ----------
  await send("Page.navigate", { url: DEV });
  await waitReady(); await sleep(800);
  await ev("__perf.frameGaps.length = 0");
  await ev(`(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left+r.width/2, clientY: r.top+r.height*0.55, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); return 1; })()`);
  await sleep(600);
  const firstTap = { gaps: gapStats(await ev("__perf.frameGaps.slice(0)")), longtasks: await ev("__perf.longtasks.map(l => l.dur)") };
  await ev("__perf.frameGaps.length = 0; __perf.longtasks.length = 0");
  await ev(`(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left+r.width/2, clientY: r.top+r.height*0.55, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); return 1; })()`);
  await sleep(600);
  const secondTap = { gaps: gapStats(await ev("__perf.frameGaps.slice(0)")), longtasks: await ev("__perf.longtasks.map(l => l.dur)") };
  out.dev.tapJank = { firstTap, secondTap, audioCtx: await ev("!!window.AudioContext") };

  // ---------- B. dev: DPR 对 CPU 的影响 ----------
  const profileFor = async (ms) => {
    await send("Profiler.enable"); await send("Profiler.setSamplingInterval", { interval: 200 }); await send("Profiler.start");
    const a = await ev("({draw: __perf.drawCalls, t: performance.now(), raf: __perf.raf.total})");
    await sleep(ms);
    const b = await ev("({draw: __perf.drawCalls, t: performance.now(), raf: __perf.raf.total})");
    const { profile } = await send("Profiler.stop");
    return { ...busyMs(profile), drawPerSec: Math.round((b.draw - a.draw) / ((b.t - a.t) / 1000)), rafPerSec: +(((b.raf - a.raf) / ((b.t - a.t) / 1000)).toFixed(1)), canvas: await ev("({w: document.getElementById('stage').width, h: document.getElementById('stage').height, dpr: devicePixelRatio})") };
  };
  out.dev.dpr = {};
  for (const dpr of [3, 2, 1]) {
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: dpr, mobile: true });
    await sleep(700);
    out.dev.dpr["dpr" + dpr] = await profileFor(4000);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await sleep(600);

  // ---------- C. dev: 最坏场景（满装修 + 老板弹层 + 小游戏 + 连点） ----------
  const fullSave = {
    v: 2, moyu: 5e9, totalEarned: 8e9, lifetimeEarned: 9e9, savedAt: Date.now(), createdAt: Date.now() - 3 * 86400e3,
    levels: { coffee: 250, water: 250, chair: 250, phone: 250, toilet: 250, group: 250, meeting: 250, deep: 250, retire: 250 },
    collected: { quotes: Array.from({ length: 30 }, (_, i) => i), flavors: Array.from({ length: 45 }, (_, i) => i) },
    decor: ["rug", "lamp", "fridge", "chair", "aquarium", "projector", "catbed", "plant"],
    prestige: 20, totalClicks: 123456, patrolSurvives: 200, surviveStreak: 42,
    visits: { date: new Date().toLocaleDateString("sv-SE"), count: 3 },
    team: { colleagues: { zhou: { level: 10, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 1e6 }, mei: { level: 10, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 1e6 }, qiang: { level: 10, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 1e6 }, li: { level: 10, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 1e6 }, wang: { level: 10, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 1e6 } } },
    energy: { date: new Date().toLocaleDateString("sv-SE"), left: 0, used: ["slack", "social", "fake-work"], boosted: { idleMult: 1.3125, patrolRewardMult: 2.2, clickMult: 1 } },
    arcade: { date: new Date().toLocaleDateString("sv-SE"), played: 0, best: {} },
  };
  await ev(`localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(fullSave))})`);
  await send("Page.reload", { ignoreCache: true });
  await waitReady(); await sleep(1500);
  out.dev.fullState = await ev("({docSeq: __perf.docSeq, decor: __MOYU__.state.decor.length, levels: __MOYU__.state.levels.coffee, frames: __MOYU__.frames})");
  // 全装修 + 5cps 点击
  await ev(`(() => { clearInterval(window.__ck); window.__ck = setInterval(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left+r.width*0.5, clientY: r.top+r.height*0.55, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); }, 200); })()`);
  out.dev.worstDecorClick = await profileFor(5000);
  // 老板回合弹层 + 小游戏 + 连点
  await ev("clearInterval(window.__ck)");
  await ev("__MOYU__.forceBoss('choice')");
  await sleep(300);
  await ev("document.getElementById('btn-arcade').click()");
  await sleep(300);
  await ev("document.querySelector('#arcade-body button[data-game]').click()");
  await ev(`window.__ck = setInterval(() => { const cv = document.getElementById('stage'); const r = cv.getBoundingClientRect(); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left+r.width*0.5, clientY: r.top+r.height*0.55, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true })); }, 100)`);
  await ev("__perf.frameGaps.length = 0; __perf.longtasks.length = 0");
  const worst = await profileFor(5000);
  worst.frameGaps = gapStats(await ev("__perf.frameGaps.slice(0)"));
  worst.longtasks = await ev("__perf.longtasks.map(l => l.dur)");
  worst.rafActive = await ev("__perf.raf.active");
  worst.panels = await ev(`({boss: !document.getElementById('boss-choice').classList.contains('hidden'), arcade: !document.getElementById('arcade').classList.contains('hidden')})`);
  out.dev.worstAll = worst;
  await ev("clearInterval(window.__ck)");
  out.errors = c.errors.slice(0, 20);

  // ---------- D. 生产构建启动（本地静态服 + 网络限速） ----------
  const coldStart = async (url, label, runs) => {
    const res = [];
    for (let i = 0; i < runs; i++) {
      await send("Storage.clearDataForOrigin", { origin: new URL(url).origin, storageTypes: "all" });
      await send("Network.enable");
      await send("Network.setCacheDisabled", { cacheDisabled: true });
      await send("Page.navigate", { url });
      let ok = false;
      for (let k = 0; k < 800; k++) { if (await ev("!!(window.__perf && window.__perf.firstDrawAt)")) { ok = true; break; } await sleep(25); }
      const m = await ev(`(() => { const P = window.__perf || {}; const n = performance.getEntriesByType('navigation')[0] || {}; const rs = performance.getEntriesByType('resource'); return { ok: ${'!!P.firstDrawAt'}, fcp: P.firstContentfulPaint ?? null, firstRafAt: P.firstRafAt ?? null, firstDrawAt: P.firstDrawAt ?? null, ttfb: n.responseStart ? +n.responseStart.toFixed(1) : null, domInteractive: n.domInteractive ? +n.domInteractive.toFixed(1) : null, load: n.loadEventEnd ? +n.loadEventEnd.toFixed(1) : null, transferKB: +(((n.transferSize||0) + rs.reduce((a, r) => a + (r.transferSize||0), 0)) / 1024).toFixed(1), resources: rs.length }; })()`);
      res.push(m);
      await sleep(300);
    }
    out.prod[label] = res;
  };
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  // 4G-ish: 100ms RTT, 10Mbps down
  await send("Network.enable");
  await send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 5 * 1024 * 1024 / 8 });
  await coldStart(PROD_LOCAL, "local4G", 3);
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await coldStart(PROD_LOCAL, "localFast", 2);
  await coldStart(PROD_ONLINE, "onlineFast", 2);

  writeFileSync("playtest/perf-review/out-d-prod-dpr.json", J(out));
  console.log(J(out));
  c.close();
}, { timeoutMs: 300_000 });
