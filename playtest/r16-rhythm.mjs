// R16 操作党探针 B：节奏点击（120BPM）—— 是否有节拍音轨？判定窗口实测？反馈同步？连续惩罚是否公平？
// 运行：node playtest/r16-rhythm.mjs   （必须走 playtest/lib/chrome.mjs）
// 手法：不依赖 startAt 内部变量。用「#play-area 插入时刻 R.playT」近似 startAt（误差 ~1-3ms，见 startAt 估计校准），
//       用 R.at() 亚毫秒打点派发真实 pointerdown 到 #play-area，按 δ 扫描判定结果。
import { writeFileSync } from "node:fs";
import {
  runChrome, connect, bootDev, evj, sleep, stats, openArcade, waitFor, clickSel,
} from "./r16-action-lib.mjs";

const OUT = new URL("./r16-rhythm.json", import.meta.url).pathname;

const INSTALL_RUNNER = `(function(){
  const R = window.__R16;
  if (R.runRhythm) return 'already';
  // 记录 #play-area 首次出现时刻（≈ startGame 里 startAt 之后 1-3ms；误差见校准）
  R.playT = null;
  R.startClickT = null;
  try {
    new MutationObserver(function(){
      if (!R.playT && document.getElementById('play-area')) R.playT = performance.now();
    }).observe(document.getElementById('arcade-body'), { childList: true, subtree: true });
  } catch (e) {}
  const canvasEl = document.getElementById('stage');
  R.runRhythm = async function(plan, opts){
    opts = opts || {};
    const area = document.getElementById('play-area');
    if (!area) return { err: 'no play-area' };
    R.logs = { score: [], judge: [], beat: [], timer: [] };
    R.obs = [];
    const mk = function(sel, key, get){
      const el = document.querySelector(sel);
      if (!el) return null;
      const last = { v: get(el) };
      R.logs[key].push({ t: performance.now(), v: last.v });
      const mo = new MutationObserver(function(){
        const v = get(el);
        if (v !== last.v) { last.v = v; R.logs[key].push({ t: performance.now(), v: v }); }
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
      return mo;
    };
    const o1 = mk('#play-score', 'score', function(e){ return e.textContent; }); if (o1) R.obs.push(o1);
    const o2 = mk('#judge-text', 'judge', function(e){ return e.textContent + '|' + e.className; }); if (o2) R.obs.push(o2);
    const row = document.getElementById('beat-row');
    const lastCls = {};
    if (row) {
      R.beatRects = [];
      const dots = row.querySelectorAll('.beat');
      for (let k = 0; k < dots.length; k++) {
        const r = dots[k].getBoundingClientRect();
        R.beatRects.push({ i: k, cx: r.x + r.width / 2, cy: r.y + r.height / 2, x: r.x, y: r.y, w: r.width, h: r.height });
      }
      const mo = new MutationObserver(function(muts){
        const t = performance.now();
        for (let j = 0; j < muts.length; j++) {
          const el = muts[j].target;
          if (!el || !el.classList || !el.classList.contains('beat')) continue;
          const idx = el.getAttribute('data-b');
          const c = el.className;
          if (lastCls[idx] === c) continue;
          lastCls[idx] = c;
          R.logs.beat.push({ t: t, i: Number(idx), cls: c });
        }
      });
      mo.observe(row, { subtree: true, attributes: true, attributeFilter: ['class'] });
      R.obs.push(mo);
    }
    const t0 = R.playT || performance.now();
    R.rhythmT0 = t0;
    R.rhythmPlan = plan;
    const beatT = (i) => t0 + (0.6 + 0.5 * i) * 1000; // ms
    const trials = [];
    const areaRect = area.getBoundingClientRect();
    const cx = areaRect.x + areaRect.width * 0.5;
    const cy = areaRect.y + areaRect.height * 0.5;
    const scoreText = () => { const e = document.getElementById('play-score'); return e ? e.textContent : null; };
    const judgeState = () => { const e = document.getElementById('judge-text'); return e ? e.textContent + '|' + e.className : null; };
    const dotCls = (i) => { const e = document.querySelector('#beat-row [data-b="' + i + '"]'); return e ? e.className : null; };
    const audioN = () => R.audio.length;
    // 按拍顺序执行（plan 按 beat index 升序；null = 不打）
    for (let k = 0; k < plan.length; k++) {
      const item = plan[k];
      if (!item) continue;
      const i = item.i;
      const target = beatT(i) + item.d * 1000;
      // 若目标已过（上一拍等待太长），记录并跳过
      const pre = { t: performance.now(), score: scoreText(), judge: judgeState(), dot: dotCls(i), audioN: audioN() };
      const res = await R.at(target, function(now){
        area.dispatchEvent(new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
          pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
        }));
        return { score: scoreText(), judge: judgeState(), dot: dotCls(i), audioN: audioN(), t: performance.now() };
      });
      const sync = res.out || {};
      // 等自动漏拍结算（b+0.22 之后）
      const settleAt = Math.min(beatT(i) + 300, target + 350);
      await new Promise(function(r){ setTimeout(r, Math.max(0, settleAt - performance.now())); });
      trials.push({
        i: i, d: item.d, kind: item.kind || 'normal',
        targetT: Number(target.toFixed(2)), tapT: Number(res.actual.toFixed(2)), tapErr: Number(res.err.toFixed(3)),
        scoreBefore: pre.score, judgeBefore: pre.judge, dotBefore: pre.dot,
        audioBefore: pre.audioN, audioAfter: sync.audioN || 0,
        judgeSync: sync.judge, scoreSync: sync.score, dotSync: sync.dot,
        judgeSettled: judgeState(), scoreSettled: scoreText(), dotSettled: dotCls(i),
        audioDuringTap: (sync.audioN || 0) - pre.audioN,
      });
    }
    // 最后一批：不做操作，等结果面板或超时
    const finalAt = opts.waitResultMs == null ? 0 : opts.waitResultMs;
    if (finalAt > 0) await new Promise(function(r){ setTimeout(r, finalAt); });
    return {
      t0: t0,
      startClickT: R.startClickT,
      playT: R.playT,
      trials: trials,
      logs: R.logs,
      beatRects: R.beatRects || [],
      audio: R.audio.map(function(a){ return { t: a.t, tStart: a.tStart, freq: a.freq }; }),
      scoreText: scoreText(),
      judge: judgeState(),
      areaRect: { x: areaRect.x, y: areaRect.y, w: areaRect.width, h: areaRect.height },
      rowRect: (function(){ const e = document.getElementById('beat-row'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
      title: (document.getElementById('arcade-title') || {}).textContent,
    };
  };
  return 'installed';
})()`;

