/**
 * R11 无障碍/色弱探针（只读 src/，不改 src/）。
 * 采集：截图（首屏/可买商店/日报/丢梗/三种巡逻）、对比度、ARIA/键盘可达、
 *        prefers-reduced-motion / prefers-contrast / forced-colors 适配、AX 树。
 * 用法：node playtest/r11-a11y-probe.mjs
 * 产物：playtest/r11-a11y-evidence.json + playtest/r11-screens/*.png
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.env.URL || "http://127.0.0.1:5173/";
const PORT = Number(process.env.PORT || 9461);
const OUT_DIR = "playtest/r11-screens";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT_DIR, { recursive: true });

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

async function openBrowser(tag) {
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
      `--user-data-dir=/tmp/chrome-r11-${tag}-${PORT}-${Date.now()}`,
      `--remote-debugging-port=${PORT}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  await waitJson(`http://127.0.0.1:${PORT}/json/version`);
  const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, {
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
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
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
  return { send, ev, evj, shot, close: () => { try { ws.close(); } catch { /* ignore */ } proc.kill(); } };
}

const INJECT = `(() => {
  const v = Number(localStorage.getItem("r11-rnd"));
  if (Number.isFinite(v) && v > 0) Math.random = () => v;
  window.__r11 = { rnd: Number.isFinite(v) ? v : null, t0: performance.now() };
  window.__r11rt = () => (performance.now() - window.__r11.t0) / 1000;
})();`;

const CONTRAST_JS = `(() => {
  const parse = (c) => { const m = String(c).match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(",").map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const L1 = lum(a), L2 = lum(b); return (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); };
  const bgOf = (el) => { let n = el; while (n) { const bg = parse(getComputedStyle(n).backgroundColor); if (bg && bg.a > 0.9) return bg; n = n.parentElement; } return { r: 43, g: 43, b: 58, a: 1 }; };
  const sels = [".hud-moyu", ".hud-moyu small", ".hud-sub", "#hud-click", "#hud-idle", "#hud-rank", ".hud-sub b", ".tag-click", ".tag-idle", ".shop-name", ".shop-next", ".shop-value", ".shop-remain", ".shop-cost", ".shop-level", ".goal-desc", ".goal-progress", ".goal-mark", ".c-label", ".c-text", ".journal-meta", ".stat-row", ".stat-row b", ".prestige-desc", "#shop-hint", ".journal-latest", "#quest-text", "#journal-claim", "#btn-journal", "#btn-mute", "#journal-close", ".journal-collect", ".shop-card.affordable .shop-name"];
  const out = [];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (!el) { out.push({ sel, missing: true }); continue; }
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") { out.push({ sel, hidden: true }); continue; }
    const fg = parse(cs.color); const bg = bgOf(el);
    if (!fg) { out.push({ sel, unparsed: true }); continue; }
    const size = parseFloat(cs.fontSize); const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, bg);
    out.push({ sel, fg: cs.color, bg: \`rgb(\${bg.r}, \${bg.g}, \${bg.b})\`, size, weight, ratio: Number(r.toFixed(2)), need, pass: r >= need });
  }
  return JSON.stringify(out);
})()`;

