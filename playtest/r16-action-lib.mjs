// R16 操作/手感党探针公共库：统一 headless Chrome（必须走 lib/chrome.mjs）+ 页内仪表化。
// 页内钩子（addScriptToEvaluateOnNewDocument）：
//   __R16.audio   WebAudio 振荡器创建日志（频率/启动时刻/上下文状态）——用于"代码层面验证音效"
//   __R16.raf     每帧时间戳——用于测"点击→下一帧（上屏）"延迟
//   __R16.ptr     pointerdown 捕获/冒泡时刻——用于测 handler 执行耗时
//   __R16.clicks  click 捕获日志（含 [data-game] 开始按钮时刻 = 迷你游戏 startAt 近似）
//   __R16.at(t,fn) 亚毫秒级精确定时（setTimeout + 忙等）——用于按节拍/判定窗口打点
//   __R16.snap()  当前 UI+状态快照
//   自动跳过每日卡弹窗（否则它会盖住 canvas 吞掉点击）；#cards 同时 display:none 兜底
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

export { runChrome, connect, sleep };

export const INIT_SCRIPT = String.raw`
(function(){
  var W = window;
  if (W.__R16) return;
  var R = W.__R16 = { audio: [], raf: [], ptr: [], clicks: [], meta: {}, logs: {} };
  R.now = function(){ return performance.now(); };

  // ---------- WebAudio 振荡器日志 ----------
  try {
    var AC = W.AudioContext || W.webkitAudioContext;
    if (AC && AC.prototype && AC.prototype.createOscillator) {
      var origCreate = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function(){
        var osc = origCreate.call(this);
        var rec = { t: performance.now(), freq: null, startWhen: null, tStart: null, stopWhen: null, ctxState: this.state, ctxTime: this.currentTime };
        R.audio.push(rec);
        if (R.audio.length > 4000) R.audio.shift();
        try {
          var f = osc.frequency;
          var origSet = f.setValueAtTime.bind(f);
          f.setValueAtTime = function(v, t){ rec.freq = v; rec.setAt = t; return origSet(v, t); };
        } catch (e) { R.meta.freqHookErr = String(e); }
        try { var st = osc.start.bind(osc); osc.start = function(w){ rec.startWhen = (w == null ? 0 : w); rec.tStart = performance.now(); return st(w); }; } catch (e) {}
        try { var sp = osc.stop.bind(osc); osc.stop = function(w){ rec.stopWhen = w; return sp(w); }; } catch (e) {}
        return osc;
      };
      var WrappedAC = new Proxy(AC, {
        construct: function(target, args){
          var c = Reflect.construct(target, args);
          R.ctx = c;
          R.meta.ctx = { sr: c.sampleRate, baseLatency: c.baseLatency, outputLatency: c.outputLatency, state: c.state, t: performance.now() };
          return c;
        }
      });
      W.AudioContext = WrappedAC;
      if (W.webkitAudioContext) W.webkitAudioContext = WrappedAC;
    }
  } catch (e) { R.meta.audioErr = String(e); }

  // ---------- rAF ----------
  try {
    var raf = W.requestAnimationFrame.bind(W);
    var tick = function(ts){ R.raf.push(ts); if (R.raf.length > 9000) R.raf.shift(); raf(tick); };
    raf(tick);
  } catch (e) { R.meta.rafErr = String(e); }

  // ---------- pointer 日志 ----------
  try {
    document.addEventListener('pointerdown', function(e){
      R.ptr.push({ ph: 'cap', t: performance.now(), ts: e.timeStamp, x: e.clientX, y: e.clientY, pt: e.pointerType, tgt: (e.target && (e.target.id || e.target.className || e.target.tagName)) || '' });
      if (R.ptr.length > 6000) R.ptr.shift();
    }, true);
    document.addEventListener('pointerdown', function(e){
      var fxN = -1;
      var audioN = R.audio.length;
      try { fxN = (W.__MOYU__ && W.__MOYU__.fxTexts) ? W.__MOYU__.fxTexts().length : -1; } catch (err) {}
      R.ptr.push({ ph: 'bub', t: performance.now(), ts: e.timeStamp, fxN: fxN, audioN: audioN });
    }, false);
  } catch (e) {}

  // ---------- click 日志（含开始按钮） ----------
  try {
    document.addEventListener('click', function(e){
      var g = e.target && e.target.closest ? e.target.closest('[data-game]') : null;
      R.clicks.push({
        t: performance.now(),
        game: g ? g.getAttribute('data-game') : null,
        id: (e.target && e.target.id) || '',
        txt: ((e.target && e.target.textContent) || '').trim().slice(0, 24)
      });
      if (R.clicks.length > 500) R.clicks.shift();
    }, true);
  } catch (e) {}

  // ---------- 每日卡弹窗：探针期自动跳过（否则盖住 canvas 吞点击） ----------
  try {
    var injectStyle = function(){
      try {
        var st = document.createElement('style');
        st.textContent = '#cards{display:none !important}';
        (document.head || document.documentElement).appendChild(st);
      } catch (e) {}
    };
    if (document.head) injectStyle(); else document.addEventListener('DOMContentLoaded', injectStyle);
    setInterval(function(){
      var c = document.getElementById('cards');
      if (c && !c.classList.contains('hidden')) {
        var sk = document.getElementById('cards-skip');
        if (sk) { sk.click(); R.cardDismissed = (R.cardDismissed || 0) + 1; }
      }
    }, 120);
  } catch (e) {}

  // ---------- 精确打点 ----------
  R.at = function(target, fn){
    return new Promise(function(resolve){
      var fire = function(){
        var guard = 0;
        while (performance.now() < target && guard++ < 8e6) {}
        var actual = performance.now();
        var out = null;
        try { out = fn(actual); } catch (e) { out = { err: String(e) }; }
        resolve({ target: target, actual: actual, err: actual - target, out: out });
      };
      var now = performance.now();
      if (now >= target) return fire();
      var lead = Math.min(8, Math.max(0, (target - now) * 0.5));
      setTimeout(fire, Math.max(0, (target - now) - lead));
    });
  };

  // ---------- 快照 ----------
  R.snap = function(){
    var q = function(s){ return document.querySelector(s); };
    var txt = function(s){ var e = q(s); return e ? e.textContent : null; };
    var st = null;
    try { st = W.__MOYU__ ? W.__MOYU__.state : null; } catch (e) {}
    var hud = q('#hud-combo');
    var judge = q('#judge-text');
    return {
      t: performance.now(),
      score: txt('#play-score'), timer: txt('#play-timer'),
      judge: judge ? { text: judge.textContent, cls: judge.className } : null,
      hudCombo: hud ? { text: hud.textContent, hidden: hud.classList.contains('hidden') } : null,
      fx: (function(){ try { return W.__MOYU__ ? W.__MOYU__.fxTexts() : null; } catch (e) { return null; } })(),
      moyu: st ? st.moyu : null,
      totalClicks: st ? st.totalClicks : null,
      arcade: st ? st.arcade : null,
      surviveStreak: st ? st.surviveStreak : null,
      arcadeOpen: !!(q('#arcade') && !q('#arcade').classList.contains('hidden')),
      cardsOpen: !!(q('#cards') && !q('#cards').classList.contains('hidden')),
      choiceOpen: !!(q('#boss-choice') && !q('#boss-choice').classList.contains('hidden')),
      title: txt('#arcade-title'),
      audioCount: R.audio.length,
      audioTail: R.audio.slice(-6),
    };
  };

  // ---------- 观察器：迷你游戏判定/分数/节拍 ----------
  R.watchPlay = function(){
    R.logs = { score: [], judge: [], beat: [], timer: [] };
    var mk = function(sel, key, get){
      var el = document.querySelector(sel);
      if (!el) return null;
      var last = get(el);
      R.logs[key].push({ t: performance.now(), v: last });
      var mo = new MutationObserver(function(){
        var v = get(el);
        if (v !== last) { last = v; R.logs[key].push({ t: performance.now(), v: v }); }
      });
      mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
      return mo;
    };
    R.obs = [];
    var o1 = mk('#play-score', 'score', function(e){ return e.textContent; }); if (o1) R.obs.push(o1);
    var o2 = mk('#judge-text', 'judge', function(e){ return e.textContent + '|' + e.className; }); if (o2) R.obs.push(o2);
    var o3 = mk('#play-timer', 'timer', function(e){ return e.textContent; }); if (o3) R.obs.push(o3);
    // 节拍点 class 变化（去重）
    var row = document.querySelector('#beat-row');
    if (row) {
      var lastCls = {};
      var mo = new MutationObserver(function(muts){
        var t = performance.now();
        for (var i = 0; i < muts.length; i++) {
          var el = muts[i].target;
          if (!el || !el.classList || !el.classList.contains('beat')) continue;
          var idx = el.getAttribute('data-b');
          var c = el.className;
          if (lastCls[idx] === c) continue;
          lastCls[idx] = c;
          R.logs.beat.push({ t: t, i: Number(idx), cls: c });
        }
      });
      mo.observe(row, { subtree: true, attributes: true, attributeFilter: ['class'] });
      R.obs.push(mo);
      R.beatRects = [];
      var dots = row.querySelectorAll('.beat');
      for (var k = 0; k < dots.length; k++) {
        var r = dots[k].getBoundingClientRect();
        R.beatRects.push({ i: k, cx: r.x + r.width / 2, cy: r.y + r.height / 2, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
    return { score: R.logs.score.length, judge: R.logs.judge.length, beat: R.logs.beat.length };
  };

  R.hudComboLog = [];
  R.watchHudCombo = function(){
    var el = document.getElementById('hud-combo');
    if (!el) return 0;
    var last = el.textContent + '|' + el.className;
    var mo = new MutationObserver(function(){
      var v = el.textContent + '|' + el.className;
      if (v !== last) { last = v; R.hudComboLog.push({ t: performance.now(), v: v }); }
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    return R.hudComboLog.length;
  };
})();
`;

