/**
 * R6 · 移动端 UX 评审探针（真实 Chrome/CDP，390×844 / 375×667 / 360×740，DPR3 + touch）
 *
 * 覆盖：
 * 1) 布局：三视口各区域 rect / 重叠 / 裁切 / 溢出 / 商店横滑到底 / 日报面板
 * 2) 点击热区：📔 按钮、商店卡、场景、日报关闭/领取按钮的 rect + elementFromPoint 命中覆盖率
 * 3) 可读性：computed fontSize + 计算色对比度 + 截图真实像素对比度（含 disabled 卡 opacity 0.55）
 * 4) 交互反馈：场景点击飘字（canvas 像素级佐证）、HUD 数值、买卡后价格即时刷新、日报领取角标消失
 * 5) 性能：10s 帧率、首屏 ready/FCP/load、console error/warning/exception 计数
 * 6) 视觉：三视口 + 日报面板 + 飘字前后截图（playtest/r6-screens/）
 *
 * 产出：playtest/r6-ux-evidence.json（全部实测数值）
 * 用法：node playtest/probe-r6-ux-cdp.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9517;
const APP_URL = "http://127.0.0.1:5173/";
const SHOT_DIR = "playtest/r6-screens";
mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r6-ux]", ...a);

/* ============================== CDP 基础 ============================== */

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      timeout: 30000,
    });
    if (r.exceptionDetails) {
      throw new Error("evaluate failed: " + JSON.stringify(r.exceptionDetails).slice(0, 1200));
    }
    return r.result.value;
  }
  async screenshot() {
    const r = await this.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    return r.data;
  }
}

let chromeProc = null;
let cdp = null;

async function waitJson(path, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error(`CDP not ready: ${path}`);
}

async function waitUntil(fn, label, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return true;
    } catch {
      /* keep polling */
    }
    await sleep(100);
  }
  throw new Error(`waitUntil timeout: ${label}`);
}

async function launch() {
  chromeProc = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      `--user-data-dir=/tmp/chrome-r6-ux-${Date.now()}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chromeProc.stderr.on("data", () => {});
  await waitJson("/json/version");
  const target = await fetch(
    `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  ).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws error"));
  });
  cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Network.enable");
  await cdp.send("Performance.enable");
  // 首屏计时：在 document_start 埋点，记录 __MOYU__ 就绪 / load / FCP
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      const rec = { nav: Math.round(performance.now()), ready: null, load: null, fcp: null };
      window.__UXBOOT__ = rec;
      const iv = setInterval(() => {
        if (window.__MOYU__ && rec.ready == null) { rec.ready = Math.round(performance.now()); clearInterval(iv); }
      }, 10);
      addEventListener('load', () => { rec.load = Math.round(performance.now()); });
      try {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') rec.fcp = Math.round(e.startTime);
        }).observe({ type: 'paint', buffered: true });
      } catch (e) {}
    })();`,
  });
}

async function setViewport(w, h) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: w,
    height: h,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: w,
    screenHeight: h,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
}

async function clearSave() {
  await cdp.send("Storage.clearDataForOrigin", {
    origin: "http://127.0.0.1:5173",
    storageTypes: "local_storage",
  });
}

let navSeq = 0;
async function navigateFresh() {
  await clearSave();
  navSeq++;
  await cdp.send("Page.navigate", { url: `${APP_URL}?r6=${Date.now()}-${navSeq}` });
  await waitUntil(
    async () => (await cdp.evaluate("!!window.__MOYU__ && document.querySelectorAll('.shop-card').length === 9")) === true,
    "game boot",
  );
  await sleep(1100); // 资产与首帧稳定
}

async function reloadKeepSave() {
  navSeq++;
  await cdp.send("Page.navigate", { url: `${APP_URL}?r6=${Date.now()}-${navSeq}` });
  await waitUntil(
    async () => (await cdp.evaluate("!!window.__MOYU__ && document.querySelectorAll('.shop-card').length === 9")) === true,
    "game boot (save)",
  );
  await sleep(1000);
}

/** 伪造存档后重载：先写入 localStorage，再用 rewindSave 抑制 pagehide 的存档覆盖 */
async function forgeSaveAndReload(saveLiteral) {
  await cdp.evaluate(`(() => {
    const save = ${saveLiteral};
    localStorage.setItem('moyu-save', JSON.stringify(save));
    if (window.__MOYU__) window.__MOYU__.rewindSave(0.001);
    return true;
  })()`);
  await reloadKeepSave();
}

async function tap(x, y, holdMs = 25) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, radiusX: 6, radiusY: 6, force: 1, id: 1 }],
  });
  await sleep(holdMs);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function tapSelector(sel) {
  const r = await cdp.evaluate(
    `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
  );
  if (!r) throw new Error("no element " + sel);
  await tap(r.x, r.y);
  return r;
}

/* ============================== 页面内表达式 ============================== */

const TEXT_TARGETS_MAIN = [
  { sel: "#hud-moyu", label: "HUD 摸鱼值数值" },
  { sel: ".hud-moyu small", label: "HUD 摸鱼值标签" },
  { sel: ".hud-sub > span:nth-child(1)", label: "HUD 点击+文案" },
  { sel: "#hud-click", label: "HUD 点击力数值" },
  { sel: ".hud-sub > span:nth-child(2)", label: "HUD 挂机/秒文案" },
  { sel: "#hud-idle", label: "HUD 挂机数值" },
  { sel: "#hud-rank", label: "HUD 段位+百分比" },
  { sel: "#hud-streak", label: "HUD 连胜" },
  { sel: ".shop-card .shop-name", label: "商店卡名称" },
  { sel: ".shop-card .shop-desc", label: "商店卡描述" },
  { sel: ".shop-card .shop-next", label: "商店卡下级增量/里程碑" },
  { sel: ".shop-card .shop-value", label: "商店卡性价比" },
  { sel: ".shop-card .shop-cost", label: "商店卡价格" },
  { sel: ".shop-card .shop-flavor", label: "商店卡彩蛋文案" },
  { sel: ".shop-card .shop-level", label: "商店卡等级" },
  { sel: ".shop-card:not(.affordable) .shop-name", label: "商店卡名称(不可买 opacity .55)" },
  { sel: ".shop-card:not(.affordable) .shop-desc", label: "商店卡描述(不可买 opacity .55)" },
  { sel: ".shop-card:not(.affordable) .shop-cost", label: "商店卡价格(不可买 opacity .55)" },
];

