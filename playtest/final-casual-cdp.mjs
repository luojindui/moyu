/**
 * 终验 CASUAL · 手机端真实浏览器探针 v2（CDP，390×844 DPR3 touch）
 * - 布局/HUD/场景/商店/日报图鉴 尺寸与可见性
 * - 真实触点：点 1 下、点 20 下、买咖啡
 * - HUD 极端文案压力（最长段位名 + 🔥连胜）
 * - 离线回归：伪造 Date.now 让 pagehide 存档时间回拨（真实 reload → boot → settleReturn → welcome 面板）
 *   · 30 分钟首日 → 应显示全额
 *   · 30 分钟建档 2 天后 → 应显示「离线效率 70%」
 *   · 100 小时 → 应显示「8 小时 0 分」封顶
 * 产出 /tmp/final-casual-cdp2.json + 截图。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CASUAL_CDP_PORT || 9334);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[probe2]", ...a);

const userDir = `/tmp/chrome-cdp-final2-${Date.now()}`;
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
    "--disable-background-networking",
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let chromeErr = "";
proc.stderr.on("data", (d) => (chromeErr += d.toString()));

async function waitJson(path, tries = 120) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error(`CDP not ready: ${path}`);
}

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
      } else if (msg.method) this.events.push(msg);
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result.value;
  }
}

async function openPage() {
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return new CDP(ws);
}

const MARKET = `(() => {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
  const lines = (el) => { if (!el) return 0; const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length; };
  const cards = [...document.querySelectorAll('.shop-card')];
  const stage = q('#stage');
  const hud = q('#hud');
  const hudSub = hud && hud.querySelector('.hud-sub');
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    doc: { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight },
    hud: { rect: rect(hud), text: hud ? hud.innerText.replace(/\\n+/g, ' | ') : null, subScrollW: hudSub ? hudSub.scrollWidth : null, subClientW: hudSub ? hudSub.clientWidth : null, rankLines: lines(q('#hud-rank')), clickLines: lines(q('#hud-click')), idleLines: lines(q('#hud-idle')) },
    canvas: stage ? { attrW: stage.width, attrH: stage.height, rect: rect(stage) } : null,
    shop: { rect: rect(q('#shop')), cards: cards.length, cardRects: cards.map((c) => ({ id: c.dataset.upgrade, ...rect(c), disabled: c.disabled, cost: (c.querySelector('.shop-cost') || {}).textContent })) },
    journal: { hidden: q('#journal')?.classList.contains('hidden'), total: q('#journal-total')?.textContent, goals: document.querySelectorAll('#journal-goals li').length, grid: document.querySelectorAll('#journal-grid .c-item').length, claim: q('#journal-claim')?.textContent, panel: rect(q('.journal-panel')), gridScrollH: q('#journal-grid')?.scrollHeight, gridClientH: q('#journal-grid')?.clientHeight },
    welcome: { hidden: q('#welcome')?.classList.contains('hidden'), time: q('#welcome-time')?.textContent, gain: q('#welcome-gain')?.textContent, rule: q('#welcome-rule')?.textContent, panel: rect(q('.welcome-panel')) },
    hudValues: { moyu: q('#hud-moyu')?.textContent, click: q('#hud-click')?.textContent, idle: q('#hud-idle')?.textContent, rank: q('#hud-rank')?.textContent, streak: q('#hud-streak')?.textContent },
    journalBadge: q('#btn-journal')?.className,
    bootError: !!document.querySelector('.boot-error'),
    state: window.__MOYU__ ? window.__MOYU__.state : null,
    fps: window.__MOYU__ ? window.__MOYU__.fps : null,
    frames: window.__MOYU__ ? window.__MOYU__.frames : null,
    assets: window.__MOYU__ ? window.__MOYU__.assets : null,
  };
})()`;

const run = async () => {
  await waitJson("/json/version");
  const cdp = await openPage();
  const consoleErrors = [];
  const consoleWarns = [];
  const exceptions = [];
  const failedReq = [];
  cdp.ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.consoleAPICalled") {
      const txt = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
      if (msg.params.type === "error") consoleErrors.push(txt);
      if (msg.params.type === "warning") consoleWarns.push(txt);
    }
    if (msg.method === "Runtime.exceptionThrown") exceptions.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
    if (msg.method === "Log.entryAdded") {
      const e = msg.params.entry;
      if (e.level === "error") (e.source === "network" ? failedReq.push(`${e.url || ""} ${e.text}`) : consoleErrors.push(`[log:${e.source}] ${e.text}`));
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  const emu = async (w, h) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 3, mobile: true, screenWidth: w, screenHeight: h });
  };
  await emu(390, 844);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.navigate", { url: URL });

  const waitReady = async (frames = 30) => {
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      try {
        if (await cdp.evaluate(`!!(window.__MOYU__ && window.__MOYU__.frames > ${frames})`)) return true;
      } catch { /* navigating */ }
    }
    return false;
  };
  await waitReady(30);
  await sleep(800);

  const shot = async (name) => {
    const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`/tmp/final-casual-${name}.png`, Buffer.from(r.data, "base64"));
  };

  const result = { initial: await cdp.evaluate(MARKET) };
  await shot("11-initial");

  // ---- 真实触点 ----
  const tap = async (x, y) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(50);
  };
  const beforeTap = await cdp.evaluate("window.__MOYU__.state.moyu");
  await tap(195, 420);
  await sleep(300);
  result.tap = { before: beforeTap, after: await cdp.evaluate("window.__MOYU__.state.moyu"), hudNow: await cdp.evaluate(`document.getElementById('hud-moyu').textContent`) };

  for (let i = 0; i < 24; i++) await tap(150 + (i % 6) * 10, 380 + (i % 4) * 20);
  await sleep(300);
  result.afterTaps = { state: await cdp.evaluate("window.__MOYU__.state"), shop: await cdp.evaluate(`[...document.querySelectorAll('.shop-card')].slice(0,4).map(c=>({id:c.dataset.upgrade,disabled:c.disabled,cost:c.querySelector('.shop-cost').textContent}))`) };
  await shot("12-after-taps");

  // 买咖啡
  result.buy = await cdp.evaluate(`(() => {
    const b = document.querySelector('.shop-card[data-upgrade="coffee"]');
    const wasDisabled = b.disabled;
    b.click();
    return { wasDisabled };
  })()`);
  await sleep(350);
  result.afterBuy = await cdp.evaluate(MARKET);
  await shot("13-after-buy");

  // ---- HUD 压力：最长段位 + 连胜 ----
  result.hudStress = await cdp.evaluate(`(() => {
    const rank = document.getElementById('hud-rank');
    const streak = document.getElementById('hud-streak');
    const before = { rank: rank.textContent, h: document.getElementById('hud').getBoundingClientRect().height };
    rank.textContent = '带薪摸鱼传说（升 摸鱼之神 100%）';
    streak.textContent = '🔥连胜 10';
    streak.classList.remove('hidden');
    const after = { rank: rank.textContent, h: document.getElementById('hud').getBoundingClientRect().height, docScrollW: document.documentElement.scrollWidth };
    return { before, after };
  })()`);
  await sleep(300);
  result.hudStressLines = await cdp.evaluate(MARKET);
  await shot("14-hud-stress");

  // ---- 真实浏览器自动试玩 90s：1 次/秒点场景 + 每 3s 买一张卡（模拟"手闲休闲玩家"）----
  // 用途：校验引擎模拟的成长曲线在真实 rAF 主循环 + 真实 pointer/click 事件下同样成立。
  const playStart = await cdp.evaluate("window.__MOYU__.state");
  await cdp.evaluate(`(() => {
    // 自动买卡：优先买没买过的卡，否则最便宜的可买卡（禁用卡点不动，等价于真实点击）
    window.__autoBuy = setInterval(() => {
      const cards = [...document.querySelectorAll('.shop-card')];
      const enabled = cards.filter((c) => !c.disabled);
      if (!enabled.length) return;
      const target = enabled.find((c) => !c.querySelector('.shop-level').textContent) || enabled[0];
      target.click();
    }, 3000);
    // 自动戳屏幕：1 次/秒，位置在场景内随机（与真人手指覆盖范围一致）
    window.__autoTap = setInterval(() => {
      const c = document.getElementById('stage');
      const r = c.getBoundingClientRect();
      const x = r.left + 40 + Math.random() * (r.width - 80);
      const y = r.top + 60 + Math.random() * (r.height - 120);
      c.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, clientX: x, clientY: y, bubbles: true }));
      window.__tapCount = (window.__tapCount || 0) + 1;
    }, 1000);
    return true;
  })()`);
  await sleep(90_000);
  const playEnd = await cdp.evaluate(MARKET);
  result.realPlay90s = {
    start: playStart,
    end: playEnd,
    taps: await cdp.evaluate("window.__tapCount").catch(() => null),
  };
  await cdp.evaluate("clearInterval(window.__autoBuy); clearInterval(window.__autoTap); true");
  await shot("20-realplay90s");

  // ---- 日报/图鉴 ----
  await cdp.evaluate(`document.getElementById('btn-journal').click()`);
  await sleep(500);
  result.journalOpen = await cdp.evaluate(MARKET);
  await shot("15-journal");
  await cdp.evaluate(`document.getElementById('journal-close').click()`);
  await sleep(200);

  // ---- 离线回归（真实 reload）----
  // 关键点：pagehide 会用 Date.now() 重写 savedAt，所以先在本页把 Date.now 回拨，再 reload。
  const fakeClockReload = async (offsetMs, setup) => {
    if (setup) await cdp.evaluate(setup);
    await cdp.evaluate(`window.__realNow = Date.now; Date.now = () => window.__realNow() + (${offsetMs}); true`);
    const t0 = Date.now();
    await cdp.send("Page.reload");
    await sleep(900); // 等旧页面卸载，避免在旧执行上下文里读到 frames
    await waitReady(20);
    await sleep(600);
    return { reloadMs: Date.now() - t0, market: await cdp.evaluate(MARKET), saved: await cdp.evaluate(`(() => { try { const b = JSON.parse(localStorage.getItem('moyu-save')||'null'); return b ? { savedAt: b.savedAt, createdAt: b.createdAt, moyu: b.moyu, levels: b.levels } : null; } catch { return null; } })()`) };
  };

  // 场景 A：首日离线 30 分钟（Date.now 回拨 -30min → pagehide 写旧 savedAt）
  result.offlineFirstDay = await fakeClockReload(-1800 * 1000);
  await shot("16-welcome-firstday");
  await cdp.evaluate(`document.getElementById('welcome-ok').click()`);
  await sleep(300);
  result.afterWelcomeClose = await cdp.evaluate(MARKET);

  // 场景 B：建档 2 天后 + 离线 30 分钟 → 70%
  result.offlineNextDay = await fakeClockReload(-1800 * 1000, `(() => {
    const raw = JSON.parse(localStorage.getItem('moyu-save'));
    raw.createdAt = Date.now() - 2 * 86400000;
    localStorage.setItem('moyu-save', JSON.stringify(raw));
    return true;
  })()`);
  await shot("17-welcome-70pct");

  // 场景 C：离线 100 小时 → 8h 封顶
  result.offlineCap = await fakeClockReload(-100 * 3600 * 1000);
  await shot("18-welcome-cap");

  // 场景 D：debug 钩子 rewindSave 是否真的能测离线（文档承诺"回拨存档时间，需刷新"）
  result.rewindHook = await (async () => {
    await cdp.evaluate(`window.__realNow = Date.now; Date.now = () => window.__realNow(); __MOYU__.saveNow(); __MOYU__.rewindSave(1800); true`);
    await cdp.send("Page.reload");
    await sleep(900);
    await waitReady(20);
    await sleep(600);
    return { welcome: await cdp.evaluate(`(() => ({ hidden: document.getElementById('welcome').classList.contains('hidden'), gain: document.getElementById('welcome-gain').textContent }))()`), saved: await cdp.evaluate(`(() => { const b = JSON.parse(localStorage.getItem('moyu-save')||'null'); return b ? { savedAt: b.savedAt, agoSec: Math.round((Date.now()-b.savedAt)/1000) } : null; })()`) };
  })();

  // ---- 360×740 小屏回归（iPhone SE 级别）----
  await cdp.evaluate(`window.__realNow = Date.now; Date.now = () => window.__realNow(); true`);
  await emu(360, 740);
  await sleep(500);
  result.smallScreen = await cdp.evaluate(MARKET);
  await shot("19-360x740");

  // ---- HUD 真实极端状态：高段位（带薪摸鱼传说）+ 🔥连胜，检查 390 宽下是否溢出/截断 ----
  await emu(390, 844);
  await sleep(300);
  result.hudLongRank = await (async () => {
    // 注意：Page.reload 会触发旧页面 pagehide → 用内存状态重写存档；必须在"新文档创建时"注入存档种子
    const seeded = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => { try {
        const raw = JSON.parse(localStorage.getItem('moyu-save') || 'null') || { v: 1, levels: {}, collected: { quotes: [], flavors: [] }, daily: null };
        raw.v = 1;
        raw.totalEarned = 150000000; // 带薪摸鱼传说（升 摸鱼之神 5%）
        raw.surviveStreak = 10;      // HUD 显示 🔥连胜 10
        raw.savedAt = Date.now();
        raw.createdAt = Date.now();
        localStorage.setItem('moyu-save', JSON.stringify(raw));
      } catch (e) {} })();`,
    });
    await cdp.send("Page.reload");
    await sleep(900);
    await waitReady(20);
    await sleep(700);
    const m = await cdp.evaluate(MARKET);
    await shot("21-hud-longrank-streak");
    m.seedScriptId = seeded.identifier;
    return m;
  })();

  result.console = { errors: consoleErrors, warns: consoleWarns, exceptions, failedReq };
  result.chromeStderrTail = chromeErr.split("\n").filter((l) => /CONSOLE|Uncaught|TypeError|ReferenceError|Failed to load|404/i.test(l)).slice(0, 20);
  writeFileSync(process.env.CASUAL_CDP_OUT || "/tmp/final-casual-cdp2.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  cdp.ws.close();
  proc.kill("SIGKILL");
};

run().catch((e) => {
  console.error("PROBE FAILED", e);
  proc.kill("SIGKILL");
  process.exit(1);
});