/** 启动一个 dev 会话（含仪表化钩子、移动端视口、清档） */
export async function bootDev(send, ev, { url = "http://127.0.0.1:5173/", reset = true, device = "mobile" } = {}) {
  await send("Runtime.enable");
  await send("Page.enable");
  try { await send("Log.enable"); } catch { /* 忽略 */ }
  await send("Page.addScriptToEvaluateOnNewDocument", { source: INIT_SCRIPT });
  if (device === "mobile") {
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
      screenOrientation: { type: "portraitPrimary", angle: 0 },
    });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  } else {
    await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  }
  await send("Page.navigate", { url });
  await waitFor(ev, 'document.readyState === "complete"', { timeout: 20000, label: "readyState" });
  await waitFor(ev, "typeof window.__MOYU__ !== 'undefined' && typeof window.__R16 !== 'undefined'", { timeout: 20000, label: "__MOYU__" });
  await waitFor(ev, "window.__MOYU__.fps >= 20", { timeout: 15000, label: "fps" }).catch(() => undefined);
  await sleep(700);
  if (reset) { await ev("window.__MOYU__.reset()"); await sleep(350); }
  return true;
}

export async function waitFor(ev, expr, { timeout = 8000, interval = 40, label = "" } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await ev(expr);
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`waitFor timeout: ${label || expr} last=${JSON.stringify(last)}`);
}