const TEXT_TARGETS_AFFORDABLE = [
  { sel: ".shop-card.affordable .shop-name", label: "可买卡名称" },
  { sel: ".shop-card.affordable .shop-desc", label: "可买卡描述" },
  { sel: ".shop-card.affordable .shop-next", label: "可买卡增量/里程碑" },
  { sel: ".shop-card.affordable .shop-value", label: "可买卡性价比" },
  { sel: ".shop-card.affordable .shop-cost", label: "可买卡价格" },
  { sel: ".shop-card.affordable .shop-flavor", label: "可买卡彩蛋" },
];

const TEXT_TARGETS_JOURNAL = [
  { sel: ".journal-head h2", label: "日报标题" },
  { sel: "#journal-close", label: "日报关闭按钮" },
  { sel: ".journal-meta", label: "日报日期/连胜" },
  { sel: ".goal .goal-desc", label: "日报目标文案" },
  { sel: ".goal .goal-progress", label: "日报目标进度" },
  { sel: "#journal-claim", label: "日报领取按钮" },
  { sel: ".journal-panel h3", label: "图鉴标题" },
  { sel: ".journal-panel h3 small", label: "图鉴总数" },
  { sel: ".journal-collect span", label: "图鉴分类进度" },
  { sel: "#journal-latest", label: "最新彩蛋" },
  { sel: ".c-item.on .c-label", label: "图鉴格标签(已解锁)" },
  { sel: ".c-item.on .c-text", label: "图鉴格内容(已解锁)" },
  { sel: ".c-item.off .c-label", label: "图鉴格标签(未解锁)" },
  { sel: ".c-item.off .c-text", label: "图鉴格内容(未解锁)" },
];

const buildLayoutExpr = (targets) => `(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const dpr = devicePixelRatio, vw = innerWidth, vh = innerHeight;
  const rd = (n) => Math.round(n * 10) / 10;
  const rect = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: rd(r.x), y: rd(r.y), w: rd(r.width), h: rd(r.height), right: rd(r.right), bottom: rd(r.bottom) };
  };
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null);
  const isHidden = (el) => {
    if (!el) return true;
    const s = cs(el);
    if (!s || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true;
    const r = el.getBoundingClientRect();
    return r.width < 1 || r.height < 1;
  };
  const lineCount = (el) => {
    if (!el) return 0;
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length;
  };
  const overlap = (a, b) => {
    if (!a || !b) return null;
    const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
    return w > 0.5 && h > 0.5 ? { w: rd(w), h: rd(h), area: rd(w * h) } : null;
  };
  const outside = (r) => {
    if (!r) return null;
    return {
      right: rd(r.right - vw), bottom: rd(r.bottom - vh), left: rd(-r.x), top: rd(-r.y),
      any: r.right > vw + 0.5 || r.bottom > vh + 0.5 || r.x < -0.5 || r.y < -0.5,
    };
  };
  const rgb = (str) => {
    if (!str) return null;
    const i = str.indexOf('(');
    if (i < 0) return null;
    const parts = str.slice(i + 1, str.lastIndexOf(')')).split(',').map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => {
    const l1 = Math.max(lum(a), lum(b)), l2 = Math.min(lum(a), lum(b));
    return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const pageBg = { r: 35, g: 35, b: 50, a: 1 };
  const resolveBg = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      const c = rgb(s.backgroundColor);
      if (c && c.a > 0.001) stack.push(c);
      n = n.parentElement;
    }
    let bg = pageBg;
    for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg);
    return bg;
  };
  const effOpacityOf = (el) => {
    let o = 1, n = el;
    while (n) { o *= Number(getComputedStyle(n).opacity); n = n.parentElement; }
    return Math.round(o * 100) / 100;
  };
  const measure = (el) => {
    if (!el) return { missing: true };
    const s = cs(el);
    const op = effOpacityOf(el);
    const fg = rgb(s.color);
    const bg = resolveBg(el);
    let contrastComputed = null;
    if (fg && bg) {
      let f = fg, b = bg;
      if (op < 1) {
        f = blend({ ...fg, a: fg.a * op }, pageBg);
        b = blend({ ...bg, a: op }, pageBg);
      }
      contrastComputed = ratio(f, b);
    }
    return {
      fs: parseFloat(s.fontSize),
      lh: s.lineHeight,
      fw: s.fontWeight,
      color: s.color,
      bgColor: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
      opacity: Number(s.opacity),
      effOpacity: op,
      contrastComputed,
      rect: rect(el),
      lines: lineCount(el),
      text: txt(el),
      hidden: isHidden(el),
    };
  };
  const hitCoverage = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return 0;
    let ok = 0, total = 0;
    for (let iy = 0; iy < 3; iy++) {
      for (let ix = 0; ix < 3; ix++) {
        const x = r.left + (r.width * (ix + 0.5)) / 3;
        const y = r.top + (r.height * (iy + 0.5)) / 3;
        const t = document.elementFromPoint(x, y);
        total++;
        if (t && (t === el || el.contains(t))) ok++;
      }
    }
    return Math.round((ok / total) * 100) / 100;
  };
  const hud = $('#hud'), hudSub = $('.hud-sub'), stageWrap = $('#stage-wrap');
  const stage = $('#stage'), shop = $('#shop'), shopCards = $('#shop-cards');
  const journalBtn = $('#btn-journal');
  const cards = $$('.shop-card');
  const typo = ${JSON.stringify(targets)}.map((t) => {
    const el = $(t.sel);
    return { sel: t.sel, label: t.label, ...measure(el) };
  });
  const hudParts = ['#hud-moyu', '.hud-moyu small', '#hud-click', '#hud-idle', '#hud-rank', '#hud-streak', '#btn-journal']
    .map((sel) => {
      const el = $(sel);
      return {
        sel, text: txt(el), rect: rect(el), hidden: isHidden(el), lines: lineCount(el),
        scrollW: el ? el.scrollWidth : null, clientW: el ? el.clientWidth : null,
        clippedX: el ? el.scrollWidth > el.clientWidth + 1 : null,
        hitCoverage: hitCoverage(el),
      };
    });
  const overlaps = [];
  const named = { hud: rect(hud), stageWrap: rect(stageWrap), stage: rect(stage), shop: rect(shop), journalBtn: rect(journalBtn) };
  const keys = Object.keys(named);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const inter = overlap(named[keys[i]], named[keys[j]]);
      if (inter) overlaps.push({ a: keys[i], b: keys[j], ...inter });
    }
  }
  const outsideMap = {};
  for (const k of Object.keys(named)) outsideMap[k] = outside(named[k]);
  const badge = cs(journalBtn, '::after');
  return {
    viewport: { w: vw, h: vh, dpr, visualScale: visualViewport ? Math.round(visualViewport.scale * 100) / 100 : null },
    doc: {
      scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
      bodyScrollW: document.body.scrollWidth, bodyScrollH: document.body.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth - vw,
    },
    meta: {
      viewportMeta: $('meta[name="viewport"]') ? $('meta[name="viewport"]').content : null,
      manifest: $('link[rel="manifest"]') ? $('link[rel="manifest"]').getAttribute('href') : null,
      lang: document.documentElement.lang, title: document.title,
      bodyTouchAction: cs(document.body) ? cs(document.body).touchAction : null,
      canvasTouchAction: stage ? cs(stage).touchAction : null,
    },
    app: { rect: rect($('#app')), padding: (() => { const s = cs($('#app')); return s ? { top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft } : null; })() },
    named, outOfViewport: outsideMap, overlaps,
    hud: {
      rect: rect(hud), sub: { rect: rect(hudSub), scrollW: hudSub ? hudSub.scrollWidth : null, clientW: hudSub ? hudSub.clientWidth : null, clipped: hudSub ? hudSub.scrollWidth > hudSub.clientWidth + 1 : null },
      parts: hudParts,
    },
    stageWrap: rect(stageWrap),
    stage: stage ? { rect: rect(stage), attrW: stage.width, attrH: stage.height, clientW: stage.clientWidth, clientH: stage.clientHeight } : null,
    shop: {
      rect: rect(shop),
      cards: { rect: rect(shopCards), scrollW: shopCards ? shopCards.scrollWidth : null, clientW: shopCards ? shopCards.clientWidth : null, scrollLeft: shopCards ? Math.round(shopCards.scrollLeft) : null, maxScrollLeft: shopCards ? shopCards.scrollWidth - shopCards.clientWidth : null },
      cardCount: cards.length,
      list: cards.map((c) => ({
        id: c.dataset.upgrade, rect: rect(c), disabled: c.disabled, affordable: c.classList.contains('affordable'),
        name: txt(c.querySelector('.shop-name')), cost: txt(c.querySelector('.shop-cost')),
        level: txt(c.querySelector('.shop-level')),
        scrollH: c.scrollHeight, clientH: c.clientHeight, contentOverflow: c.scrollHeight > c.clientHeight + 1,
        fs: { name: parseFloat(cs(c.querySelector('.shop-name')).fontSize), desc: parseFloat(cs(c.querySelector('.shop-desc')).fontSize) },
      })),
    },
    journalBtn: {
      rect: rect(journalBtn), hasReward: journalBtn ? journalBtn.classList.contains('has-reward') : null,
      aria: journalBtn ? journalBtn.getAttribute('aria-label') : null,
      title: journalBtn ? journalBtn.getAttribute('title') : null,
      badgeContent: badge ? badge.content : null, badgeW: badge ? badge.width : null,
    },
    journal: { open: !isHidden($('#journal')) },
    typography: typo,
    fps: window.__MOYU__ ? window.__MOYU__.fps : null,
    boot: window.__UXBOOT__ || null,
    state: window.__MOYU__ ? window.__MOYU__.state : null,
  };
})()`;

