import { runChrome, connect, sleep } from "../lib/chrome.mjs";
import { INSTRUMENT } from "./instrument.mjs";
import { writeFileSync } from "node:fs";

const URL = "http://127.0.0.1:5173/";
const out = { save: {}, robustness: {}, rapid: {}, minigame: {}, errors: [] };
const J = (o) => JSON.stringify(o, null, 1);

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send; const rawEv = c.ev;
  const ev = (e) => Promise.race([rawEv(e), new Promise((r) => setTimeout(() => r({ __timeout: true }), 12000))]);
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INSTRUMENT });
  const nav = async () => { await send("Page.navigate", { url: URL }); for (let i = 0; i < 400; i++) { if (await ev("!!window.__MOYU__")) return; await sleep(25); } };
  await nav();
  await sleep(1500);

  // ============ 1) 存档体积 / 序列化耗时 ============
  const appSaveBefore = await ev(`(() => { try { const r = localStorage.getItem('moyu-save'); return r ? new TextEncoder().encode(r).length : 0; } catch { return -1; } })()`);
  out.save = await ev(`(async () => {
    const stateM = await import('/src/engine/state.ts');
    const saveM = await import('/src/engine/save.ts');
    const upM = await import('/src/engine/upgrades.ts');
    const teamM = await import('/src/engine/team.ts');
    const talM = await import('/src/engine/talents.ts');
    const decorM = await import('/src/engine/decor.ts');
    const cardsM = await import('/src/engine/cards.ts');
    const enM = await import('/src/engine/energy.ts');
    const miniM = await import('/src/engine/minigames.ts');
    const colM = await import('/src/engine/collection.ts');
    const dailyM = await import('/src/engine/daily.ts');
    const flavorM = await import('/src/engine/flavor.ts');
    const adapter = {
      getItem: (k) => localStorage.getItem(k),
      setItem: (k, v) => localStorage.setItem(k, v),
      removeItem: (k) => localStorage.removeItem(k),
    };
    const today = new Date().toLocaleDateString('sv-SE');
    const now = Date.now();
    // --- 满进度状态 ---
    let s = stateM.initialState();
    s.moyu = 8.5e12; s.totalEarned = 2.2e13; s.lifetimeEarned = 3.9e14; s.prestige = 20;
    s.levels = Object.fromEntries(upM.UPGRADES.map((u) => [u.id, 250]));
    s.team.colleagues = Object.fromEntries(teamM.COLLEAGUES.map((d) => [d.id, { level: 10, missionId: null, startedAt: 0, endsAt: 0, favor: 100, autoRepeat: true, rewardSnapshot: 123456789 }]));
    s.talents.points = 0; s.talents.unlocked = talM.TALENTS.map((t) => t.id); s.talents.rankGranted = 12; s.talents.overflow = 30; s.talents.dailyGiftDate = today;
    s.decor = decorM.DECOR.map((d) => d.id);
    s.collected = { quotes: Array.from({ length: flavorM.MEME_QUOTES.length }, (_, i) => i), flavors: Array.from({ length: 45 }, (_, i) => i) };
    const offers = cardsM.CARDS.slice(0, 3).map((c) => c.id);
    s.cards = { date: today, offers, chosen: offers[0] ?? null, chosenDate: today, until: now + 3600e3, dismissed: true, nextDayGuaranteed: null };
    s.energy = { date: today, left: 0, used: ['slack', 'social', 'fake-work'], boosted: { idleMult: 1.25 * 1.05, patrolRewardMult: 2.2, clickMult: 1 } };
    s.arcade = { date: today, played: 3, best: { coffee: 540, findboss: 1200, rhythm: 1180 } };
    s.daily = dailyM.ensureDaily(stateM.initialState(), today, () => 0.5, 1).daily;
    s.daily = { ...s.daily, claimed: false, streak: 12, goals: s.daily.goals.map((g) => ({ ...g, progress: g.target, done: true })) };
    s.totalClicks = 123456; s.patrolSurvives = 200; s.surviveStreak = 42; s.visits = { date: today, count: 3 };
    // 尺寸/耗时
    const raw = saveM.encodeSaveCode(JSON.stringify(s));
    saveM.serialize(s, adapter, now);
    const stored = localStorage.getItem(saveM.SAVE_KEY) ?? '';
    const before = performance.now();
    for (let i = 0; i < 100; i++) saveM.serialize(s, adapter, now);
    const serMs = (performance.now() - before) / 100;
    const before2 = performance.now();
    for (let i = 0; i < 100; i++) saveM.restore(adapter, now);
    const resMs = (performance.now() - before2) / 100;
    const jsonOnly = performance.now();
    for (let i = 0; i < 100; i++) JSON.stringify(s);
    const jsonMs = (performance.now() - jsonOnly) / 100;
    // 存储与真实档
    const realRaw = localStorage.getItem(saveM.SAVE_KEY) ?? '';
    return {
      fullStateJsonBytes: new TextEncoder().encode(JSON.stringify(s)).length,
      fullSaveBlobBytes: new TextEncoder().encode(stored).length,
      saveCodeChars: raw.length,
      serializeMeanMs: +serMs.toFixed(3),
      restoreMeanMs: +resMs.toFixed(3),
      jsonStringifyMeanMs: +jsonMs.toFixed(3),
      restorePctOfSerialize: +((resMs / serMs) * 100).toFixed(0),
      realAppSaveBytes: new TextEncoder().encode(realRaw).length,
      appSaveBytesBeforeBench: ${appSaveBefore},
    };
  })()`);

  // ============ 2) 篡改存档健壮性 ============
  const cases = [
    ["huge_numbers", { v: 2, moyu: 1e308, totalEarned: 1e308, lifetimeEarned: 1e308, savedAt: Date.now(), levels: {} }],
    ["huge_prestige", { v: 2, moyu: 100, totalEarned: 100, lifetimeEarned: 100, savedAt: Date.now(), levels: {}, prestige: 1e308 }],
    ["max_levels", { v: 2, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, savedAt: Date.now(), levels: { coffee: 1000, water: 1000, chair: 1000, phone: 1000, toilet: 1000, group: 1000, meeting: 1000, deep: 1000, retire: 1000 } }],
    ["neg_and_nan_like", { v: 2, moyu: -1, totalEarned: -5, lifetimeEarned: -2, savedAt: "not-a-number", levels: null }],
    ["offline_megagap", { v: 2, moyu: 10, totalEarned: 10, lifetimeEarned: 10, savedAt: -1e308, createdAt: 1e308, levels: { coffee: 3 } }],
    ["future_savedAt", { v: 2, moyu: 10, totalEarned: 10, lifetimeEarned: 10, savedAt: Date.now() + 9e8, levels: { coffee: 3 } }],
    ["garbage_nested", { v: 2, moyu: 10, totalEarned: 10, lifetimeEarned: 10, savedAt: Date.now(), levels: { coffee: "x", water: 1.5, chair: 1e300 }, team: { colleagues: { zhou: { level: 1e99, missionId: { a: 1 }, startedAt: "x", endsAt: 1e300, favor: -50, autoRepeat: "yes", rewardSnapshot: 1e308 } } }, talents: { unlocked: ["click_1", "click_5b", "click_5b", "nonexistent"], points: 1e10, rankGranted: 1e10, overflow: -5 }, cards: { offers: [1, "x", "coffee"], chosen: "nonexistent", until: 1e300 }, decor: ["rug", "rug", "nope", 5], energy: { date: "x", left: 1e10, used: ["slack", "slack", "hack"] }, arcade: { date: "x", played: 1e9, best: { coffee: 1e300, nope: 5 } }, daily: { date: "x", goals: "nope", streak: 1e99 }, collected: { quotes: [1, 1, 999999], flavors: ["a"] }, visits: { date: 5, count: 1e99 } }],
    ["levels_proto", JSON.parse('{"v":2,"moyu":10,"totalEarned":10,"lifetimeEarned":10,"savedAt":' + Date.now() + ',"levels":{"__proto__":5,"constructor":7,"toString":9}}')],
    ["future_version", { v: 99, moyu: 1e9, totalEarned: 1e9, savedAt: Date.now(), levels: {} }],
    ["truncated_json", "__BROKEN__{"],
    ["empty", null],
  ];
  // 首次已加载：之后统一 write -> reload
  for (const [name, obj] of cases) {
    for (let i = 0; i < 200; i++) { if (await ev("!!document.getElementById('stage')")) break; await sleep(20); }
    const raw = obj === null ? "__NONE__" : obj === "__BROKEN__{" ? obj : JSON.stringify(obj);
    await ev(`(() => { if (${JSON.stringify(raw)} === "__NONE__") localStorage.removeItem('moyu-save'); else localStorage.setItem('moyu-save', ${JSON.stringify(raw)}); })()`);
    await send("Page.reload", { ignoreCache: true });
    await sleep(2600);
    const r = await ev(`(() => {
      const M = window.__MOYU__;
      if (!M) return { noMoyu: true, body: document.body.innerText.slice(0, 200) };
      let st = null; try { st = M.state; } catch (e) { return { stateThrow: String(e).slice(0, 200) }; }
      const hud = document.getElementById('hud')?.innerText ?? '';
      const bad = [];
      for (const [k, v] of Object.entries(st)) { if (typeof v === 'number' && !Number.isFinite(v)) bad.push(k + '=' + v); }
      const canvas = document.getElementById('stage');
      const ctx = canvas?.getContext('2d');
      let colored = false; try { const d = ctx.getImageData(10, 10, 1, 1).data; colored = d[3] > 0; } catch (e) {}
      return { hudBad: /NaN|Infinity/.test(hud), hud: hud.slice(0, 120), badNumbers: bad, firstDraw: window.__perf ? window.__perf.firstDrawAt : null, frames: M.frames, moyu: st.moyu, prestige: st.prestige, rows: document.querySelectorAll('*').length, bootErr: !!document.querySelector('.boot-error'), canvasColored: colored };
    })()`);
    const errs = c.errors.slice(-4);
    out.robustness[name] = { ...r, newErrors: errs };
    if (errs.length) c.errors.length = 0;
  }

  // ============ 3) 快速开关面板 / 快速切 tab ============
  await ev("localStorage.removeItem('moyu-save')");
  await send("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 300; i++) { if (await ev("!!window.__MOYU__")) break; await sleep(20); }
  await sleep(800);
  const counters = async () => ev(`(() => { const P = window.__perf; return { raf: P.raf.active, si: P.si.size, st: P.st.size, nodes: document.querySelectorAll('*').length, errors: (window.__errs||[]).length }; })()`);
  // 先把三个面板各开关一次，让懒加载内容都渲染过（否则基线节点数不可比）
  for (const btn of ["btn-journal", "btn-team", "btn-arcade"]) { await ev(`document.getElementById('${btn}').click()`); await sleep(400); await ev(`document.getElementById('${btn}').click()`); await sleep(300); }
  await send("HeapProfiler.enable"); await send("HeapProfiler.collectGarbage"); await sleep(400);
  const heapOf = async () => { const { usedSize } = await send("Runtime.getHeapUsage"); const dom = await send("Memory.getDOMCounters"); return { heapMB: +(usedSize / 1048576).toFixed(2), dom }; };
  const beforeRapid = { ...(await counters()), ...(await heapOf()) };
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    for (const btn of ["btn-journal", "btn-team", "btn-arcade"]) {
      await ev(`document.getElementById('${btn}').click()`);
      if (btn === "btn-team") { await ev(`document.getElementById('tab-talents').click()`); await ev(`document.getElementById('tab-decor').click()`); await ev(`document.getElementById('tab-colleagues').click()`); }
      await ev(`document.getElementById('${btn}').click()`);
    }
  }
  await send("HeapProfiler.collectGarbage"); await sleep(400);
  const afterRapid = { ...(await counters()), ...(await heapOf()) };
  const openStates = await ev(`({
    journal: !document.getElementById('journal').classList.contains('hidden'),
    team: !document.getElementById('team').classList.contains('hidden'),
    arcade: !document.getElementById('arcade').classList.contains('hidden'),
    cards: !document.getElementById('cards').classList.contains('hidden'),
    bossChoice: !document.getElementById('boss-choice').classList.contains('hidden'),
    choiceOpen: document.body.classList.contains('choice-open'),
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
  })`);
  out.rapid = { before: beforeRapid, after: afterRapid, openStates, elapsedMs: Date.now() - t0, newErrors: c.errors.slice(-6) };
  c.errors.length = 0;

  // ============ 4) 小游戏 rAF 泄漏 ============
  const games = await ev(`Array.from(document.querySelectorAll('#arcade-body button[data-game]')).map(b => ({ id: b.dataset.game }))`);
  const gid = games.map((g) => g.id);
  out.minigame.available = gid;
  const leak = [];
  await ev(`document.getElementById('btn-arcade').click()`); await sleep(300);
  for (const game of gid) {
    for (let rep = 0; rep < 2; rep++) {
      await ev(`document.querySelector('#arcade-body button[data-game="${game}"]')?.click()`);
      await sleep(rep === 0 ? 1200 : 3000); // 第 2 轮超过 2s，会走 confirm（探针已 stub true）
      await ev(`document.getElementById('arcade-close').click()`);
      await sleep(500);
      const k = await ev(`({ raf: __perf.raf.active, si: __perf.si.size, st: __perf.st.size, arcadeOpen: !document.getElementById('arcade').classList.contains('hidden') })`);
      // 重新打开菜单
      if (!(await ev(`!document.getElementById('arcade').classList.contains('hidden')`))) { await ev(`document.getElementById('btn-arcade').click()`); await sleep(300); }
      leak.push({ game, rep, ...k });
    }
  }
  await ev(`document.getElementById('btn-arcade').click()`); await sleep(300);
  out.minigame.leak = leak;
  await send("HeapProfiler.collectGarbage"); await sleep(300);
  out.minigame.after = { ...(await counters()), ...(await heapOf()), docSeq: await ev("__perf.docSeq") };
  out.minigame.newErrors = c.errors.slice(-6);

  out.errors = c.errors.slice(0, 20);
  writeFileSync("playtest/perf-review/out-c-save-robust.json", J(out));
  console.log(J(out));
  c.close();
}, { timeoutMs: 400_000 });
