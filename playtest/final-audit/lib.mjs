// 终验审计探针公共工具：页面导航 / 等待 / 点击 / 读数 / 截图
// 必须配合 playtest/lib/chrome.mjs 使用（随机端口 + 自动清理进程）
import { writeFileSync } from "node:fs";

export const DEV = "http://127.0.0.1:5173/";
export const PROD = "https://luojindui.github.io/moyu/";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 设置视口（桌面 1100x800） */
export async function setViewport(c, { width = 1100, height = 800, mobile = false, dpr = 1 } = {}) {
  await c.send("Emulation.setDeviceMetricsOverride", {
    width, height, deviceScaleFactor: dpr, mobile,
  });
}

/** 导航并等待 app 就绪（check 表达式为真） */
export async function goto(c, url, check, timeoutMs = 20000) {
  await c.send("Page.enable").catch(() => undefined);
  await c.send("Page.navigate", { url });
  const ok = await waitFor(c, check, timeoutMs);
  if (!ok) throw new Error(`页面未就绪: ${url} / ${check}`);
  await sleep(300); // 让首帧主循环跑起来
  return ok;
}

/** 轮询等待表达式为真（返回 true/false） */
export async function waitFor(c, expr, timeoutMs = 8000, stepMs = 100) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await c.ev(expr).catch(() => false);
    if (v === true) return true;
    if (v && typeof v === "object" && v.__err) return false;
    await sleep(stepMs);
  }
  return false;
}

/** 读 JS 表达式（异常时抛错） */
export async function ev(c, expr) {
  const r = await c.ev(expr);
  if (r && typeof r === "object" && r.__err) throw new Error(`ev 异常 ${expr.slice(0, 80)}: ${r.__err}`);
  return r;
}

/** DOM 点击（selector 需返回唯一元素；返回是否点到） */
export async function click(c, selector, { index = 0 } = {}) {
  const r = await ev(c, `(() => {
    const els = document.querySelectorAll(${JSON.stringify(selector)});
    const el = els[${index}];
    if (!el) return { ok: false, n: els.length };
    if (el.disabled) return { ok: false, disabled: true, n: els.length };
    el.click();
    return { ok: true, n: els.length, text: (el.textContent || "").trim().slice(0, 80) };
  })()`);
  return r;
}

/** 统计 selector 数量 */
export async function count(c, selector) {
  return ev(c, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

/** 读取元素文本 */
export async function text(c, selector) {
  return ev(c, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); return el ? (el.textContent || "").trim() : null; })()`);
}

/** 是否可见（存在且无 hidden 祖先/自身） */
export async function visible(c, selector) {
  return ev(c, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden") return false;
    return !el.classList.contains("hidden");
  })()`);
}

/** dev 专属：读取游戏状态快照 */
export async function state(c) {
  return ev(c, `window.__MOYU__ ? window.__MOYU__.state : null`);
}

/** dev 专属：在页面里动态 import 引擎模块（Vite dev ESM 缓存，与 app 同一实例） */
export async function mod(c, path) {
  // 返回可序列化的调用结果；调用方给出表达式（避免传函数跨进程）
  const key = `__mod_${path.replace(/[^a-z0-9]/gi, "_")}`;
  // 必须 await 模块加载完成，否则紧接着的 modEval 会拿到 undefined（竞态）
  await ev(c, `(async () => { if (!window.${key}) window.${key} = await import(${JSON.stringify(path)}); return true; })()`);
  return key;
}

/** 在页面里用动态 import 的模块执行表达式（expr 里可用 M 代表模块命名空间） */
export async function modEval(c, path, expr) {
  const key = await mod(c, path);
  return ev(c, `(async () => { const M = window.${key}; return (${expr}); })()`);
}

/** canvas 中心点（含抖动），用于真实输入事件 */
export async function canvasPoint(c, jitter = 0.18) {
  return ev(c, `(() => {
    const el = document.getElementById("stage");
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * (0.35 + Math.random() * 0.3), y: r.top + r.height * (0.3 + Math.random() * 0.4), w: r.width, h: r.height };
  })()`);
}

/** 真实鼠标点击 canvas n 次（间隔 intervalMs；doTap 有 80ms 冷却） */
export async function tapCanvas(c, n, intervalMs = 100) {
  for (let i = 0; i < n; i++) {
    const p = await canvasPoint(c);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(intervalMs);
  }
}