const SHOP_SCROLL_EXPR = `(() => {
  const c = document.getElementById('shop-cards');
  const cards = Array.from(c.children);
  const out = { before: { scrollLeft: Math.round(c.scrollLeft), scrollW: c.scrollWidth, clientW: c.clientWidth } };
  c.scrollLeft = c.scrollWidth;
  const max = c.scrollWidth - c.clientWidth;
  const last = cards[cards.length - 1].getBoundingClientRect();
  const view = c.getBoundingClientRect();
  out.after = { scrollLeft: Math.round(c.scrollLeft), maxScrollLeft: max, atEnd: Math.round(c.scrollLeft) >= max - 1, lastCardRight: Math.round(last.right), containerRight: Math.round(view.right), lastCardFullyVisible: last.right <= view.right + 0.5, lastCardLeft: Math.round(last.left) };
  const first = cards[0].getBoundingClientRect();
  out.firstCardLeft = Math.round(first.left);
  // 复原
  c.scrollLeft = 0;
  out.restored = Math.round(c.scrollLeft);
  return out;
})()`;

const JOURNAL_EXPR = `(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const rd = (n) => Math.round(n * 10) / 10;
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: rd(r.x), y: rd(r.y), w: rd(r.width), h: rd(r.height), right: rd(r.right), bottom: rd(r.bottom) }; };
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const txt = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : null);
  const isHidden = (el) => { if (!el) return true; const s = cs(el); if (!s || s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return true; const r = el.getBoundingClientRect(); return r.width < 1 || r.height < 1; };
  const hitCoverage = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return 0;
    let ok = 0, total = 0;
    for (let iy = 0; iy < 3; iy++) for (let ix = 0; ix < 3; ix++) {
      const x = r.left + (r.width * (ix + 0.5)) / 3, y = r.top + (r.height * (iy + 0.5)) / 3;
      const t = document.elementFromPoint(x, y); total++;
      if (t && (t === el || el.contains(t))) ok++;
    }
    return Math.round((ok / total) * 100) / 100;
  };
  const panel = $('.journal-panel'), grid = $('#journal-grid');
  const panelRect = rect(panel), claim = $('#journal-claim'), close = $('#journal-close');
  const claimRect = rect(claim);
  const items = $$('#journal-grid .c-item');
  const xs = Array.from(new Set(items.map((i) => Math.round(i.getBoundingClientRect().left)))).sort((a, b) => a - b);
  const gridBefore = { scrollTop: grid ? Math.round(grid.scrollTop) : null, scrollH: grid ? grid.scrollHeight : null, clientH: grid ? grid.clientHeight : null };
  if (grid) grid.scrollTop = grid.scrollHeight;
  const lastItem = items.length ? items[items.length - 1].getBoundingClientRect() : null;
  const gridRect = grid ? grid.getBoundingClientRect() : null;
  const gridAfter = { scrollTop: grid ? Math.round(grid.scrollTop) : null, maxScrollTop: grid ? grid.scrollHeight - grid.clientHeight : null, lastItemVisible: lastItem && gridRect ? lastItem.bottom <= gridRect.bottom + 0.5 && lastItem.top >= gridRect.top - 0.5 : null };
  if (grid) grid.scrollTop = 0;
  return {
    open: !isHidden($('#journal')),
    overlay: { rect: rect($('#journal')), bg: cs($('#journal')) ? cs($('#journal')).backgroundColor : null },
    panel: { rect: panelRect, scrollH: panel ? panel.scrollHeight : null, clientH: panel ? panel.clientHeight : null, scrollable: panel ? panel.scrollHeight > panel.clientHeight + 1 : null, scrollW: panel ? panel.scrollWidth : null, clientW: panel ? panel.clientWidth : null, horizontalOverflow: panel ? panel.scrollWidth - panel.clientWidth : null },
    close: { rect: rect(close), hitCoverage: hitCoverage(close), aria: close ? close.getAttribute('aria-label') : null },
    goals: $$('#journal-goals li').map((li) => ({ cls: li.className, text: txt(li) })),
    claim: { rect: claimRect, text: txt(claim), disabled: claim ? claim.disabled : null, hitCoverage: hitCoverage(claim), fullyVisibleInPanel: panelRect && claimRect ? claimRect.bottom <= panelRect.bottom + 0.5 && claimRect.top >= panelRect.y - 0.5 : null, visibleInViewport: claimRect ? claimRect.bottom <= innerHeight + 0.5 && claimRect.top >= 0 : null },
    grid: { rect: rect(grid), count: items.length, columns: xs.length, columnXs: xs, firstRowY: items.length ? [Math.round(items[0].getBoundingClientRect().y), items[1] ? Math.round(items[1].getBoundingClientRect().y) : null] : null, ...gridBefore, afterScroll: gridAfter, itemsOverflowEach: items.slice(0, 3).map((i) => i.scrollHeight > i.clientHeight + 1) },
    collectText: txt($('.journal-collect')),
    total: txt($('#journal-total')),
    latest: txt($('#journal-latest')),
    badgeAfter: cs($('#btn-journal'), '::after') ? cs($('#btn-journal'), '::after').content : null,
  };
})()`;

