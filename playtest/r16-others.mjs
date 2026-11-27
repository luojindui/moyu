// R16 操作党探针 C：接咖啡（视觉vs判定/音效） + 找老板（反馈） + 回合制老板（5秒窗口/判定公平）
// 运行：node playtest/r16-others.mjs   （必须走 playtest/lib/chrome.mjs）
import { writeFileSync } from "node:fs";
import {
  runChrome, connect, bootDev, evj, rect, sleep, waitFor, clickSel, openArcade, BASE_URL, tapMouse,
} from "./r16-action-lib.mjs";

const OUT = new URL("./r16-others.json", import.meta.url).pathname;

const HELPER = String.raw`
(function(){
  var R = window.__R16;
  R.playT = null;
  if (!R._playObs) {
    R._playObs = new MutationObserver(function(){
      if (!R.playT && document.getElementById('play-area')) R.playT = performance.now();
    });
    R._playObs.observe(document.getElementById('arcade-body'), { childList: true, subtree: true });
  }

  /* ---------- 接咖啡 ---------- */
  R.coffeeRun = async function(plan, runMs){
    var area = document.getElementById('play-area');
    if (!area) return { err: 'no area' };
    var dropsEl = document.getElementById('play-drops');
    var t0 = R.playT || performance.now();
    var areaRect = area.getBoundingClientRect();
    var cup = document.querySelector('.cup-line');
    var cupRect = cup ? cup.getBoundingClientRect() : null;
    var audioStart = R.audio.length;
    var drops = [];
    var classEvents = [];
    var records = [];
    var planIdx = 0;
    var running = true;
    var mo = new MutationObserver(function(muts){
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'attributes' && m.target && m.target.classList && m.target.classList.contains('drop')) {
          classEvents.push({ t: performance.now(), cls: m.target.className, idx: m.target.__dropIdx, d: m.target.__dropAt });
        }
        if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            var n = m.addedNodes[j];
            if (n.classList && n.classList.contains('drop')) {
              n.__dropIdx = drops.length;
              var createdElapsed = (performance.now() - t0) / 1000;
              var top0 = parseFloat(n.style.top);
              var d = { el: n, idx: n.__dropIdx, createdT: performance.now(), createdTop: top0, createdElapsed: createdElapsed,
                        x: parseFloat(n.style.left) / 100, identified: false };
              n.__dropAt = null;
              drops.push(d);
            }
          }
        }
      }
    });
    mo.observe(dropsEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    var tapOn = function(rec, d, x){
      R.at(rec.tapT, function(){
        var scoreEl = document.getElementById('play-score');
        rec.clsBefore = d.el.className;
        rec.scoreBefore = scoreEl ? scoreEl.textContent : null;
        var ev = new PointerEvent('pointerdown', {
          bubbles: true, cancelable: true, composed: true,
          clientX: areaRect.x + areaRect.width * Math.min(1, Math.max(0, x)),
          clientY: areaRect.y + areaRect.height * 0.5,
          pointerId: 61, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1
        });
        area.dispatchEvent(ev);
        rec.tapAt = performance.now();
        rec.actualDelta = (rec.tapAt - t0) / 1000 - rec.at;
        rec.clsAfterSync = d.el.className;
        return null;
      }).then(function(){
        setTimeout(function(){
          rec.clsAfter = d.el.isConnected ? d.el.className : 'removed';
          var scoreEl = document.getElementById('play-score');
          rec.scoreAfter = scoreEl ? scoreEl.textContent : null;
        }, 70);
      });
    };
    var identify = function(){
      if (!running) return;
      for (var i = 0; i < drops.length; i++) {
        var d = drops[i];
        if (d.identified) continue;
        var top = parseFloat(d.el.style.top);
        if (!isFinite(top)) continue;
        if (top > 70) continue;
        d.identified = true;
        var elapsed = (performance.now() - t0) / 1000;
        d.at = elapsed + (88 - top) * 3 / 88;
        d.el.__dropAt = d.at;
        var trial = plan[planIdx++ % plan.length];
        var x = Math.min(1, Math.max(0, d.x + (trial.dx || 0)));
        var rec = { idx: d.idx, idxPlan: planIdx - 1, tag: trial.tag, d: trial.d, dx: trial.dx || 0,
                    at: Number(d.at.toFixed(3)), x: d.x, tapX: x, tapT: t0 + (d.at + trial.d) * 1000,
                    createdTop: d.createdTop, createdElapsed: Number(d.createdElapsed.toFixed(3)) };
        records.push(rec);
        tapOn(rec, d, x);
      }
    };
    var raf = function(){ if (!running) return; identify(); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    await new Promise(function(r){ setTimeout(r, runMs); });
    running = false;
    await new Promise(function(r){ setTimeout(r, 700); });
    mo.disconnect();
    var scoreEl = document.getElementById('play-score');
    return {
      t0: t0, areaRect: { x: areaRect.x, y: areaRect.y, w: areaRect.width, h: areaRect.height },
      cup: cupRect ? { top: cupRect.top, h: cupRect.height, topPctOfArea: Number(((cupRect.top - areaRect.top) / areaRect.height * 100).toFixed(2)) } : null,
      dropSize: (function(){ var e = dropsEl.querySelector('.drop'); if (!e) return null; var r = e.getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
      records: records, classEvents: classEvents,
      dropsMeta: drops.map(function(d){ return { idx: d.idx, createdTop: d.createdTop, createdElapsed: Number(d.createdElapsed.toFixed(3)), x: d.x, at: d.at || null }; }),
      audioCount: R.audio.length - audioStart,
      audio: R.audio.slice(audioStart).map(function(a){ return { freq: a.freq, t: a.t }; }),
      scoreFinal: scoreEl ? scoreEl.textContent : null,
      resultText: (function(){ var b = document.getElementById('arcade-body'); return b ? b.innerText.slice(0, 300) : null; })(),
    };
  };

  /* ---------- 找老板 ---------- */
  R.findbossRun = async function(){
    var audioStart = R.audio.length;
    var t0 = performance.now();
    var clickCell = function(i){
      var b = document.querySelector('#play-grid .face[data-i="' + i + '"]');
      if (!b) return { err: 'no cell' };
      var r = b.getBoundingClientRect();
      var t = performance.now();
      b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 62, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      b.click();
      return { t: t, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    };
    var snap = function(){
      var scoreEl = document.getElementById('play-score');
      var grid = document.getElementById('play-grid');
      return {
        t: performance.now(),
        score: scoreEl ? scoreEl.textContent : null,
        gridHtml: grid ? grid.innerHTML.length : null,
        bossCell: (function(){ var b = document.querySelector('#play-grid .face.boss'); return b ? Number(b.dataset.i) : null; })(),
        hint: (function(){ var h = document.querySelector('.arcade-hint'); return h ? h.textContent : null; })(),
      };
    };
    var out = { t0: t0, steps: [] };
    await new Promise(function(r){ setTimeout(r, 300); });
    var s0 = snap();
    out.steps.push({ name: 'start', ...s0 });
    // 1) 正确点击
    var bossCell = s0.bossCell;
    var c1 = clickCell(bossCell);
    var s1 = snap();
    out.steps.push({ name: 'correct', click: c1, score: s1.score, bossCell: s1.bossCell, sameCell: s1.bossCell === bossCell, hint: s1.hint, renderMs: s1.t - c1.t });
    // 2) 错误点击（分数可能还是 0，看有没有任何可见反馈）
    var nonBoss = [0,1,2,3,4,5,6,7,8].filter(function(i){ return i !== s1.bossCell; });
    var c2 = clickCell(nonBoss[0]);
    var s2 = snap();
    out.steps.push({ name: 'wrong', score: s2.score, bossCell: s2.bossCell, hint: s2.hint, renderMs: s2.t - c2.t });
    // 3) 连续快速两击（60ms 内）：第二击会不会也算一次作答并被罚？
    var s3a = snap();
    var bossNow = s3a.bossCell;
    var c3 = clickCell(bossNow);
    await new Promise(function(r){ setTimeout(r, 60); });
    var s3b = snap();
    var c4 = clickCell(s3b.bossCell);
    var s4 = snap();
    out.steps.push({ name: 'doubleTap', first: { bossWas: bossNow }, after60ms: { score: s3b.score, boss: s3b.bossCell }, secondClick: { score: s4.score, boss: s4.bossCell, elapsedFromFirst: Number((s3b.t - c3.t).toFixed(1)) } });
    // 4) 12 次快速乱点（模拟误触/手滑）：分数变化
    var before = snap();
    for (var k = 0; k < 12; k++) { clickCell(k % 9); await new Promise(function(r){ setTimeout(r, 35); }); }
    var after = snap();
    out.spam = { before: before.score, after: after.score, hint: after.hint };
    out.audioCount = R.audio.length - audioStart;
    out.audio = R.audio.slice(audioStart).map(function(a){ return { freq: a.freq }; });
    out.scoreFinal = after.score;
    out.timerText = (function(){ var e = document.getElementById('play-timer'); return e ? e.textContent : null; })();
    out.gridRects = (function(){ var els = document.querySelectorAll('#play-grid .face'); var o = []; for (var i = 0; i < els.length; i++) { var r = els[i].getBoundingClientRect(); o.push({ i: i, w: r.width, h: r.height }); } return o; })();
    return out;
  };

  /* ---------- 回合制老板 ---------- */
  R.bossTrial = async function(opts){
    opts = opts || {};
    var root = document.getElementById('boss-choice');
    var t0 = performance.now();
    var shownAt = null, hiddenAt = null, barSamples = [], resultSeen = null, shakeSeen = false;
    var wasHidden = root.classList.contains('hidden');
    var obs = new MutationObserver(function(){
      var hidden = root.classList.contains('hidden');
      if (wasHidden && !hidden) shownAt = performance.now();
      if (!wasHidden && hidden) hiddenAt = performance.now();
      wasHidden = hidden;
      var res = root.querySelector('.boss-result');
      if (res) resultSeen = { t: performance.now(), text: res.textContent, color: getComputedStyle(res).color };
    });
    obs.observe(root, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    // 计时条采样
    var barTimer = setInterval(function(){
      var i = root.querySelector('.boss-timer i');
      if (i) barSamples.push({ t: performance.now(), w: i.style.width });
    }, 40);
    if (opts.force !== false) await __MOYU__.forceBoss('choice');
    // 等面板出现
    for (var w = 0; w < 200 && shownAt == null; w++) await new Promise(function(r){ setTimeout(r, 20); });
    var info = {
      showDelayMs: shownAt != null ? Number((shownAt - t0).toFixed(1)) : null,
      tell: (document.getElementById('boss-tell') || {}).textContent || null,
      opts: Array.prototype.map.call(root.querySelectorAll('.boss-opts > button'), function(b){ var r = b.getBoundingClientRect(); return { text: b.textContent, w: Number(r.width.toFixed(1)), h: Number(r.height.toFixed(1)) }; }),
      panelRect: (function(){ var b = root.querySelector('.boss-box'); if (!b) return null; var r = b.getBoundingClientRect(); return { x: Number(r.x.toFixed(0)), y: Number(r.y.toFixed(0)), w: Number(r.width.toFixed(1)), h: Number(r.height.toFixed(1)) }; })(),
      viewport: { w: innerWidth, h: innerHeight },
      shownAt: shownAt,
    };
    var btns = root.querySelectorAll('.boss-opts > button');
    var pick = function(idx){
      if (!btns[idx]) return false;
      var r = btns[idx].getBoundingClientRect();
      btns[idx].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, pointerId: 63, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
      btns[idx].click();
      return true;
    };
    if (opts.guardTrial) {
      // 面板出现后 60ms 内猛按（期待被 150ms 守卫吞掉并给 shake 反馈）
      await new Promise(function(r){ setTimeout(r, 60); });
      pick(1);
      shakeSeen = !!root.querySelector('.boss-opts button.shake') || !!root.querySelector('.shake');
      await new Promise(function(r){ setTimeout(r, 120); });
      info.guard = { stillOpen: !root.classList.contains('hidden'), pickedClass: !!root.querySelector('.boss-opts button.picked'), shakeSeen: shakeSeen };
    }
    if (opts.pickAtMs != null) {
      await new Promise(function(r){ setTimeout(r, Math.max(0, (shownAt || t0) + opts.pickAtMs - performance.now())); });
      info.pickAcceptT = Number((performance.now() - (shownAt || t0)).toFixed(1));
      info.picked = pick(opts.pickIndex);
    }
    // 等结果/关闭
    for (var z = 0; z < 400 && hiddenAt == null; z++) await new Promise(function(r){ setTimeout(r, 20); });
    clearInterval(barTimer);
    obs.disconnect();
    await new Promise(function(r){ setTimeout(r, 500); });
    var toast = document.getElementById('dom-toast');
    info.hiddenAt = hiddenAt;
    info.visibleMs = shownAt != null && hiddenAt != null ? Number((hiddenAt - shownAt).toFixed(1)) : null;
    info.barFirst = barSamples.length ? barSamples[0].w : null;
    info.barLast = barSamples.length ? barSamples[barSamples.length - 1].w : null;
    info.barSamplesN = barSamples.length;
    info.resultSeen = resultSeen;
    info.toast = toast ? { text: toast.textContent, shown: toast.classList.contains('show') } : null;
    info.srLive = (document.getElementById('sr-live') || {}).textContent || null;
    info.audio = R.audio.slice(-8).map(function(a){ return { t: a.t, freq: a.freq }; });
    info.stateSurvive = __MOYU__.state.surviveStreak;
    info.moyu = __MOYU__.state.moyu;
    return info;
  };
  return 'installed';
})()`;

