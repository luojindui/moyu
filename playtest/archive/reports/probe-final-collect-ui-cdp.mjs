/**
 * probe-final-collect-ui-cdp.mjs — 终验探针 ④/⑤（真实浏览器运行时）
 * 用无头 Chrome + CDP 在精确 390×844 移动视口下验证：
 *   - HUD 非空 / canvas 尺寸 / 商店 9 卡 / 图鉴入口初始 hidden + 0/55
 *   - 打开图鉴：55 格、未解锁 ???、2 列可滚动、日报 3 目标、领取门禁
 *   - 注入存档后：📔 红色角标 has-reward、连胜 #hud-streak、领奖入账、角标消失
 *   - 移动端 meta / manifest / apple-touch-icon / console 错误
 * 用法：node playtest/probe-final-collect-ui-cdp.mjs [baseUrl] [label]
 * 只读 src/，不改 src/。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.argv[2] ?? "http://127.0.0.1:5173/";
const LABEL = process.argv[3] ?? "dev";
const OUT_DIR = "/tmp/final-collect-ui";
mkdirSync(OUT_DIR, { recursive: true });

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.consoleErrors = [];
    this.notable = [];
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${JSON.stringify(msg.error)}`));
        else p.resolve(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        this.consoleErrors.push(`exception: ${d.text} ${d.exception?.description ?? ""}`.slice(0, 400));
      } else if (msg.method === "Runtime.consoleAPICalled") {
        const type = msg.params.type;
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
        if (type === "error" || type === "assert") this.consoleErrors.push(`console.${type}: ${text}`.slice(0, 400));
        else if (type === "warning") this.notable.push(`console.warn: ${text}`.slice(0, 300));
      } else if (msg.method === "Log.entryAdded") {
        const e = msg.params.entry;
        if (e.level === "error") this.consoleErrors.push(`log.error: ${e.text}`.slice(0, 400));
        else if (e.level === "warning") this.notable.push(`log.warn: ${e.text}`.slice(0, 300));
      }
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timeout ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function launch(profile) {
  rmSync(profile, { recursive: true, force: true });
  const proc = spawn(
    CHROME,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      "--mute-audio",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      "--window-size=390,844",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  proc.stderr.on("data", (b) => (stderr += b.toString()));
  const portFile = `${profile}/DevToolsActivePort`;
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100);
  if (!existsSync(portFile)) throw new Error(`chrome 未就绪: ${stderr.slice(-500)}`);
  const port = readFileSync(portFile, "utf8").split("\n")[0].trim();
  let page;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      page = list.find((p) => p.type === "page");
      if (page) break;
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  if (!page) throw new Error("未找到 page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  return { proc, cdp, port };
}

async function stop(inst) {
  try {
    inst.cdp.ws.close();
  } catch {
    /* ignore */
  }
  inst.proc.kill("SIGKILL");
  await sleep(300);
}

async function evalJs(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    throw new Error(`页面脚本异常: ${JSON.stringify(r.exceptionDetails).slice(0, 500)}`);
  }
  return r.result.value;
}

async function waitReady(cdp, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await evalJs(cdp, `document.readyState === 'complete' && !!window.__MOYU__`).catch(() => false);
    if (ok) {
      // 等主循环跑几帧 + HUD 150ms 节流刷新
      await sleep(1200);
      return;
    }
    await sleep(120);
  }
  throw new Error("页面未在超时内就绪");
}

async function goto(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitReady(cdp);
}