const ANALYSIS_EXPR = (b64, targets) => `(async () => {
  const dpr = devicePixelRatio;
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = 'data:image/png;base64,' + ${JSON.stringify(b64)}; });
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(img, 0, 0);
  const I = cx.getImageData(0, 0, img.width, img.height);
  const data = I.data;
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const ratio = (a, b) => { const l1 = Math.max(a, b), l2 = Math.min(a, b); return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100; };
  const out = [];
  for (const t of ${JSON.stringify(targets)}) {
    const el = document.querySelector(t.sel);
    if (!el) { out.push({ sel: t.sel, label: t.label, missing: true }); continue; }
    const s = getComputedStyle(el);
    const er = el.getBoundingClientRect();
    if (er.width < 1 || er.height < 1 || s.display === 'none' || s.visibility === 'hidden') {
      out.push({ sel: t.sel, label: t.label, hidden: true }); continue;
    }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const rects = [];
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent || !n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    if (!rects.length) { out.push({ sel: t.sel, label: t.label, empty: true }); continue; }
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const r of rects) { left = Math.min(left, r.left); top = Math.min(top, r.top); right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom); }
    const x0 = Math.max(0, Math.floor(left * dpr)), x1 = Math.min(I.width, Math.ceil(right * dpr));
    const y0 = Math.max(0, Math.floor(top * dpr)), y1 = Math.min(I.height, Math.ceil(bottom * dpr));
    if (x1 <= x0 || y1 <= y0) { out.push({ sel: t.sel, label: t.label, offscreen: true }); continue; }
    const area = (x1 - x0) * (y1 - y0);
    const stride = Math.max(1, Math.round(Math.sqrt(area / 60000)));
    const hist = new Map();
    let total = 0;
    for (let y = y0; y < y1; y += stride) {
      for (let x = x0; x < x1; x += stride) {
        const i = (y * I.width + x) * 4;
        if (data[i + 3] < 200) continue;
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        hist.set(key, (hist.get(key) || 0) + 1);
        total++;
      }
    }
    if (!hist.size) { out.push({ sel: t.sel, label: t.label, noPixels: true }); continue; }
    let bgKey = 0, bgCount = 0;
    for (const [k, c] of hist) { if (c > bgCount) { bgCount = c; bgKey = k; } }
    const bgL = lum((bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255);
    const minCount = Math.max(3, Math.round(total * 0.002));
    let best = null;
    for (const [k, c] of hist) {
      if (k === bgKey || c < minCount) continue;
      const r = (k >> 16) & 255, g = (k >> 8) & 255, b = k & 255;
      const cr = ratio(lum(r, g, b), bgL);
      if (!best || cr > best.contrast) best = { r, g, b, count: c, contrast: cr };
    }
    out.push({
      sel: t.sel, label: t.label,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 48),
      fs: parseFloat(s.fontSize),
      computedColor: s.color,
      computedOpacity: Number(s.opacity),
      pixelBg: 'rgb(' + ((bgKey >> 16) & 255) + ', ' + ((bgKey >> 8) & 255) + ', ' + (bgKey & 255) + ')',
      pixelFg: best ? 'rgb(' + best.r + ', ' + best.g + ', ' + best.b + ')' : null,
      pixelContrast: best ? best.contrast : null,
      fgPixels: best ? best.count : 0,
      samples: total,
      boxPx: { w: x1 - x0, h: y1 - y0 },
    });
  }
  return { image: { w: I.width, h: I.height }, items: out };
})()`;

const COMPARE_EXPR = (b64a, b64b, region) => `(async () => {
  const dpr = devicePixelRatio;
  const decode = async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('decode failed')); img.src = 'data:image/png;base64,' + b64; });
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, data: cx.getImageData(0, 0, img.width, img.height).data };
  };
  const A = await decode(${JSON.stringify(b64a)});
  const B = await decode(${JSON.stringify(b64b)});
  const reg = ${JSON.stringify(region)};
  const x0 = Math.max(0, Math.floor(reg.x * dpr)), x1 = Math.min(A.w, Math.ceil((reg.x + reg.w) * dpr));
  const y0 = Math.max(0, Math.floor(reg.y * dpr)), y1 = Math.min(A.h, Math.ceil((reg.y + reg.h) * dpr));
  let changed = 0, brightA = 0, brightB = 0, brightBox = null;
  const isBright = (d, i) => d[i] > 200 && d[i + 1] > 185 && d[i + 2] > 150;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const ia = (y * A.w + x) * 4, ib = (y * B.w + x) * 4;
      if (Math.abs(A.data[ia] - B.data[ib]) + Math.abs(A.data[ia + 1] - B.data[ib + 1]) + Math.abs(A.data[ia + 2] - B.data[ib + 2]) > 30) changed++;
      if (isBright(A.data, ia)) brightA++;
      if (isBright(B.data, ib)) {
        brightB++;
        const lx = x / dpr, ly = y / dpr;
        if (!brightBox) brightBox = { x0: lx, y0: ly, x1: lx, y1: ly };
        else { brightBox.x0 = Math.min(brightBox.x0, lx); brightBox.y0 = Math.min(brightBox.y0, ly); brightBox.x1 = Math.max(brightBox.x1, lx); brightBox.y1 = Math.max(brightBox.y1, ly); }
      }
    }
  }
  return { region: reg, changedPx: changed, brightPxBefore: brightA, brightPxAfter: brightB, brightBox: brightBox ? { x0: Math.round(brightBox.x0), y0: Math.round(brightBox.y0), x1: Math.round(brightBox.x1), y1: Math.round(brightBox.y1) } : null };
})()`;