export async function evj(ev, expr) {
  const r = await ev(expr);
  if (r && typeof r === "object" && "__err" in r) throw new Error("eval error: " + r.__err + "\nexpr=" + expr.slice(0, 300));
  return r;
}

export async function rect(ev, sel) {
  return evj(ev, `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
}

/** 真实输入：鼠标按下/抬起（headless 下等价可信用户手势，会触发 pointerdown） */
export async function tapMouse(send, x, y, holdMs = 28) {
  const t0 = Date.now();
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", clickCount: 0 });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  if (holdMs > 0) await sleep(holdMs);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  return t0;
}

/** 真实触屏输入 */
export async function tapTouch(send, x, y, holdMs = 26) {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  if (holdMs > 0) await sleep(holdMs);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

export async function clickSel(send, ev, sel, { touch = false } = {}) {
  const r = await rect(ev, sel);
  if (!r) throw new Error("no element: " + sel);
  if (touch) return tapTouch(send, r.cx, r.cy);
  return tapMouse(send, r.cx, r.cy);
}

/** 页内合成 pointerdown（走真实 handler 路径、但不经浏览器输入管线） */
export const inPageTap = (selector, x, y) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { ok: false };
  const r = el.getBoundingClientRect();
  const cx = ${x === null || x === undefined ? "r.x + r.width / 2" : `r.x + r.width * ${x}`};
  const cy = ${y === null || y === undefined ? "r.y + r.height / 2" : `r.y + r.height * ${y}`};
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }));
  return { ok: true, x: cx, y: cy };
})()`;

export async function openArcade(send, ev) {
  await clickSel(send, ev, "#btn-arcade");
  await waitFor(ev, "!document.getElementById('arcade').classList.contains('hidden')", { label: "arcade open", timeout: 4000 });
  await sleep(150);
}

export async function startGame(send, ev, game) {
  const sel = `#arcade-body button[data-game="${game}"]`;
  await waitFor(ev, `!!document.querySelector(${JSON.stringify(sel)})`, { label: "game button", timeout: 4000 });
  await clickSel(send, ev, sel);
  await waitFor(ev, "!!document.getElementById('play-area') || !!document.getElementById('play-grid')", { label: "play area", timeout: 4000 });
  await sleep(60);
}

/** 终止当前小游戏：直接刷新页面（避免 confirm 对话框卡住 headless） */
export async function abortByReload(send, ev, url = "http://127.0.0.1:5173/") {
  await send("Page.navigate", { url });
  await waitFor(ev, 'document.readyState === "complete"', { timeout: 20000, label: "reload" });
  await waitFor(ev, "typeof window.__MOYU__ !== 'undefined' && typeof window.__R16 !== 'undefined'", { timeout: 20000, label: "hooks" });
  await waitFor(ev, "window.__MOYU__.fps >= 20", { timeout: 15000, label: "fps" }).catch(() => undefined);
  await sleep(500);
  await ev("window.__MOYU__.reset()");
  await sleep(300);
}

export function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i];
}

export function stats(arr) {
  const a = arr.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const sum = a.reduce((s, v) => s + v, 0);
  return { n: a.length, min: a[0], p50: pct(a, 0.5), p90: pct(a, 0.9), max: a[a.length - 1], mean: Number((sum / a.length).toFixed(2)) };
}

/** 用 page 侧 rAF 日志算「事件→下一帧（上屏起点）」延迟 */
export function nextRafAfter(rafLog, t) {
  for (let i = 0; i < rafLog.length; i++) if (rafLog[i] >= t) return rafLog[i];
  return null;
}