const STATIC_AUDIT_JS = `(() => {
  const ax = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { tag: el.tagName, role: el.getAttribute("role"), ariaLabel: el.getAttribute("aria-label"), ariaLive: el.getAttribute("aria-live"), ariaPressed: el.getAttribute("aria-pressed"), title: el.getAttribute("title"), tabIndex: el.tabIndex, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), display: cs.display, outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth }; };
  const tabbables = [...document.querySelectorAll("a,button,input,textarea,select,[tabindex]")]
    .filter((el) => el.tabIndex >= 0 && !el.disabled && el.getClientRects().length > 0)
    .map((el) => ({ tag: el.tagName, id: el.id, cls: el.className, text: (el.innerText || "").slice(0, 24), ariaLabel: el.getAttribute("aria-label"), disabled: el.disabled }));
  return JSON.stringify({
    lang: document.documentElement.lang,
    title: document.title,
    ariaLiveCount: document.querySelectorAll("[aria-live]").length,
    roleDialogCount: document.querySelectorAll("[role=dialog]").length,
    ariaModalCount: document.querySelectorAll("[aria-modal]").length,
    ariaHiddenCount: document.querySelectorAll("[aria-hidden]").length,
    ariaPressedCount: document.querySelectorAll("[aria-pressed]").length,
    ariaDescribedbyCount: document.querySelectorAll("[aria-describedby]").length,
    ariaLabelElements: [...document.querySelectorAll("[aria-label]")].map((e) => ({ tag: e.tagName, id: e.id, label: e.getAttribute("aria-label") })),
    tabbables,
    elements: { hudMoyu: ax("#hud-moyu"), btnMute: ax("#btn-mute"), btnJournal: ax("#btn-journal"), canvas: ax("#stage"), claim: ax("#journal-claim"), btnJournalRect: ax("#btn-journal") },
    hudMoyuText: (document.querySelector("#hud-moyu") || {}).textContent,
    liveRegions: [...document.querySelectorAll("[aria-live],[role=status],[role=alert],[role=log]")].map((e) => ({ tag: e.tagName, id: e.id, role: e.getAttribute("role"), live: e.getAttribute("aria-live") })),
    mediaCSS: (() => { const found = []; const walk = (rules) => { for (const r of rules) { try { if (r.conditionText && /prefers-reduced-motion|prefers-contrast|forced-colors/.test(r.conditionText)) found.push(r.conditionText); if (r.cssRules) walk(r.cssRules); } catch { /* ignore */ } } }; for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch { /* ignore */ } } return found; })(),
    reducedMotionMatch: matchMedia("(prefers-reduced-motion: reduce)").matches,
    prefersContrastMatch: matchMedia("(prefers-contrast: more)").matches,
    hasRewardDot: (() => { const el = document.getElementById("btn-journal"); const s = getComputedStyle(el, "::after"); return { content: s.content, bg: s.backgroundColor, w: s.width, h: s.height }; })(),
  });
})()`;

const reduceJs = `JSON.stringify({ match: matchMedia("(prefers-reduced-motion: reduce)").matches, cssRules: (() => { const found = []; const walk = (rules) => { for (const r of rules) { try { if (r.conditionText && /prefers-reduced-motion|prefers-contrast|forced-colors/.test(r.conditionText)) found.push(r.conditionText); if (r.cssRules) walk(r.cssRules); } catch { /* ignore */ } } }; for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch { /* ignore */ } } return found; })(), animations: document.getAnimations().map((a) => ({ name: a.animationName || (a.transitionProperty || "?"), state: a.playState })) })`;