const MOBILE_EXPR = `(() => {
  const q = (s) => document.querySelector(s);
  const t = (id) => (document.getElementById(id)?.textContent ?? '').trim();
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1), right:+r.right.toFixed(1), bottom:+r.bottom.toFixed(1) }; };
  const cv = q('#stage');
  const hud = q('#hud');
  const overflowIn = (root) => [...root.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position === 'fixed') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && (r.right > innerWidth + 0.5 || r.left < -0.5);
  }).slice(0, 10).map((el) => ({ tag: el.tagName, id: el.id || null, cls: (el.className || '').toString().slice(0, 40), right: +el.getBoundingClientRect().right.toFixed(1), left: +el.getBoundingClientRect().left.toFixed(1) }));
  const meta = (n) => q('meta[name="'+n+'"]')?.content ?? null;
  const app = q('#app');
  return {
    url: location.href,
    innerWidth, innerHeight, dpr: devicePixelRatio,
    readyState: document.readyState,
    appHeight: rect(app)?.h ?? null,
    hud: { moyu: t('hud-moyu'), click: t('hud-click'), idle: t('hud-idle'), rank: t('hud-rank'), streak: t('hud-streak'), streakHidden: q('#hud-streak')?.classList.contains('hidden') ?? null },
    canvas: { attrW: cv?.width ?? null, attrH: cv?.height ?? null, clientW: cv?.clientWidth ?? null, clientH: cv?.clientHeight ?? null, rect: rect(cv) },
    shop: { cards: document.querySelectorAll('[data-upgrade]').length, ids: [...document.querySelectorAll('[data-upgrade]')].map((b) => b.dataset.upgrade), containerScrollW: q('#shop-cards')?.scrollWidth ?? null, containerClientW: q('#shop-cards')?.clientWidth ?? null, overflowX: getComputedStyle(q('#shop-cards')).overflowX, cardRect: rect(q('[data-upgrade]')) },
    journal: { hiddenClass: q('#journal')?.classList.contains('hidden') ?? null, display: getComputedStyle(q('#journal')).display, total: t('journal-total'), quote: t('journal-quote'), flavor: t('journal-flavor') },
    btnJournal: { rect: rect(q('#btn-journal')), hasReward: q('#btn-journal')?.classList.contains('has-reward') ?? null },
    hudOverflow: overflowIn(hud),
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    viewportMeta: meta('viewport'),
    themeColor: meta('theme-color'),
    appleCapable: meta('apple-mobile-web-app-capable'),
    manifestHref: q('link[rel="manifest"]')?.href ?? null,
    appleTouchHref: q('link[rel="apple-touch-icon"]')?.href ?? null,
    faviconHref: q('link[rel="icon"]')?.href ?? null,
    moyuFrames: window.__MOYU__?.frames ?? null,
    moyuFps: window.__MOYU__?.fps ?? null,
  };
})()`;

const JOURNAL_OPEN_EXPR = `(async () => {
  const q = (s) => document.querySelector(s);
  const t = (id) => (document.getElementById(id)?.textContent ?? '').trim();
  document.getElementById('btn-journal').click();
  await new Promise((r) => setTimeout(r, 550));
  const grid = q('#journal-grid');
  const items = [...document.querySelectorAll('#journal-grid .c-item')];
  const locked = items.filter((el) => el.classList.contains('off'));
  const on = items.filter((el) => el.classList.contains('on'));
  const gs = getComputedStyle(grid);
  const panel = q('.journal-panel');
  const panelRect = panel.getBoundingClientRect();
  const claim = q('#journal-claim');
  const pseudo = getComputedStyle(q('#btn-journal'), '::after');
  return {
    hiddenClass: q('#journal').classList.contains('hidden'),
    panelRect: { x: +panelRect.x.toFixed(1), y: +panelRect.y.toFixed(1), w: +panelRect.width.toFixed(1), h: +panelRect.height.toFixed(1), right: +panelRect.right.toFixed(1), bottom: +panelRect.bottom.toFixed(1) },
    panelWithinViewport: panelRect.right <= innerWidth + 0.5 && panelRect.left >= -0.5 && panelRect.bottom <= innerHeight + 0.5 && panelRect.top >= -0.5,
    panelScrollable: panel.scrollHeight > panel.clientHeight + 1,
    panelOverflowY: getComputedStyle(panel).overflowY,
    date: t('journal-date'),
    streakText: t('journal-streak'),
    goals: [...document.querySelectorAll('#journal-goals li')].map((li) => ({ cls: li.className, text: li.textContent.trim() })),
    claim: { text: claim.textContent.trim(), disabled: claim.disabled },
    counters: { quote: t('journal-quote'), flavor: t('journal-flavor'), total: t('journal-total') },
    latest: t('journal-latest'),
    grid: {
      items: items.length, on: on.length, off: locked.length,
      lockedAllQuestionLabel: locked.every((el) => el.querySelector('.c-label')?.textContent === '???'),
      lockedLabels: [...new Set(locked.map((el) => el.querySelector('.c-label')?.textContent))].slice(0, 5),
      lockedTexts: [...new Set(locked.map((el) => el.querySelector('.c-text')?.textContent))].slice(0, 5),
      onLabels: on.slice(0, 3).map((el) => ({ label: el.querySelector('.c-label')?.textContent, text: el.querySelector('.c-text')?.textContent })),
      columns: gs.gridTemplateColumns.split(' ').length,
      scrollHeight: grid.scrollHeight, clientHeight: grid.clientHeight,
      scrollable: grid.scrollHeight > grid.clientHeight + 1,
    },
    btnAfter: { content: pseudo.content, width: pseudo.width, height: pseudo.height, background: pseudo.backgroundColor },
    hudStreak: { text: t('hud-streak'), hidden: q('#hud-streak').classList.contains('hidden') },
  };
})()`;

