/**
 * R10 回归老玩家 live 探针（只读 src/，不改任何游戏文件）：
 * 注入「3 天活跃后停 30 天」的存档 → 重新加载 → 记录欢迎面板 / 首屏 / 日报 / 存档被清后的表现。
 * 输出 playtest/r10-returner-live.json + 截图到 playtest/r10-screens/。
 */
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9591;
const W = 390;
const H = 844;
const DAY_MS = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("playtest/r10-screens", { recursive: true });

const evidence = JSON.parse(readFileSync("playtest/r10-returner-evidence.json", "utf8"));
const seedState = evidence.seedSave;

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
    `--user-data-dir=/tmp/chrome-r10-returner-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitJson(url, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch {}
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
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
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};
const evJson = async (expr) => JSON.parse(await ev(`JSON.stringify(${expr})`));
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`playtest/r10-screens/${name}.png`, Buffer.from(r.data, "base64"));
};
const tap = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
  await sleep(55);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2600);

const out = { generatedAt: new Date().toISOString(), head: "999b0f4", seed: { day3End: evidence.day3End, returnAt: evidence.returnAt }, steps: {} };

// 等 dev server 的 hot module 就绪
out.bootState = await evJson("window.__MOYU__ && __MOYU__.state ? __MOYU__.state : null");
const initialSaveExists = await ev("localStorage.getItem('moyu-save') !== null");

// ---------- 1) 注入「3 天活跃 + 停 30 天」的存档，rewindSave 抑制覆盖，重新加载 ----------
const nowMs = Date.now();
const blob = {
  ...seedState,
  createdAt: nowMs - 33 * DAY_MS,
  savedAt: nowMs - 30 * DAY_MS,
  visits: { date: new Date(nowMs - 30 * DAY_MS).toLocaleDateString("sv-SE"), count: 3 },
  daily: { ...seedState.daily, date: new Date(nowMs - 30 * DAY_MS).toLocaleDateString("sv-SE"), lastCompleteDate: new Date(nowMs - 30 * DAY_MS).toLocaleDateString("sv-SE") },
};
await ev(`localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))}); __MOYU__.rewindSave(${30 * 86400}); "seeded"`);
out.steps.seed = { savedAt: await ev("__MOYU__.savedAt"), blobKeys: Object.keys(blob), seedIdleRate: evidence.d3.idleRate, seedMoyu: evidence.d3.moyu, seedRank: evidence.d3.rankName, seedCollection: evidence.d3.collection, seedLifetime: evidence.d3.lifetimeEarned, expectedEarned: evidence.reopen.earned, expectedRate: evidence.reopen.rate };

await send("Page.reload", { ignoreCache: true });
await sleep(3000);

// ---------- 2) 欢迎面板 ----------
out.welcome = await evJson(`(() => {
  const w = document.getElementById('welcome');
  const visible = !w.classList.contains('hidden');
  return {
    visible,
    time: document.getElementById('welcome-time').textContent,
    gain: document.getElementById('welcome-gain').textContent,
    rule: document.getElementById('welcome-rule').textContent,
    title: w.querySelector('h2').textContent,
    okText: document.getElementById('welcome-ok').textContent,
    anyOtherOverlay: !document.getElementById('journal').classList.contains('hidden'),
  };
})()`);
out.afterBootState = await evJson("__MOYU__.state");
out.realRateCheck = {
  idleRate: out.afterBootState ? null : null,
};

await shot("r10-welcome-30d");

// 欢迎面板本身是否可点、点完是否只剩正常首屏
await tap(W / 2, H / 2); // 兜底：先点面板外（应无效）
out.steps.tapOutsideWelcome = await evJson(`({welcomeStillVisible: !document.getElementById('welcome').classList.contains('hidden')})`);
const okRect = await evJson(`(()=>{const r=document.getElementById('welcome-ok').getBoundingClientRect();return {cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
await tap(okRect.cx, okRect.cy);
await sleep(500);
out.afterWelcomeOk = await evJson(`({
  welcomeHidden: document.getElementById('welcome').classList.contains('hidden'),
  journalHidden: document.getElementById('journal').classList.contains('hidden'),
  journalBadge: document.getElementById('btn-journal').classList.contains('has-reward'),
  questHidden: document.getElementById('quest').classList.contains('hidden'),
  questText: document.getElementById('quest-text').textContent,
  hudRank: document.getElementById('hud-rank').textContent,
  hudMoyu: document.getElementById('hud-moyu').textContent,
  hudIdle: document.getElementById('hud-idle').textContent,
  hudStreak: {text: document.getElementById('hud-streak').textContent, hidden: document.getElementById('hud-streak').classList.contains('hidden')},
  hudCombo: {text: document.getElementById('hud-combo').textContent, hidden: document.getElementById('hud-combo').classList.contains('hidden')},
  shopCards: document.querySelectorAll('.shop-card').length,
  shopUnlockedAnim: document.querySelectorAll('.shop-card.just-unlocked').length,
  shopConfirming: document.querySelectorAll('.shop-card.confirming').length,
  toastText: [...document.querySelectorAll('body *')].filter(e=>e.className==='toast').map(e=>e.textContent).slice(0,3),
  visibleButtons: [...document.querySelectorAll('button')].filter(b=>{const r=b.getBoundingClientRect();const st=getComputedStyle(b);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden'&&b.offsetParent!==null;}).length,
})`);
out.firstScreenText = await evJson(`(() => {
  const g = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim().replace(/\\s+/g,' ').slice(0,120) : null; };
  return { hud: g('#hud'), shopHint: g('#shop-hint'), welcome: g('#welcome') };
})()`);
await shot("r10-firstscreen-30d");

// ---------- 3) 打开 📔 日报：目标 / streak / 回访 ----------
const jrect = await evJson(`(()=>{const r=document.getElementById('btn-journal').getBoundingClientRect();return {cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
await tap(jrect.cx, jrect.cy);
await sleep(500);
out.journal = await evJson(`(() => {
  const goals = [...document.querySelectorAll('#journal-goals .goal')].map(li => li.textContent.trim().replace(/\\s+/g,' '));
  return {
    open: !document.getElementById('journal').classList.contains('hidden'),
    date: document.getElementById('journal-date').textContent,
    streak: document.getElementById('journal-streak').textContent,
    goals,
    claimText: document.getElementById('journal-claim').textContent,
    claimDisabled: document.getElementById('journal-claim').disabled,
    stats: [...document.querySelectorAll('#stats-list .stat-row')].map(r=>r.textContent.trim().replace(/\\s+/g,' ')),
    prestigeBtn: document.getElementById('prestige-btn').textContent,
    savecode: document.getElementById('savecode').value ? '已有' : '空',
  };
})()`);
out.dailyBefore = await evJson("__MOYU__.state.daily");
await shot("r10-journal-30d");

// 关面板，戳 30 下 + 等 6 秒，看「今天上线看一眼 / 等摸鱼值自己涨」是否推进
const closeRect = await evJson(`(()=>{const r=document.getElementById('journal-close').getBoundingClientRect();return {cx:r.x+r.width/2,cy:r.y+r.height/2};})()`);
await tap(closeRect.cx, closeRect.cy);
await sleep(300);
for (let i = 0; i < 30; i++) {
  await tap(W / 2 - 60 + (i % 6) * 24, H * 0.45 + (i % 3) * 18);
  await sleep(70);
}
await sleep(6000);
out.dailyAfterTaps = await evJson("__MOYU__.state.daily");
out.dailyKindCheck = (() => {
  const before = out.dailyBefore;
  const after = out.dailyAfterTaps;
  const kinds = { visit_1: "visit", idle_earn: "idle", click_100: "click", buy_3: "buy", meme_1: "meme", survive_2: "survive" };
  return before.goals.map((g) => {
    const a = after.goals.find((x) => x.id === g.id);
    return { id: g.id, kind: kinds[g.id], before: g.progress, after: a ? a.progress : null, done: g.done };
  });
})();
await shot("r10-after-taps");

// ---------- 4) 模拟存档被 Safari/清缓存清掉：清档并重载（reset() 清存档+内存，等效 ITP 清档后的冷启动） ----------
await ev(`__MOYU__.reset(); localStorage.removeItem('moyu-save'); "cleared"`);
await send("Page.reload", { ignoreCache: true });
await sleep(2600);
out.afterCleared = await evJson(`(() => {
  const s = __MOYU__.state;
  return {
    welcomeVisible: !document.getElementById('welcome').classList.contains('hidden'),
    hasSave: localStorage.getItem('moyu-save') !== null,
    stateLoaded: s ? { totalEarned: s.totalEarned, lifetimeEarned: s.lifetimeEarned, rank: document.getElementById('hud-rank').textContent, moyu: s.moyu } : null,
    anyLossNotice: [...document.querySelectorAll('body *')].some(e => /存档|丢失|恢复|备份/.test(e.textContent || '') && ['DIV','P','SPAN','BUTTON'].includes(e.tagName) && e.offsetParent !== null && e.id !== 'savecode-msg'),
    bodyText: document.body.innerText.replace(/\\s+/g,' ').slice(0, 220),
  };
})()`);
await shot("r10-save-cleared-fresh");

out.devServer = "http://127.0.0.1:5173/";
out.initialSaveExists = initialSaveExists;
writeFileSync("playtest/r10-returner-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGTERM");
ws.close();
process.exit(0);