async function main() {
  const b = await openBrowser("main");
  const out = { url: URL_, startedAt: new Date().toISOString() };
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Accessibility.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: INJECT });
  await b.send("Page.navigate", { url: URL_ });
  await sleep(3200);

  // ---------- 1) 首屏 ----------
  await b.shot(`${OUT_DIR}/r11-first.png`);
  out.boot = await b.evj(`(() => JSON.stringify({ ready: !!window.__MOYU__, assets: window.__MOYU__ && window.__MOYU__.assets, fps: window.__MOYU__ && window.__MOYU__.fps, state: window.__MOYU__ && window.__MOYU__.state, t: window.__r11rt && window.__r11rt() }))()`);
  out.staticAudit = await b.evj(STATIC_AUDIT_JS);
  out.contrastFirst = await b.evj(CONTRAST_JS);

  // ---------- 2) 键盘 Tab 顺序 ----------
  const tabOrder = [];
  await b.ev("document.body.focus(); document.activeElement && document.activeElement.blur();");
  for (let i = 0; i < 26; i++) {
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(40);
    const info = await b.ev(`(() => { const el = document.activeElement; if (!el || el === document.body) return JSON.stringify({ none: true }); return JSON.stringify({ tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 60), text: (el.innerText || "").replace(/\\s+/g, " ").slice(0, 40), ariaLabel: el.getAttribute("aria-label"), disabled: !!el.disabled }); })()`);
    const parsed = typeof info === "string" ? JSON.parse(info) : info;
    tabOrder.push(parsed);
    if (parsed.none) break;
  }
  out.tabOrder = tabOrder;

  // ---------- 3) 点 45 下 → 可买商店 ----------
  out.clicks = await b.ev(`(async () => {
    const c = document.getElementById("stage");
    const r = c.getBoundingClientRect();
    for (let i = 0; i < 45; i++) {
      c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: "touch" }));
      await new Promise((res) => setTimeout(res, 90));
    }
    await new Promise((res) => setTimeout(res, 500));
    return JSON.stringify({ moyu: window.__MOYU__.state.moyu, clicks: window.__MOYU__.state.totalClicks });
  })()`);
  await b.shot(`${OUT_DIR}/r11-shop-affordable.png`);
  out.shopStateAfterClicks = await b.evj(`(() => JSON.stringify([...document.querySelectorAll(".shop-card")].map((el) => ({ id: el.dataset.upgrade, disabled: el.disabled, affordable: el.classList.contains("affordable"), name: el.querySelector(".shop-name").textContent, tag: el.querySelector(".shop-tag").textContent, cost: el.querySelector(".shop-cost b").textContent, remain: el.querySelector(".shop-remain").textContent }))))()`);

  // ---------- 4) 日报面板 ----------
  await b.ev("document.getElementById('btn-journal').click()");
  await sleep(700);
  await b.shot(`${OUT_DIR}/r11-journal.png`);
  out.journalOpen = await b.evj(`(() => { const active = document.activeElement; const root = document.getElementById("journal"); return JSON.stringify({ open: !root.classList.contains("hidden"), activeTag: active && active.tagName, activeId: active && active.id, modalRole: root.getAttribute("role"), ariaModal: root.getAttribute("aria-modal"), ariaLabel: root.getAttribute("aria-label"), ariaLabelledby: root.getAttribute("aria-labelledby"), claimDisabled: document.getElementById("journal-claim").disabled, claimText: document.getElementById("journal-claim").textContent, goals: [...document.querySelectorAll("#journal-goals li")].map((li) => ({ cls: li.className, text: li.innerText.replace(/\\s+/g, " ").slice(0, 40) })) }); })()`);
  const axTree = await b.send("Accessibility.getFullAXTree");
  out.axTreeSummary = (axTree.nodes || [])
    .filter((n) => !n.ignored)
    .map((n) => ({ role: n.role && n.role.value, name: n.name && n.name.value, desc: n.description && n.description.value, props: (n.properties || []).filter((p) => ["disabled", "focusable", "live", "atomic", "modal"].includes(p.name)).map((p) => `${p.name}=${p.value && p.value.value}`) }))
    .filter((n) => n.name || ["button", "dialog", "canvas"].includes(n.role));
  out.contrastJournalOpen = await b.evj(CONTRAST_JS);
  // 关闭日报
  await b.ev("document.getElementById('journal-close').click()");
  await sleep(300);

  // ---------- 5) reduced-motion 模拟 ----------
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  const f1 = await b.ev("window.__MOYU__.frames");
  const f2 = await b.ev("window.__r11rt()");
  const clickMotion = await b.ev(`(async () => {
    const c = document.getElementById("stage"); const r = c.getBoundingClientRect();
    for (let i = 0; i < 6; i++) { c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: "touch" })); await new Promise((res) => setTimeout(res, 100)); }
    await new Promise((res) => setTimeout(res, 120));
    return JSON.stringify({ reduced: matchMedia("(prefers-reduced-motion: reduce)").matches });
  })()`);
  const frames2 = await b.ev("window.__MOYU__.frames");
  out.reducedMotion = { reducedMatch: true, framesBefore: f1, framesAfter: frames2, framesInWindow: frames2 - f1, animations: await b.evj(reduceJs), clickMotion: JSON.parse(clickMotion) };
  await b.ev(`(async () => { document.getElementById("btn-journal").classList.add("has-reward"); await new Promise(r=>setTimeout(r,100)); })()`);
  out.reducedMotionAnimations = await b.evj(reduceJs);
  await b.ev("document.getElementById('btn-journal').classList.remove('has-reward')");
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-contrast", value: "more" }] });
  out.prefersContrast = await b.evj(`(() => { const pick = (sel) => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { borderColor: cs.borderColor, background: cs.backgroundColor, color: cs.color }; }; return JSON.stringify({ contrastMatch: matchMedia("(prefers-contrast: more)").matches, shopCard: pick(".shop-card"), body: pick("body"), btn: pick("#btn-journal"), cssMedia: (() => { const found = []; const walk = (rules) => { for (const r of rules) { try { if (r.conditionText && /prefers-contrast/.test(r.conditionText)) found.push(r.conditionText); if (r.cssRules) walk(r.cssRules); } catch {} } }; for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch {} } return found; })() }); })()`);
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "forced-colors", value: "active" }] });
  await sleep(200);
  await b.shot(`${OUT_DIR}/r11-forced-colors.png`);
  out.forcedColors = await b.evj(`(() => { const dot = getComputedStyle(document.getElementById("btn-journal"), "::after"); const card = document.querySelector(".shop-card"); const cs = card ? getComputedStyle(card) : null; return JSON.stringify({ forced: matchMedia("(forced-colors: active)").matches, dotBg: dot.backgroundColor, dotShadow: dot.boxShadow, cardBorder: cs && cs.borderColor, cardBg: cs && cs.backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor }); })()`);
  await b.send("Emulation.setEmulatedMedia", { features: [] });

  // ---------- 6) 商店二次确认的视觉反馈 ----------
  out.confirmState = await b.evj(`(() => { const card = document.querySelector('.shop-card[data-upgrade="phone"], .shop-card[data-upgrade="coffee"]'); if (!card) return JSON.stringify({ none: true }); card.click(); const cs = getComputedStyle(card); return JSON.stringify({ cls: card.className, confirmingRule: [...document.styleSheets].some((ss) => { try { return [...ss.cssRules].some((r) => r.selectorText && /confirming/.test(r.selectorText)); } catch { return false; } }), borderColor: cs.borderColor, outline: cs.outlineStyle + " " + cs.outlineWidth }); })()`);

  // ---------- 7) 随机事件截图（Math.random 锁定以稳定变体） ----------
  const scenarios = [
    { rnd: 0.5, name: "meme+type", waits: [[20, "r11-meme.png"], [9, "r11-patrol-type.png"]] },
    { rnd: 0.1, name: "hold", waits: [[23, "r11-patrol-hold.png"]] },
    { rnd: 0.9, name: "blitz", waits: [[34, "r11-patrol-blitz.png"]] },
  ];
  out.events = [];
  for (const sc of scenarios) {
    await b.ev(`localStorage.setItem("r11-rnd", "${sc.rnd}"); location.reload(); 1`);
    await sleep(3200);
    const t0 = Date.now();
    for (const [atSec, file] of sc.waits) {
      const wait = atSec * 1000 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      await b.shot(`${OUT_DIR}/${file}`);
      out.events.push({ scenario: sc.name, file, atSec, t: await b.ev("window.__r11rt && window.__r11rt()"), fps: await b.ev("window.__MOYU__ && window.__MOYU__.fps"), state: await b.ev("window.__MOYU__ && JSON.stringify({moyu: window.__MOYU__.state.moyu, totalClicks: window.__MOYU__.state.totalClicks})") });
    }
  }
  await b.ev(`localStorage.removeItem("r11-rnd"); 1`);

  await b.close();
  out.finishedAt = new Date().toISOString();
  writeFileSync("playtest/r11-a11y-evidence.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, out: "playtest/r11-a11y-evidence.json", screens: OUT_DIR }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
