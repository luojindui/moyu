// R16 操作党探针 B2：节奏点击「判定公平性」专项
// 目的：逐条量化「偏差 δ → 扣分」，证明 160~220ms 的“差一点”比完全不点（-10）更亏；并测“晚按合并”的边界。
// 手法：每个测试占 3 拍（第 1 拍按 δ 打，后 2 拍不点），窗口结束后读分数；
//       空闲基准 = -30（3 拍全漏），因此 delta 与 -30 的差即“这一按额外造成的罚分”。
import { writeFileSync } from "node:fs";
import {
  runChrome, connect, bootDev, evj, sleep, waitFor, clickSel, openArcade,
} from "./r16-action-lib.mjs";

const OUT = new URL("./r16-rhythm2.json", import.meta.url).pathname;

const RUNNER = String.raw`
(function(){
  var R = window.__R16;
  R.playT = null;
  new MutationObserver(function(){
    if (!R.playT && document.getElementById('play-area')) R.playT = performance.now();
  }).observe(document.getElementById('arcade-body'), { childList: true, subtree: true });
  R.runFair = async function(plan, tailPlan, padBeats){
    var padBeats = padBeats || [];
    var area = document.getElementById('play-area');
    if (!area) return { err: 'no area' };
    var t0 = R.playT || performance.now();
    var beatT = function(i){ return t0 + (0.6 + 0.5 * i) * 1000; };
    var rect = area.getBoundingClientRect();
    var cx = rect.x + rect.width * 0.5, cy = rect.y + rect.height * 0.5;
    var tap = function(){
      area.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy,
        pointerId: 51, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
      }));
    };
    var scoreEls = function(){ var e = document.getElementById('play-score'); return e ? e.textContent : null; };
    var judgeEls = function(){ var e = document.getElementById('judge-text'); return e ? e.textContent + '|' + e.className : null; };
    var scoreLog = [];
    R.scoreLog2 = scoreLog;
    if (scoreEls() != null) {
      var sEl = document.getElementById('play-score');
      var last = sEl.textContent;
      scoreLog.push({ t: performance.now(), v: last });
      new MutationObserver(function(){
        var v = sEl.textContent;
        if (v !== last) { last = v; scoreLog.push({ t: performance.now(), v: v }); }
      }).observe(sEl, { childList: true, characterData: true, subtree: true });
    }
    var audioLog = [];
    var audioStart = R.audio.length;
    var out = [];
    // 垫分：逐拍准点打（独立于测试窗口），打完等到首个测试前
    for (var pb = 0; pb < padBeats.length; pb++) {
      await R.at(beatT(padBeats[pb]), function(){ tap(); return null; });
    }
    if (plan.length) {
      var waitTo = beatT(plan[0].i) - 300;
      await new Promise(function(r){ setTimeout(r, Math.max(0, waitTo - performance.now())); });
    }
    for (var k = 0; k < plan.length; k++) {
      var it = plan[k];
      var target = beatT(it.i) + it.d * 1000;
      var before = scoreEls();
      var res = await R.at(target, function(){
        tap();
        return { judge: judgeEls(), score: scoreEls(), audioN: R.audio.length };
      });
      var sync = res.out || {};
      // 采样两拍后：auto-miss 已全部结算
      var endT = beatT(it.i + 2) + 260;
      await new Promise(function(r){ setTimeout(r, Math.max(0, endT - performance.now())); });
      out.push({
        i: it.i, d: it.d, tapErr: Number(res.err.toFixed(3)),
        scoreBefore: before, scoreSync: sync.score, scoreAfter: scoreEls(),
        judgeSync: sync.judge, judgeAfter: judgeEls(),
        audioCreated: (sync.audioN || 0) - audioStart,
      });
    }
    // 合并保护测试：同一拍连点
    var tail = [];
    if (tailPlan && tailPlan.length) {
      var i0 = tailPlan[0].i;
      var bt = beatT(i0);
      for (var j = 0; j < tailPlan.length; j++) {
        var tp = bt + tailPlan[j].d * 1000;
        var b4 = scoreEls();
        var rr = await R.at(tp, function(){ tap(); return { judge: judgeEls(), score: scoreEls() }; });
        tail.push({ i: i0, d: tailPlan[j].d, tapErr: Number(rr.err.toFixed(3)), scoreBefore: b4, scoreAfter: (rr.out||{}).score, judge: (rr.out||{}).judge });
        await new Promise(function(r){ setTimeout(r, 40); });
      }
    }
    await new Promise(function(r){ setTimeout(r, 1200); });
    return {
      t0: t0, playT: R.playT, tests: out, tail: tail,
      scoreLog: scoreLog,
      audio: R.audio.slice(audioStart).map(function(a){ return { t: a.t, tStart: a.tStart, freq: a.freq }; }),
      finalScore: scoreEls(),
      finalJudge: judgeEls(),
      resultText: (function(){ var b = document.getElementById('arcade-body'); return b ? b.innerText.slice(0, 300) : null; })(),
    };
  };
  return 'installed';
})()`;

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  const result = { section: "rhythm-fair", ts: Date.now() };
  try {
    await bootDev(send, ev);
    await evj(ev, RUNNER);
    await openArcade(send, ev);
    await clickSel(send, ev, '#arcade-body button[data-game="rhythm"]');
    await waitFor(ev, "!!document.getElementById('play-area') && !!__R16.playT", { label: 'play area', timeout: 5000 });
    // 规划：2-4 拍做分数垫（+60）；6 起每测试占 3 拍
    const plan = [];
    for (let i = 2; i <= 4; i++) plan.push({ i, d: 0 }); // 垫分
    const tests = [
      // 完美/良好边界（±80ms、±160ms 两侧）
      { d: 0.079 }, { d: 0.081 }, { d: -0.079 }, { d: -0.081 },
      { d: 0.159 }, { d: 0.161 }, { d: -0.159 }, { d: -0.161 },
      // “差一点”危险带：晚按（160-240ms 之间 vs 之后）
      { d: 0.175 }, { d: 0.20 }, { d: 0.215 }, { d: 0.235 }, { d: 0.30 },
      // 早按危险带
      { d: -0.175 }, { d: -0.20 }, { d: -0.26 },
    ];
    let beat = 6;
    for (const t of tests) { plan.push({ i: beat, d: t.d }); beat += 3; }
    const lastBeat = beat;
    const padBeats = [2, 3, 4];
    const tailBeat = lastBeat + 1;
    const tailPlan = [
      { i: tailBeat, d: 0 }, { i: tailBeat, d: 0.05 }, { i: tailBeat, d: 0.10 }, { i: tailBeat, d: 0.30 },
    ];
    const run = await evj(ev, `__R16.runFair(${JSON.stringify(plan)}, ${JSON.stringify(tailPlan)}, ${JSON.stringify(padBeats)})`);
    result.run = run;
    result.planMeta = { lastBeat, tailBeat, padBeats, tests: tests.length };
    result.errors = c.errors.slice();
  } catch (e) {
    result.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    const run = result.run || {};
    console.log(JSON.stringify({
      ok: !result.fatal, fatal: result.fatal,
      t0: run.t0,
      tests: (run.tests || []).map(t => {
        const dScore = (Number(t.scoreAfter) || 0) - (Number(t.scoreBefore) || 0);
        const judged = String(t.judgeSync || "").split("|")[0];
        // 3 拍全漏基准 -30；把“本按造成的额外罚分” = delta - 若本拍正常命中/漏的期望
        // 期望：满漏 = -30；命中 = +20-20 = 0；good = +10-20 = -10
        const expected = judged === "PERFECT" ? 0 : judged === "GOOD" ? -10 : -30;
        return { i: t.i, d: t.d, err: t.tapErr, judge: judged, dScore, expectedIdle: expected, tapPenalty: dScore - expected, audio: t.audioCreated };
      }),
      tail: (run.tail || []).map(t => ({ d: t.d, judge: String(t.judge || "").split("|")[0], dScore: (Number(t.scoreAfter) || 0) - (Number(t.scoreBefore) || 0) })),
      scoreLog: (run.scoreLog || []).map(s => Math.round(s.t - (run.t0 || 0)) + ":" + s.v),
      finalScore: run.finalScore,
      resultText: run.resultText,
      errors: result.errors,
    }, null, 2));
    c.close();
  }
}, { timeoutMs: 180_000 });