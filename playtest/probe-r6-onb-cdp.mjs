/**
 * R7 · 新手首屏真实浏览器探针（CDP 390×844 DPR3 touch）：只读，不修改 src/
 * 1) 首屏 HUD / 9 张商店卡的真实渲染文案与可见性（哪些卡在首屏可见、需不需要横向滑）
 * 2) 📔 日报按钮的可点尺寸、打开后的目标文案
 * 3) 首屏截图 playtest/r6-onb-first-screen.png
 *
 * 用法：node playtest/probe-r6-onb-cdp.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.ONB_CDP_PORT || 9355);
const URL_ = "http://127.0.0.1:5173/";
const OUT = "playtest/r6-onb-first-screen.png";
const W = 390;
const H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    `--user-data-dir=/tmp/chrome-r6-onb-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

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
  throw new Error("CDP not ready");
}

await waitJson("/json/version");
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
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
const evalJs = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(3000);

const first = await evalJs(`(() => {
  const txt = (el) => el ? el.textContent.trim() : null;
  const shop = document.getElementById('shop-cards');
  const box = shop.getBoundingClientRect();
  const cards = [...shop.querySelectorAll('.shop-card')].map((c, i) => {
    const r = c.getBoundingClientRect();
    return {
      i,
      id: c.dataset.upgrade,
      fullyVisible: r.left >= box.left - 1 && r.right <= box.right + 1,
      left: Math.round(r.left), right: Math.round(r.right),
      disabled: c.disabled,
      text: c.innerText.replace(/\\n/g, ' | '),
    };
  });
  const j = document.getElementById('btn-journal');
  const jr = j.getBoundingClientRect();
  return JSON.stringify({
    vw: innerWidth, vh: innerHeight,
    hud: {
      moyu: txt(document.getElementById('hud-moyu')),
      click: txt(document.getElementById('hud-click')),
      idle: txt(document.getElementById('hud-idle')),
      rank: txt(document.getElementById('hud-rank')),
      rankTitle: document.getElementById('hud-rank').title,
    },
    shop: { scrollWidth: shop.scrollWidth, clientWidth: shop.clientWidth, cardWidth: 118, visibleCount: cards.filter(c => c.fullyVisible && c.left >= box.left && c.left < box.right).length, cards },
    journalBtn: { text: txt(j), aria: j.getAttribute('aria-label'), w: Math.round(jr.width), h: Math.round(jr.height) },
    welcomeVisible: !document.getElementById('welcome').classList.contains('hidden'),
    tutorialNodes: [...document.querySelectorAll('[class*=tutor],[id*=tutor],[class*=onboard],[id*=onboard],[class*=hint],[id*=hint]')].map(e => e.id || e.className),
    hasSave: !!localStorage.getItem('moyu-save'),
    bodyText: document.body.innerText.slice(0, 600),
  });
})()`);
console.log("FIRST_SCREEN", first);

// 首屏截图（未打开任何面板）
const shot0 = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(OUT, Buffer.from(shot0.data, "base64"));
console.log("SHOT_FIRST", OUT);

// 打开日报面板，读取目标文案与图鉴前三格
await evalJs(`document.getElementById('btn-journal').click()`);
await sleep(600);
const journal = await evalJs(`(() => {
  const txt = (el) => el ? el.textContent.trim() : null;
  return JSON.stringify({
    date: txt(document.getElementById('journal-date')),
    goals: [...document.querySelectorAll('#journal-goals .goal')].map(g => g.innerText.replace(/\\n/g, ' ')),
    claim: txt(document.getElementById('journal-claim')),
    total: txt(document.getElementById('journal-total')),
    quote: txt(document.getElementById('journal-quote')),
    flavor: txt(document.getElementById('journal-flavor')),
    latest: txt(document.getElementById('journal-latest')),
    gridFirst3: [...document.querySelectorAll('#journal-grid .c-item')].slice(0, 3).map(g => g.innerText.replace(/\\n/g, ' ')),
  });
})()`);
console.log("JOURNAL", journal);

const shot1 = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(OUT.replace(".png", "-journal.png"), Buffer.from(shot1.data, "base64"));
console.log("SHOT_JOURNAL", OUT.replace(".png", "-journal.png"));

proc.kill();
process.exit(0);
