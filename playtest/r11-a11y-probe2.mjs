/**
 * R11 无障碍探针 #2（干净 profile / 播种存档）：只读 src/，不改 src/。
 * 覆盖：日报可领红点、可买/不可买边框、二次确认无样式、焦点陷阱/Esc、焦点环、
 *       键盘空格点击、CSS 动画在 reduce 下的表现、forced-colors 下状态色、AX 树。
 * 产物：playtest/r11-a11y-evidence2.json + playtest/r11-screens/*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.env.URL || "http://127.0.0.1:5173/";
const OUT_DIR = "playtest/r11-screens";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT_DIR, { recursive: true });

async function freePort() {
  for (let i = 0; i < 30; i++) {
    const port = 9520 + Math.floor(Math.random() * 200);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
      if (!r.ok) return port;
    } catch {
      return port;
    }
  }
  throw new Error("no free port");
}

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

async function openBrowser(tag, port) {
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
      `--user-data-dir=/tmp/chrome-r11b-${tag}-${Date.now()}`,
      `--remote-debugging-port=${port}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  if (proc.exitCode !== null) throw new Error("spawned chrome exited (port conflict?)");
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, {
    method: "PUT",
  }).then((r) => r.json());
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
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  };
  const evj = async (expression) => {
    const v = await ev(expression);
    return typeof v === "string" ? JSON.parse(v) : v;
  };
  async function shot(path) {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(path, Buffer.from(s.data, "base64"));
  }
  return { send, ev, evj, shot, port, close: () => { try { ws.close(); } catch { /* ignore */ } proc.kill(); } };
}

async function setup(b, { width = 390, height = 844, inject }) {
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Accessibility.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true, screenWidth: width, screenHeight: height });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (inject) await b.send("Page.addScriptToEvaluateOnNewDocument", { source: inject });
  await b.send("Page.navigate", { url: URL_ });
  await sleep(3400);
}

const SEED = `(() => {
  if (localStorage.getItem("r11-seeded") === "1") return;
  const today = new Date().toLocaleDateString("sv-SE");
  const win = Math.floor(new Date().getHours() / 6);
  const now = Date.now();
  const daily = {
    date: today,
    goals: [
      { id: "visit_1", target: 1, progress: 1, done: true },
      { id: "idle_earn", target: 1, progress: 1, done: true },
      { id: "click_100", target: 100, progress: 100, done: true }
    ],
    streak: 2, lastCompleteDate: null, claimed: false, window: win, claimsToday: 0
  };
  const blob = { v: 1, moyu: 156, totalEarned: 156, levels: {}, savedAt: now, createdAt: now,
    collected: { quotes: [], flavors: [] }, daily, surviveStreak: 0, totalClicks: 0,
    visits: { date: today, count: 1 }, lifetimeEarned: 156, prestige: 0 };
  localStorage.setItem("moyu-save", JSON.stringify(blob));
  localStorage.setItem("r11-seeded", "1");
})();`;

const AX_DUMP = `(async () => {
  const r = await new Promise((res) => {
    const b = window.__r11cdp; res(b);
  });
  return "x";
})()`;

async function axNodes(b) {
  const t = await b.send("Accessibility.getFullAXTree");
  return (t.nodes || [])
    .filter((n) => !n.ignored)
    .map((n) => ({
      role: n.role && n.role.value,
      name: (n.name && n.name.value) || "",
      desc: (n.description && n.description.value) || "",
      props: (n.properties || []).filter((p) => ["disabled", "focusable", "live", "atomic", "modal", "pressed"].includes(p.name)).map((p) => `${p.name}=${p.value && p.value.value}`),
    }))
    .filter((n) => n.name || ["button", "canvas", "dialog"].includes(n.role));
}

