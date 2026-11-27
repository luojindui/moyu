/**
 * R9 · 音游/节奏党真实手感探针（CDP，390×844 DPR3 移动视口）。
 * 只读：不修改 src/，只观测。只在 playtest/ 下新增脚本。
 *
 * 用法：node playtest/r9-rhythm-cdp.mjs
 * 产出：playtest/r9-rhythm-evidence.json、playtest/r9-screens/*.png
 *
 * 测量项：
 *  A 点击→飘字绘制延迟（孤立点击 ×8，同步读 __MOYU__ 反推 combo）
 *  B 3 / 5 / 8 cps 连点：帧率、掉帧、飘字同屏条数/相邻竖距/重叠率、连击文案
 *  C 连击窗口实测：seed 3 连后停 0.30~1.55s 再点，用收入反推 combo（是否为增量/保持/清零）
 *  D 2.5cps ±18% 抖动（blitz 要求速度）下的 combo 表现
 *  E 多指：单指顺序 / 双指交叠交替 / 双指同时 / 非主指针合成事件
 *  F 老板巡逻（rAF 变速快进到 90-150s）：type/blitz 变体的新点击死区、计数、达标反馈
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openBrowser, setupMobilePage, waitForGame, sleep } from "./r9-cdp-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INJECT = readFileSync(join(HERE, "r9-inject.js"), "utf8");
const URL_ = "http://127.0.0.1:5173/";
const EVIDENCE = join(HERE, "r9-rhythm-evidence.json");
const SHOTS = join(HERE, "r9-screens");
mkdirSync(SHOTS, { recursive: true });

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const comboOf = (gain) => Math.round((gain - 1) / 0.02);

const b = await openBrowser({ port: 9461, tag: "rhythm" });
const out = { meta: {}, phases: {}, patrols: [], errors: [] };
try {
  await setupMobilePage(b, { injectSource: INJECT, url: URL_ });
  const bootMs = await waitForGame(b);
  await sleep(1500);
  out.meta = { bootMs, url: URL_, viewport: "390x844 dpr3" };

  const env = await b.evj(`JSON.stringify({
    dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight,
    canvas: (() => { const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top), cw: c.width, ch: c.height }; })(),
    clickPt: window.__r9.clickPoint(),
    state: window.__MOYU__.state,
    errors: window.__r9.errors
  })`);
  out.meta.env = env;
  console.log("[env]", JSON.stringify(env.canvas), "clickPt", JSON.stringify(env.clickPt));

  const resetWait = async () => {
    await b.ev("window.__MOYU__.reset(); 1");
    await sleep(1800);
  };

  /* ================= A 空闲帧率 ================= */
  await sleep(1600);
  out.phases.idle = await b.evj(
    `JSON.stringify(window.__r9.frameStats(performance.now()-1500, performance.now()))`,
  );
  console.log("[idle]", JSON.stringify(out.phases.idle));

  /* ================= B 点击→飘字延迟 ================= */
  await resetWait();
  const lat = await b.evj(`(async () => {
    const r = await window.__r9.runIsolated(8, 1800);
    return JSON.stringify({ rows: window.__r9.latencyStats(r.clicks), pt: r.pt });
  })()`);
  out.phases.latency = lat.rows;
  console.log("[latency]", JSON.stringify(lat.rows.map((x) => [x.lat, x.frameLat, x.text])));

  /* ================= C 3/5/8cps 连点 ================= */
  const bursts = {};
  for (const cps of [3, 5, 8]) {
    await resetWait();
    const res = await b.evj(`(async () => {
      const r = await window.__r9.runBurst({ cps: ${cps}, ms: 6000, jitter: 0.03 });
      const a = r.clicks[0].t - 100, b2 = r.clicks[r.clicks.length - 1].t + 150;
      return JSON.stringify({
        cps: ${cps}, jitter: 0.03, n: r.clicks.length,
        clicks: r.clicks.map((c) => ({ t: Math.round(c.t), gain: r1(c.dMoyu), dClicks: c.dClicks })),
        frames: window.__r9.frameStats(a, b2),
        texts: window.__r9.textStats(a, b2, 30),
        comboTexts: window.__r9.comboTexts(a, b2),
        moYuFps: window.__MOYU__.fps
      });
      function r1(x) { return Math.round(x * 10) / 10; }
    })()`);
    bursts[cps] = res;
    const clicks = res.clicks;
    const combos = clicks.map((c) => (c.dClicks === 1 ? comboOf(c.gain) : null));
    const valid = combos.filter((v) => v !== null);
    res.combos = combos;
    res.maxCombo = valid.length ? Math.max(...valid) : 0;
    res.avgCombo = valid.length ? r2(valid.reduce((a, c) => a + c, 0) / valid.length) : 0;
    res.advances = combos.filter((v, i) => i > 0 && v !== null && combos[i - 1] !== null && v === combos[i - 1] + 1).length;
    res.gaps = [];
    for (let i = 1; i < clicks.length; i++) res.gaps.push(r1(clicks[i].t - clicks[i - 1].t));
    res.gapOver400 = res.gaps.filter((g) => g > 400).length;
    res.gapOver380 = res.gaps.filter((g) => g > 380).length;
    console.log(
      `[burst ${cps}cps] n=${clicks.length} fps=${res.frames.fps} p95=${res.frames.p95} max=${res.frames.max} over33=${res.frames.over33} texts.avg=${res.texts.avgN} max=${res.texts.maxN} overlap=${res.texts.overlapPct}% combo max=${res.maxCombo} avg=${res.avgCombo} gap>400=${res.gapOver400}`,
    );
    out.phases["burst" + cps] = res;
  }

  /* ================= C2 8cps 截图（糊成一片证据） ================= */
  await resetWait();
  await b.ev(
    `window.__r9.lastBurst = null; window.__r9.runBurst({cps:8, ms:6000, jitter:0.03}).then((r)=>{ window.__r9.lastBurst = r.clicks.map((c) => ({ t: c.t, dMoyu: c.dMoyu, dClicks: c.dClicks })); }); 1`,
  );
  await sleep(2600);
  await b.shot(join(SHOTS, "r9-8cps-mid.png"));
  // 等跑完
  for (let i = 0; i < 100; i++) {
    const ok = await b.ev("!!window.__r9.lastBurst");
    if (ok) break;
    await sleep(100);
  }
  await sleep(200);
  await b.shot(join(SHOTS, "r9-8cps-after.png"));

  /* ================= D 连击窗口实测 ================= */
  await resetWait();
  const comboTbl = await b.evj(`(async () => {
    const gaps = [0.30, 0.36, 0.40, 0.44, 0.50, 0.90, 1.30, 1.45, 1.55];
    return JSON.stringify(await window.__r9.comboProbe(gaps));
  })()`);
  out.phases.comboWindow = comboTbl;
  console.log("[comboWindow]", JSON.stringify(comboTbl));

  /* ================= E 2.5cps 抖动（blitz 要求速度） ================= */
  await resetWait();
  const jit = await b.evj(`(async () => {
    const r = await window.__r9.runBurst({ cps: 2.5, ms: 8000, jitter: 0.18 });
    const a = r.clicks[0].t - 100, b2 = r.clicks[r.clicks.length - 1].t + 150;
    const clicks = r.clicks.map((c) => ({ t: Math.round(c.t), gain: r1(c.dMoyu), dClicks: c.dClicks }));
    return JSON.stringify({
      n: r.clicks.length, clicks,
      frames: window.__r9.frameStats(a, b2),
      texts: window.__r9.textStats(a, b2, 30),
      comboTexts: window.__r9.comboTexts(a, b2)
    });
    function r1(x) { return Math.round(x * 10) / 10; }
  })()`);
  const jitCombos = jit.clicks.map((c) => (c.dClicks === 1 ? comboOf(c.gain) : null));
  jit.combos = jitCombos;
  jit.gaps = [];
  for (let i = 1; i < jit.clicks.length; i++) jit.gaps.push(r1(jit.clicks[i].t - jit.clicks[i - 1].t));
  jit.gapUnder400 = jit.gaps.filter((g) => g < 400).length;
  jit.maxCombo = Math.max(...jitCombos.filter((v) => v !== null));
  jit.avgCombo = r2(jitCombos.filter((v) => v !== null).reduce((a, c) => a + c, 0) / jit.clicks.length);
  out.phases.jitter25cps = jit;
  console.log(
    `[2.5cps jitter] n=${jit.n} gap<400=${jit.gapUnder400}/${jit.gaps.length} maxCombo=${jit.maxCombo} avgCombo=${jit.avgCombo}`,
  );

  /* ================= F 多指输入 ================= */
  const pt = env.clickPt;
  const readClicks = () => b.ev("window.__MOYU__.state.totalClicks");
  const clearPE = () => b.ev("window.__r9.pointerEvents.length = 0; 1");

  // F1 单指顺序（点完抬起）
  await resetWait();
  await clearPE();
  let c0 = await readClicks();
  for (let i = 0; i < 6; i++) {
    await b.touch("touchStart", [{ id: 1, x: pt.x, y: pt.y }]);
    await b.touch("touchEnd", []);
    await sleep(140);
  }
  let c1 = await readClicks();
  const f1 = { taps: 6, registered: c1 - c0, raw: await b.evj("JSON.stringify(window.__r9.pointerEvents)") };

  // F2 双指交叠交替（一根手指始终不抬起，另一根反复按下抬起）
  await resetWait();
  await clearPE();
  c0 = await readClicks();
  await b.touch("touchStart", [{ id: 1, x: pt.x, y: pt.y }]);
  for (let i = 0; i < 4; i++) {
    await b.touch("touchStart", [
      { id: 1, x: pt.x, y: pt.y },
      { id: 2, x: pt.x + 44, y: pt.y },
    ]);
    await b.touch("touchEnd", [{ id: 2, x: pt.x + 44, y: pt.y }]);
    await b.touch("touchStart", [
      { id: 2, x: pt.x + 44, y: pt.y },
      { id: 1, x: pt.x, y: pt.y },
    ]);
    await b.touch("touchEnd", [{ id: 1, x: pt.x, y: pt.y }]);
    await sleep(80);
  }
  await b.touch("touchEnd", []);
  await sleep(120);
  c1 = await readClicks();
  const f2 = { presses: 9, registered: c1 - c0, raw: await b.evj("JSON.stringify(window.__r9.pointerEvents)") };

  // F3 双指同时按下
  await resetWait();
  await clearPE();
  c0 = await readClicks();
  await b.touch("touchStart", [
    { id: 1, x: pt.x, y: pt.y },
    { id: 2, x: pt.x + 44, y: pt.y },
  ]);
  await b.touch("touchEnd", []);
  await sleep(120);
  c1 = await readClicks();
  const f3 = { taps: 2, registered: c1 - c0, raw: await b.evj("JSON.stringify(window.__r9.pointerEvents)") };

  // F4 合成非主指针事件（验证代码分支，非真实多指）
  await resetWait();
  c0 = await readClicks();
  await b.ev(`window.__r9.measureClick(${pt.x}, ${pt.y}, false, 9); 1`);
  c1 = await readClicks();
  const f4 = { taps: 1, registered: c1 - c0 };

  out.phases.multitouch = { singleSequential: f1, twoFingerAlternate: f2, twoFingerSimultaneous: f3, syntheticNonPrimary: f4 };
  for (const [k, v] of Object.entries({ singleSequential: f1, twoFingerAlternate: f2, twoFingerSimultaneous: f3 })) {
    const pe = v.raw;
    console.log(
      `[multi ${k}] taps=${v.taps} registered=${v.registered} rawPointerDown=${pe.length} primary=${pe.filter((p) => p.isPrimary).length}`,
    );
  }
  console.log(`[multi syntheticNonPrimary] registered=${f4.registered}`);

  /* ================= G 老板巡逻（变速快进） ================= */
  await resetWait();
  await b.ev("window.__r9.patrols.length = 0; window.__r9.speed = 12; 1");
  const huntStart = Date.now();
  const tappedPatrols = new Set();
  const shotTaken = {};
  let lastPatrolCount = 0;
  while (Date.now() - huntStart < 170000) {
    const boss = await b.evj("JSON.stringify(window.__r9.boss)");
    if (boss.active && boss.variant !== "hold" && !tappedPatrols.has(boss.firstAt)) {
      tappedPatrols.add(boss.firstAt);
      // 任务变体：立刻以 10cps 连点（模拟真人看到横幅后的连打）
      await b.ev(
        `window.__r9.bossBurst = null; window.__r9.runBurst({cps:10, ms:2600, jitter:0.08}).then((r)=>{ window.__r9.bossBurst = r.clicks.map((c)=>({t: c.t, dMoyu: c.dMoyu, dClicks: c.dClicks})); }); 1`,
      );
      if (!shotTaken[boss.variant]) {
        shotTaken[boss.variant] = true;
        await b.shot(join(SHOTS, `r9-patrol-${boss.variant}.png`));
      }
      console.log("[patrol] tap burst on", boss.variant);
    }
    const ps = await b.evj("JSON.stringify(window.__r9.patrols)");
    if (ps.length !== lastPatrolCount) {
      lastPatrolCount = ps.length;
      console.log("[patrol] done", JSON.stringify(ps[ps.length - 1].variant), "total", ps.length);
      // 巡逻结束后恢复变速，继续找下一个
      if (ps.length) await b.ev("window.__r9.speed = 12; 1");
      const variants = new Set(ps.map((p) => p.variant));
      if (variants.has("blitz") && variants.has("type")) break;
    }
    await sleep(90);
  }
  await b.ev("window.__r9.speed = 1; 1");
  await sleep(300);

  // 巡逻期数据：横幅计数推进、被吞点击、结算文案、达标文案
  const patrolData = await b.evj(`JSON.stringify({
    patrols: window.__r9.patrols,
    banners: window.__r9.banners,
    bossBurst: window.__r9.bossBurst || null,
    rewardTexts: window.__r9.texts.filter((e) => /安然度过|没达标|冲刺/.test(e.s)).map((e) => ({t: Math.round(e.t), s: e.s, x: e.x, y: e.y})),
    zeroStealTexts: window.__r9.texts.filter((e) => e.s.indexOf('偷点 +0') >= 0).map((e) => ({t: Math.round(e.t), s: e.s})),
    comboDraws: window.__r9.textStats(0, performance.now(), 30).comboDraws
  })`);

  out.patrols = patrolData.patrols.map((p) => {
    const win = [p.firstAt - 50, p.endedAt + 700];
    const texts = patrolData.rewardTexts.filter((e) => e.t >= win[0] && e.t <= win[1]);
    const zeros = patrolData.zeroStealTexts.filter((e) => e.t >= win[0] && e.t <= win[1]);
    const bannerNums = p.log
      .map((l) => ({ t: l.t, m: l.s.match(/(\\d+)\\/(\\d+)/) }))
      .filter((x) => x.m)
      .map((x) => ({ t: x.t, n: Number(x.m[1]), total: Number(x.m[2]) }));
    return {
      variant: p.variant,
      firstAt: p.firstAt,
      endedAt: p.endedAt,
      bannerFirst: p.log[0] ? p.log[0].s : null,
      bannerNums,
      zeroTapTexts: zeros.length,
      resultTexts: texts,
      comboTexts: [],
    };
  });
  // 每个任务变体的连击文案/计数进度
  for (const p of out.patrols) {
    if (p.variant === "hold") continue;
    const win = [p.firstAt - 50, p.endedAt + 700];
    p.countProgress = p.bannerNums.filter((x, i, arr) => i === 0 || x.n !== arr[i - 1].n).map((x) => ({ t: x.t, n: x.n, total: x.total }));
  }
  out.phaseG = patrolData.bossBurst ? { bossBurstClicks: patrolData.bossBurst.length } : {};
  console.log("[patrols]", JSON.stringify(out.patrols.map((p) => ({ v: p.variant, zeros: p.zeroTapTexts, res: p.resultTexts.map((r) => r.s), prog: (p.countProgress || []).map((x) => x.n) }))));

  out.errors = await b.evj("JSON.stringify(window.__r9.errors)");
  await b.shot(join(SHOTS, "r9-final.png"));
} catch (e) {
  out.errors.push(String(e && e.stack ? e.stack : e));
  console.error("[probe error]", e);
} finally {
  b.close();
}

