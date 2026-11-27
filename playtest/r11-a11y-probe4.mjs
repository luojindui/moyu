/**
 * R11 无障碍探针 #4：reduce 下 CSS 动画是否停（以真实可领态测量）+ 巡逻横幅期间 AX 树。
 * 只读 src/，产物 playtest/r11-a11y-evidence4.json + playtest/r11-screens/*.png
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
    const port = 9900 + Math.floor(Math.random() * 90);
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
async function openBrowser(tag, port) {
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r11d-${tag}-${Date.now()}`,
    `--remote-debugging-port=${port}`, "about:blank",
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
  if (localStorage.getItem("r11-seeded4") === "1") return;
  const today = new Date().toLocaleDateString("sv-SE");
  const win = Math.floor(new Date().getHours() / 6);
  const now = Date.now();
  const daily = { date: today, goals: [
    { id: "visit_1", target: 1, progress: 1, done: true },
    { id: "idle_earn", target: 1, progress: 1, done: true },
    { id: "click_100", target: 100, progress: 100, done: true }],
    streak: 2, lastCompleteDate: null, claimed: false, window: win, claimsToday: 0 };
  const blob = { v: 1, moyu: 156, totalEarned: 156, levels: {}, savedAt: now, createdAt: now,
    collected: { quotes: [], flavors: [] }, daily, surviveStreak: 0, totalClicks: 0,
    visits: { date: today, count: 1 }, lifetimeEarned: 156, prestige: 0 };
  localStorage.setItem("moyu-save", JSON.stringify(blob));
  localStorage.setItem("r11-seeded4", "1");
})();`;

async function axTexts(b) {
  const t = await b.send("Accessibility.getFullAXTree");
  return (t.nodes || []).filter((n) => !n.ignored && (n.name && n.name.value)).map((n) => ({ role: n.role && n.role.value, name: n.name.value }));
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
  await b.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await b.send("Page.navigate", { url: URL_ });
  await sleep(3400);

  // 可领态在 reduce 下的动画
  out.claimable = await b.evj(`(() => { const btn = document.getElementById("btn-journal"); const cs = getComputedStyle(btn); const anims = document.getAnimations().map((x) => ({ name: x.animationName || "?", state: x.playState })); return JSON.stringify({ hasReward: btn.classList.contains("has-reward"), title: btn.title, reduce: matchMedia("(prefers-reduced-motion: reduce)").matches, animationName: cs.animationName, animationIterationCount: cs.animationIterationCount, anims }); })()`);
  await b.shot(`${OUT_DIR}/r11-reduced-claimable.png`);

  // 巡逻横幅：轮询画布像素直到横幅出现，再取 AX 树
  await b.ev(`localStorage.setItem("r11-rnd","0.1"); location.reload(); 1`);
  await sleep(3000);
  const found = { active: false, waitedMs: 0, pixel: null };
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    const px = await b.ev(`(() => { const c = document.getElementById("stage"); const ctx = c.getContext("2d"); const d = ctx.getImageData(Math.round(c.width * 0.5), Math.round(c.height * 0.1), 1, 1).data; return JSON.stringify([...d]); })()`);
    const arr = JSON.parse(px);
    const near = (c, [r, g, bl], tol = 24) => Math.abs(c[0] - r) <= tol && Math.abs(c[1] - g) <= tol && Math.abs(c[2] - bl) <= tol;
    if (near(arr, [179, 65, 60]) || near(arr, [47, 122, 79])) {
      found.active = true; found.pixel = arr; found.waitedMs = Date.now() - t0;
      break;
    }
    await sleep(250);
  }
  out.patrol = { found, axPatrolTexts: found.active ? (await axTexts(b)).filter((n) => /王总|巡逻|忍住|连点|假装工作/.test(n.name)) : [], liveRegions: await b.ev(`document.querySelectorAll("[aria-live],[role=status],[role=alert]").length`), canvasLabel: await b.ev(`document.getElementById("stage").getAttribute("aria-label")`) };
  await b.shot(`${OUT_DIR}/r11-patrol-ax2.png`);
  out.patrol.axTextCount = (await axTexts(b)).length;
  await b.ev(`localStorage.removeItem("r11-rnd"); 1`);

  await b.close();
  out.finishedAt = new Date().toISOString();
  writeFileSync("playtest/r11-a11y-evidence4.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, port, patrol: out.patrol.found }));
}
main().catch((e) => { console.error(e); process.exit(1); });
