/**
 * R9 · 音游/节奏党真实手感探针（CDP，390×844 DPR3 移动视口）。只读，不改 src/。
 *
 * 用法：node playtest/r9-rhythm-cdp.mjs
 * 产出：playtest/r9-rhythm-evidence.json、playtest/r9-screens/*.png
 *
 * 测量项：
 *  A 点击→飘字绘制延迟（孤立点击 ×6，同步读 __MOYU__ 快照，无挂机收益混入）
 *  B 3 / 5 / 8 cps 连点：帧率/掉帧、同屏飘字条数/相邻竖距/重叠率、连击文案到顶时间
 *  C 连击窗口实测：seed 3 连后停 0.30~1.55s 再点，用原始收入反推 combo
 *  D 2.5cps ±18% 抖动（blitz 要求速度）下的 combo 表现
 *  E 多指：单指顺序 / 双指交叠交替 / 双指同时 / 非主指针
 *  F 老板巡逻（rAF 变速快进）：type/blitz 的新点击死区、计数、达标/失败反馈
 *    - blitz 第一段按 2.5cps（题面要求速度）打 5.2s，看能到几 /20
 *    - 随后 12cps 补完，抓"达标文案"
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { openBrowser, setupMobilePage, waitForGame, sleep } from "./r9-cdp-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INJECT = readFileSync(join(HERE, "r9-inject.js"), "utf8");
const URL_ = "http://127.0.0.1:5173/";
const EVIDENCE = join(HERE, "r9-rhythm-evidence1.json");
const SHOTS = join(HERE, "r9-rhythm-screens");
mkdirSync(SHOTS, { recursive: true });

const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const comboOf = (gain) => Math.round((gain - 1) / 0.02);

const b = await openBrowser({ port: 9461, tag: "rhythm1" });
const out = { meta: {}, phases: {}, errors: [] };
try {
  await setupMobilePage(b, { injectSource: INJECT, url: URL_ });
  const bootMs = await waitForGame(b);
  await sleep(1500);
  out.meta = { bootMs, url: URL_, viewport: "390x844 dpr3" };

  const env = await b.evj(`JSON.stringify({
    dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight,
    canvas: (() => { const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), cw: c.width, ch: c.height }; })(),
    clickPt: window.__r9.clickPoint(),
    comboInDom: /连击|combo/i.test(document.body.innerText),
    hudText: document.querySelector('.hud-moyu') ? document.querySelector('.hud-moyu').innerText : '',
    state: window.__MOYU__.state,
    errors: window.__r9.errors
  })`);
  out.meta.env = env;
  console.log("[env] canvas", JSON.stringify(env.canvas), "clickPt", JSON.stringify(env.clickPt), "comboInDom", env.comboInDom);

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
    const r = await window.__r9.runIsolated(6, 1800);
    return JSON.stringify({ rows: window.__r9.latencyStats(r.clicks), pt: r.pt });
  })()`);
  out.phases.latency = lat.rows;
  console.log("[latency]", JSON.stringify(lat.rows.map((x) => [x.lat, x.frameLat, x.text])));

  /* ================= C 3/5/8cps 连点 ================= */
  for (const cps of [3, 5, 8]) {
    await resetWait();
    const res = await b.evj(`(async () => {
      const r = await window.__r9.runBurst({ cps: ${cps}, ms: 6000, jitter: 0.03 });
      const a = r.clicks[0].t - 100, b2 = r.clicks[r.clicks.length - 1].t + 150;
      return JSON.stringify({
        cps: ${cps}, jitter: 0.03, n: r.clicks.length, pt: r.pt,
        clicks: r.clicks.map((c) => ({ t: Math.round(c.t), gain: c.dMoyu, dClicks: c.dClicks })),
        frames: window.__r9.frameStats(a, b2),
        texts: window.__r9.textStats(a, b2, r.pt, 30),
        comboTexts: window.__r9.comboTexts(a, b2),
        moYuFps: window.__MOYU__.fps
      });
    })()`);
    const combos = res.clicks.map((c) => (c.dClicks === 1 ? comboOf(c.gain) : null));
    const valid = combos.filter((v) => v !== null);
    res.combos = combos;
    res.maxCombo = Math.max(...res.clicks.filter((c) => c.dClicks === 1).map((c) => comboOf(c.gain)));
    res.avgCombo = r2(valid.reduce((a, c) => a + c, 0) / valid.length);
    res.gaps = [];
    for (let i = 1; i < res.clicks.length; i++) res.gaps.push(r1(res.clicks[i].t - res.clicks[i - 1].t));
    res.gapOver400 = res.gaps.filter((g) => g > 400).length;
    res.capAt = res.comboTexts.find((x) => x.n === 12);
    res.capDelayMs = res.capAt ? res.capAt.t - res.clicks[0].t : null;
    console.log(
      `[burst ${cps}cps] n=${res.clicks.length} fps=${res.frames.fps} p95=${res.frames.p95} over33=${res.frames.over33} onScreen=${res.texts.avgN}(max ${res.texts.maxN}) overlap=${res.texts.overlapPct}% adjGap=${res.texts.avgAdjGap} combo max=${res.maxCombo} avg=${res.avgCombo} capAt=${res.capDelayMs}ms`,
    );
    out.phases["burst" + cps] = res;
  }

  /* ================= C2 8cps 截图（糊成一片证据） ================= */
  await resetWait();
  await b.ev(
    `window.__r9.lastBurst = null; window.__r9.runBurst({cps:8, ms:6000, jitter:0.03}).then((r)=>{ window.__r9.lastBurst = r.clicks.length; }); 1`,
  );
  await sleep(2600);
  await b.shot(join(SHOTS, "r9-8cps-mid.png"));
  for (let i = 0; i < 100; i++) {
    if (await b.ev("!!window.__r9.lastBurst")) break;
    await sleep(100);
  }
  await sleep(200);

  /* ================= D 连击窗口实测 ================= */
  await resetWait();
  const comboTbl = await b.evj(`(async () => {
    const gaps = [0.26, 0.30, 0.36, 0.40, 0.44, 0.50, 0.90, 1.30, 1.45, 1.55];
    return JSON.stringify(await window.__r9.comboProbe(gaps));
  })()`);
  out.phases.comboWindow = comboTbl;
  console.log("[comboWindow]", JSON.stringify(comboTbl.map((x) => [x.requestedGap, x.actualGap, x.combo])));

  /* ================= E 2.5cps 抖动（blitz 要求速度） ================= */
  await resetWait();
  const jit = await b.evj(`(async () => {
    const r = await window.__r9.runBurst({ cps: 2.5, ms: 8000, jitter: 0.18 });
    const a = r.clicks[0].t - 100, b2 = r.clicks[r.clicks.length - 1].t + 150;
    return JSON.stringify({
      n: r.clicks.length, pt: r.pt,
      clicks: r.clicks.map((c) => ({ t: Math.round(c.t), gain: c.dMoyu, dClicks: c.dClicks })),
      frames: window.__r9.frameStats(a, b2),
      texts: window.__r9.textStats(a, b2, r.pt, 30),
      comboTexts: window.__r9.comboTexts(a, b2)
    });
  })()`);
  jit.combos = jit.clicks.map((c) => (c.dClicks === 1 ? comboOf(c.gain) : null));
  jit.gaps = [];
  for (let i = 1; i < jit.clicks.length; i++) jit.gaps.push(r1(jit.clicks[i].t - jit.clicks[i - 1].t));
  jit.gapUnder400 = jit.gaps.filter((g) => g < 400).length;
  jit.maxCombo = Math.max(...jit.clicks.filter((c) => c.dClicks === 1).map((c) => comboOf(c.gain)));
  jit.avgCombo = r2(jit.combos.filter((v) => v !== null).reduce((a, c) => a + c, 0) / jit.clicks.length);
  out.phases.jitter25cps = jit;
  console.log(
    `[2.5cps jitter] n=${jit.n} gap<400=${jit.gapUnder400}/${jit.gaps.length} maxCombo=${jit.maxCombo} avgCombo=${jit.avgCombo} gaps=${JSON.stringify(jit.gaps)}`,
  );

  /* ================= F 多指输入 ================= */
  const pt = env.clickPt;
  const readClicks = () => b.ev("window.__MOYU__.state.totalClicks");
  const clearPE = () => b.ev("window.__r9.pointerEvents.length = 0; 1");
  const rawSummary = async () => {
    const raw = await b.evj("JSON.stringify(window.__r9.pointerEvents)");
    return { down: raw.length, primary: raw.filter((p) => p.isPrimary).length, sample: raw.slice(0, 3) };
  };

  await resetWait();
  await clearPE();
  let c0 = await readClicks();
  for (let i = 0; i < 6; i++) {
    await b.touch("touchStart", [{ id: 1, x: pt.x, y: pt.y }]);
    await b.touch("touchEnd", []);
    await sleep(140);
  }
  let c1 = await readClicks();
  const f1 = { taps: 6, registered: c1 - c0, ...(await rawSummary()) };

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
  const f2 = { presses: 9, registered: c1 - c0, ...(await rawSummary()) };

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
  const f3 = { taps: 2, registered: c1 - c0, ...(await rawSummary()) };

  await resetWait();
  c0 = await readClicks();
  await b.ev(`window.__r9.measureClick(${pt.x}, ${pt.y}, false, 9); 1`);
  c1 = await readClicks();
  const f4 = { taps: 1, registered: c1 - c0 };

  out.phases.multitouch = { singleSequential: f1, twoFingerAlternate: f2, twoFingerSimultaneous: f3, syntheticNonPrimary: f4 };
  for (const [k, v] of Object.entries({ singleSequential: f1, twoFingerAlternate: f2, twoFingerSimultaneous: f3 })) {
    console.log(`[multi ${k}] taps/presses=${v.taps ?? v.presses} registered=${v.registered} rawDown=${v.down} primary=${v.primary}`);
  }
  console.log(`[multi syntheticNonPrimary] registered=${f4.registered}`);
} catch (e) {
  out.errors.push(String(e && e.stack ? e.stack : e));
  console.error("[probe error]", e);
} finally {
  b.close();
}