/** 鼠标点击任意元素中心（真实输入，用于需要 pointerdown 的场景） */
export async function tapElement(c, selector) {
  const r = await ev(c, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  })()`);
  if (!r) throw new Error(`找不到元素 ${selector}`);
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(30);
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  return true;
}

/** 截图保存 */
export async function shot(c, name) {
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  const path = `${process.env.AUDIT_OUT ?? "/Users/p/Desktop/workspace/code/moyu/playtest/final-audit/out"}/${name}.png`;
  writeFileSync(path, Buffer.from(r.data, "base64"));
  return path;
}

/** 等待主循环运行若干帧（frames 增加） */
export async function waitFrames(c, n = 3, timeoutMs = 5000) {
  const start = await ev(c, `window.__MOYU__ ? window.__MOYU__.frames : -1`);
  if (start < 0) { await sleep(500); return true; }
  const ok = await waitFor(c, `window.__MOYU__.frames >= ${start + n}`, timeoutMs);
  return ok;
}

/** 打开面板并等待显示 */
export async function openPanel(c, btnSel, panelSel, timeoutMs = 3000) {
  await click(c, btnSel);
  return waitFor(c, `document.querySelector(${JSON.stringify(panelSel)}).classList.contains("hidden") === false`, timeoutMs);
}

/** 关闭面板并等待隐藏（用关闭按钮） */
export async function closePanel(c, btnSel, panelSel, timeoutMs = 3000) {
  const shown = await visible(c, panelSel);
  if (!shown) return true;
  await click(c, btnSel);
  return waitFor(c, `document.querySelector(${JSON.stringify(panelSel)}).classList.contains("hidden") === true`, timeoutMs);
}

/** 记录一条断言结果 */
export class Report {
  constructor(name) {
    this.name = name;
    this.checks = [];
    this.startedAt = Date.now();
  }
  add(id, ok, detail = "") {
    this.checks.push({ id, ok: !!ok, detail: typeof detail === "string" ? detail : JSON.stringify(detail) });
    console.log(`${ok ? "✅" : "❌"} [${this.name}] ${id}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
    return ok;
  }
  /** 断言并记录 */
  expect(id, cond, detail = "") {
    return this.add(id, cond, detail);
  }
  /** 求和 */
  summary() {
    const pass = this.checks.filter((x) => x.ok).length;
    return {
      name: this.name,
      pass,
      total: this.checks.length,
      failed: this.checks.filter((x) => !x.ok).map((x) => x.id),
      checks: this.checks,
      ms: Date.now() - this.startedAt,
    };
  }
}

/** 取 HUD 数字文本 */
export async function hud(c) {
  return ev(c, `({
    moyu: document.getElementById("hud-moyu")?.textContent,
    click: document.getElementById("hud-click")?.textContent,
    idle: document.getElementById("hud-idle")?.textContent,
    rank: document.getElementById("hud-rank")?.textContent,
    card: document.getElementById("hud-card")?.textContent,
    toast: document.getElementById("dom-toast")?.textContent,
    toastShown: document.getElementById("dom-toast")?.classList.contains("show") ?? false,
    sr: document.getElementById("sr-live")?.textContent,
  })`);
}

/** 等待 toast 文本包含 pattern（返回最后一次 toast 文本） */
export async function waitToast(c, pattern, timeoutMs = 4000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    const h = await hud(c);
    last = h.toast;
    if (last && pattern.test(last)) return last;
    await sleep(80);
  }
  return (`?__notfound__:${last}`);
}

/** 等待大厅无模态（除 welcome/cards 外都关掉） */
export async function closeAllModals(c) {
  // 用各自关闭按钮/跳过按钮，避免 Esc 只关一个
  const ids = [
    ["#journal", "#journal-close"],
    ["#team", "#team-close"],
    ["#arcade", "#arcade-close"],
    ["#cards", "#cards-skip"],
  ];
  for (const [panel, btn] of ids) {
    const shown = await visible(c, panel);
    if (shown) {
      await click(c, btn).catch(() => undefined);
      await sleep(80);
    }
  }
  // welcome
  if (await visible(c, "#welcome")) {
    await click(c, "#welcome-ok");
    await sleep(80);
  }
}