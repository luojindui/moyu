/**
 * R9 · 音游/节奏党探针注入脚本（Page.addScriptToEvaluateOnNewDocument，文档创建前安装）。
 * 只做只读观测 + 可控变速，不修改 src/。
 *
 * 观测点：
 *  1) 真实 rAF 帧时间（独立记录，不受变速影响）→ 帧率/掉帧
 *  2) Canvas fillText（飘字/横幅）→ 点击→绘制延迟、飘字重叠、连击文案
 *  3) pointerdown 原始事件（capture，记录 isPrimary / pointerId）→ 多指输入
 *  4) __MOYU__.state 同步读（快照 delta，无挂机收益混入）→ 逐击收入反推 combo
 *  5) rAF 时间戳可变速 → 快进到 90-150s 的老板巡逻（detect 后立即切回实时）
 */
(() => {
  const r1 = (x) => Math.round(x * 10) / 10;
  const R = (window.__r9 = {
    t0: performance.now(),
    speed: 1,
    texts: [],
    banners: [],
    frames: [],
    pointerEvents: [],
    errors: [],
    boss: { active: false, variant: null, firstAt: 0, lastBannerAt: 0, log: [] },
    patrols: [],
    patrolBursts: [],
  });
  window.addEventListener("error", (e) => {
    if (R.errors.length < 10) R.errors.push(String(e.message));
  });

  /* ---------- 1) 真实帧记录（用 patch 前的原生 rAF） ---------- */
  const realRAF = window.requestAnimationFrame.bind(window);
  const realFrameLoop = (ts) => {
    R.frames.push(ts);
    if (R.frames.length > 40000) R.frames.splice(0, 10000);
    // 巡逻横幅消失 >0.5s → 判定本次巡逻结束（变速时横幅不再被绘制）
    if (R.boss.active && performance.now() - R.boss.lastBannerAt > 500) {
      R.boss.active = false;
      R.patrols.push({
        variant: R.boss.variant,
        firstAt: Math.round(R.boss.firstAt),
        endedAt: Math.round(performance.now()),
        log: R.boss.log.slice(),
      });
    }
    realRAF(realFrameLoop);
  };
  realRAF(realFrameLoop);

  /* ---------- 5) 可控变速 rAF（speed=1 时等价原样） ---------- */
  let lastIn = performance.now();
  let lastOut = lastIn;
  const mapTs = (realTs) => {
    if (realTs > lastIn) {
      lastOut += (realTs - lastIn) * R.speed;
      lastIn = realTs;
    }
    return lastOut;
  };
  const origRAF = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => origRAF((ts) => cb(mapTs(ts)));

  /* ---------- 3) 原始 pointerdown（capture） ---------- */
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (R.pointerEvents.length < 500) {
        R.pointerEvents.push({
          t: Math.round(performance.now() * 10) / 10,
          isPrimary: e.isPrimary,
          id: e.pointerId,
          x: Math.round(e.clientX),
          y: Math.round(e.clientY),
          type: e.pointerType,
        });
      }
    },
    true,
  );

  /* ---------- 2) Canvas 文本记录 ---------- */
  const STATIC = new Set(["戳屏幕摸鱼", "丢梗!", "戳它 +5×点击力"]);
  const BANNER = /老板来了|假装工作|摸鱼冲刺/;
  const origFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (txt, x, y) {
    const s = String(txt);
    try {
      if (STATIC.has(s)) {
        /* 静态提示：忽略 */
      } else if (BANNER.test(s)) {
        const now = performance.now();
        const variant = /摸鱼冲刺/.test(s) ? "blitz" : /假装工作/.test(s) ? "type" : "hold";
        if (!R.boss.active) {
          R.boss.active = true;
          R.boss.variant = variant;
          R.boss.firstAt = now;
          R.boss.log = [];
          // 任务变体（type/blitz）：立刻切回实时钟，让"真人速度连点"可被观察
          if (variant !== "hold" && R.speed !== 1) R.speed = 1;
        }
        R.boss.lastBannerAt = now;
        const last = R.boss.log[R.boss.log.length - 1];
        if (!last || last.s !== s) R.boss.log.push({ t: Math.round(now), s });
        if (R.boss.log.length > 300) R.boss.log.splice(0, 100);
        if (R.banners.length < 200 && (!last || last.s !== s)) R.banners.push({ t: Math.round(now), s });
      } else if (s.length < 40) {
        if (R.texts.length > 40000) R.texts.splice(0, 15000);
        R.texts.push({
          t: performance.now(),
          s,
          x: Math.round(x),
          y: Math.round(y),
          fs: (this.font.match(/(\d+(?:\.\d+)?)px/) || [0, 0])[1] * 1 || 0,
        });
      }
    } catch (_) {
      /* 记录失败不影响游戏 */
    }
    return origFillText.apply(this, arguments);
  };

  /* ---------- 工具：点击坐标 / 同步点击测量 ---------- */
  R.clickPoint = function () {
    const c = document.getElementById("stage");
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.bottom - 26;
    return {
      x: Math.round(x),
      y: Math.round(y),
      cx: Math.round(x - r.left),
      cy: Math.round(y - r.top),
    };
  };

  R.measureClick = function (x, y, isPrimary, pointerId) {
    const c = document.getElementById("stage");
    const before = window.__MOYU__.state;
    const t = performance.now();
    c.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        isPrimary: isPrimary !== false,
        pointerId: pointerId || 1,
        pointerType: "touch",
        button: 0,
        buttons: 1,
        pressure: 0.5,
      }),
    );
    const after = window.__MOYU__.state;
    return {
      t,
      dMoyu: after.totalEarned - before.totalEarned, // 原始值，不四舍五入（combo 反推用）
      dClicks: after.totalClicks - before.totalClicks,
      totalClicks: after.totalClicks,
    };
  };

  R.sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  R.sleepUntil = async function (target) {
    for (;;) {
      const d = target - performance.now();
      if (d <= 0) return;
      await new Promise((res) => setTimeout(res, d > 14 ? d - 10 : 0));
    }
  };

  /** 孤立点击（间隔足够让 combo 断档，用于测延迟） */
  R.runIsolated = async function (n, gapMs) {
    const pt = R.clickPoint();
    const clicks = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) await R.sleep(gapMs);
      clicks.push(R.measureClick(pt.x, pt.y, true, 1));
    }
    await R.sleep(150); // 让最后一击的飘字也画出来
    return { clicks, pt };
  };

  /** 连续点击：cps、时长、每次间隔抖动比例 */
  R.runBurst = async function (opts) {
    const cps = opts.cps;
    const ms = opts.ms;
    const jitter = opts.jitter || 0;
    const pt = R.clickPoint();
    const n = Math.max(1, Math.round((ms / 1000) * cps));
    const period = 1000 / cps;
    const clicks = [];
    let t = performance.now() + 80;
    for (let i = 0; i < n; i++) {
      await R.sleepUntil(t);
      clicks.push(R.measureClick(pt.x, pt.y, true, 1));
      t += period * (1 + (Math.random() * 2 - 1) * jitter);
    }
    return { clicks, pt, cps, jitter };
  };

  /**
   * 连击窗口探针：seed 3 连（间隔 100ms）后停 gap 再点，用收入反推 combo。
   * 关键：最后一击 seed 后不再 sleep(100)，实测停顿时长从最后一击算起。
   */
  R.comboProbe = async function (gaps) {
    const pt = R.clickPoint();
    const out = [];
    for (const gap of gaps) {
      await R.sleep(1750); // > 1.5s 断点，确保清零
      const seed = [];
      for (let i = 0; i < 3; i++) {
        if (i > 0) await R.sleep(100);
        seed.push(R.measureClick(pt.x, pt.y, true, 1));
      }
      await R.sleep(gap * 1000);
      const c = R.measureClick(pt.x, pt.y, true, 1);
      const combo = c.dClicks === 1 ? Math.round((c.dMoyu - 1) / 0.02) : null;
      out.push({
        requestedGap: gap,
        actualGap: r1((c.t - seed[2].t) / 1000),
        seedCombos: seed.map((s) => Math.round((s.dMoyu - 1) / 0.02)),
        gain: c.dMoyu,
        dClicks: c.dClicks,
        combo,
      });
    }
    return out;
  };

  /* ---------- 分析辅助（在页面内聚合，避免传输大数组） ---------- */
  R.frameStats = function (a, b) {
    const ts = R.frames.filter((t) => t >= a && t <= b);
    if (ts.length < 3) return { n: ts.length };
    const d = [];
    for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
    d.sort((x, y) => x - y);
    const q = (p) => d[Math.min(d.length - 1, Math.max(0, Math.floor(p * (d.length - 1))))];
    const span = ts[ts.length - 1] - ts[0];
    return {
      n: ts.length,
      span: r1(span),
      fps: r1((d.length * 1000) / span),
      p50: r1(q(0.5)),
      p95: r1(q(0.95)),
      max: r1(d[d.length - 1]),
      over33: d.filter((x) => x > 33.4).length,
      over50: d.filter((x) => x > 50).length,
      over100: d.filter((x) => x > 100).length,
    };
  };

  R.latencyStats = function (clicks) {
    return clicks.map((c) => {
      let firstText = null;
      for (let i = 0; i < R.texts.length; i++) {
        if (R.texts[i].t > c.t) {
          firstText = R.texts[i];
          break;
        }
      }
      let firstFrame = null;
      for (let i = 0; i < R.frames.length; i++) {
        if (R.frames[i] > c.t) {
          firstFrame = R.frames[i];
          break;
        }
      }
      return {
        lat: firstText ? r1(firstText.t - c.t) : null,
        text: firstText ? firstText.s : null,
        fs: firstText ? firstText.fs : null,
        frameLat: firstFrame ? r1(firstFrame - c.t) : null,
        gain: c.dMoyu,
        dClicks: c.dClicks,
      };
    });
  };

  /**
   * 飘字重叠：按绘制批次（同帧 <=3ms 连续）分组。
   * 只统计"点击列"的飘字（x 与点击点一致、y 在点击点上方 70px 内），
   * 排除段位/图鉴 toast（固定 y≈canvasH*0.22）等干扰。
   */
  R.textStats = function (a, b, pt, fontPx) {
    const list = R.texts.filter((e) => {
      if (e.t < a || e.t > b) return false;
      if (!pt) return true;
      return Math.abs(e.x - pt.cx) <= 4 && e.y > pt.cy - 70 && e.y < pt.cy + 12;
    });
    const draws = [];
    let cur = [];
    let last = -1e9;
    for (const e of list) {
      if (e.t - last > 3) {
        if (cur.length) draws.push(cur);
        cur = [];
      }
      cur.push(e);
      last = e.t;
    }
    if (cur.length) draws.push(cur);
    const overlapTh = (fontPx || 30) * 0.8;
    let maxN = 0;
    let sumN = 0;
    let comboDraws = 0;
    let pairs = 0;
    let overlapPairs = 0;
    let gapSum = 0;
    let minGap = Infinity;
    const samples = [];
    for (const d of draws) {
      const n = d.length;
      maxN = Math.max(maxN, n);
      sumN += n;
      if (d.some((e) => e.s.indexOf("连击") >= 0)) comboDraws++;
      const ys = d.map((e) => e.y).sort((p, q) => p - q);
      for (let i = 1; i < ys.length; i++) {
        const g = ys[i] - ys[i - 1];
        pairs++;
        gapSum += g;
        minGap = Math.min(minGap, g);
        if (g < overlapTh) overlapPairs++;
      }
      if (samples.length < 30) samples.push({ t: Math.round(d[0].t), n, ys });
    }
    return {
      draws: draws.length,
      avgN: draws.length ? r1(sumN / draws.length) : 0,
      maxN,
      pairs,
      overlapPairs,
      overlapPct: pairs ? r1((overlapPairs / pairs) * 100) : 0,
      avgAdjGap: pairs ? r1(gapSum / pairs) : 0,
      minGap: pairs ? r1(minGap) : null,
      comboDraws,
      fontPx: fontPx || 30,
      samples,
    };
  };

  /** 连击文案：每个 ×N 首次出现时刻（去掉重复重绘） */
  R.comboTexts = function (a, b) {
    const firstAt = {};
    for (const e of R.texts) {
      if (e.t < a || e.t > b) continue;
      const m = e.s.match(/连击×(\d+)/);
      if (!m) continue;
      const n = Number(m[1]);
      if (!(n in firstAt)) firstAt[n] = Math.round(e.t);
    }
    return Object.keys(firstAt)
      .map(Number)
      .sort((x, y) => x - y)
      .map((n) => ({ n, t: firstAt[n] }));
  };

  /**
   * 把同一字符串的连续帧重绘折叠成"一次实例"（飘字寿命 0.9s，同字符串多实例按 y 分离）。
   * 返回 [{s,t}]，t = 首次绘制时刻。
   */
  R.distinctTexts = function (a, b) {
    const openByS = new Map();
    const out = [];
    for (const e of R.texts) {
      if (e.t < a || e.t > b) continue;
      let arr = openByS.get(e.s);
      if (!arr) {
        arr = [];
        openByS.set(e.s, arr);
      }
      let hit = null;
      for (const inst of arr) {
        if (e.t - inst.lastT < 40 && Math.abs(e.y - inst.lastY) <= 1.5) {
          hit = inst;
          break;
        }
      }
      if (hit) {
        hit.lastT = e.t;
        hit.lastY = e.y;
      } else {
        const inst = { s: e.s, firstT: e.t, lastT: e.t, lastY: e.y };
        arr.push(inst);
        out.push({ s: e.s, t: Math.round(e.t) });
      }
    }
    return out;
  };

  R.resetTexts = function () {
    R.texts.length = 0;
    R.pointerEvents.length = 0;
  };
})();
