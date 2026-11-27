/**
 * R9 · 低成本 WebAudio 音效方案可行性实测（无素材，纯程序化生成）。
 * 只读页面之外的环境，不改 src/。
 *
 * 测量：
 *  1) AudioContext 是否可用 / baseLatency / outputLatency / sampleRate
 *  2) 方案 A「单振荡器 blip」：每次点击 1 osc + 1 gain + 2 个参数自动化 的单次成本
 *  3) 方案 B「预生成噪声 buffer + bandpass」：每次点击 1 AudioBufferSource 的单次成本
 *  4) combo → 音高映射表（+1 半音/连击，12 连一个八度）
 *  5) 调度精度：用 ctx.currentTime 提前 50ms 调度的抖动（模拟"点击即响"）
 *
 * 用法：node playtest/r9-audio-probe.mjs
 * 产出：playtest/r9-audio-evidence.json
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const b = await openBrowser({ port: 9463, tag: "audio" });
const out = { errors: [] };
try {
  await setupMobilePage(b, { injectSource: "", url: "http://127.0.0.1:5173/" });
  for (let i = 0; i < 200; i++) {
    const ok = await b.ev("!!window.__MOYU__ ? 1 : 0").catch(() => 0);
    if (ok === 1) break;
    await sleep(100);
  }
  await sleep(800);

  out.env = await b.evj(`JSON.stringify((() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    return { hasAudioContext: !!AC, userActivation: (navigator.userActivation||{}).hasBeenActive ?? null };
  })())`);

  // 需要 userGesture：Runtime.evaluate 传 userGesture: true
  out.measure = await b.evj(`(async () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return JSON.stringify({ error: "no AudioContext" });
    const ctx = new AC();
    const stateBefore = ctx.state;
    try { await ctx.resume(); } catch (_) {}
    const info = {
      stateBefore, stateAfter: ctx.state, sampleRate: ctx.sampleRate,
      baseLatency: ctx.baseLatency ?? null, outputLatency: ctx.outputLatency ?? null
    };
    // ---- 方案 A：单振荡器 blip（每次点击重建 osc+gain）----
    const N = 500;
    const tA0 = performance.now();
    for (let i = 0; i < N; i++) {
      const t = ctx.currentTime + 0.05;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(330 * Math.pow(2, (i % 12) / 12), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(g).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.06);
    }
    const tA1 = performance.now();

    // ---- 方案 B：预生成 30ms 噪声 buffer + bandpass（每次点击只建 source）----
    const sr = ctx.sampleRate;
    const buf = ctx.createBuffer(1, Math.round(sr * 0.03), sr);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
    const tB0 = performance.now();
    for (let i = 0; i < N; i++) {
      const t = ctx.currentTime + 0.05;
      const src = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      src.buffer = buf;
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(6000, t);
      bp.Q.value = 1.2;
      g.gain.setValueAtTime(0.05, t);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
    }
    const tB1 = performance.now();

    // ---- 方案 C：节拍器 loop 单拍成本（60Hz sine kick + 噪声 hat）----
    const tC0 = performance.now();
    for (let i = 0; i < 60; i++) {
      const t = ctx.currentTime + 0.05 + i * 0.5; // 120BPM
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(60, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 0.15);
    }
    const tC1 = performance.now();

    // ---- 调度抖动（用 ctx.currentTime 提前 50ms，模拟"点击即响"）----
    const jitter = [];
    const base = ctx.currentTime;
    for (let i = 0; i < 40; i++) {
      const sched = base + 0.05 + i * 0.05;
      jitter.push(Math.round((sched - (ctx.currentTime + 0.05)) * 10000) / 10000 + i * 0.05);
    }
    // combo → 频率映射（+1 半音/连击）
    const pitch = [];
    for (let c = 0; c <= 12; c++) pitch.push({ combo: c, hz: Math.round(330 * Math.pow(2, c / 12)) });

    await ctx.close().catch(() => {});
    return JSON.stringify({
      info: Object.assign(info, {
        blipPerClickMs: Math.round((tA1 - tA0) / N * 1000) / 1000,
        noisePerClickMs: Math.round((tB1 - tB0) / N * 1000) / 1000,
        beatPerBeatMs: Math.round((tC1 - tC0) / 60 * 1000) / 1000,
      }),
      pitch,
      jitterSample: jitter.slice(0, 5)
    });
  })()`);

  out.verdict = {
    audioContextUsable: !!out.measure && !!out.measure.info,
    blipCostMs: out.measure?.info?.blipPerClickMs,
    noiseCostMs: out.measure?.info?.noisePerClickMs,
    at8cps: {
      blipCpuPercent: out.measure?.info ? Math.round((out.measure.info.blipPerClickMs * 8) / 10) : null,
      noiseCpuPercent: out.measure?.info ? Math.round((out.measure.info.noisePerClickMs * 8) / 10) : null,
    },
  };
} catch (e) {
  out.errors.push(String(e && e.stack ? e.stack : e));
  console.error("[audio probe error]", e);
} finally {
  b.close();
}
writeFileSync(join(HERE, "r9-audio-evidence.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
