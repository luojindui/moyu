// 页面注入探针：统计 rAF/timer 活跃数、首绘时间、长任务、帧间隔、canvas 绘制次数
export const INSTRUMENT = String.raw`
(() => {
  let seq = 1;
  try { seq = Number(sessionStorage.getItem('__docSeq') || 0) + 1; sessionStorage.setItem('__docSeq', String(seq)); } catch {}
  const P = (window.__perf = {
    docSeq: seq, events: [],
    navAt: performance.now(), firstDrawAt: null, firstRafAt: null, firstContentfulPaint: null,
    raf: { active: 0, total: 0 }, si: new Map(), st: new Map(),
    drawCalls: 0, longtasks: [], frameGaps: [],
  });
  // rAF 活跃计数（精准：自建 id → 原生 id 映射）
  const _raf = window.requestAnimationFrame.bind(window);
  const _caf = window.cancelAnimationFrame.bind(window);
  let ownSeq = 1; const idMap = new Map();
  window.requestAnimationFrame = (cb) => {
    const own = ownSeq++;
    const native = _raf((t) => {
      if (idMap.delete(own)) P.raf.active--;
      if (P.firstRafAt === null) P.firstRafAt = performance.now();
      cb(t);
    });
    idMap.set(own, native); P.raf.active++; P.raf.total++;
    return own;
  };
  window.cancelAnimationFrame = (own) => {
    const native = idMap.get(own);
    if (native !== undefined) { idMap.delete(own); P.raf.active--; _caf(native); }
    else if (typeof own === 'number') { try { _caf(own); } catch {} }
  };
  const _si = window.setInterval.bind(window), _ci = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { const id = _si(fn, ms, ...a); P.si.set(id, ms); return id; };
  window.clearInterval = (id) => { P.si.delete(id); return _ci(id); };
  const _st = window.setTimeout.bind(window), _ct = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...a) => {
    const id = _st((...args) => { P.st.delete(id); typeof fn === 'function' ? fn(...args) : null; }, ms, ...a);
    P.st.set(id, ms); return id;
  };
  window.clearTimeout = (id) => { P.st.delete(id); return _ct(id); };
  // canvas 绘制计数 + 首绘
  const proto = CanvasRenderingContext2D.prototype;
  const origFillRect = proto.fillRect;
  proto.fillRect = function (...a) { P.drawCalls++; if (P.firstDrawAt === null) P.firstDrawAt = performance.now(); return origFillRect.apply(this, a); };
  const origFill = proto.fill;
  proto.fill = function (...a) { if (P.firstDrawAt === null) P.firstDrawAt = performance.now(); return origFill.apply(this, a); };
  // 帧间隔（独立 rAF 链，记录真实帧节奏）
  let lastT = null;
  const tick = (t) => {
    if (lastT !== null && !P.gapsDisabled) { P.frameGaps.push(+(t - lastT).toFixed(2)); if (P.frameGaps.length > 20000) P.frameGaps.shift(); }
    lastT = t; _raf(tick);
  };
  _raf(tick);
  // 长任务 / FCP
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (P.longtasks.length < 2000) P.longtasks.push({ start: +e.startTime.toFixed(0), dur: +e.duration.toFixed(1) }); }).observe({ entryTypes: ['longtask'] }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') P.firstContentfulPaint = +e.startTime.toFixed(1); }).observe({ entryTypes: ['paint'] }); } catch {}
  // 记录 pointerdown 派发时间（测点击响应）
  for (const evName of ['pagehide', 'pageshow', 'visibilitychange', 'beforeunload']) {
    window.addEventListener(evName, () => { P.events.push(evName + '@' + Math.round(performance.now())); });
  }
  // headless 探针：confirm/alert 会阻塞渲染线程 -> 自动应答（不改业务逻辑，仅探针便利）
  window.confirm = () => true;
  window.alert = () => undefined;
  window.print = () => undefined;
  window.__probeTaps = 0;
  window.addEventListener('pointerdown', () => { window.__probeTaps++; }, true);
})();
`;
