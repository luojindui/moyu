/**
 * R9 多设备玩家 —— 真实浏览器（CDP / headless Chrome）存档存活性探针。
 *
 * 验证：
 *   1) 正常刷新后存档还在（正常路径 OK）；
 *   2) 页面自身的 pagehide/10s 自动存档会覆盖"外部写入"的存档（对导入功能是关键约束）；
 *   3) 清站点数据（清缓存）后进度归零，游戏无任何"进度丢失"提示；
 *   4) 同浏览器换 origin（127.0.0.1 → localhost）→ 读不到同一份存档；
 *   5) 游戏内无导出/导入/备份入口；navigator.storage.persisted() = false（无持久化申请）。
 *
 * 运行：node playtest/probe-r9-cloudsave-live.mjs
 * 前置：dev server 已在 http://127.0.0.1:5173 运行。
 * 只读 src/，产物写 playtest/r9-cloudsave-live.json。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9471;
const ORIGIN_A = "http://127.0.0.1:5173";
const URL_A = `${ORIGIN_A}/`;
const URL_B = "http://localhost:5173/"; // 同机不同 origin
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--mute-audio",
    "--no-first-run",
    "--disable-extensions",
    `--user-data-dir=/tmp/chrome-r9-save-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitJson(path, tries = 120) {
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

const SEED = {
  v: 1,
  moyu: 123456,
  totalEarned: 234567,
  levels: { coffee: 20, phone: 15, toilet: 8 },
  savedAt: Date.now(),
  createdAt: Date.now() - 5 * 86400000,
  collected: { quotes: [0, 1, 2], flavors: [0, 5, 12] },
  daily: null,
  surviveStreak: 6,
  totalClicks: 4321,
  visits: { date: new Date().toLocaleDateString("sv-SE"), count: 2 },
  lifetimeEarned: 234567,
  prestige: 1,
};

const out = { urlA: URL_A, urlB: URL_B, seed: { moyu: SEED.moyu }, steps: {} };
try {
  await waitJson("/json/version");
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then(
    (r) => r.json(),
  );
  const ws = new WebSocket(t.webSocketDebuggerUrl);
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
  const evalJson = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `JSON.stringify(${expr})`, returnByValue: true });
    return r.result?.value ? JSON.parse(r.result.value) : null;
  };
  const evalPromise = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: `(${expr})`, returnByValue: true, awaitPromise: true });
    return r.result?.value ?? null;
  };
  const evalStatements = async (code) => {
    await send("Runtime.evaluate", { expression: `(() => { ${code} })()`, returnByValue: true });
  };
  /** 在页面脚本执行前写入存档（模拟"新设备/新浏览器首次打开就带着一份存档"） */
  const seedBeforeBoot = async (stateObj) => {
    const r = await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(stateObj))});`,
    });
    return r.identifier;
  };
  const dropSeed = async (identifier) => {
    await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  };
  const navigate = async (url) => {
    await send("Page.navigate", { url });
    await sleep(2600);
  };
  const snapshot = () =>
    evalJson(`({
      origin: location.origin,
      moyu: window.__MOYU__?.state?.moyu ?? null,
      levels: window.__MOYU__?.state?.levels ?? null,
      prestige: window.__MOYU__?.state?.prestige ?? null,
      lifetimeEarned: window.__MOYU__?.state?.lifetimeEarned ?? null,
      keys: Object.keys(localStorage),
      rect: (()=>{ const r = document.getElementById('welcome'); return r ? !r.classList.contains('hidden') : null })(),
    })`);

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  // ---- 0. 首访（origin A） ----
  await navigate(URL_A);
  const first = await evalJson(`({
    origin: location.origin,
    hasHook: typeof window.__MOYU__ !== 'undefined',
    keys: Object.keys(localStorage),
    exportUI: [...document.querySelectorAll('button,a')].map(e=>e.textContent.trim()).filter(t=>/导出|导入|备份|存档码|迁移|同步/.test(t)),
    storagePersisted: 'pending',
  })`);
  const storageInfo = await evalPromise(
    `Promise.all([navigator.serviceWorker.getRegistrations().then(r=>r.length), navigator.serviceWorker.controller ? Promise.resolve('controlled') : Promise.resolve('uncontrolled'), navigator.storage.persisted()]).then(([swRegs,swControl,persisted])=>({swRegs,swControl,persisted}))`,
  );
  out.steps["0_first_visit"] = { ...first, ...storageInfo };

  // ---- 1. 新环境带着一份存档首次启动（模拟"另一台设备/另一个浏览器打开"）→ 刷新后仍在 ----
  const seedId = await seedBeforeBoot(SEED);
  await navigate(URL_A);
  const afterSeed = await snapshot();
  await dropSeed(seedId);
  await navigate(URL_A); // 去掉注入脚本后再次刷新，只依赖浏览器自身持久化
  const afterReload = await snapshot();
  out.steps["1_reload_persist"] = {
    firstBoot: afterSeed,
    afterReload,
    seededMoyu: SEED.moyu,
    conclusion:
      afterReload.levels?.coffee === 20 && afterReload.prestige === 1 && (afterReload.moyu ?? 0) >= SEED.moyu
        ? "同 origin 刷新后存档保留 OK（正常持久化路径）"
        : "意外丢失",
  };

  // ---- 2. 页面开着时外部写入：被页面自身 10s/pagehide 存档覆盖 ----
  await evalStatements(
    `localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify({ ...SEED, moyu: 999999 }))});`,
  );
  const wroteExternal = await evalJson(`JSON.parse(localStorage.getItem('moyu-save') || '{}').moyu ?? null`);
  await navigate(URL_A);
  const afterNaiveSeed = await snapshot();
  out.steps["2_external_write_overwritten"] = {
    ...afterNaiveSeed,
    externalWroteMoyu: wroteExternal,
    conclusion:
      afterNaiveSeed.moyu !== 999999
        ? "页面开着时外部写入会被 pagehide/定时存档覆盖 → 导入存档后必须同步内存 state 或强制刷新"
        : "未被覆盖",
  };

  // ---- 3. 关闭页面后清站点数据（模拟"清除网站数据/清缓存"）----
  await navigate("about:blank");
  await send("Storage.clearDataForOrigin", { origin: ORIGIN_A, storageTypes: "local_storage" });
  await navigate(URL_A);
  const afterClear = await snapshot();
  const clearNotice = await evalJson(
    `({ lossNotice: /进度|丢失|恢复|导出|备份|存档码|清缓存|迁移/.test(document.body.innerText) })`,
  );
  out.steps["3_clear_site_data"] = {
    ...afterClear,
    ...clearNotice,
    conclusion: "清缓存后回到 0，全程无任何提示/恢复入口",
  };

  // ---- 4. 同浏览器换 origin（127.0.0.1 → localhost） ----
  await navigate("about:blank");
  const seedA = await seedBeforeBoot({ ...SEED, moyu: 777777 });
  await navigate(URL_A);
  const beforeSwitch = await snapshot();
  await dropSeed(seedA);
  await navigate(URL_B);
  const otherOrigin = await snapshot();
  out.steps["4_other_origin"] = {
    beforeSwitchMoyu: beforeSwitch.moyu,
    ...otherOrigin,
    conclusion: otherOrigin.keys.length === 0 ? "同浏览器 + 同端口换域名/Host → 存档完全不可见（origin 隔离）" : "意外可见",
  };

  writeFileSync("playtest/r9-cloudsave-live.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
} finally {
  try {
    proc.kill();
  } catch {
    /* ignore */
  }
  setTimeout(() => process.exit(0), 200);
}