// ---------- 汇总 ----------
const latRows = (out.phases.latency || []).filter((r) => r.lat !== null);
const med = (arr) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
out.summary = {
  latency: { n: latRows.length, median: med(latRows.map((r) => r.lat)), p95: pct(latRows.map((r) => r.lat), 0.95), max: latRows.length ? Math.max(...latRows.map((r) => r.lat)) : null, frameLatMedian: med(latRows.map((r) => r.frameLat)), texts: latRows.map((r) => r.text) },
  bursts: Object.fromEntries(Object.entries(out.phases).filter(([k]) => k.startsWith("burst")).map(([k, v]) => [k, {
    cps: v.cps, fps: v.frames.fps, p95: v.frames.p95, maxFrame: v.frames.max, over33: v.frames.over33,
    onScreenTexts: v.texts.avgN, maxTexts: v.texts.maxN, overlapPct: v.texts.overlapPct, avgAdjGap: v.texts.avgAdjGap,
    fontPx: v.texts.fontPx, maxCombo: v.maxCombo, avgCombo: v.avgCombo, capDelayMs: v.capDelayMs, gapOver400: v.gapOver400,
  }])),
  comboWindow: out.phases.comboWindow,
  jitter25: { n: out.phases.jitter25cps && out.phases.jitter25cps.n, gapUnder400: out.phases.jitter25cps && out.phases.jitter25cps.gapUnder400, maxCombo: out.phases.jitter25cps && out.phases.jitter25cps.maxCombo, avgCombo: out.phases.jitter25cps && out.phases.jitter25cps.avgCombo },
  multitouch: out.phases.multitouch,
};
writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
console.log("\n[summary]", JSON.stringify(out.summary).slice(0, 4000));
console.log("wrote", EVIDENCE);
process.exit(0);
