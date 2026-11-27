/**
 * R9 数据控真机探针（CDP mobile，只读 src，不改 src）
 * 核对：__MOYU__ 暴露字段 / 存档字段 / 离线结算明细 / 转生账本 / 转生门槛文案 / 篡改存档 / 是否存在统计或导出 UI
 * 运行：node playtest/probe-r9-data-live.mjs
 * 输出：playtest/r9-data-live.json + r9-data-*.png
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9591;
const URL = "http://127.0.0.1:5173/";
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
    "--disable-background-timer-throttling",
    `--user-data-dir=/tmp/chrome-r9-data-${Date.now()}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

async function waitJson(url, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch {
      /* retry */
    }
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
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
};
const shot = async (path) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path, Buffer.from(r.data, "base64"));
};

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

async function waitHook(tries = 160) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await ev("!!(window.__MOYU__ && window.__MOYU__.state)")) return true;
    } catch {
      /* context 变更 */
    }
    await sleep(100);
  }
  throw new Error("__MOYU__ not ready");
}

// 注入存档必须在「新文档执行任何页面脚本之前」写 localStorage（旧页 pagehide 会 saveNow 覆盖注入值）
let preDocId = null;
const BASE_BLOB = {
  v: 1, moyu: 0, totalEarned: 0, levels: {}, savedAt: 0, createdAt: 0,
  collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0,
  totalClicks: 0, visits: { date: "", count: 0 }, lifetimeEarned: 0, prestige: 0,
};
const injectSave = async (patch) => {
  const { agoSeconds = 0, ...blobPatch } = patch;
  const source = `(() => { try {
    const now = Date.now();
    const base = ${JSON.stringify(BASE_BLOB)};
    Object.assign(base, ${JSON.stringify(blobPatch)});
    base.savedAt = now - ${agoSeconds} * 1000;
    if (!base.createdAt) base.createdAt = now;
    localStorage.setItem("moyu-save", JSON.stringify(base));
  } catch (e) { window.__INJECT_ERROR = String(e); } })();`;
  if (preDocId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: preDocId });
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source });
  preDocId = r.identifier;
};

const reload = async () => {
  await send("Page.reload", { ignoreCache: true });
  await waitHook();
  await sleep(1200);
};

const evidence = { startedAt: new Date().toISOString(), step2_offline: {}, step3_cap: {}, step4_prestige: {}, step5_tamper: {}, inventory: {} };

// 1) 首屏盘点：暴露字段 / 存档字段 / 统计&导出 UI 是否存在 / 图表数量
await send("Page.navigate", { url: URL });
await waitHook();
await ev("window.__MOYU__.reset(); window.__MOYU__.saveNow();");
await sleep(600);
evidence.inventory = JSON.parse(
  await ev(`JSON.stringify((() => {
    const s = window.__MOYU__.state;
    const save = JSON.parse(localStorage.getItem("moyu-save") || "{}");
    const body = document.body.innerText;
    return {
      devHookFields: Object.keys(window.__MOYU__),
      stateKeys: Object.keys(s),
      saveBlobKeys: Object.keys(save),
      hud: {
        moyu: document.getElementById("hud-moyu").textContent,
        click: document.getElementById("hud-click").textContent,
        idle: document.getElementById("hud-idle").textContent,
        rank: document.getElementById("hud-rank").textContent,
        rankTitle: document.getElementById("hud-rank").getAttribute("title"),
        streakHidden: document.getElementById("hud-streak").classList.contains("hidden"),
        streakText: document.getElementById("hud-streak").textContent,
      },
      ui: {
        canvases: document.querySelectorAll("canvas").length,
        svgs: document.querySelectorAll("svg").length,
        statsPanel: !!document.querySelector("#stats,#weekly,#export,[data-panel=stats]"),
        hasStatWords: /统计|周报|导出|分享|趋势|曲线|历史累计|生涯/.test(body),
        downloadLinks: [...document.querySelectorAll("a[download]")].length,
        shareButtons: [...document.querySelectorAll("button")].filter((b) => /分享|导出|截图/.test(b.textContent)).length,
      },
      whatIsRecordedButHidden: {
        lifetimeEarned_raw: s.lifetimeEarned,
        totalEarned_raw: s.totalEarned,
        totalClicks: s.totalClicks,
        visits: s.visits,
        createdAtInSave: save.createdAt,
        savedAtInSave: save.savedAt,
        prestige: s.prestige,
      },
    };
  })())`),
);