const TAP_INSTRUMENT = `(() => {
  window.__TAPLOG__ = { events: [], dbl: 0 };
  const push = (type) => (e) => window.__TAPLOG__.events.push({ type, t: Math.round(performance.now() * 100) / 100, ts: Math.round(e.timeStamp * 100) / 100 });
  for (const type of ['touchstart', 'pointerdown', 'mousedown', 'pointerup', 'click']) {
    document.addEventListener(type, push(type), { capture: true, passive: true });
  }
  document.addEventListener('dblclick', () => { window.__TAPLOG__.dbl++; }, { capture: true, passive: true });
  return true;
})()`;

/* ============================== 业务流程 ============================== */

const evidence = { generatedAt: new Date().toISOString(), app: APP_URL, chrome: null, viewports: [], interactions: null, daily: null, stressHud: null, perf: null, console: null };

async function saveShot(name, b64) {
  const p = `${SHOT_DIR}/${name}.png`;
  writeFileSync(p, Buffer.from(b64, "base64"));
  return p;
}

async function measureViewport(w, h) {
  const label = `${w}x${h}`;
  log("measure viewport", label);
  await setViewport(w, h);
  await navigateFresh();
  const layout = await cdp.evaluate(buildLayoutExpr(TEXT_TARGETS_MAIN));
  const shot = await cdp.screenshot();
  const shotPath = await saveShot(`${label}-main`, shot);
  const typoPixels = await cdp.evaluate(ANALYSIS_EXPR(shot, TEXT_TARGETS_MAIN));
  const shopScroll = await cdp.evaluate(SHOP_SCROLL_EXPR);

  // 商店卡可发现性：首屏可见完整卡片数（用于判断"是否有下一张的露出线索"）
  const cardVisibility = await cdp.evaluate(`(() => {
    const c = document.getElementById('shop-cards');
    const view = c.getBoundingClientRect();
    return Array.from(c.children).map((el, i) => {
      const r = el.getBoundingClientRect();
      const visibleW = Math.max(0, Math.min(r.right, view.right) - Math.max(r.left, view.left));
      return { i, id: el.dataset.upgrade, visibleW: Math.round(visibleW), full: visibleW >= r.width - 0.5, ratio: Math.round((visibleW / r.width) * 100) / 100 };
    });
  })()`);

  // 日报面板
  const btn = await tapSelector("#btn-journal");
  await sleep(250);
  const journal = await cdp.evaluate(JOURNAL_EXPR);
  const journalShot = await cdp.screenshot();
  const journalShotPath = await saveShot(`${label}-journal`, journalShot);
  const journalTypoPixels = await cdp.evaluate(ANALYSIS_EXPR(journalShot, TEXT_TARGETS_JOURNAL));
  // 关闭（真实触点）
  const close = await tapSelector("#journal-close");
  await sleep(200);
  const closed = await cdp.evaluate("document.getElementById('journal').classList.contains('hidden')");

  evidence.viewports.push({
    label, size: { w, h },
    boot: layout.boot, fps: layout.fps,
    layout: {
      viewport: layout.viewport, doc: layout.doc, meta: layout.meta, app: layout.app,
      named: layout.named, outOfViewport: layout.outOfViewport, overlaps: layout.overlaps,
      hud: layout.hud, stage: layout.stage, shop: layout.shop, journalBtn: layout.journalBtn,
    },
    cardsVisibility: cardVisibility,
    shopScroll,
    journal: { ...journal, openedByTap: { x: btn.x, y: btn.y }, closeTap: close, closedAfterTap: closed },
    screenshots: { main: shotPath, journal: journalShotPath },
    typographyComputed: layout.typography,
    typographyPixels: typoPixels,
    journalTypographyPixels: journalTypoPixels,
  });
}

