/**
 * R7 · 怒退玩家（低耐心易弃坑）真实浏览器探针。只读，不修改 src/。
 *
 * 用法：
 *   node playtest/probe-r7-rage.mjs a   # 首屏真实计时 + 3 秒内可交互 + 随机乱点 10 次
 *   node playtest/probe-r7-rage.mjs b   # 加速时钟（rAF 时间戳 ×7.5）复现一次巡逻偷点罚款
 *
 * 产出：
 *   /tmp/rage-1.png /tmp/rage-2.png /tmp/rage-3-boss.png /tmp/rage-4-penalty.png
 *   playtest/r7-screens/*.png
 *   playtest/r7-rage-evidence.json
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "http://127.0.0.1:5173/";
const W = 390;
const H = 844;
const SHOTS = "playtest/r7-screens";
const EVIDENCE = "playtest/r7-rage-evidence.json";
mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ---------------- 页面内注入脚本（文档创建前安装） ---------------- */
const PROBE_SCRIPT = `
(() => {
  const P = window.__probe = {
    navAt: Math.round(performance.now() * 10) / 10,
    hookAt: null, firstFrameAt: null, assetsAt: null,
    paints: {}, lcp: null, errors: [],
    events: [], hint: { count: 0, first: 0, last: 0, x: 0, y: 0 },
  };
  window.addEventListener('error', (e) => { try { P.errors.push(String(e.message)); } catch (_) {} });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!(e.name in P.paints)) P.paints[e.name] = Math.round(e.startTime * 10) / 10; } })
      .observe({ type: 'paint', buffered: true });
  } catch (_) {}
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) P.lcp = Math.round(e.startTime * 10) / 10; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}
  // 精确捕获 __MOYU__ 装配完成的时刻
  let _moyu = null;
  try {
    Object.defineProperty(window, '__MOYU__', {
      configurable: true,
      get() { return _moyu; },
      set(v) { _moyu = v; if (P.hookAt === null) P.hookAt = Math.round(performance.now() * 10) / 10; },
    });
  } catch (_) {}
  // 记录所有 canvas 文本（首屏提示 / 点击浮字 / 巡逻横幅），用于验证"有没有反馈"
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
    try {
      const s = String(t);
      if (s === '戳屏幕摸鱼') {
        const h = P.hint; h.count++; h.x = Math.round(x); h.y = Math.round(y);
        if (!h.first) h.first = Math.round(performance.now());
        h.last = Math.round(performance.now());
      } else {
        P.events.push({ txt: s, x: Math.round(x), y: Math.round(y), ts: Math.round(performance.now()) });
        if (P.events.length > 800) P.events.splice(0, 300);
      }
    } catch (_) {}
    return orig.apply(this, arguments);
  };
  P.recent = function (sinceMs, winMs) {
    const now = performance.now(); const out = []; const seen = {};
    for (let i = P.events.length - 1; i >= 0; i--) {
      const e = P.events[i];
      if (now - e.ts > winMs) break;
      if (e.ts <= sinceMs) continue;
      if (!seen[e.txt]) { seen[e.txt] = 1; out.push(e); }
    }
    return out;
  };
  const rafOrig = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return rafOrig(function (ts) {
      if (P.firstFrameAt === null) P.firstFrameAt = Math.round(performance.now() * 10) / 10;
      cb(ts);
    });
  };
  const iv = setInterval(function () {
    const g = window.__MOYU__; if (!g) return;
    const a = g.assets || {};
    if (P.assetsAt === null && a.worker === 'loaded' && a.computer === 'loaded' && a.cooler === 'loaded')
      P.assetsAt = Math.round(performance.now() * 10) / 10;
    if (P.hookAt !== null && P.firstFrameAt !== null && P.assetsAt !== null) clearInterval(iv);
  }, 8);
  P.snap = function () {
    return { hookAt: P.hookAt, firstFrameAt: P.firstFrameAt, assetsAt: P.assetsAt, paints: P.paints, lcp: P.lcp, errors: P.errors.slice(0, 5), navAt: P.navAt };
  };
})();
`;

/** 加速时钟：每帧把 rAF 时间戳推快 125ms（≈7.5 倍速），只用于触发 90-150s 才出现的巡逻 */
const ACCEL_SCRIPT = `
(() => {
  const inner = window.requestAnimationFrame;
  let fake = performance.now();
  window.requestAnimationFrame = function (cb) {
    return inner(function () { fake += 125; cb(fake); });
  };
})();
`;