async function main() {
  const out = { url: URL_, startedAt: new Date().toISOString() };

  // ========== A. 干净 profile：首屏 / 焦点环 / 键盘 / reduce ==========
  const portA = await freePort();
  const a = await openBrowser("fresh", portA);
  await setup(a, {});
  out.fresh = await a.evj(`(() => JSON.stringify({ moyu: window.__MOYU__.state.moyu, totalClicks: window.__MOYU__.state.totalClicks, visits: window.__MOYU__.state.visits, viewportMeta: document.querySelector('meta[name=viewport]').content, lang: document.documentElement.lang }))()`);
  await a.shot(`${OUT_DIR}/r11-first-fresh.png`);

  // 键盘焦点环
  out.focusRing = await a.evj(`(() => {
    const out = [];
    const els = [document.getElementById("btn-mute"), document.getElementById("btn-journal"), document.getElementById("stage"), document.querySelector(".shop-card")];
    for (const el of els) {
      if (!el) { out.push({ missing: true }); continue; }
      el.focus();
      const cs = getComputedStyle(el);
      out.push({ tag: el.tagName, id: el.id, focused: document.activeElement === el, outline: cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor });
      el.blur();
    }
    return JSON.stringify(out);
  })()`);

  // 键盘空格激活 canvas
  out.keyboardClick = await a.evj(`(() => {
    const c = document.getElementById("stage");
    c.focus();
    const before = window.__MOYU__.state.totalClicks;
    c.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
    return JSON.stringify({ before, after: window.__MOYU__.state.totalClicks, active: document.activeElement && document.activeElement.id });
  })()`);

  // 小于 12px 的文字元素统计
  out.smallText = await a.evj(`(() => {
    const rows = [];
    for (const el of document.querySelectorAll("#app *, #journal *, #welcome *")) {
      if (!el.getClientRects().length) continue;
      if ([...el.children].length) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      if (size && size < 12) rows.push({ tag: el.tagName, cls: String(el.className).slice(0, 40), text: (el.innerText || "").replace(/\\s+/g, " ").slice(0, 20), size });
    }
    return JSON.stringify(rows);
  })()`);

  // reduce 下 CSS 动画是否仍跑
  await a.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await a.ev(`document.getElementById("btn-journal").classList.add("has-reward")`);
  await sleep(400);
  out.reducedAnim = await a.evj(`(() => {
    const el = document.getElementById("btn-journal");
    const cs = getComputedStyle(el);
    return JSON.stringify({
      reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
      animationName: cs.animationName,
      animations: document.getAnimations().map((x) => ({ name: x.animationName || "?", state: x.playState })),
      animCount: document.getAnimations().length,
      framesA: window.__MOYU__.frames
    });
  })()`);
  await sleep(700);
  out.reducedAnim.framesB = await a.ev("window.__MOYU__.fps !== undefined ? window.__MOYU__.frames : -1");
  await a.ev(`document.getElementById("btn-journal").classList.remove("has-reward")`);
  await a.send("Emulation.setEmulatedMedia", { features: [] });

  // 日报模态：焦点 / Esc
  await a.ev("document.getElementById('btn-journal').click()");
  await sleep(500);
  out.modal = await a.evj(`(() => {
    const root = document.getElementById("journal");
    const first = { id: document.activeElement && document.activeElement.id, tag: document.activeElement && document.activeElement.tagName };
    return JSON.stringify({ open: !root.classList.contains("hidden"), focusAtOpen: first, role: root.getAttribute("role"), ariaModal: root.getAttribute("aria-modal"), labelledby: root.getAttribute("aria-labelledby"), inert: [...document.querySelectorAll("#app *")].some((e) => e.hasAttribute("inert")) });
  })()`);
  const tabFlows = [];
  for (let i = 0; i < 5; i++) {
    await a.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await a.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(60);
    tabFlows.push(await a.ev(`(() => { const el = document.activeElement; return JSON.stringify({ id: el && el.id, tag: el && el.tagName, text: el && (el.innerText || "").replace(/\\s+/g, " ").slice(0, 26), behindModal: !!(el && el.closest("#app")) }); })()`));
  }
  out.modalTabOrder = tabFlows;
  // Esc 是否关闭
  await a.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await a.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(200);
  out.modalEscCloses = await a.ev(`!document.getElementById("journal").classList.contains("hidden") ? "still-open" : "closed"`);
  await a.ev("document.getElementById('journal-close').click()");
  out.axTreeFresh = await axNodes(a);
  a.close();

  // ========== B. 播种存档：日报可领红点 / 可买边框 / 二次确认 ==========
  const portB = await freePort();
  const b = await openBrowser("seeded", portB);
  await setup(b, { inject: SEED });
  out.seeded = await b.evj(`(() => JSON.stringify({ moyu: window.__MOYU__.state.moyu, daily: window.__MOYU__.state.daily, hasReward: document.getElementById("btn-journal").classList.contains("has-reward"), title: document.getElementById("btn-journal").title, dot: (() => { const s = getComputedStyle(document.getElementById("btn-journal"), "::after"); return { content: s.content, bg: s.backgroundColor, w: s.width, h: s.height }; })() }))()`);
  await b.shot(`${OUT_DIR}/r11-journal-dot.png`);
  out.axTreeSeeded = await axNodes(b);
  out.redDotAX = (out.axTreeSeeded || []).filter((n) => /日报|奖励/.test(n.name + n.desc));

  // 买 100 的水 → 余额 56；water 曾可买 → just-unlocked 持久绿框
  out.shopBefore = await b.evj(`(() => JSON.stringify([...document.querySelectorAll(".shop-card")].map((el) => ({ id: el.dataset.upgrade, disabled: el.disabled, cls: el.className.replace("shop-card pixel-panel", "").trim(), border: getComputedStyle(el).borderColor, bg: getComputedStyle(el).backgroundColor }))))()`);
  await b.ev(`document.querySelector('[data-upgrade="water"]').click()`);
  await sleep(400);
  out.shopAfterBuy = await b.evj(`(() => JSON.stringify({ moyu: window.__MOYU__.state.moyu, cards: [...document.querySelectorAll(".shop-card")].map((el) => ({ id: el.dataset.upgrade, disabled: el.disabled, cls: el.className.replace("shop-card pixel-panel", "").trim(), border: getComputedStyle(el).borderColor, bg: getComputedStyle(el).backgroundColor, remain: el.querySelector(".shop-remain").textContent })) }))()`);
  await b.shot(`${OUT_DIR}/r11-shop-stale-border.png`);

  // 二次确认：点 phone（50 ≤ 余额 56 的 50% 以上）→ confirming 类但无 CSS 规则
  out.phoneFirstClick = await b.evj(`(() => {
    const card = document.querySelector('[data-upgrade="phone"]');
    card.click();
    const cs = getComputedStyle(card);
    let hasRule = false;
    for (const ss of document.styleSheets) { try { for (const r of ss.cssRules) { if (r.selectorText && /confirming/.test(r.selectorText)) hasRule = true; } } catch {} }
    return JSON.stringify({ cls: card.className, confirmingRuleExists: hasRule, border: cs.borderColor, bg: cs.backgroundColor, outline: cs.outlineStyle, ariaBusy: card.getAttribute("aria-busy"), dataPrice: card.dataset.price });
  })()`);
  await sleep(120);
  await b.shot(`${OUT_DIR}/r11-confirm-float.png`);
  await sleep(1100);
  await b.shot(`${OUT_DIR}/r11-confirm-after-float.png`);
  out.phoneAfterFloat = await b.evj(`(() => { const card = document.querySelector('[data-upgrade="phone"]'); return JSON.stringify({ cls: card.className, border: getComputedStyle(card).borderColor, pendingStillActive: card.classList.contains("confirming") }); })()`);
  // AX 树里确认态的提示（飘字在 canvas 内，不存在于 DOM）
  out.axHasConfirmText = (await axNodes(b)).some((n) => /再点一次确认/.test(n.name + n.desc));
  out.axHasPatrolText = (await axNodes(b)).some((n) => /王总|巡逻|丢梗/.test(n.name + n.desc));

  // forced-colors 下可买边框 / 红点
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  await sleep(300);
  await b.shot(`${OUT_DIR}/r11-forced-colors-seeded.png`);
  out.forcedSeeded = await b.evj(`(() => {
    const dot = getComputedStyle(document.getElementById("btn-journal"), "::after");
    const cardA = document.querySelector(".shop-card.affordable");
    const cardD = document.querySelector(".shop-card:not(.affordable)");
    return JSON.stringify({ dotBg: dot.backgroundColor, dotShadow: dot.boxShadow, dotDisplay: dot.display,
      affordableBorder: cardA && getComputedStyle(cardA).borderColor, unaffordableBorder: cardD && getComputedStyle(cardD).borderColor });
  })()`);
  await b.send("Emulation.setEmulatedMedia", { features: [] });
  b.close();

  out.finishedAt = new Date().toISOString();
  writeFileSync("playtest/r11-a11y-evidence2.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, ports: [portA, portB] }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
