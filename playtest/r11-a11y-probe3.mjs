/**
 * R11 无障碍探针 #3（补充证据）：焦点环、CSS 动画、买后旧绿框、巡逻中 AX 树、reduce 下粒子。
 * 只读 src/，产物 playtest/r11-a11y-evidence3.json + playtest/r11-screens/*.png
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
    const port = 9700 + Math.floor(Math.random() * 200);
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
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
async function openBrowser(tag, port, extraArgs = []) {
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--disable-extensions",
    `--user-data-dir=/tmp/chrome-r11c-${tag}-${Date.now()}`,
    `--remote-debugging-port=${port}`, ...extraArgs, "about:blank",
  ], { stdio: "ignore" });
  await waitJson(`http://127.0.0.1:${port}/json/version`);
  if (proc.exitCode !== null) throw new Error("spawned chrome exited");
  const tab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
  const evj = async (expression) => { const v = await ev(expression); return typeof v === "string" ? JSON.parse(v) : v; };
  async function shot(path) {
    const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(path, Buffer.from(s.data, "base64"));
  }
  return { send, ev, evj, shot, close: () => { try { ws.close(); } catch { /* ignore */ } proc.kill(); } };
}

const SEED = `(() => {
  if (localStorage.getItem("r11-seeded3") === "1") return;
  const today = new Date().toLocaleDateString("sv-SE");
  const win = Math.floor(new Date().getHours() / 6);
  const now = Date.now();
  const blob = { v: 1, moyu: 160, totalEarned: 160, levels: {}, savedAt: now, createdAt: now,
    collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, totalClicks: 0,
    visits: { date: today, count: 1 }, lifetimeEarned: 160, prestige: 0 };
  localStorage.setItem("moyu-save", JSON.stringify(blob));
  localStorage.setItem("r11-seeded3", "1");
})();`;

async function axNodes(b) {
  const t = await b.send("Accessibility.getFullAXTree");
  return (t.nodes || []).filter((n) => !n.ignored).map((n) => ({
    role: n.role && n.role.value,
    name: (n.name && n.name.value) || "",
    desc: (n.description && n.description.value) || "",
  }));
}

