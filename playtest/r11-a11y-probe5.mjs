/**
 * R11 无障碍探针 #5：📔 has-reward 时 position 被覆盖导致按钮跑位/被裁切的实测。
 * 只读 src/，产物 playtest/r11-a11y-evidence5.json + playtest/r11-screens/*.png
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
    const port = 9990 + Math.floor(Math.random() * 90);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(300) });
      if (!r.ok) return port;
    } catch { return port; }
  }
  throw new Error("no free port");
}
async function waitJson(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
async function openBrowser(port) {
  const proc = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
    "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r11e-${Date.now()}`,
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
  if (localStorage.getItem("r11-seeded5") === "1") return;
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
  localStorage.setItem("r11-seeded5", "1");
})();`;

async function main() {
  const out = { url: URL_, startedAt: new Date().toISOString() };
  const port = await freePort();
  const b = await openBrowser(port);
  await b.send("Page.enable");
  await b.send("Runtime.enable");
  await b.send("Accessibility.enable");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: SEED });
  await b.send("Page.navigate", { url: URL_ });
  await sleep(3400);

  out.journalBtn = await b.evj(`(() => {
    const btn = document.getElementById("btn-journal");
    const mute = document.getElementById("btn-mute");
    const r = btn.getBoundingClientRect();
    const mr = mute.getBoundingClientRect();
    const sub = document.querySelector(".hud-sub");
    return JSON.stringify({
      hasReward: btn.classList.contains("has-reward"),
      position: getComputedStyle(btn).position,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
      viewport: { w: innerWidth, h: innerHeight },
      inViewport: r.x >= 0 && r.right <= innerWidth && r.y >= 0 && r.bottom <= innerHeight,
      elementAtDot: (() => { const el = document.elementFromPoint(innerWidth - 12, innerHeight - 186); return el ? el.tagName + "#" + el.id + "." + String(el.className).slice(0, 20) : null; })(),
      muteRect: { x: Math.round(mr.x), y: Math.round(mr.y), w: Math.round(mr.width), h: Math.round(mr.height) },
      hudSub: { scrollWidth: sub.scrollWidth, clientWidth: sub.clientWidth, overflow: getComputedStyle(sub).overflow },
      dotRect: (() => { const s = getComputedStyle(btn, "::after"); return { content: s.content, position: s.position, w: s.width }; })()
    });
  })()`);

  await b.shot(`${OUT_DIR}/r11-journal-btn-reward.png`);
  // 对比：不可领时
  await b.ev(`document.getElementById("btn-journal").classList.remove("has-reward"); 1`);
  await sleep(250);
  out.journalBtnNoReward = await b.evj(`(() => { const btn = document.getElementById("btn-journal"); const r = btn.getBoundingClientRect(); return JSON.stringify({ position: getComputedStyle(btn).position, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, inViewport: r.x >= 0 && r.right <= innerWidth }); })()`);
  await b.shot(`${OUT_DIR}/r11-journal-btn-noreward.png`);

  await b.close();
  out.finishedAt = new Date().toISOString();
  writeFileSync("playtest/r11-a11y-evidence5.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, port }));
}
main().catch((e) => { console.error(e); process.exit(1); });
