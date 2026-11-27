/**
 * R10 平板/宽屏输入探针（只读）：真实鼠标点击、滚轮横滑、键盘可达性、悬停/焦点反馈。
 * 用法：node playtest/probe-r10-tablet-input.mjs
 * 输出：playtest/r10-tablet-input.json
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.PROBE_PORT || 9573);
const URL_ = process.env.URL || "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r10-input-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const mouse = async (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1, ...extra });

async function measure(label) {
  return ev(`(() => {
    const m = document.getElementById('hud-moyu').textContent;
    const el = document.getElementById('shop-cards');
    const cards = [...document.querySelectorAll('.shop-card')];
    const first = cards[0];
    return { label: ${JSON.stringify(label)}, moyu: m, shopScrollLeft: el.scrollLeft, shopMax: el.scrollWidth - el.clientWidth,
      firstDisabled: first.disabled, firstAffordable: first.classList.contains('affordable'),
      enabledCards: cards.filter(c => !c.disabled).length,
      active: document.activeElement?.id || document.activeElement?.tagName };
  })()`);
}

const RESULT = {};
// ========== 视口 1440x900（桌面键鼠） ==========
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false, screenWidth: 1440, screenHeight: 900 });
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
await send("Storage.clearDataForOrigin", { origin: "http://127.0.0.1:5173", storageTypes: "local_storage" });
await send("Page.navigate", { url: URL_ });
await sleep(2800);
const desktop = {};
// 1) 真实鼠标点击画布中心
const cRect = await ev(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height, cx: r.left + r.width/2, cy: r.top + r.height/2 }; })()`);
const m0 = await ev(`document.getElementById('hud-moyu').textContent`);
await mouse("mouseMoved", cRect.cx, cRect.cy);
await mouse("mousePressed", cRect.cx, cRect.cy);
await mouse("mouseReleased", cRect.cx, cRect.cy);
await sleep(300);
const m1 = await ev(`document.getElementById('hud-moyu').textContent`);
desktop.realMouseClick = { before: m0, after: m1, added: +(parseFloat(m1) - parseFloat(m0)).toFixed(2) };
// 2) 悬停已可负担卡（先攒钱：连点 20 次 ~ 每次 +1，需要 90ms 间隔）
for (let i = 0; i < 16; i++) {
  await mouse("mousePressed", cRect.cx, cRect.cy);
  await mouse("mouseReleased", cRect.cx, cRect.cy);
  await sleep(95);
}
await sleep(300);
desktop.afterClicks = await measure("after16clicks");
// 3) 悬停首卡样式（可负担态）
const cardRect = await ev(`(() => { const r = document.querySelector('.shop-card').getBoundingClientRect(); return { cx: r.left + r.width/2, cy: r.top + r.height/2 }; })()`);
await mouse("mouseMoved", cardRect.cx, cardRect.cy);
await sleep(250);
desktop.hoverAffordableCard = await ev(`(() => { const el = document.querySelector('.shop-card'); const cs = getComputedStyle(el); return { cursor: cs.cursor, bg: cs.backgroundColor, transform: cs.transform, matchedHover: el.matches(':hover'), hasHoverRule: false, cursorImg: null }; })()`);
// 4) 键盘：Tab 顺序（卡片已启用）
await ev(`document.activeElement?.blur?.();`);
const tabSeq = [];
for (let i = 0; i < 16; i++) {
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await sleep(50);
  tabSeq.push(await ev(`(() => { const a = document.activeElement; if (!a || a === document.body) return 'BODY'; const cs = getComputedStyle(a); return (a.id ? '#' + a.id : a.tagName.toLowerCase() + '.' + (a.className||'').split(' ')[0]) + '|outline=' + cs.outlineStyle + '/' + cs.outlineWidth; })()`));
}
desktop.tabSeqAffordable = tabSeq;
// 5) 聚焦首卡 Enter 购买（首卡成本 15，点击力若干）
await ev(`document.querySelector('.shop-card').focus()`);
const buyBefore = await ev(`(() => { const el = document.querySelector('.shop-card'); return { moyu: document.getElementById('hud-moyu').textContent, confirm: el.classList.contains('confirming'), cost: el.querySelector('.shop-cost b').textContent, level: el.querySelector('.shop-level').textContent }; })()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
await sleep(350);
const buyAfter = await ev(`(() => { const el = document.querySelector('.shop-card'); return { moyu: document.getElementById('hud-moyu').textContent, confirm: el.classList.contains('confirming'), level: el.querySelector('.shop-level').textContent, toast: document.querySelector('.toast')?.textContent ?? null }; })()`);
desktop.keyboardBuy = { before: buyBefore, after: buyAfter };
// 6) 画布空格/回车能否摸鱼
await ev(`document.activeElement?.blur?.();`);
const kb0 = await ev(`document.getElementById('hud-moyu').textContent`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
await sleep(300);
const kb1 = await ev(`document.getElementById('hud-moyu').textContent`);
desktop.keyboardClick = { before: kb0, after: kb1, added: +(parseFloat(kb1) - parseFloat(kb0)).toFixed(2), canvasTabIndex: await ev(`document.getElementById('stage').tabIndex`) };
// 7) 1440 下商店不可滚动，但是否显示“滑动查看更多”
desktop.shopHintAt1440 = await ev(`(() => { const h = document.getElementById('shop-hint'); return { opacity: getComputedStyle(h).opacity, hidden: h.classList.contains('hidden'), text: h.textContent }; })()`);
// 8) 滚轮能否横滑（挪到 1024 视口再试）
RESULT.desktop1440 = desktop;

// ========== 视口 1024x768（横屏平板 / 小桌面）：滚轮横滑 ==========
await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false, screenWidth: 1024, screenHeight: 768 });
await send("Storage.clearDataForOrigin", { origin: "http://127.0.0.1:5173", storageTypes: "local_storage" });
await send("Page.navigate", { url: URL_ });
await sleep(2800);
const land = {};
const lr = await ev(`(() => { const r = document.getElementById('shop-cards').getBoundingClientRect(); return { cx: r.left + r.width/2, cy: r.top + r.height/2, top: r.top }; })()`);
await mouse("mouseMoved", lr.cx, lr.cy);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: lr.cx, y: lr.cy, deltaX: 0, deltaY: 240 });
await sleep(400);
land.wheelVertical = await ev(`(() => { const el = document.getElementById('shop-cards'); return { scrollLeft: el.scrollLeft, max: el.scrollWidth - el.clientWidth }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: lr.cx, y: lr.cy, deltaX: 300, deltaY: 0 });
await sleep(400);
land.wheelHorizontal = await ev(`(() => { const el = document.getElementById('shop-cards'); return { scrollLeft: el.scrollLeft, max: el.scrollWidth - el.clientWidth }; })()`);
// 触摸拖拽（横屏平板）能否滑
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const beforeTouch = await ev(`document.getElementById('shop-cards').scrollLeft`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 900, y: lr.cy }] });
for (let i = 1; i <= 6; i++) {
  await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 900 - i * 60, y: lr.cy }] });
  await sleep(30);
}
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(500);
land.touchDrag = { before: beforeTouch, after: await ev(`document.getElementById('shop-cards').scrollLeft`), max: await ev(`(() => { const el = document.getElementById('shop-cards'); return el.scrollWidth - el.clientWidth; })()`) };
// 画布点按（触摸）
const lc = await ev(`(() => { const r = document.getElementById('stage').getBoundingClientRect(); return { cx: r.left + r.width/2, cy: r.top + r.height/2 }; })()`);
const lm0 = await ev(`document.getElementById('hud-moyu').textContent`);
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: lc.cx, y: lc.cy }] });
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(300);
land.touchClick = { before: lm0, after: await ev(`document.getElementById('hud-moyu').textContent`) };
RESULT.landscape1024 = land;

writeFileSync("playtest/r10-tablet-input.json", JSON.stringify(RESULT, null, 1));
console.log(JSON.stringify(RESULT, null, 1));
proc.kill();
process.exit(0);