async function reload(send, ev) {
  await send("Page.navigate", { url: BASE_URL });
  await waitFor(ev, 'document.readyState === "complete"', { timeout: 20000, label: "reload" });
  await waitFor(ev, "typeof window.__MOYU__ !== 'undefined' && !!window.__R16", { timeout: 20000, label: "hooks" });
  await waitFor(ev, "window.__MOYU__.fps >= 20", { timeout: 10000, label: "fps" }).catch(() => undefined);
  await sleep(500);
  await evj(ev, "__MOYU__.reset()");
  await sleep(250);
}

await runChrome(async ({ port }) => {
  const c = await connect(port);
  const { send, ev } = c;
  const result = { section: "others", ts: Date.now() };
  try {
    await bootDev(send, ev);
    result.fps = await evj(ev, "__MOYU__.fps");
    await evj(ev, HELPER);

    // ================= 1) 接咖啡 =================
    await openArcade(send, ev);
    await clickSel(send, ev, '#arcade-body button[data-game="coffee"]');
    await waitFor(ev, "!!document.getElementById('play-area') && !!__R16.playT", { label: "coffee area", timeout: 5000 });
    const coffeePlan = [
      { tag: "center", d: 0, dx: 0 },
      { tag: "early300", d: -0.30, dx: 0 },
      { tag: "lateAfterLand", d: 0.20, dx: 0 },
      { tag: "edgeLate310", d: 0.31, dx: 0 },
      { tag: "outLate350", d: 0.35, dx: 0 },
      { tag: "edgeEarly310", d: -0.31, dx: 0 },
      { tag: "outEarly350", d: -0.35, dx: 0 },
      { tag: "x10", d: 0, dx: 0.10 },
      { tag: "x15", d: 0, dx: 0.15 },
      { tag: "x20", d: 0, dx: 0.20 },
      { tag: "center5", d: 0.05, dx: 0 },
      { tag: "emptyTap", d: 0.45, dx: 0.5 },
    ];
    const coffee = await evj(ev, `__R16.coffeeRun(${JSON.stringify(coffeePlan)}, 26500)`);
    result.coffee = coffee;
    // 结算面板
    await sleep(4200);
    result.coffeeResult = await evj(ev, "(() => { const b = document.getElementById('arcade-body'); return b ? b.innerText.slice(0,300) : null; })()");

    // ================= 2) 找老板 =================
    await reload(send, ev);
    await evj(ev, HELPER);
    await openArcade(send, ev);
    await clickSel(send, ev, '#arcade-body button[data-game="findboss"]');
    await waitFor(ev, "!!document.getElementById('play-grid')", { label: "findboss grid", timeout: 5000 });
    result.findboss = await evj(ev, "__R16.findbossRun()");
    await sleep(300);
    result.findbossToast = await evj(ev, "(document.getElementById('dom-toast')||{}).textContent || null");

    // ================= 3) 回合制老板 =================
    await reload(send, ev);
    await evj(ev, HELPER);
    const boss = {};
    // A) 超时（不选）：测实际窗口长度 + 计时条残留 + toast
    await evj(ev, "__R16.playerPickFired = false");
    boss.timeout = await evj(ev, "__R16.bossTrial({ force: true, pickAtMs: null })");
    await sleep(400);
    boss.timeoutToast = await evj(ev, "(document.getElementById('dom-toast')||{textContent:null}).textContent");
    // B) 守卫期（面板出现 60ms 内按）+ 之后正常选对
    await reload(send, ev);
    await evj(ev, HELPER);
    boss.guardAndCorrect = await evj(ev, "__R16.bossTrial({ force: true, guardTrial: true, pickAtMs: 900, pickIndex: 1 })");
    // C) 选错
    await reload(send, ev);
    await evj(ev, HELPER);
    boss.wrong = await evj(ev, "__R16.bossTrial({ force: true, pickAtMs: 900, pickIndex: 0 })");
    // D) 迟到点击：用 A 的 visibleMs 估算窗口末端前 60ms 再点
    await reload(send, ev);
    await evj(ev, HELPER);
    const W = boss.timeout.visibleMs || 5000;
    boss.late = await evj(ev, `__R16.bossTrial({ force: true, pickAtMs: ${Math.max(200, W - 60)}, pickIndex: 1 })`);
    result.boss = boss;
    result.bossMeta = { timeoutWindowMs: W };
    result.errors = c.errors.slice();
  } catch (e) {
    result.fatal = String(e && e.stack ? e.stack : e);
  } finally {
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    const cof = result.coffee;
    const fb = result.findboss;
    const bs = result.boss || {};
    console.log(JSON.stringify({
      ok: !result.fatal, fatal: result.fatal, fps: result.fps,
      coffee: cof && {
        areaRect: cof.areaRect, cup: cof.cup, dropSize: cof.dropSize, audioCount: cof.audioCount,
        scoreFinal: cof.scoreFinal,
        drops: (cof.dropsMeta || []).length,
        firstDropCreated: (cof.dropsMeta || [])[0],
        records: (cof.records || []).map(r => ({ idx: r.idx, tag: r.tag, d: r.d, dx: r.dx, at: r.at, actualDelta: r.actualDelta != null ? Number(r.actualDelta.toFixed(3)) : null, catch: /caught/.test(r.clsAfter || '') ? 1 : 0, clsAfter: r.clsAfter, score: [r.scoreBefore, r.scoreAfter] })),
        landedOffsets: (cof.classEvents || []).filter(e => /landed/.test(e.cls)).slice(0, 6).map(e => ({ idx: e.idx, at: e.d, landedRel: e.d != null ? Number((((e.t - cof.t0) / 1000) - e.d).toFixed(3)) : null })),
        resultText: result.coffeeResult,
      },
      findboss: fb && {
        steps: fb.steps, spam: fb.spam, audioCount: fb.audioCount, gridRects: fb.gridRects && fb.gridRects[0], timerText: fb.timerText, scoreFinal: fb.scoreFinal,
      },
      boss: {
        timeout: bs.timeout && { showDelay: bs.timeout.showDelayMs, visibleMs: bs.timeout.visibleMs, barFirst: bs.timeout.barFirst, barLast: bs.timeout.barLast, tell: bs.timeout.tell, opts: bs.timeout.opts, panelRect: bs.timeout.panelRect, viewport: bs.timeout.viewport, resultSeen: bs.timeout.resultSeen, toast: bs.timeout.toast, audio: bs.timeout.audio },
        timeoutToast: result.timeoutToast,
        guardAndCorrect: bs.guardAndCorrect && { showDelay: bs.guardAndCorrect.showDelayMs, guard: bs.guardAndCorrect.guard, pickAcceptT: bs.guardAndCorrect.pickAcceptT, resultSeen: bs.guardAndCorrect.resultSeen, toast: bs.guardAndCorrect.toast, audio: bs.guardAndCorrect.audio, visibleMs: bs.guardAndCorrect.visibleMs },
        wrong: bs.wrong && { pickAcceptT: bs.wrong.pickAcceptT, resultSeen: bs.wrong.resultSeen, toast: bs.wrong.toast, audio: bs.wrong.audio, moyu: bs.wrong.moyu },
        late: bs.late && { pickAt: bs.late.pickAcceptT, hiddenAt: bs.late.hiddenAt, resultSeen: bs.late.resultSeen, toast: bs.late.toast, visibleMs: bs.late.visibleMs },
        meta: result.bossMeta,
      },
      errors: result.errors,
    }, null, 2));
    c.close();
  }
}, { timeoutMs: 300_000 });