async function screenshot(cdp, path) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(path, Buffer.from(r.data, "base64"));
  return path;
}

const results = { label: LABEL, base: BASE, startedAt: new Date().toISOString(), checks: {}, errors: [] };

async function baselineRun() {
  const inst = await launch(`/tmp/chrome-final-collect-${LABEL}-base`);
  const { cdp } = inst;
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    await goto(cdp, BASE);
    const mobile = await evalJs(cdp, MOBILE_EXPR);
    const journal = await evalJs(cdp, JOURNAL_OPEN_EXPR);
    const shot = await screenshot(cdp, `${OUT_DIR}/${LABEL}-journal-390.png`);
    // 关闭图鉴
    await evalJs(cdp, `document.getElementById('journal-close').click(), 'closed'`);
    await sleep(200);
    const closed = await evalJs(cdp, `({ hidden: document.getElementById('journal').classList.contains('hidden'), display: getComputedStyle(document.getElementById('journal')).display })`);
    results.checks[`${LABEL}:baseline`] = { mobile, journal, closed, screenshot: shot };
    // manifest / icon 资源可达性（页面上下文 fetch，同源相对路径）
    const assets = await evalJs(
      cdp,
      `(async () => {
        const out = {};
        const get = async (u) => { try { const r = await fetch(u, { cache: 'no-cache' }); return { url: u, status: r.status, type: r.headers.get('content-type') }; } catch (e) { return { url: u, error: String(e) }; } };
        const manifestHref = document.querySelector('link[rel="manifest"]')?.href;
        out.manifest = await get(manifestHref);
        if (out.manifest?.status === 200) { const j = await (await fetch(manifestHref, { cache: 'no-cache' })).json(); out.manifestJson = { name: j.name, short_name: j.short_name, display: j.display, orientation: j.orientation, start_url: j.start_url, scope: j.scope, theme_color: j.theme_color, background_color: j.background_color, icons: j.icons }; }
        out.appleTouch = await get(document.querySelector('link[rel="apple-touch-icon"]')?.href);
        out.favicon = await get(document.querySelector('link[rel="icon"]')?.href);
        const iconOk = await new Promise((res) => { const img = new Image(); img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res({ error: true }); img.src = document.querySelector('link[rel="apple-touch-icon"]')?.href; });
        out.appleTouchImage = iconOk;
        return out;
      })()`,
    );
    results.checks[`${LABEL}:assets`] = assets;
  } finally {
    results.errors.push(...cdp.consoleErrors);
    await stop(inst);
  }
}