// ---------- 汇总 ----------
const latRows = (out.phases.latency || []).filter((r) => r.lat !== null);
const med = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
out.summary = {
  latency: {
    n: latRows.length,
    median: med(latRows.map((r) => r.lat)),
    p95: (() => {
      const s = latRows.map((r) => r.lat).sort((a, b) => a - b);
      return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] : null;
    })(),
    max: latRows.length ? Math.max(...latRows.map((r) => r.lat)) : null,
    frameLatMedian: med(latRows.map((r) => r.frameLat)),
    texts: [...new Set(latRows.map((r) => r.text))],
  },
  bursts: Object.fromEntries(
    Object.entries(out.phases)
      .filter(([k]) => k.startsWith("burst"))
      .map(([k, v]) => [
        k,
        {
          cps: v.cps,
          fps: v.frames.fps,
          p95: v.frames.p95,
          maxFrame: v.frames.max,
          over33: v.frames.over33,
          avgTexts: v.texts.avgN,
          maxTexts: v.texts.maxN,
          overlapPct: v.texts.overlapPct,
          avgAdjGap: v.texts.avgAdjGap,
          fontPx: v.texts.fontPx,
          maxCombo: v.maxCombo,
          avgCombo: v.avgCombo,
          comboTextDraws: v.texts.comboDraws,
          gapOver400: v.gapOver400,
        },
      ]),
  ),
  comboWindow: out.phases.comboWindow,
  jitter25: {
    n: out.phases.jitter25cps && out.phases.jitter25cps.n,
    gapUnder400: out.phases.jitter25cps && out.phases.jitter25cps.gapUnder400,
    maxCombo: out.phases.jitter25cps && out.phases.jitter25cps.maxCombo,
    avgCombo: out.phases.jitter25cps && out.phases.jitter25cps.avgCombo,
  },
  multitouch: out.phases.multitouch,
  patrols: out.patrols,
};
writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
console.log("\n[summary]", JSON.stringify(out.summary, null, 2).slice(0, 6000));
console.log("\nwrote", EVIDENCE);
process.exit(0);