/** 点击开始按钮（真实输入），并在 click 捕获里记录时刻 */
async function startRhythm(send, ev, selector = '#arcade-body button[data-game="rhythm"]') {
  await evj(ev, INSTALL_RUNNER);
  await evj(ev, "(() => { __R16.playT = null; __R16.audio.length = 0; __R16.ptr.length = 0; return true; })()");
  await clickSel(send, ev, selector);
  // 等 play-area 出现
  await waitFor(ev, "!!document.getElementById('play-area') && !!__R16.playT", { label: 'rhythm play area', timeout: 5000 });
  await sleep(30);
  return evj(ev, "({ playT: __R16.playT, clicks: __R16.clicks.slice(-2) })");
}

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  const result = { section: "rhythm", ts: Date.now() };
  try {
    await bootDev(send, ev);
    result.fps = await evj(ev, "__MOYU__.fps");
    await openArcade(send, ev);

    // ============ RUN A：无节拍音轨 + 闪烁测量 + 正负 δ 扫描 + 全流程结果面板 ============
    const startA = await startRhythm(send, ev);
    result.startA = startA;
    // 计划：0-5 不打（观察）；6-10 准点；11-25 正偏移；26-37 负偏移；38 附近狂点；39-45 准点；46-58 准点收尾
    const posSweep = [0.04, 0.06, 0.075, 0.085, 0.10, 0.13, 0.15, 0.158, 0.165, 0.175, 0.20, 0.21, 0.22, 0.25, 0.30];
    const negSweep = [-0.04, -0.06, -0.075, -0.085, -0.10, -0.13, -0.15, -0.158, -0.165, -0.175, -0.20, -0.24];
    const planA = [];
    for (let i = 0; i <= 5; i++) planA.push(null);
    for (let i = 6; i <= 10; i++) planA.push({ i, d: 0, kind: 'perfect0' });
    posSweep.forEach((d, k) => planA.push({ i: 11 + k, d, kind: 'pos' }));
    negSweep.forEach((d, k) => planA.push({ i: 26 + k, d, kind: 'neg' }));
    // 38：狂点测试（4 连点，间隔 ~55ms，从 +0.02 起）
    planA.push({ i: 38, d: 0.02, kind: 'burst' });
    planA.push({ i: 38, d: 0.075, kind: 'burst' });
    planA.push({ i: 38, d: 0.13, kind: 'burst' });
    planA.push({ i: 38, d: 0.185, kind: 'burst' });
    for (let i = 39; i <= 58; i++) planA.push({ i, d: 0, kind: 'perfect0' });
    const runA = await evj(ev, `__R16.runRhythm(${JSON.stringify(planA)}, { waitResultMs: 3200 })`);
    result.runA = runA;
    // 结果面板文本
    result.resultPanelA = await evj(ev, `(() => {
      const b = document.getElementById('arcade-body');
      return { text: b ? b.innerText.slice(0, 400) : null, html: b ? b.innerHTML.slice(0, 600) : null };
    })()`);

    // ============ RUN B：人味抖动（σ=80ms） ============
    // 重新开局：点「再来一局」或返回摸鱼站再开
    const canAgain = await evj(ev, "!!document.getElementById('arcade-again')");
    let startB;
    if (canAgain) {
      startB = await startRhythm(send, ev, "#arcade-again");
    } else {
      await openArcade(send, ev);
      await waitFor(ev, `!!document.querySelector('#arcade-body button[data-game="rhythm"]')`, { label: 'menu again', timeout: 4000 });
      startB = await startRhythm(send, ev);
    }
    result.startB = startB;
    // 用 seed 生成 N(0,0.08) 抖动
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const gauss = () => { const u = Math.max(1e-9, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const planB = [];
    for (let i = 6; i <= 45; i++) {
      let d = gauss() * 0.08;
      d = Math.max(-0.3, Math.min(0.3, d));
      planB.push({ i, d: Number(d.toFixed(4)), kind: 'jitter' });
    }
    const runB = await evj(ev, `__R16.runRhythm(${JSON.stringify(planB)}, { waitResultMs: 0 })`);
    result.runB = runB;
    result.fpsEnd = await evj(ev, "__MOYU__.fps");
    result.errors = c.errors.slice();
  } catch (e) {
    result.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    // 控制台摘要
    const A = result.runA, B = result.runB;
    const fmtTrials = (r) => (r && r.trials ? r.trials.map(t => ({ i: t.i, d: t.d, k: t.kind, err: t.tapErr, judgeSync: t.judgeSync, judgeSettled: t.judgeSettled, dScore: (Number(t.scoreSettled) || 0) - (Number(t.scoreBefore) || 0), audio: t.audioDuringTap, dot: t.dotSettled })) : []);
    console.log(JSON.stringify({
      ok: !result.fatal, fatal: result.fatal, fps: [result.fps, result.fpsEnd],
      startA: result.startA, startB: result.startB,
      t0Calib: A ? { playT: A.playT, startClickT: A.startClickT } : null,
      runA: A ? {
        scoreText: A.scoreText, title: A.title, areaRect: A.areaRect, rowRect: A.rowRect,
        audioTotal: A.audio.length, audioFirst6s: A.audio.filter(a => a.tStart < A.t0 + 3000).length,
        audioFreqs: A.audio.map(a => Math.round(a.freq)),
        trials: fmtTrials(A),
        resultPanel: result.resultPanelA && result.resultPanelA.text,
      } : null,
      runB: B ? { scoreText: B.scoreText, trials: fmtTrials(B) } : null,
      errors: result.errors,
    }, null, 2));
    c.close();
  }
}, { timeoutMs: 240_000 });