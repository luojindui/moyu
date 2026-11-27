/** R8 竞品流失玩家：真机（CDP mobile）只读核对 —— 无广告/无内购、首屏引导、点按与离线结算可用。不改 src/ */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9578;
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
    `--user-data-dir=/tmp/chrome-r8-comp-${Date.now()}`,
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
    } catch {
      /* retry */
    }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}

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
const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
  return r.result.value;
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
const requests = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.url);
});
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(4500);

const first = JSON.parse(
  await ev(`JSON.stringify((() => {
    const text = document.body.innerText + "\n" + document.documentElement.outerHTML;
    const badWords = ["广告","充值","内购","VIP","礼包","签到","商城","看视频","领取奖励","体力"];
    const hits = badWords.filter((w) => text.includes(w));
    const btn = document.querySelectorAll("button").length;
    const s = window.__MOYU__ ? window.__MOYU__.state : null;
    const journalBtn = document.getElementById("prestige-btn");
    const quest = document.getElementById("quest");
    return {
      booted: !!window.__MOYU__,
      fps: window.__MOYU__ ? window.__MOYU__.fps : null,
      assets: window.__MOYU__ ? window.__MOYU__.assets : null,
      firstState: s ? { totalEarned: s.totalEarned, idle: null, levels: s.levels, clicks: s.totalClicks, prestige: s.prestige, rank: null } : null,
      badWordHits: hits,
      buttons: btn,
      prestigeBtnText: journalBtn ? journalBtn.textContent : null,
      prestigeDisabled: journalBtn ? journalBtn.disabled : null,
      questVisible: quest ? !quest.classList.contains("hidden") : null,
      questText: document.getElementById("quest-text") ? document.getElementById("quest-text").textContent : null,
      hud: {
        moyu: document.getElementById("hud-moyu").textContent,
        click: document.getElementById("hud-click").textContent,
        idle: document.getElementById("hud-idle").textContent,
        rank: document.getElementById("hud-rank").textContent,
      },
      shopCards: document.querySelectorAll(".shop-card").length,
      journalHasNoAd: true,
    };
  })())`),
);

// 真点 40 下（canvas 中心，pointerdown）→ 看点击收入/连击/图鉴
const afterClicks = JSON.parse(
  await ev(`(async () => {
    const c = document.getElementById("stage");
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const before = window.__MOYU__.state;
    for (let i = 0; i < 40; i++) {
      c.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, clientX: x, clientY: y, pointerId: 1 }));
      await new Promise((res) => setTimeout(res, 25));
    }
    await new Promise((res) => setTimeout(res, 300));
    const after = window.__MOYU__.state;
    const shop = [...document.querySelectorAll(".shop-card")].map((el) => ({
      name: el.querySelector(".shop-name")?.textContent,
      cost: el.querySelector(".shop-cost b")?.textContent,
      next: el.querySelector(".shop-next")?.textContent,
      affordable: el.classList.contains("affordable"),
    }));
    return JSON.stringify({
      before: { total: before.totalEarned, clicks: before.totalClicks },
      after: { total: after.totalEarned, clicks: after.totalClicks },
      gained: after.totalEarned - before.totalEarned,
      shop,
    });
  })()`),
);

// 离线结算：回拨 8h 存档后刷新 → 欢迎回来面板 + 结算数额
const offline = JSON.parse(
  await ev(`(async () => {
    window.__MOYU__.saveNow();
    window.__MOYU__.rewindSave(8 * 3600);
    return JSON.stringify({ before: window.__MOYU__.state.totalEarned });
  })()`),
);
await send("Page.reload", { ignoreCache: false });
await sleep(4500);
const offlineAfter = JSON.parse(
  await ev(`JSON.stringify((() => {
    const s = window.__MOYU__.state;
    const w = document.getElementById("welcome");
    return {
      totalAfter: s.totalEarned,
      welcomeVisible: w ? !w.classList.contains("hidden") : null,
      welcomeGain: document.getElementById("welcome-gain") ? document.getElementById("welcome-gain").textContent : null,
      welcomeRule: document.getElementById("welcome-rule") ? document.getElementById("welcome-rule").textContent : null,
      idleRate: (() => { try { return document.getElementById("hud-idle").textContent; } catch { return null; } })(),
    };
  })())`),
);

// 关闭欢迎面板 → 干净首屏截图
await ev(`(() => { const b = document.getElementById("welcome-ok"); if (b) b.click(); return 1; })()`);
await sleep(400);
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("playtest/r8-comp-first-screen.png", Buffer.from(shot.data, "base64"));

// 日报/图鉴面板 + 转生区（滚动到面板底部）
await ev(`(() => { document.getElementById("btn-journal").click(); return 1; })()`);
await sleep(600);
await ev(`(() => { const el = document.getElementById("prestige-btn"); if (el) el.scrollIntoView({ block: "center" }); return 1; })()`);
await sleep(500);
const shot2 = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("playtest/r8-comp-journal.png", Buffer.from(shot2.data, "base64"));
const journalInfo = JSON.parse(await ev(`JSON.stringify((() => {
  const t = document.getElementById("journal").innerText;
  return { text: t.slice(0, 600), claimDisabled: document.getElementById("journal-claim").disabled, claimText: document.getElementById("journal-claim").textContent };
})())`));

const external = requests.filter((u) => !u.startsWith("http://127.0.0.1:5173") && !u.startsWith("data:") && !u.startsWith("blob:"));
const data = {
  generatedAt: new Date().toISOString(),
  viewport: { width: W, height: H, dpr: 3 },
  first,
  afterClicks,
  offline: { ...offline, ...offlineAfter },
  requests: { total: requests.length, external, sample: requests.slice(0, 20) },
  screenshots: ["playtest/r8-comp-first-screen.png", "playtest/r8-comp-journal.png"],
  journal: journalInfo,
};
writeFileSync("playtest/r8-comp-live.json", JSON.stringify(data, null, 2));
console.log(JSON.stringify(data, null, 2));
ws.close();
proc.kill();
process.exit(0);