async function interactionsTest() {
  log("interactions at 390x844");
  await setViewport(390, 844);
  await navigateFresh();
  const tapLogPath = await cdp.evaluate(TAP_INSTRUMENT);
  const boot = await cdp.evaluate("window.__UXBOOT__");
  const before = await cdp.evaluate(`({
    state: window.__MOYU__.state,
    hud: { moyu: document.getElementById('hud-moyu').textContent, click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent, rank: document.getElementById('hud-rank').textContent },
    fps: window.__MOYU__.fps,
    scrollY: scrollY,
    visualScale: visualViewport ? visualViewport.scale : null
  })`);

  // ---- 场景点击飘字（canvas 像素佐证）----
  const tapPoint = { x: 335, y: 270 };
  const shotBefore = await cdp.screenshot();
  await tap(tapPoint.x, tapPoint.y);
  await sleep(110);
  const shotAfter = await cdp.screenshot();
  const afterTapState = await cdp.evaluate(`({ moyu: window.__MOYU__.state.moyu, fps: window.__MOYU__.fps, frames: window.__MOYU__.frames })`);
  const diff = await cdp.evaluate(COMPARE_EXPR(shotBefore, shotAfter, { x: 324, y: 195, w: 66, h: 145 }));
  const beforePath = await saveShot("390x844-tap-before", shotBefore);
  const afterPath = await saveShot("390x844-tap-after", shotAfter);

  // ---- 连点 20 次（真实触摸）----
  const fpsStart = await cdp.evaluate("({ fps: window.__MOYU__.fps, frames: window.__MOYU__.frames })");
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await tap(320 + (i % 3) * 12, 300 + (i % 2) * 10);
    await sleep(70);
  }
  await sleep(300);
  const afterClicks = await cdp.evaluate(`({
    state: window.__MOYU__.state,
    fps: window.__MOYU__.fps,
    frames: window.__MOYU__.frames,
    hudMoyu: document.getElementById('hud-moyu').textContent,
    hudClick: document.getElementById('hud-click').textContent,
    tapLog: window.__TAPLOG__,
    fps2: window.__MOYU__.fps
  })`);
  const clicksWallMs = Date.now() - t0;

  // ---- 可买态商店卡可读性（opacity 从 .55 恢复为 1）----
  const affordableState = await cdp.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('.shop-card'));
    const n = cards.filter((c) => c.classList.contains('affordable')).length;
    const first = cards.find((c) => c.classList.contains('affordable'));
    return { affordableCount: n, firstId: first ? first.dataset.upgrade : null, firstOpacity: first ? getComputedStyle(first).opacity : null,
      className: first ? first.className : null, moyu: window.__MOYU__.state.moyu };
  })()`);
  const affordableShot = await cdp.screenshot();
  const affordableShotPath = await saveShot("390x844-shop-affordable", affordableShot);
  const affordableTypo = await cdp.evaluate(ANALYSIS_EXPR(affordableShot, TEXT_TARGETS_AFFORDABLE));

  // ---- 商店横滑手势（真实触摸滑动，验证可发现性/可滑性）----
  const shopSwipe = await (async () => {
    const c = await cdp.evaluate(`(() => { const c = document.getElementById('shop-cards'); const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, scrollLeft: Math.round(c.scrollLeft) }; })()`);
    let gestureError = null;
    try {
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(c.x), y: Math.round(c.y), xDistance: -180, yDistance: 0,
        speed: 800, gestureSourceType: "touch", preventFling: true,
      });
      await sleep(350);
    } catch (e) {
      gestureError = String(e).slice(0, 200);
    }
    const after = await cdp.evaluate(`(() => { const c = document.getElementById('shop-cards'); const r = { sl: Math.round(c.scrollLeft) }; c.scrollLeft = 0; return r; })()`);
    return { startScrollLeft: c.scrollLeft, afterScrollLeft: after.sl, moved: after.sl > c.scrollLeft, gestureError };
  })();

  // ---- 300ms 延迟 / 双击缩放 ----
  const tapDelays = (() => {
    const ev = afterClicks.tapLog.events;
    const out = [];
    for (let i = 0; i < ev.length; i++) {
      if (ev[i].type === 'pointerdown') {
        const up = ev.slice(i + 1).find((e) => e.type === 'pointerup');
        const click = ev.slice(i + 1).find((e) => e.type === 'click');
        out.push({ downToUp: up ? Math.round((up.ts - ev[i].ts) * 10) / 10 : null, downToClick: click ? Math.round((click.ts - ev[i].ts) * 10) / 10 : null });
      }
    }
    return out;
  })();

  // 双击测试：视口缩放手感
  const scaleBefore = await cdp.evaluate("visualViewport ? visualViewport.scale : null");
  await tap(200, 400, 20);
  await sleep(90);
  await tap(200, 400, 20);
  await sleep(350);
  const doubleTap = await cdp.evaluate(`({
    scale: visualViewport ? visualViewport.scale : null,
    dblclicks: window.__TAPLOG__.dbl,
    innerW: innerWidth,
    innerH: innerHeight,
    visualW: visualViewport ? visualViewport.width : null
  })`);

  // ---- 买卡即时反馈 ----
  const buyBefore = await cdp.evaluate(`(() => {
    const cards = Array.from(document.querySelectorAll('.shop-card'));
    const idx = cards.findIndex((c) => !c.disabled);
    if (idx < 0) return { none: true };
    const c = cards[idx];
    const r = c.getBoundingClientRect();
    return { idx, id: c.dataset.upgrade, center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
      cost: c.querySelector('.shop-cost').textContent, level: c.querySelector('.shop-level').textContent,
      disabled: c.disabled, affordable: c.classList.contains('affordable'), state: window.__MOYU__.state };
  })()`);
  let buyResult = null;
  if (buyBefore && !buyBefore.none) {
    const tBuy = Date.now();
    await tap(buyBefore.center.x, buyBefore.center.y);
    // 触点抬起后立即读一次（不 sleep），验证价格/等级是否同帧刷新
    const immediate = await cdp.evaluate(`(() => {
      const c = document.querySelectorAll('.shop-card')[${buyBefore.idx}];
      return { cost: c.querySelector('.shop-cost').textContent, level: c.querySelector('.shop-level').textContent, disabled: c.disabled, affordable: c.classList.contains('affordable') };
    })()`);
    const immediateMs = Date.now() - tBuy;
    await sleep(120);
    const afterBuy = await cdp.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('.shop-card'));
      const idx = ${buyBefore.idx};
      const c = cards[idx];
      return { cost: c.querySelector('.shop-cost').textContent, level: c.querySelector('.shop-level').textContent,
        disabled: c.disabled, affordable: c.classList.contains('affordable'),
        state: window.__MOYU__.state, hudMoyu: document.getElementById('hud-moyu').textContent };
    })()`);
    buyResult = { before: buyBefore, immediate, immediateMs, after: afterBuy, wallMs: Date.now() - tBuy };
  }

  // ---- 10s 帧率 ----
  log("fps sampling 10s");
  const fpsSamples = [];
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    const s = await cdp.evaluate("({ fps: window.__MOYU__.fps, frames: window.__MOYU__.frames, dpr: devicePixelRatio })");
    fpsSamples.push(s);
  }

  // ---- 页面基本信息 ----
  const perfNav = await cdp.evaluate(`(() => {
    const n = performance.getEntriesByType('navigation')[0];
    const paints = performance.getEntriesByType('paint').map((p) => ({ name: p.name, t: Math.round(p.startTime) }));
    return {
      navigation: n ? { domInteractive: Math.round(n.domInteractive), domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transferSize: n.transferSize } : null,
      paints,
      ready: window.__UXBOOT__,
      canvas: (() => { const c = document.getElementById('stage'); return c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight, dpr: devicePixelRatio } : null; })(),
      assets: window.__MOYU__.assets,
      domNodes: document.getElementsByTagName('*').length,
    };
  })()`);

  return {
    boot, before, tapPoint, afterTapState, diff, screenshots: { tapBefore: beforePath, tapAfter: afterPath, affordable: affordableShotPath },
    afterClicks, clicksWallMs, tapDelays, doubleTap: { before: scaleBefore, ...doubleTap },
    affordableState, affordableTypographyPixels: affordableTypo, shopSwipe,
    buy: buyResult, fpsSamples, perfNav, tapLogInstalled: tapLogPath,
  };
}

