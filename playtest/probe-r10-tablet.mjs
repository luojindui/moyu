/**
 * R10 平板/宽屏探针（只读，不改 src/）：三视口测量 + 基础交互（点击/悬停/键盘/商店滚动）。
 * 用法：node playtest/probe-r10-tablet.mjs
 * 输出：playtest/r10-tablet.json + playtest/r10-screens/*.png
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PROBE_PORT || 9571);
const URL_ = process.env.URL || "http://127.0.0.1:5173/";
const OUTDIR = "playtest/r10-screens";
mkdirSync(OUTDIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--disable-extensions",
    `--user-data-dir=/tmp/chrome-r10-tablet-${Date.now()}`,
    `--remote-debugging-port=${PORT}`, "about:blank",
  ],
  { stdio: "ignore" },
);
async function waitJson(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch {}
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) => {
  const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve, reject) => pending.set(i, { resolve, reject }));
};
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const shot = async (file) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(file, Buffer.from(r.data, "base64"));
};

// ---------- 页面内测量表达式 ----------
const MEASURE = `(() => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
      display: cs.display, position: cs.position, fontSize: cs.fontSize,
      scrollW: el.scrollWidth, scrollH: el.scrollHeight, clientW: el.clientWidth, clientH: el.clientHeight,
    };
  };
  const vw = innerWidth, vh = innerHeight;
  const hud = rect('#hud'), wrap = rect('#stage-wrap'), shop = rect('#shop'), cards = rect('#shop-cards');
  const c = document.getElementById('stage');
  const cr = c.getBoundingClientRect();
  const scale = Math.max(2, Math.min(6, Math.round(cr.width / 130)));
  const virtual = { vw: +(cr.width / scale).toFixed(1), vh: +(cr.height / scale).toFixed(1) };
  const groundY = virtual.vh - 4.2 * 16;
  const deskY = groundY - 2 * 16;          // 场景实际用 groundY-2u 作为桌面 y
  const wkrY = deskY - 1.55 * 16;          // 职员 sprite 顶部
  const boardY = Math.min(4.6 * 16, groundY - 4.4 * 16);
  const boardClip = boardY < 0;
  const workerBottom = wkrY + 16;
  const workerVisible = Math.max(0, Math.min(16, workerBottom) - Math.max(0, wkrY)) / 16;
  const pcY = deskY - 1.05 * 16;
  const pcVisible = Math.max(0, Math.min(16, pcY + 16) - Math.max(0, pcY)) / 16;
  const cardsEl = document.getElementById('shop-cards');
  const cardEls = [...document.querySelectorAll('.shop-card')];
  const cardRects = cardEls.map(el => {
    const r = el.getBoundingClientRect();
    return { id: el.dataset.upgrade, w: +r.width.toFixed(1), h: +r.height.toFixed(1),
      left: +r.left.toFixed(1), right: +r.right.toFixed(1),
      visible: r.right > 0 && r.left < vw,
      fullyVisible: r.left >= 0 && r.right <= vw };
  });
  const journal = rect('#btn-journal'), mute = rect('#btn-mute'), quest = rect('#quest');
  const q = document.getElementById('quest');
  const questVisible = !!q && !q.classList.contains('hidden');
  const hudSub = document.querySelector('.hud-sub');
  const hudSubTextW = hudSub ? [...hudSub.children].reduce((a, el) => a + el.getBoundingClientRect().width, 0) : 0;
  // 元素最大右边缘 / 横向溢出
  let maxRight = 0, overflows = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right > maxRight) maxRight = r.right;
    if (r.right > vw + 0.5 || r.left < -0.5) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'absolute' && cs.position !== 'fixed')
        overflows.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ':' + Math.round(r.left) + '..' + Math.round(r.right));
    }
  }
  const docOverflowX = document.documentElement.scrollWidth - vw;
  // 窗口/场景可见内容估算：工位宽 4.2*16*scale；地面以下纯地板高度
  const deskPxW = 4.2 * 16 * scale;
  const floorPx = (cr.height / scale - groundY) * scale;
  const wallPx = groundY * scale;
  const hint = document.getElementById('shop-hint');
  return {
    vw, vh, dpr: devicePixelRatio,
    hud, wrap, shop, cards, journal, mute, quest, questVisible,
    canvas: {
      cssW: +cr.width.toFixed(1), cssH: +cr.height.toFixed(1),
      backingW: c.width, backingH: c.height, dprUsed: +(c.width / cr.width).toFixed(2),
      scale, virtual, groundY: +groundY.toFixed(1), floorPx: +floorPx.toFixed(1),
      wallPx: +wallPx.toFixed(1), deskPxW: +deskPxW.toFixed(1),
      workerTopPx: +(wkrY * scale).toFixed(1), workerBottomPx: +(workerBottom * scale).toFixed(1),
      workerVisibleFrac: +workerVisible.toFixed(2), pcVisibleFrac: +pcVisible.toFixed(2),
      boardY: +boardY.toFixed(1), boardClip,
    },
    shopInfo: {
      count: cardEls.length,
      scrollW: cardsEl.scrollWidth, clientW: cardsEl.clientWidth,
      scrollable: cardsEl.scrollWidth > cardsEl.clientWidth + 1,
      scrollLeft: cardsEl.scrollLeft,
      fullyVisibleCount: cardRects.filter(x => x.fullyVisible).length,
      visibleCount: cardRects.filter(x => x.visible).length,
      card0: cardRects[0], cardLast: cardRects[cardRects.length - 1],
      hintVisible: !!hint && getComputedStyle(hint).opacity !== '0' && !hint.classList.contains('hidden'),
    },
    hudContentW: +hudSubTextW.toFixed(1), hudEmptyRightPct: +(((vw - hudSubTextW) / vw) * 100).toFixed(1),
    docOverflowX, maxRight,
    overflowEls: overflows.slice(0, 8),
    proportions: {
      hudPct: +((hud.h / vh) * 100).toFixed(1),
      scenePct: +((wrap.h / vh) * 100).toFixed(1),
      shopPct: +((shop.h / vh) * 100).toFixed(1),
    },
    fonts: {
      moyu: getComputedStyle(document.querySelector('.hud-moyu')).fontSize,
      card: getComputedStyle(cardEls[0]).fontSize,
      hint: getComputedStyle(document.getElementById('shop-hint')).fontSize,
    },
    welcomeVisible: !document.getElementById('welcome').classList.contains('hidden'),
  };
})()`;

// 交互测量：点击/组合键/悬停
const INTERACT = `(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const out = {};
  const val = () => document.getElementById('hud-moyu').textContent;
  const before = val();
  const c = document.getElementById('stage');
  const r = c.getBoundingClientRect();
  const target = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  // 三次点击（间隔 120ms > 80ms 节流）
  for (let i = 0; i < 3; i++) {
    c.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, clientX: target.x, clientY: target.y }));
    await sleep(120);
  }
  await sleep(350);
  out.clickDelta = { before, after: val(), combo: document.getElementById('hud-combo').textContent, comboHidden: document.getElementById('hud-combo').classList.contains('hidden') };
  // 商店首卡点击（不可负担 → 应出现“还差/再戳”toast，且余额不减）
  const card = document.querySelector('.shop-card');
  const m0 = val();
  card.click();
  await sleep(250);
  out.unaffordableClick = { moyuBefore: m0, moyuAfter: val(), toast: document.querySelector('.toast')?.textContent ?? null };
  // 键鼠：Tab 焦点顺序
  document.activeElement?.blur?.();
  return out;
})()`;

const KEYTEST = `(() => {
  const seq = [];
  const activeDesc = () => {
    const a = document.activeElement;
    if (!a || a === document.body) return 'BODY';
    return (a.id ? '#' + a.id : a.tagName.toLowerCase() + '.' + (a.className || '').split(' ')[0]);
  };
  return { seq, activeDesc };
})()`;

const styles = `(sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, border: cs.borderColor, cursor: cs.cursor, transform: cs.transform, boxShadow: cs.boxShadow, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor };
}`;

const viewports = [
  { name: "tablet-portrait-768x1024", w: 768, h: 1024, mobile: true, dpr: 2 },
  { name: "tablet-landscape-1024x768", w: 1024, h: 768, mobile: true, dpr: 2 },
  { name: "desktop-1440x900", w: 1440, h: 900, mobile: false, dpr: 1 },
];

const result = {};
for (const vp of viewports) {
  await send("Emulation.setDeviceMetricsOverride", {
    width: vp.w, height: vp.h, deviceScaleFactor: vp.dpr, mobile: vp.mobile,
    screenWidth: vp.w, screenHeight: vp.h,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: vp.mobile, maxTouchPoints: 5 });
  await send("Storage.clearDataForOrigin", { origin: "http://127.0.0.1:5173", storageTypes: "local_storage" });
  await send("Page.navigate", { url: URL_ });
  await sleep(2800);
  const m = await ev(MEASURE);
  await shot(`${OUTDIR}/${vp.name}.png`);
  const inter = await ev(INTERACT);
  // 悬停：桌面模式给商店卡 + canvas 加 mouseMoved，测样式变化
  let hover = null;
  if (!vp.mobile) {
    const cardRect = await ev(`(() => { const r = document.querySelector('.shop-card').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
    const canvasRect = await ev(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
    const styleFn = await ev(`(${styles})`);
    // 用 Runtime 直接读样式即可（元素本身 hover 由 CDP 真实鼠标触发）
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cardRect.x, y: cardRect.y, button: "none" });
    await sleep(300);
    const hoverCard = await ev(`(() => { const el = document.querySelector('.shop-card'); const cs = getComputedStyle(el); return { bg: cs.backgroundColor, border: cs.borderColor, cursor: cs.cursor, transform: cs.transform, boxShadow: cs.boxShadow, matched: el.matches(':hover') }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: canvasRect.x, y: canvasRect.y, button: "none" });
    await sleep(250);
    const hoverCanvas = await ev(`(() => { const el = document.getElementById('stage'); const cs = getComputedStyle(el); return { cursor: cs.cursor, matched: el.matches(':hover'), hoverAny: document.querySelectorAll(':hover').length }; })()`);
    hover = { card: hoverCard, canvas: hoverCanvas };
    void styleFn;
  }
  // 键盘
  await ev(`document.activeElement?.blur?.(); window.scrollTo(0,0);`);
  const keySeq = [];
  for (let i = 0; i < 10; i++) {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await sleep(60);
    const a = await ev(`(() => { const a = document.activeElement; const cs = a && a !== document.body ? getComputedStyle(a) : null; return a ? (a.id ? '#'+a.id : a.tagName.toLowerCase()+'.'+(a.className||'').split(' ')[0]) : 'BODY'; })()`);
    keySeq.push(a);
  }
  // 聚焦到第一张卡后按 Enter/Space 测试键盘购买
  await ev(`(() => { document.activeElement?.blur?.(); document.querySelector('.shop-card').focus(); })()`);
  const kbBefore = await ev(`document.getElementById('hud-moyu').textContent`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(250);
  const kbAfterEnter = await ev(`document.getElementById('hud-moyu').textContent`);
  // 空格（在 body 上）——看是否被当作摸鱼
  await ev(`document.activeElement?.blur?.();`);
  const kbBeforeSpace = await ev(`document.getElementById('hud-moyu').textContent`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
  await sleep(300);
  const kbAfterSpace = await ev(`document.getElementById('hud-moyu').textContent`);
  const kbState = await ev(`(() => ({ scrollY: window.scrollY, active: document.activeElement?.id || document.activeElement?.tagName, canvasTabIndex: document.getElementById('stage').tabIndex, canvasRole: document.getElementById('stage').getAttribute('role'), canvasAria: document.getElementById('stage').getAttribute('aria-label') }))()`);
  // 把商店滚到末尾截图，确认全部 9 卡可达
  await ev(`(() => { const el = document.getElementById('shop-cards'); el.scrollLeft = el.scrollWidth; })()`);
  await sleep(400);
  const endInfo = await ev(`(() => { const el = document.getElementById('shop-cards'); const cards=[...document.querySelectorAll('.shop-card')]; const last=cards[cards.length-1].getBoundingClientRect(); return { scrollLeft: el.scrollLeft, maxScroll: el.scrollWidth-el.clientWidth, lastRight: Math.round(last.right), vw: innerWidth, lastFullyVisible: last.left>=0 && last.right<=innerWidth, hintHidden: document.getElementById('shop-hint').classList.contains('hidden') }; })()`);
  await shot(`${OUTDIR}/${vp.name}-shop-end.png`);
  result[vp.name] = { measure: m, interaction: inter, hover, keyboard: { tabSeq: keySeq, kbBefore, kbAfterEnter, kbBeforeSpace, kbAfterSpace, ...kbState }, shopEnd: endInfo, files: [`${OUTDIR}/${vp.name}.png`, `${OUTDIR}/${vp.name}-shop-end.png`] };
}

writeFileSync("playtest/r10-tablet.json", JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1).slice(0, 200000));
proc.kill();
process.exit(0);
