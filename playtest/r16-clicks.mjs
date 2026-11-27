// R16 操作党探针 A：点击/连击 —— 窗口、封顶、音效（振荡器频率）、断连音、延迟、80ms 冷却、HUD 滞后、可点区域
// 运行：node playtest/r16-clicks.mjs   （必须走 playtest/lib/chrome.mjs）
// 注意：每块测量前 __MOYU__.reset()，把首次自然巡逻（20-35s，固定 choice 变体）挡在测量窗口之外。
import { writeFileSync } from "node:fs";
import {
  runChrome, connect, bootDev, evj, rect, tapMouse, tapTouch, sleep, stats, nextRafAfter,
} from "./r16-action-lib.mjs";

const OUT = new URL("./r16-clicks.json", import.meta.url).pathname;

const resetNow = async (ev) => {
  await evj(ev, "__MOYU__.reset()");
  await sleep(250);
};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  const result = { section: "clicks", ts: Date.now(), errors: c.errors };
  try {
    await bootDev(send, ev);
    result.url = await evj(ev, "location.href");
    result.viewport = await evj(ev, "({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
    result.version = await evj(ev, "(document.querySelector('#about-version') || {}).textContent || null");
    result.fps = await evj(ev, "__MOYU__.fps");
    result.assets = await evj(ev, "__MOYU__.assets");
    result.canvas = await rect(ev, "#stage");

    const cv = result.canvas;
    // 首次手势建立 AudioContext
    await tapMouse(send, cv.cx, cv.cy);
    await sleep(250);
    result.audioMeta = await evj(ev, "__R16.meta.ctx || null");
    await evj(ev, "__R16.watchHudCombo()");

    // ---------- A1. 真实输入延迟（鼠标 / 触屏） ----------
    const latencyRuns = [];
    for (const kind of ["mouse", "touch", "mouse", "touch"]) {
      await resetNow(ev);
      const mark = await evj(ev, "(__R16.marker = performance.now())");
      const rafBefore = await evj(ev, "__R16.raf.length");
      const hudBefore = await evj(ev, "__R16.hudComboLog.length");
      if (kind === "mouse") await tapMouse(send, cv.cx, cv.cy - 40);
      else await tapTouch(send, cv.cx, cv.cy - 40);
      await sleep(160);
      const got = await evj(ev, `(() => {
        const R = __R16;
        const cap = R.ptr.filter(p => p.ph === 'cap' && p.t >= ${mark}).slice(0,1)[0] || null;
        const bub = R.ptr.filter(p => p.ph === 'bub' && p.t >= ${mark}).slice(0,1)[0] || null;
        const raf = R.raf.slice(${rafBefore});
        const audio = R.audio.filter(a => a.tStart >= ${mark});
        const hud = (R.hudComboLog || []).slice(${hudBefore});
        return {
          cap: cap ? { t: cap.t, pt: cap.pt, ts: cap.ts } : null,
          bub: bub ? { t: bub.t, fxN: bub.fxN, audioN: bub.audioN } : null,
          raf: raf.slice(0, 4),
          audio: audio.map(a => ({ t: a.t, tStart: a.tStart, freq: a.freq })),
          hud: hud.map(h => ({ t: h.t, v: h.v })),
          fx: (__MOYU__.fxTexts ? __MOYU__.fxTexts() : null),
          clicks: __MOYU__.state.totalClicks,
        };
      })()`);
      let paint = null;
      if (got.cap) {
        const nr = nextRafAfter(got.raf, got.cap.t);
        paint = nr == null ? null : nr - got.cap.t;
      }
      latencyRuns.push({
        kind,
        handlerMs: got.cap && got.bub ? Number((got.bub.t - got.cap.t).toFixed(3)) : null,
        eventTimeStampLagMs: got.cap ? Number((got.cap.t - got.cap.ts).toFixed(3)) : null,
        toNextFrameMs: paint == null ? null : Number(paint.toFixed(2)),
        audioScheduledMs: got.audio.length ? Number((got.audio[0].tStart - got.cap.t).toFixed(3)) : null,
        audioFreq: got.audio.length ? got.audio[0].freq : null,
        fxInBubble: got.bub ? got.bub.fxN : null,
        hudComboLagMs: got.hud.length ? Number((got.hud[got.hud.length - 1].t - got.cap.t).toFixed(1)) : null,
        clicksAfter: got.clicks,
        fx: got.fx,
      });
    }
    result.latency = {
      byKind: latencyRuns,
      handlerMsStats: stats(latencyRuns.map((r) => r.handlerMs)),
      toNextFrameStats: stats(latencyRuns.map((r) => r.toNextFrameMs)),
      audioScheduledStats: stats(latencyRuns.map((r) => r.audioScheduledMs)),
      touchEventTsLag: stats(latencyRuns.filter(r => r.kind === "touch").map(r => r.eventTimeStampLagMs)),
      mouseEventTsLag: stats(latencyRuns.filter(r => r.kind === "mouse").map(r => r.eventTimeStampLagMs)),
    };

    // ---------- A2. 可点区域矩阵（12 个位置，每个 260ms 间隔，看是否每次都算点击） ----------
    const hitMatrix = await evj(ev, `(async () => {
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const tap = (x, y) => canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
        pointerId: 31, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
      }));
      const pts = [];
      for (const fx of [0.06, 0.5, 0.94]) for (const fy of [0.08, 0.45, 0.85]) pts.push([fx, fy]);
      // 加 3 个非 canvas 位置（HUD 按钮/商店）对照
      pts.push([0.5, -0.05], [0.5, 1.03], [0.06, 0.02]);
      const out = [];
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      for (const [fx, fy] of pts) {
        const x = r.x + r.width * fx, y = r.y + r.height * fy;
        const before = __MOYU__.state.totalClicks;
        tap(x, y);
        await wait(260);
        out.push({ fx: Number(fx.toFixed(2)), fy: Number(fy.toFixed(2)), accepted: __MOYU__.state.totalClicks - before });
      }
      return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, points: out };
    })()`);
    result.hitMatrix = hitMatrix;

    // ---------- A3. 连击窗口矩阵 ----------
    await resetNow(ev);
    const cadence = await evj(ev, `(async () => {
      const R = __R16;
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.42;
      const tap = () => canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 21, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
      }));
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      const out = [];
      for (const iv of [0.30, 0.45, 0.50, 0.55, 0.70, 1.05]) {
        await wait(1250);
        const hudLog = R.hudComboLog.length;
        const audioLog = R.audio.length;
        const base = performance.now() + 60;
        const errs = [];
        const clicksBefore = __MOYU__.state.totalClicks;
        for (let i = 0; i < 5; i++) {
          const res = await R.at(base + i * iv * 1000, () => { tap(); return performance.now(); });
          errs.push(Number(res.err.toFixed(2)));
        }
        await wait(420);
        const el = document.getElementById('hud-combo');
        const st = __MOYU__.state;
        out.push({
          intervalS: iv,
          hud: el.textContent,
          hudHidden: el.classList.contains('hidden'),
          tapErrMs: errs,
          acceptedClicks: st.totalClicks - clicksBefore,
          audio: R.audio.slice(audioLog).map(a => ({ freq: a.freq, t: a.t })),
          hudChanges: R.hudComboLog.slice(hudLog).map(h => ({ dt: Number((h.t - base).toFixed(1)), v: h.v })),
        });
      }
      return out;
    })()`);
    result.cadence = cadence;

    // ---------- A4. 20 连封顶 + 音高映射 + 双音 + 每击收入 ----------
    await resetNow(ev);
    await evj(ev, "__R16.audio.length = 0");
    const capRun = await evj(ev, `(async () => {
      const R = __R16;
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.5;
      const tap = () => canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 22, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
      }));
      const audioLog = R.audio.length;
      const hudLog = R.hudComboLog.length;
      const base = performance.now() + 60;
      const taps = [];
      for (let i = 0; i < 26; i++) {
        const res = await R.at(base + i * 150, () => {
          tap();
          const st = __MOYU__.state;
          const fx = (__MOYU__.fxTexts ? __MOYU__.fxTexts() : []);
          return { moyu: st.moyu, clicks: st.totalClicks, t: performance.now(), fx: fx.slice(-2) };
        });
        taps.push({ i, err: Number(res.err.toFixed(2)), moyu: res.out.moyu, clicks: res.out.clicks, t: res.out.t, fx: res.out.fx });
      }
      await new Promise(res => setTimeout(res, 400));
      const el = document.getElementById('hud-combo');
      return {
        hud: el.textContent,
        hudHidden: el.classList.contains('hidden'),
        audio: R.audio.slice(audioLog).map(a => ({ freq: a.freq, t: a.t, tStart: a.tStart })),
        hudChanges: R.hudComboLog.slice(hudLog).map(h => ({ dt: Number((h.t - base).toFixed(1)), v: h.v })),
        taps,
      };
    })()`);
    const tapIncomes = [];
    for (let i = 1; i < capRun.taps.length; i++) {
      const dt = (capRun.taps[i].t - capRun.taps[i - 1].t) / 1000;
      tapIncomes.push(Number((capRun.taps[i].moyu - capRun.taps[i - 1].moyu - 0.2 * dt).toFixed(4)));
    }
    capRun.tapIncomes = tapIncomes;
    result.cap = capRun;
    const pitchBeeps = capRun.audio.filter((a) => a.freq >= 300);
    result.capAnalysis = {
      hudMax: capRun.hud,
      tapIncomes,
      maxIncome: Math.max(...tapIncomes.filter((v) => Number.isFinite(v))),
      minIncomeAfterCap: Math.min(...tapIncomes.slice(21)),
      pitchSeries: pitchBeeps.map((a) => Number(a.freq.toFixed(2))),
      expectedPitchFirst20: Array.from({ length: 21 }, (_, k) => Number((330 * Math.pow(2, Math.min(k, 20) / 20)).toFixed(2))),
      pitchMatchCount: (() => {
        const exp = Array.from({ length: 21 }, (_, k) => 330 * Math.pow(2, Math.min(k, 20) / 20));
        const got = pitchBeeps.map((a) => a.freq);
        let ok = 0;
        for (let i = 0; i < Math.min(got.length, exp.length); i++) if (Math.abs(got[i] - exp[i]) < 0.8) ok++;
        return { compared: Math.min(got.length, exp.length), match: ok };
      })(),
      doubleBlips: (() => {
        const byT = new Map();
        for (const a of capRun.audio) {
          if (!a.freq) continue;
          const key = Math.round(a.t / 2) * 2;
          if (!byT.has(key)) byT.set(key, []);
          byT.get(key).push(Number(a.freq.toFixed(2)));
        }
        const out = [];
        for (const [k, freqs] of byT) if (freqs.length >= 2) out.push({ t: k, freqs });
        return out;
      })(),
      fxTexts: capRun.taps.slice(-8).map((t) => t.fx.map((f) => f.text)),
    };

    // ---------- A5. 80ms 冷却：45ms 狂点丢点击率 ----------
    await resetNow(ev);
    const rate = await evj(ev, `(async () => {
      const R = __R16;
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.5;
      const tap = () => canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 23, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
      }));
      const before = __MOYU__.state.totalClicks;
      const fxBefore = (__MOYU__.fxTexts() || []).length;
      const base = performance.now() + 60;
      const errs = [];
      for (let i = 0; i < 24; i++) {
        const res = await R.at(base + i * 45, () => { tap(); return performance.now(); });
        errs.push(Number(res.err.toFixed(2)));
      }
      await new Promise(res => setTimeout(res, 150));
      return {
        dispatched: 24,
        accepted: __MOYU__.state.totalClicks - before,
        tapErrMs: errs,
        fxAfter: (__MOYU__.fxTexts() || []),
      };
    })()`);
    result.rateGate = rate;

    // ---------- A6. 断连闷响（110Hz） ----------
    await resetNow(ev);
    const brk = await evj(ev, `(async () => {
      const R = __R16;
      const canvas = document.getElementById('stage');
      const r = canvas.getBoundingClientRect();
      const cx = r.x + r.width * 0.5, cy = r.y + r.height * 0.5;
      const tap = () => canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 24, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
      }));
      const wait = (ms) => new Promise(res => setTimeout(res, ms));
      await wait(200);
      const audioLog = R.audio.length;
      const base = performance.now() + 60;
      for (let i = 0; i < 4; i++) await R.at(base + i * 200, () => { tap(); });
      await new Promise(res => setTimeout(res, 300));
      const midHud = document.getElementById('hud-combo');
      const mid = { text: midHud.textContent, hidden: midHud.classList.contains('hidden') };
      const lastTapT = performance.now();
      // 停手 >1.0s → 框架循环应触发 playBreak（110Hz）
      await new Promise(res => setTimeout(res, 1400));
      const afterHud = document.getElementById('hud-combo');
      return {
        audioAround: R.audio.slice(audioLog).map(a => ({ freq: a.freq, tStart: a.tStart, dtFromLastTap: Number((a.tStart - lastTapT).toFixed(1)) })),
        hudAfterTaps: mid,
        hudAfterBreak: { text: afterHud.textContent, hidden: afterHud.classList.contains('hidden') },
        lastTapT,
      };
    })()`);
    result.breakSound = brk;

    result.errors = c.errors.slice();
    result.fpsEnd = await evj(ev, "__MOYU__.fps");
  } catch (e) {
    result.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({
      ok: !result.fatal,
      fatal: result.fatal,
      version: result.version,
      viewport: result.viewport,
      fps: [result.fps, result.fpsEnd],
      audioMeta: result.audioMeta,
      latency: result.latency && {
        handlerMs: result.latency.handlerMsStats,
        toNextFrame: result.latency.toNextFrameStats,
        audioScheduled: result.latency.audioScheduledStats,
        touchEventTsLag: result.latency.touchEventTsLag,
        mouseEventTsLag: result.latency.mouseEventTsLag,
        runs: result.latency.byKind.map(r => ({ kind: r.kind, handler: r.handlerMs, frame: r.toNextFrameMs, audio: r.audioScheduledMs, freq: r.audioFreq, fxBubble: r.fxInBubble, tsLag: r.eventTimeStampLagMs, fx: r.fx && r.fx.map(f => f.text) })),
      },
      hitMatrix: result.hitMatrix && { rect: result.hitMatrix.rect, points: result.hitMatrix.points.map(p => `${p.fx},${p.fy}:${p.accepted}`) },
      cadence: (result.cadence || []).map(x => ({ iv: x.intervalS, hud: x.hud, hidden: x.hudHidden, errs: x.tapErrMs, accepted: x.acceptedClicks, freqs: x.audio.map(a => Math.round(a.freq)), hudCh: x.hudChanges.map(h => `${h.dt}ms:${h.v}`) })),
      cap: result.capAnalysis,
      rateGate: result.rateGate && { dispatched: result.rateGate.dispatched, accepted: result.rateGate.accepted, fx: (result.rateGate.fxAfter || []).map(f => f.text) },
      breakSound: result.breakSound && { audio: result.breakSound.audioAround, mid: result.breakSound.hudAfterTaps, after: result.breakSound.hudAfterBreak },
      errors: result.errors,
    }, null, 2));
    c.close();
  }
}, { timeoutMs: 180_000 });