async function main() {
  const out = { url: URL_, startedAt: new Date().toISOString() };
  const port = await freePort();
  const b = await openBrowser("main", port);
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Accessibility.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await b.send("Page.navigate", { url: URL_ });
  await sleep(3400);

  // ---- 焦点环（键盘 Tab 后） ----
  await b.ev("document.activeElement && document.activeElement.blur(); 1");
  const focus = [];
  for (let i = 0; i < 5; i++) {
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(60);
    focus.push(await b.evj(`(() => { const el = document.activeElement; const cs = el ? getComputedStyle(el) : null; return JSON.stringify({ tag: el && el.tagName, id: el && el.id, cls: el && String(el.className).slice(0, 40), outline: cs ? cs.outlineStyle + " " + cs.outlineWidth + " " + cs.outlineColor : null, boxShadow: cs ? cs.boxShadow : null }); })()`));
  }
  out.keyboardFocus = focus;

  // ---- CSS 动画（has-reward / just-unlocked） ----
  out.anim = await b.evj(`(() => {
    const btn = document.getElementById("btn-journal");
    btn.classList.add("has-reward");
    const cs = getComputedStyle(btn);
    const anims = document.getAnimations().map((x) => ({ name: x.animationName || "?", state: x.playState }));
    const card = document.querySelector(".shop-card");
    card.classList.add("just-unlocked");
    const cs2 = getComputedStyle(card);
    return JSON.stringify({ hasReward: btn.classList.contains("has-reward"), animationName: cs.animationName, animationDuration: cs.animationDuration, animationIterationCount: cs.animationIterationCount, anims, cardAnim: cs2.animationName, animCount: document.getAnimations().length });
  })()`);
  await sleep(300);
  out.animAfter300ms = await b.evj(`(() => JSON.stringify({ animCount: document.getAnimations().length, names: document.getAnimations().map((x) => x.animationName || "?") }))()`);
  await b.ev(`document.getElementById("btn-journal").classList.remove("has-reward"); 1`);

  // ---- 买水后旧绿框（just-unlocked 类持久） ----
  await b.ev(`document.querySelector('[data-upgrade="water"]').click()`); // 第一次 → 二次确认
  await sleep(150);
  await b.ev(`document.querySelector('[data-upgrade="water"]').click()`); // 第二次 → 确认购买
  await sleep(500);
  out.afterBuyWater = await b.evj(`(() => JSON.stringify({
    moyu: window.__MOYU__.state.moyu,
    cards: [...document.querySelectorAll(".shop-card")].map((el) => ({ id: el.dataset.upgrade, disabled: el.disabled, cls: el.className.replace("shop-card pixel-panel", "").trim(), border: getComputedStyle(el).borderColor, remain: el.querySelector(".shop-remain").textContent }))
  }))()`);
  await b.shot(`${OUT_DIR}/r11-shop-stale-green.png`);

  // ---- reduce 动效：点击后粒子/飘字是否仍出现 ----
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  const fA = await b.ev("window.__MOYU__.frames");
  await b.ev(`(async () => { const c = document.getElementById("stage"); const r = c.getBoundingClientRect(); for (let i = 0; i < 6; i++) { c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: "touch" })); await new Promise((res) => setTimeout(res, 100)); } })()`);
  await b.shot(`${OUT_DIR}/r11-reduced-motion-after-click.png`);
  await sleep(400);
  out.reduced = await b.evj(`(() => JSON.stringify({ reduce: matchMedia("(prefers-reduced-motion: reduce)").matches, frames: window.__MOYU__.frames, framesBefore: window.__MOYU__.frames - 0, particleCode: "Fx.floatText 每次点击 push 5 个粒子 + 飘字（无 reduce 分支）", cssMedia: (() => { const f = []; const walk = (rs) => { for (const r of rs) { try { if (r.conditionText) f.push(r.conditionText); if (r.cssRules) walk(r.cssRules); } catch {} } }; for (const ss of document.styleSheets) { try { walk(ss.cssRules); } catch {} } return f.filter((t) => /reduced-motion|prefers-contrast|forced-colors/.test(t)); })() }))()`);
  out.reducedFrames = { before: fA, after: out.reduced.frames };
  await b.send("Emulation.setEmulatedMedia", { features: [] });

  // ---- 巡逻中：AX 树是否有"王总/巡逻" ----
  await b.ev(`localStorage.setItem("r11-rnd","0.1"); location.reload(); 1`);
  await sleep(3200);
  await sleep(23000);
  await b.shot(`${OUT_DIR}/r11-patrol-ax.png`);
  out.patrolAX = {
    axNodesWithPatrol: (await axNodes(b)).filter((n) => /王总|巡逻|忍住/.test(n.name + n.desc)),
    canvasTextContent: await b.ev(`document.getElementById("stage").textContent`),
    canvasAriaLabel: await b.ev(`document.getElementById("stage").getAttribute("aria-label")`),
    canvasAriaDescription: await b.ev(`document.getElementById("stage").getAttribute("aria-describedby")`),
    canvasRole: await b.ev(`document.getElementById("stage").getAttribute("role")`),
    patrolPixel: await b.ev(`(() => { const c = document.getElementById("stage"); const ctx = c.getContext("2d"); const d = ctx.getImageData(c.width * 0.2, c.height * 0.05, 1, 1).data; return JSON.stringify([...d]); })()`),
    allAXTexts: (await axNodes(b)).filter((n) => n.name).slice(0, 60),
  };
  await b.ev(`localStorage.removeItem("r11-rnd"); 1`);

  await b.close();
  out.finishedAt = new Date().toISOString();
  writeFileSync("playtest/r11-a11y-evidence3.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, port }));
}
main().catch((e) => { console.error(e); process.exit(1); });