async function dailyTest() {
  log("daily claim / badge test");
  await setViewport(390, 844);
  await clearSave();
  // 伪造"三目标全完成未领取"存档，重载后验证角标与领取反馈
  const forge = await cdp.evaluate(`(() => {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const save = {
      v: 1, moyu: 300, totalEarned: 300, levels: { coffee: 1 }, savedAt: Date.now(), createdAt: Date.now() - 3600 * 1000,
      collected: { quotes: [0, 1], flavors: [0] },
      daily: {
        date: today,
        goals: [
          { id: 'click_100', target: 100, progress: 100, done: true },
          { id: 'meme_1', target: 1, progress: 1, done: true },
          { id: 'buy_3', target: 3, progress: 3, done: true },
        ],
        streak: 2, lastCompleteDate: null, claimed: false,
      },
      surviveStreak: 0,
    };
    return { today, raw: save };
  })()`);
  await forgeSaveAndReload(JSON.stringify(forge.raw));
  const beforeOpen = await cdp.evaluate(`(() => {
    const btn = document.getElementById('btn-journal');
    const after = getComputedStyle(btn, '::after');
    return {
      hasReward: btn.classList.contains('has-reward'),
      afterContent: after.content, afterW: after.width, afterH: after.height, afterBg: after.backgroundColor,
      title: btn.getAttribute('title'),
      daily: window.__MOYU__.state.daily,
      hudStreak: document.getElementById('hud-streak').textContent,
    };
  })()`);
  await tapSelector("#btn-journal");
  await sleep(300);
  const opened = await cdp.evaluate(JOURNAL_EXPR);
  // 图鉴已解锁格子的真实字号/对比度 + 真实滚动
  const shotBeforeClaim = await cdp.screenshot();
  const shotBeforeClaimPath = await saveShot("390x844-journal-claimable", shotBeforeClaim);
  const journalTypographyPixels = await cdp.evaluate(ANALYSIS_EXPR(shotBeforeClaim, TEXT_TARGETS_JOURNAL));
  const gridSwipe = await (async () => {
    const g = await cdp.evaluate(`(() => {
      const el = document.getElementById('journal-grid');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, scrollTop: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight };
    })()`);
    let err = null;
    try {
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(g.x), y: Math.round(g.y), xDistance: 0, yDistance: -140,
        speed: 600, gestureSourceType: "touch", preventFling: true,
      });
      await sleep(350);
    } catch (e) {
      err = String(e).slice(0, 200);
    }
    const after = await cdp.evaluate("Math.round(document.getElementById('journal-grid').scrollTop)");
    await cdp.evaluate("document.getElementById('journal-grid').scrollTop = 0");
    return { startScrollTop: g.scrollTop, maxScrollTop: g.max, afterScrollTop: after, moved: after > g.scrollTop, gestureError: err };
  })();
  const tClaim = Date.now();
  await tapSelector("#journal-claim");
  await sleep(150);
  const afterClaim = await cdp.evaluate(`(() => {
    const btn = document.getElementById('btn-journal');
    return {
      hasReward: btn.classList.contains('has-reward'),
      afterContent: getComputedStyle(btn, '::after').content,
      claimText: document.getElementById('journal-claim').textContent,
      claimDisabled: document.getElementById('journal-claim').disabled,
      daily: window.__MOYU__.state.daily,
      hudMoyu: document.getElementById('hud-moyu').textContent,
      goals: Array.from(document.querySelectorAll('#journal-goals li')).map((li) => li.textContent.replace(/\\s+/g, ' ').trim()),
    };
  })()`);
  const claimWallMs = Date.now() - tClaim;
  return { forged: forge, beforeOpen, opened, afterClaim, claimWallMs, gridSwipe, journalTypographyPixels, screenshot: shotBeforeClaimPath };
}

async function stressHudTest() {
  log("stress HUD at 360x740 / 390x844");
  await setViewport(360, 740);
  await clearSave();
  const now = Date.now();
  const save = {
    v: 1, moyu: 987654321, totalEarned: 2500000000, levels: { retire: 50, coffee: 9 },
    savedAt: now, createdAt: now - 3600 * 1000,
    collected: { quotes: [0, 1, 2], flavors: [0, 1, 2] },
    daily: null, surviveStreak: 12,
  };
  await forgeSaveAndReload(JSON.stringify(save));
  const measure = async (label) => {
    const stress = await cdp.evaluate(`(() => {
      const rd = (n) => Math.round(n * 10) / 10;
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: rd(r.x), y: rd(r.y), w: rd(r.width), h: rd(r.height), right: rd(r.right), bottom: rd(r.bottom) }; };
      const sub = document.querySelector('.hud-sub');
      const parts = ['#hud-moyu', '.hud-moyu small', '#hud-click', '#hud-idle', '#hud-rank', '#hud-streak', '#btn-journal'].map((sel) => {
        const el = document.querySelector(sel);
        return { sel, text: el ? el.textContent.trim() : null, rect: rect(el), scrollW: el ? el.scrollWidth : null, clientW: el ? el.clientWidth : null, clipped: el ? el.scrollWidth > el.clientWidth + 1 : null, hidden: el ? el.offsetWidth === 0 : null };
      });
      return {
        viewport: { w: innerWidth, h: innerHeight },
        hud: rect(document.getElementById('hud')),
        sub: { rect: rect(sub), scrollW: sub.scrollWidth, clientW: sub.clientWidth, clipped: sub.scrollWidth > sub.clientWidth + 1 },
        parts, state: { moyu: window.__MOYU__.state.moyu, totalEarned: window.__MOYU__.state.totalEarned, surviveStreak: window.__MOYU__.state.surviveStreak },
        hudTexts: { moyu: document.getElementById('hud-moyu').textContent, rank: document.getElementById('hud-rank').textContent, idle: document.getElementById('hud-idle').textContent, streak: document.getElementById('hud-streak').textContent },
        docScrollW: document.documentElement.scrollWidth,
        rankTitle: document.getElementById('hud-rank').getAttribute('title'),
      };
    })()`);
    const shot = await cdp.screenshot();
    const shotPath = await saveShot(`${label}-hud-stress`, shot);
    return { ...stress, screenshot: shotPath };
  };
  const at360 = await measure("360x740");
  await setViewport(390, 844);
  await sleep(400);
  const at390 = await measure("390x844");
  return { at360, at390 };
}