// 2) 离线 2h（首日全额，rate=1）：验证两本账同步 + 明细不落档
await injectSave({ levels: { phone: 10 }, agoSeconds: 7200 });
await reload();
evidence.step2_offline = JSON.parse(
  await ev(`JSON.stringify((() => {
    const s = window.__MOYU__.state;
    const w = document.getElementById("welcome");
    return {
      welcomeVisible: !w.classList.contains("hidden"),
      welcomeTime: document.getElementById("welcome-time").textContent,
      welcomeGain: document.getElementById("welcome-gain").textContent,
      welcomeRule: document.getElementById("welcome-rule").textContent,
      state: { totalEarned: s.totalEarned, lifetimeEarned: s.lifetimeEarned, moyu: s.moyu, visits: s.visits },
      diff_lifetime_minus_total: s.lifetimeEarned - s.totalEarned,
      stateKeys: Object.keys(s),
      hasOfflineHistory: Object.keys(s).some((k) => /offline|history|session|lastSeen/i.test(k)),
    };
  })())`),
);
await shot("playtest/r9-data-welcome-offline.png");
await ev(`document.getElementById("welcome-ok").click()`);

// 3) 离线 20h（建档 3 天前 → 效率 0.8，8h 封顶）：验证 appied 与实际离开时长不一致（面板把 20h 说成 8h）
await injectSave({ levels: { phone: 10 }, createdAt: Date.now() - 3 * 86400_000, agoSeconds: 20 * 3600 });
await reload();
evidence.step3_cap = JSON.parse(
  await ev(`JSON.stringify((() => {
    const s = window.__MOYU__.state;
    const w = document.getElementById("welcome");
    return {
      welcomeVisible: !w.classList.contains("hidden"),
      welcomeTime: document.getElementById("welcome-time").textContent,
      welcomeGain: document.getElementById("welcome-gain").textContent,
      welcomeRule: document.getElementById("welcome-rule").textContent,
      actualAbsenceHours: 20,
      appliedHoursShown: 8,
      state: { totalEarned: s.totalEarned, lifetimeEarned: s.lifetimeEarned, visits: s.visits },
      diff_lifetime_minus_total: s.lifetimeEarned - s.totalEarned,
    };
  })())`),
);
await ev(`document.getElementById("welcome-ok").click()`);

// 4) 转生：注入本局 1e8 可转生档；转生后读 HUD/日报文案/存档（段位双口径 + 硬编码 1 亿门槛）
await injectSave({ moyu: 1e6, totalEarned: 1e8, lifetimeEarned: 1e8, levels: { phone: 10 }, createdAt: Date.now() - 3 * 86400_000 });
await reload();
const before = JSON.parse(
  await ev(`JSON.stringify((() => ({
    hudRank: document.getElementById("hud-rank").textContent,
    hudRankTitle: document.getElementById("hud-rank").getAttribute("title"),
    prestigeBtn: document.getElementById("prestige-btn").textContent,
    prestigeDisabled: document.getElementById("prestige-btn").disabled,
    state: { totalEarned: window.__MOYU__.state.totalEarned, lifetimeEarned: window.__MOYU__.state.lifetimeEarned, prestige: window.__MOYU__.state.prestige },
  }))())`),
);
await ev(`document.getElementById("btn-journal").click()`);
await sleep(700);
await shot("playtest/r9-data-journal-before-prestige.png");
await ev(`document.getElementById("prestige-btn").click()`);
await sleep(900);
const after = JSON.parse(
  await ev(`JSON.stringify((() => {
    const s = window.__MOYU__.state;
    const save = JSON.parse(localStorage.getItem("moyu-save") || "{}");
    return {
      hudRank: document.getElementById("hud-rank").textContent,
      hudRankTitle: document.getElementById("hud-rank").getAttribute("title"),
      prestigeBtn: document.getElementById("prestige-btn").textContent,
      prestigeDisabled: document.getElementById("prestige-btn").disabled,
      prestigeInfo: document.getElementById("prestige-info").textContent,
      staticDesc: document.querySelector(".prestige-desc").textContent,
      state: { totalEarned: s.totalEarned, lifetimeEarned: s.lifetimeEarned, prestige: s.prestige, levels: s.levels, surviveStreak: s.surviveStreak },
      savedBlob: { totalEarned: save.totalEarned, lifetimeEarned: save.lifetimeEarned, prestige: save.prestige },
      rankByLifetime: "带薪摸鱼传说",
      rankByTotalEarned: "摸鱼实习生",
    };
  })())`),
);
await shot("playtest/r9-data-journal-after-prestige.png");
evidence.step4_prestige = { before, after };

// 5) 篡改存档：余额 1e9 / 本局累计 0 是否被接受（跨字段不变量缺失）
await injectSave({ moyu: 1e9, totalEarned: 0, lifetimeEarned: 0 });
await reload();
evidence.step5_tamper = JSON.parse(
  await ev(`JSON.stringify((() => {
    const s = window.__MOYU__.state;
    return {
      accepted: { moyu: s.moyu, totalEarned: s.totalEarned, lifetimeEarned: s.lifetimeEarned },
      invariant_moyu_lte_total: s.moyu <= s.totalEarned,
      hudMoyu: document.getElementById("hud-moyu").textContent,
      hudRank: document.getElementById("hud-rank").textContent,
    };
  })())`),
);

evidence.finishedAt = new Date().toISOString();
writeFileSync("playtest/r9-data-live.json", JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
ws.close();
proc.kill("SIGKILL");
process.exit(0);