/* ---------------- CDP 连接 ---------------- */
async function waitJson(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("CDP not ready: " + url);
}

async function openBrowser({ port, accelerate }) {
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--disable-extensions",
      `--user-data-dir=/tmp/chrome-r7-rage-${port}-${Date.now()}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (evt) => {
    const m = JSON.parse(evt.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => {
    const i = ++id;
    ws.send(JSON.stringify({ id: i, method, params }));
    return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
  };
  const ev = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  return {
    send,
    ev,
    async shot(path) {
      const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      writeFileSync(path, Buffer.from(s.data, "base64"));
    },
    async tap(x, y) {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      proc.kill();
    },
  };
}

async function setupPage(b, accelerate) {
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE_SCRIPT });
  if (accelerate) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: ACCEL_SCRIPT });
  await b.send("Page.navigate", { url: URL_ });
}

const readSnap = (b) => b.ev("JSON.stringify(window.__probe ? window.__probe.snap() : null)").then((v) => (v ? JSON.parse(v) : null));
const readState = (b) => b.ev("JSON.stringify(window.__MOYU__ ? window.__MOYU__.state : null)").then((v) => (v ? JSON.parse(v) : null));
const pageNow = (b) => b.ev("performance.now()");

async function waitInteractive(b, timeoutMs = 15000) {
  const t0 = Date.now();
  const wall = { hook: null, firstFrame: null };
  let snap = null;
  while (Date.now() - t0 < timeoutMs) {
    snap = await readSnap(b);
    if (snap) {
      if (snap.hookAt !== null && wall.hook === null) wall.hook = Date.now() - t0;
      if (snap.firstFrameAt !== null && wall.firstFrame === null) wall.firstFrame = Date.now() - t0;
      if (snap.hookAt !== null && snap.firstFrameAt !== null) break;
    }
    await sleep(20);
  }
  return { snap, wall, pollMs: Date.now() - t0 };
}

const sleepUntilPageMs = async (b, target) => {
  const now = await pageNow(b);
  if (target > now) await sleep(target - now);
};

/* ---------------- 首屏审计 ---------------- */
const AUDIT_EXPR = `(() => {
  const items = [];
  const vw = innerWidth, vh = innerHeight;
  const walk = (el) => {
    for (const node of el.childNodes) {
      if (node.nodeType === 3) {
        const txt = (node.textContent || '').trim();
        if (!txt) continue;
        const p = node.parentElement; if (!p) continue;
        const cs = getComputedStyle(p);
        const r = p.getBoundingClientRect();
        const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) >= 0.02 && r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh;
        items.push({
          txt: txt.slice(0, 70), tag: p.tagName.toLowerCase(),
          cls: String(p.className || '').slice(0, 40),
          fontSize: parseFloat(cs.fontSize), color: cs.color, opacity: cs.opacity,
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          visible,
        });
      } else if (node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.02) continue;
        walk(node);
      }
    }
  };
  walk(document.body);
  const canvas = document.getElementById('stage');
  const cr = canvas ? canvas.getBoundingClientRect() : null;
  const shop = document.getElementById('shop-cards');
  const sb = shop.getBoundingClientRect();
  const cards = [...shop.querySelectorAll('.shop-card')].map((c, i) => {
    const r = c.getBoundingClientRect();
    return {
      i, id: c.dataset.upgrade, disabled: c.disabled, cls: c.className,
      fullyVisible: r.left >= sb.left - 1 && r.right <= sb.right + 1,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      text: c.innerText.replace(/\\n/g, ' | '),
    };
  });
  return JSON.stringify({
    vw, vh, dpr: devicePixelRatio,
    canvas: cr ? [Math.round(cr.x), Math.round(cr.y), Math.round(cr.width), Math.round(cr.height)] : null,
    items,
    shop: { scrollWidth: shop.scrollWidth, clientWidth: shop.clientWidth, cards },
    hud: {
      moyu: document.getElementById('hud-moyu').textContent,
      click: document.getElementById('hud-click').textContent,
      idle: document.getElementById('hud-idle').textContent,
      rank: document.getElementById('hud-rank').textContent,
      rankTitle: document.getElementById('hud-rank').title,
    },
    journalBtn: (() => { const j = document.getElementById('btn-journal'); const r = j.getBoundingClientRect(); return { text: j.textContent, w: Math.round(r.width), h: Math.round(r.height), cls: j.className }; })(),
    welcomeVisible: !document.getElementById('welcome').classList.contains('hidden'),
    tutorial: (() => {
      const t = document.getElementById('tutorial');
      if (!t) return null;
      const p = t.querySelector('.tutorial-panel');
      const pr = p ? p.getBoundingClientRect() : null;
      const b = document.getElementById('tutorial-ok');
      const br = b ? b.getBoundingClientRect() : null;
      return {
        visible: !t.classList.contains('hidden'),
        text: t.innerText.slice(0, 600),
        panel: pr ? [Math.round(pr.x), Math.round(pr.y), Math.round(pr.width), Math.round(pr.height)] : null,
        okBtn: br ? { rect: [Math.round(br.x), Math.round(br.y), Math.round(br.width), Math.round(br.height)], fontSize: b ? getComputedStyle(b).fontSize : null, text: b.textContent } : null,
      };
    })(),
    shopHint: (() => { const s = document.getElementById('shop-hint'); if (!s) return null; const r = s.getBoundingClientRect(); return { text: s.textContent, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], fontSize: getComputedStyle(s).fontSize, opacity: getComputedStyle(s).opacity, cls: s.className }; })(),
    bodyInnerText: document.body.innerText.slice(0, 2000),
  });
})()`;

/** 从 canvas 像素实测「戳屏幕摸鱼」提示的字号 / 对比度 */
const HINT_EXPR = `(() => {
  const P = window.__probe; const h = P.hint;
  const c = document.getElementById('stage');
  const r = c.getBoundingClientRect();
  const ctx = c.getContext('2d');
  const k = c.width / r.width; // 画布后备像素 / CSS 像素
  const cx = Math.round(h.x * k), cy = Math.round(h.y * k);
  const padX = 90;
  const x0 = Math.max(0, cx - padX), x1 = Math.min(c.width, cx + padX);
  const y0 = Math.max(0, cy - 16), y1 = Math.min(c.height, cy + 6);
  const w = x1 - x0, hh = y1 - y0;
  const data = ctx.getImageData(x0, y0, w, hh).data;
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (R, G, B) => 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
  const lums = new Array(w * hh);
  for (let i = 0; i < data.length; i += 4) lums[i / 4] = lum(data[i], data[i + 1], data[i + 2]);
  const sorted = lums.slice().sort((a, b) => a - b);
  const bg = sorted[Math.floor(sorted.length * 0.5)];
  const hi = sorted[Math.floor(sorted.length * 0.995)];
  const contrast = (hi + 0.05) / (bg + 0.05);
  const thr = bg + 0.055;
  let rows = 0, cols = 0, count = 0;
  const rowHit = new Array(hh).fill(0), colHit = new Array(w).fill(0);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      if (lums[y * w + x] > thr) { rowHit[y]++; colHit[x]++; count++; }
    }
  }
  rows = rowHit.filter((n) => n > 0).length;
  cols = colHit.filter((n) => n > 0).length;
  return JSON.stringify({
    hintCount: h.count, firstDrawnAtMs: h.first, lastDrawnAtMs: h.last,
    logical: { x: h.x, y: h.y },
    pagePx: { x: Math.round(r.left + h.x), y: Math.round(r.top + h.y) },
    canvasCss: [Math.round(r.width), Math.round(r.height)],
    canvasDpr: k,
    bgLum: Math.round(bg * 1000) / 1000,
    textLum: Math.round(hi * 1000) / 1000,
    contrast: Math.round(contrast * 100) / 100,
    textRowsDevice: rows,
    textCssHeight: Math.round((rows / k) * 10) / 10,
    textCssWidth: Math.round((cols / k) * 10) / 10,
    textPixelCount: count,
    sourceFontPx: 10,
  });
})()`;

/* ================= 阶段 A：首屏 + 前 30 秒乱点 ================= */
async function phaseA() {
  const b = await openBrowser({ port: 9561, accelerate: false });
  const out = { phase: "A", shots: {} };
  try {
    await setupPage(b, false);
    const ready = await waitInteractive(b);
    out.ready = ready;
    const readyAt = await pageNow(b);
    await b.shot(`${SHOTS}/first-ready.png`);
    out.shots.ready = `${SHOTS}/first-ready.png`;

    // —— 3 秒内能不能玩：先看是否有遮挡/教程，再在 0.8s / 1.5s 乱点，2.0s 点教程按钮，2.4s 点场景 ——
    const early = [];
    const tapMeasure = async (atMs, x, y, label) => {
      await sleepUntilPageMs(b, atMs);
      const mark = await pageNow(b);
      const st0 = await readState(b);
      const tutBefore = await b.ev("!!document.getElementById('tutorial') && !document.getElementById('tutorial').classList.contains('hidden')");
      await b.tap(x, y);
      await sleep(260);
      const st1 = await readState(b);
      const tutAfter = await b.ev("!!document.getElementById('tutorial') && !document.getElementById('tutorial').classList.contains('hidden')");
      const texts = JSON.parse(await b.ev(`JSON.stringify(window.__probe.recent(${mark - 5}, 900))`));
      early.push({
        label,
        atPageMs: Math.round(mark),
        tap: [x, y],
        tutorialBefore: tutBefore,
        tutorialAfter: tutAfter,
        moyuBefore: Math.round(st0.moyu * 10) / 10,
        moyuAfter: Math.round(st1.moyu * 10) / 10,
        delta: Math.round((st1.moyu - st0.moyu) * 10) / 10,
        floatTexts: texts.map((t) => t.txt),
        feedback: st1.moyu - st0.moyu > 1.5 || texts.length > 0,
      });
    };
    // 700ms：教程弹窗首屏证据
    await sleepUntilPageMs(b, 700);
    await b.shot(`${SHOTS}/first-700ms.png`);
    out.shots.first700 = `${SHOTS}/first-700ms.png`;
    out.tutorialAt700 = JSON.parse(await b.ev(AUDIT_EXPR)).tutorial;
    await tapMeasure(800, 195, 430, "第一次乱点（屏幕中央，教程遮挡下）");
    await tapMeasure(1500, 195, 430, "第二次乱点（同一位置）");
    // 2.0s：点教程唯一的绿色按钮
    const okRect = JSON.parse(await b.ev(AUDIT_EXPR)).tutorial?.okBtn?.rect;
    if (okRect) await tapMeasure(1950, okRect[0] + okRect[2] / 2, okRect[1] + okRect[3] / 2, "点「开始摸鱼」关闭教程");
    await b.shot(`${SHOTS}/first-after-tutorial.png`);
    await tapMeasure(2400, 195, 430, "第一次真正点场景");
    out.earlyTaps = early;

    // —— 3 秒整：首屏截图 + DOM/画布审计 ——
    await sleepUntilPageMs(b, 3000);
    await b.shot("/tmp/rage-1.png");
    writeFileSync(`${SHOTS}/first-3s.png`, Buffer.from((await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
    out.shots.at3s = "/tmp/rage-1.png";
    out.audit = JSON.parse(await b.ev(AUDIT_EXPR));
    out.hint = JSON.parse(await b.ev(HINT_EXPR));
    out.at3s = {
      pageMs: Math.round(await pageNow(b)),
      state: await readState(b),
      fps: await b.ev("window.__MOYU__.fps"),
      assets: await b.ev("JSON.stringify(window.__MOYU__.assets)"),
      navTiming: JSON.parse(await b.ev(`JSON.stringify((() => { const e = performance.getEntriesByType('navigation')[0]; return e ? { responseEnd: Math.round(e.responseEnd), dcl: Math.round(e.domContentLoadedEventEnd), load: Math.round(e.loadEventEnd), resources: performance.getEntriesByType('resource').length } : null; })())`)),
    };

    // —— 前 30 秒乱点：场景内随机 10 次，间隔 0.2-2s ——
    const R = rng(20261127);
    const [cx, cy, cw, ch] = out.audit.canvas;
    const tapLog = [];
    for (let i = 0; i < 10; i++) {
      const gap = 200 + R() * 1800;
      await sleep(gap);
      const x = Math.round(cx + 30 + R() * (cw - 60));
      const y = Math.round(cy + 50 + R() * (ch - 100));
      const mark = await pageNow(b);
      const st0 = await readState(b);
      await b.tap(x, y);
      await sleep(260);
      const st1 = await readState(b);
      const texts = JSON.parse(await b.ev(`JSON.stringify(window.__probe.recent(${mark - 5}, 900))`));
      tapLog.push({
        i: i + 1,
        gapMs: Math.round(gap),
        pageMs: Math.round(mark),
        tap: [x, y],
        moyuBefore: Math.round(st0.moyu * 10) / 10,
        moyuAfter: Math.round(st1.moyu * 10) / 10,
        delta: Math.round((st1.moyu - st0.moyu) * 10) / 10,
        floatTexts: texts.map((t) => t.txt),
        feedback: st1.moyu > st0.moyu || texts.length > 0,
      });
    }
    out.taps = tapLog;

    await b.shot("/tmp/rage-2.png");
    writeFileSync(`${SHOTS}/after-10-taps.png`, Buffer.from((await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
    out.shots.afterTaps = "/tmp/rage-2.png";
    out.afterTaps = {
      pageMs: Math.round(await pageNow(b)),
      state: await readState(b),
      fps: await b.ev("window.__MOYU__.fps"),
      audit: JSON.parse(await b.ev(AUDIT_EXPR)),
      allCanvasTextsSeen: JSON.parse(await b.ev("JSON.stringify(Object.keys(window.__probe.events.reduce((a, e) => (a[e.txt] = 1, a), {})))")),
      hintStillDrawn: JSON.parse(await b.ev("JSON.stringify({ count: window.__probe.hint.count, last: window.__probe.hint.last })")),
    };
  } finally {
    b.close();
  }
  writeFileSync(EVIDENCE, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
}

/* ================= 阶段 B：加速时钟，触发一次偷点罚款 ================= */
async function phaseB() {
  const b = await openBrowser({ port: 9562, accelerate: true });
  const out = { phase: "B", note: "rAF 时间戳每帧 +125ms（≈7.5 倍速），用于把 90-150s 才出现的巡逻压缩到 12-20s；游戏内数值仍是真实逻辑" };
  try {
    await setupPage(b, true);
    await waitInteractive(b);
    // 加速模式同样会弹首次教程：必须先点「开始摸鱼」，否则后续所有点击都被遮罩吞掉
    {
      const tutOk = JSON.parse(await b.ev("JSON.stringify((()=>{const t=document.getElementById('tutorial');if(!t||t.classList.contains('hidden'))return null;const r=document.getElementById('tutorial-ok').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})())"));
      if (tutOk) { await b.tap(tutOk.x, tutOk.y); await sleep(320); }
      out.tutorialDismissed = await b.ev("!document.getElementById('tutorial') || document.getElementById('tutorial').classList.contains('hidden')");
    }
    // 先攒一点余额，让罚款有东西可扣
    for (let i = 0; i < 20; i++) {
      await b.tap(195, 420);
      await sleep(70);
    }
    out.balanceBeforeBoss = (await readState(b)).moyu;
    out.gameSecondsAtStart = await b.ev("window.__MOYU__ ? __MOYU__.frames : 0");

    const BOSS_RE = /老板来了|假装工作|摸鱼冲刺/;
    const patrols = [];
    let punish = null;
    for (let round = 0; round < 8 && !punish; round++) {
      let banner = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 40000) {
        const texts = JSON.parse(await b.ev("JSON.stringify(__probe.recent(performance.now() - 500, 500))"));
        const hit = texts.find((t) => BOSS_RE.test(t.txt));
        if (hit) {
          banner = hit.txt;
          break;
        }
        await sleep(100);
      }
      if (!banner) break;
      const variant = /老板来了/.test(banner) ? "hold" : /假装工作/.test(banner) ? "type" : "blitz";
      const patrol = { round: round + 1, banner, variant, realMsAtDetect: Date.now() - t0 };
      patrols.push(patrol);
      if (variant === "hold") {
        if (round === 0) {
          await b.shot("/tmp/rage-3-boss.png");
          writeFileSync(`${SHOTS}/boss-banner.png`, Buffer.from((await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
        }
        await sleep(140);
        const st0 = await readState(b);
        const mark = await pageNow(b);
        await b.tap(195, 430);
        await sleep(320);
        const st1 = await readState(b);
        const texts = JSON.parse(await b.ev(`JSON.stringify(__probe.recent(${mark - 5}, 2000))`));
        patrol.tap = {
          moyuBefore: Math.round(st0.moyu * 10) / 10,
          moyuAfter: Math.round(st1.moyu * 10) / 10,
          netDelta: Math.round((st1.moyu - st0.moyu) * 10) / 10,
          totalEarnedBefore: Math.round(st0.totalEarned * 10) / 10,
          totalEarnedAfter: Math.round(st1.totalEarned * 10) / 10,
          floatTexts: texts.map((t) => t.txt),
          hudMoyuAfter: await b.ev("document.getElementById('hud-moyu').textContent"),
        };
        if (texts.some((t) => /被逮/.test(t.txt))) {
          await b.shot("/tmp/rage-4-penalty.png");
          writeFileSync(`${SHOTS}/penalty.png`, Buffer.from((await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
          punish = { ...patrol, shots: { boss: "/tmp/rage-3-boss.png", penalty: "/tmp/rage-4-penalty.png" } };
        }
      } else {
        await sleep(1600);
      }
    }
    out.patrols = patrols;
    out.punish = punish;
    out.gameSecondsElapsed = await b.ev("window.__MOYU__ ? __MOYU__.frames : 0");
    out.finalState = await readState(b);
  } finally {
    b.close();
  }
  writeFileSync(EVIDENCE.replace(".json", "-b.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
}

/* ================= 阶段 C：新手保护 3 次之后，第 4 次巡逻偷点是否真的罚 ================= */
async function phaseC() {
  const b = await openBrowser({ port: 9566, accelerate: true });
  const out = { phase: "C", note: "加速 7.5x；每段巡逻结束并空窗后再计下一段，避免重复识别同一段" };
  try {
    await setupPage(b, true);
    await waitInteractive(b);
    // 加速模式同样会弹首次教程：必须先点「开始摸鱼」，否则后续所有点击都被遮罩吞掉
    {
      const tutOk = JSON.parse(await b.ev("JSON.stringify((()=>{const t=document.getElementById('tutorial');if(!t||t.classList.contains('hidden'))return null;const r=document.getElementById('tutorial-ok').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})())"));
      if (tutOk) { await b.tap(tutOk.x, tutOk.y); await sleep(320); }
      out.tutorialDismissed = await b.ev("!document.getElementById('tutorial') || document.getElementById('tutorial').classList.contains('hidden')");
    }
    for (let i = 0; i < 20; i++) {
      await b.tap(195, 420);
      await sleep(70);
    }
    out.balanceBeforeFirstPatrol = Math.round((await readState(b)).moyu * 10) / 10;
    const patrols = [];
    let caught = null;
    for (let round = 0; round < 7 && !caught; round++) {
      let banner = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 40000) {
        const texts = JSON.parse(await b.ev("JSON.stringify(__probe.recent(performance.now() - 400, 400))"));
        const hit = texts.find((t) => /老板来了|假装工作|摸鱼冲刺/.test(t.txt));
        if (hit) { banner = hit.txt; break; }
        await sleep(80);
      }
      if (!banner) break;
      const variant = /老板来了/.test(banner) ? "hold" : /假装工作/.test(banner) ? "type" : "blitz";
      const rec = { round: round + 1, banner, variant, waitMs: Date.now() - t0 };
      if (variant === "hold") {
        await sleep(150);
        const st0 = await readState(b);
        const mark = await pageNow(b);
        await b.tap(195, 430);
        await sleep(350);
        const st1 = await readState(b);
        const texts = JSON.parse(await b.ev(`JSON.stringify(__probe.recent(${mark - 5}, 2000))`));
        rec.tap = {
          moyuBefore: Math.round(st0.moyu * 10) / 10,
          moyuAfter: Math.round(st1.moyu * 10) / 10,
          netDelta: Math.round((st1.moyu - st0.moyu) * 10) / 10,
          totalEarnedBefore: Math.round(st0.totalEarned * 10) / 10,
          totalEarnedAfter: Math.round(st1.totalEarned * 10) / 10,
          floatTexts: texts.map((t) => t.txt),
          hudMoyuAfter: await b.ev("document.getElementById('hud-moyu').textContent"),
        };
        if (texts.some((t) => /被逮/.test(t.txt))) {
          await b.shot("/tmp/rage-4-penalty.png");
          writeFileSync(`${SHOTS}/penalty.png`, Buffer.from((await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false })).data, "base64"));
          caught = rec;
        }
      } else {
        const n = variant === "type" ? 5 : 20;
        for (let i = 0; i < n; i++) { await b.tap(195, 430); await sleep(40); }
      }
      patrols.push(rec);
      // 等这段巡逻完全结束（横幅消失）再进入下一段
      const tEnd = Date.now();
      while (Date.now() - tEnd < 30000) {
        const texts = JSON.parse(await b.ev("JSON.stringify(__probe.recent(performance.now() - 700, 700))"));
        const active = texts.some((t) => /老板来了|假装工作|摸鱼冲刺/.test(t.txt));
        if (!active) break;
        await sleep(150);
      }
      await sleep(900);
    }
    out.patrols = patrols;
    out.caught = caught;
    out.finalState = await readState(b);
  } finally {
    b.close();
  }
  writeFileSync(EVIDENCE.replace(".json", "-c.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
}

const which = process.argv[2] || "a";
if (which === "a") await phaseA();
else if (which === "b") await phaseB();
else if (which === "c") await phaseC();
else throw new Error("usage: node playtest/probe-r7-rage.mjs [a|b]");
process.exit(0);