async function seededRun() {
  const inst = await launch(`/tmp/chrome-final-collect-${LABEL}-seed`);
  const { cdp } = inst;
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    // 在文档创建前注入「部分图鉴 + 3/3 日报 + 连胜 3」存档，避免 pagehide 覆盖
    const seedSource = `(() => { try {
      const today = new Date().toLocaleDateString('sv-SE');
      const y = new Date(); y.setDate(y.getDate() - 1);
      const yesterday = y.toLocaleDateString('sv-SE');
      const blob = {
        v: 1, moyu: 100, totalEarned: 100, levels: { coffee: 1 },
        savedAt: Date.now(), createdAt: Date.now(),
        collected: { quotes: [0, 1], flavors: [0] },
        daily: {
          date: today,
          goals: [
            { id: 'click_100', target: 100, progress: 100, done: true },
            { id: 'meme_1', target: 1, progress: 1, done: true },
            { id: 'buy_3', target: 3, progress: 3, done: true }
          ],
          streak: 1, lastCompleteDate: yesterday, claimed: false
        },
        surviveStreak: 3
      };
      localStorage.setItem('moyu-save', JSON.stringify(blob));
    } catch (e) {} })();`;
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: seedSource });
    await cdp.send("Page.navigate", { url: BASE });
    await waitReady(cdp, 15000);
    await sleep(900);
    const seeded = await evalJs(cdp, `({ today: new Date().toLocaleDateString('sv-SE'), saved: JSON.parse(localStorage.getItem('moyu-save') || 'null') })`);
    const before = await evalJs(cdp, MOBILE_EXPR);
    const opened = await evalJs(cdp, JOURNAL_OPEN_EXPR);
    const shotOpen = await screenshot(cdp, `${OUT_DIR}/${LABEL}-seeded-journal-390.png`);
    // 点领取
    const claimed = await evalJs(
      cdp,
      `(async () => {
        const q = (s) => document.querySelector(s);
        const t = (id) => (document.getElementById(id)?.textContent ?? '').trim();
        q('#journal-claim').click();
        await new Promise((r) => setTimeout(r, 700));
        const saved = JSON.parse(localStorage.getItem('moyu-save') || 'null');
        return {
          hudMoyu: t('hud-moyu'),
          claimText: q('#journal-claim').textContent.trim(),
          claimDisabled: q('#journal-claim').disabled,
          journalStreak: t('journal-streak'),
          hudStreak: { text: t('hud-streak'), hidden: q('#hud-streak').classList.contains('hidden') },
          surviveStreak: window.__MOYU__.state.surviveStreak,
          daily: window.__MOYU__.state.daily,
          savedDaily: saved?.daily ?? null,
          savedMoyu: saved?.moyu ?? null,
          hasRewardAfterClaim: q('#btn-journal').classList.contains('has-reward'),
        };
      })()`,
    );
    const shotClaimed = await screenshot(cdp, `${OUT_DIR}/${LABEL}-seeded-claimed-390.png`);
    results.checks[`${LABEL}:seeded`] = { seededDate: seeded, before, opened, claimed, screenshots: [shotOpen, shotClaimed] };
  } finally {
    results.errors.push(...cdp.consoleErrors);
    await stop(inst);
  }
}

async function lateRun() {
  const inst = await launch(`/tmp/chrome-final-collect-${LABEL}-late`);
  const { cdp } = inst;
  try {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
    // 大后期存档：最长段位名 + 连胜，检验 390 宽度 HUD 是否溢出/裁切
    const source = `(() => { try {
      const today = new Date().toLocaleDateString('sv-SE');
      const blob = { v: 1, moyu: 5e8, totalEarned: 5e8, levels: { retire: 50, deep: 30, meeting: 20, group: 15, toilet: 10, phone: 8, chair: 5, water: 5, coffee: 5 }, savedAt: Date.now(), createdAt: Date.now(), collected: { quotes: [], flavors: [] }, daily: { date: today, goals: [{ id: 'click_100', target: 100, progress: 0, done: false }, { id: 'meme_1', target: 1, progress: 0, done: false }, { id: 'buy_3', target: 3, progress: 0, done: false }], streak: 6, lastCompleteDate: null, claimed: false }, surviveStreak: 7 };
      localStorage.setItem('moyu-save', JSON.stringify(blob));
    } catch (e) {} })();`;
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source });
    await cdp.send("Page.navigate", { url: BASE });
    await waitReady(cdp, 15000);
    await sleep(500);
    const m = await evalJs(cdp, MOBILE_EXPR);
    const shot = await screenshot(cdp, `${OUT_DIR}/${LABEL}-late-hud-390.png`);
    results.checks[`${LABEL}:late`] = { mobile: m, screenshot: shot };
  } finally {
    results.errors.push(...cdp.consoleErrors);
    await stop(inst);
  }
}

async function smallRun() {
  const inst = await launch(`/tmp/chrome-final-collect-${LABEL}-small`);
  const { cdp } = inst;
  try {
    // 规格要求：375×667 竖屏可玩、无横向滚动（specs.md「手机适配」）
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: true, screenWidth: 375, screenHeight: 667 });
    await cdp.send("Page.navigate", { url: BASE });
    await waitReady(cdp, 15000);
    await sleep(500);
    const m = await evalJs(cdp, MOBILE_EXPR);
    const opened = await evalJs(cdp, JOURNAL_OPEN_EXPR);
    const shot = await screenshot(cdp, `${OUT_DIR}/${LABEL}-journal-375x667.png`);
    results.checks[`${LABEL}:375x667`] = { mobile: m, opened, screenshot: shot };
  } finally {
    results.errors.push(...cdp.consoleErrors);
    await stop(inst);
  }
}

try {
  await baselineRun();
  await seededRun();
  await lateRun();
  await smallRun();
} catch (e) {
  results.errors.push(`RUN_FAILED: ${e?.stack ?? e}`);
  console.error("RUN_FAILED", e);
  process.exitCode = 1;
}
writeFileSync(`${OUT_DIR}/${LABEL}-result.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