async function safeAreaTest() {
  log("safe-area override test (top 59 / bottom 34)");
  await setViewport(390, 844);
  await navigateFresh();
  try {
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 59, bottom: 34, left: 0, right: 0 },
    });
    await sleep(450);
    const m = await cdp.evaluate(`(() => {
      const rd = (n) => Math.round(n * 10) / 10;
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: rd(r.x), y: rd(r.y), w: rd(r.width), h: rd(r.height), right: rd(r.right), bottom: rd(r.bottom) }; };
      const app = document.getElementById('app');
      const s = getComputedStyle(app);
      return {
        appPadding: { top: s.paddingTop, right: s.paddingRight, bottom: s.paddingBottom, left: s.paddingLeft },
        appRect: rect(app), hud: rect(document.getElementById('hud')),
        stage: rect(document.getElementById('stage-wrap')), shop: rect(document.getElementById('shop')),
        docScrollH: document.documentElement.scrollHeight,
      };
    })()`);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", {
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    return { supported: true, ...m };
  } catch (e) {
    return { supported: false, error: String(e).slice(0, 300) };
  }
}

/** Node 侧派生指标：画布溢出、字号/对比度违规、领取按钮可见性 */
function postProcess() {
  const violations = (v) => ({
    smallFonts: v.typographyComputed
      .filter((t) => !t.missing && !t.hidden && typeof t.fs === "number" && t.fs < 12)
      .map((t) => ({ label: t.label, sel: t.sel, fs: t.fs, text: (t.text || "").slice(0, 20) })),
    lowContrast: v.typographyComputed
      .filter((t) => !t.missing && !t.hidden && typeof t.contrastComputed === "number" && t.contrastComputed < 4.5)
      .map((t) => ({ label: t.label, sel: t.sel, fs: t.fs, contrast: t.contrastComputed, opacity: t.effOpacity, text: (t.text || "").slice(0, 20) })),
  });
  for (const v of evidence.viewports) {
    const L = v.layout;
    const stageH = L.stage ? L.stage.rect.h : null;
    const wrapH = L.stageWrap ? L.stageWrap.h : null;
    const claimRect = v.journal.claim && v.journal.claim.rect;
    const panelRect = v.journal.panel && v.journal.panel.rect;
    v.derived = {
      stageCanvasOverflowPx: stageH != null && wrapH != null ? Math.round(stageH - wrapH) : null,
      stageCanvasAttr: L.stage ? { attrW: L.stage.attrW, attrH: L.stage.attrH, cssW: L.stage.clientW, cssH: L.stage.clientH } : null,
      canvasDprMismatch: L.stage ? Math.round((L.stage.attrW / L.stage.rect.w) * 100) / 100 : null,
      claimVisibleInPanel: claimRect && panelRect ? claimRect.bottom <= panelRect.bottom + 0.5 && claimRect.y >= panelRect.y - 0.5 : null,
      claimVisibleInViewport: claimRect ? claimRect.bottom <= v.layout.viewport.h + 0.5 && claimRect.y >= 0 : null,
      ...violations(v),
      touchTargets: [
        { name: "📔 日报按钮", w: L.journalBtn.rect.w, h: L.journalBtn.rect.h, pass44: L.journalBtn.rect.w >= 44 && L.journalBtn.rect.h >= 44 },
        { name: "商店卡", w: L.shop.list[0] ? L.shop.list[0].rect.w : null, h: L.shop.list[0] ? L.shop.list[0].rect.h : null, pass44: L.shop.list[0] ? L.shop.list[0].rect.w >= 44 && L.shop.list[0].rect.h >= 44 : null },
        { name: "场景画布", w: L.stage ? L.stage.rect.w : null, h: L.stage ? L.stage.rect.h : null, pass44: L.stage ? L.stage.rect.w >= 44 && L.stage.rect.h >= 44 : null },
        { name: "日报关闭 ✕", w: v.journal.close.rect.w, h: v.journal.close.rect.h, pass44: v.journal.close.rect.w >= 44 && v.journal.close.rect.h >= 44 },
        { name: "日报领取按钮", w: v.journal.claim.rect.w, h: v.journal.claim.rect.h, pass44: v.journal.claim.rect.w >= 44 && v.journal.claim.rect.h >= 44 },
      ],
    };
  }
  evidence.perf = {
    note: "首屏 timing 取自每次 navigateFresh 后 __UXBOOT__（Vite dev server warm）；10s 帧率取自 interactionsTest",
    coldBoot: evidence.viewports[0] ? evidence.viewports[0].boot : null,
    warmBoot: evidence.viewports.slice(1).map((v) => v.boot),
    fpsSamples: evidence.interactions ? evidence.interactions.fpsSamples : [],
  };
}

async function main() {
  await launch();
  const version = await cdp.send("Browser.getVersion");
  evidence.chrome = version.product;
  try {
    for (const [w, h] of [[390, 844], [375, 667], [360, 740]]) {
      await measureViewport(w, h);
    }
    evidence.interactions = await interactionsTest();
    evidence.safeArea = await safeAreaTest();
    evidence.daily = await dailyTest();
    evidence.stressHud = await stressHudTest();
    postProcess();

    // 汇总 console
    const ev = cdp.events;
    const consoleErrors = [], consoleWarns = [], exceptions = [], failedReq = [];
    for (const m of ev) {
      if (m.method === "Runtime.consoleAPICalled") {
        const text = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type)).join(" ");
        if (m.params.type === "error") consoleErrors.push(text.slice(0, 300));
        if (m.params.type === "warning") consoleWarns.push(text.slice(0, 300));
      } else if (m.method === "Runtime.exceptionThrown") {
        exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400));
      } else if (m.method === "Log.entryAdded") {
        const e = m.params.entry;
        if (e.level === "error") consoleErrors.push(("[log] " + e.text).slice(0, 300));
        if (e.level === "warning") consoleWarns.push(("[log] " + e.text).slice(0, 300));
      } else if (m.method === "Network.loadingFailed") {
        failedReq.push(m.params.errorText + " " + (m.params.type || ""));
      }
    }
    evidence.console = { consoleErrors, consoleWarns, exceptions, failedReq };
  } catch (err) {
    evidence.error = String(err && err.stack ? err.stack : err);
  }
  writeFileSync("playtest/r6-ux-evidence.json", JSON.stringify(evidence, null, 2));
  log("evidence written:", "playtest/r6-ux-evidence.json");
  try { chromeProc && chromeProc.kill(); } catch { /* ignore */ }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  writeFileSync("playtest/r6-ux-evidence.json", JSON.stringify({ error: String(err && err.stack ? err.stack : err), partial: evidence }, null, 2));
  try { chromeProc && chromeProc.kill(); } catch { /* ignore */ }
  process.exit(1);
});
