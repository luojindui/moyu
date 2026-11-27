/** R8 竞速探针：验证生产构建里 __MOYU__.rewindSave 是否能把离线时间戳回拨 → 刷新后白拿 8h 离线收益。只做只读验证，不改 src/ */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9581;
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
    `--user-data-dir=/tmp/chrome-r8-speed-${Date.now()}`,
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
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
  return r.result.value;
};
const state = () => ev("JSON.stringify(__MOYU__.state)").then(JSON.parse);
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2000);
const before = await state();
const saveBefore = await ev("JSON.parse(localStorage.getItem('moyu-save')||'null')");
const hookType = await ev("typeof window.__MOYU__?.rewindSave");
const savedAtBefore = saveBefore ? saveBefore.savedAt : null;
await ev("__MOYU__.saveNow(); __MOYU__.rewindSave(28800);");
const saveAfter = await ev("JSON.parse(localStorage.getItem('moyu-save')||'null')");
const rewindMs = saveAfter && savedAtBefore ? savedAtBefore - saveAfter.savedAt : null;
await send("Page.reload");
await sleep(2500);
const after = await state();
const welcomeShown = await ev("(()=>{const w=document.getElementById('welcome');return w? !w.classList.contains('hidden') : null;})()");
const idleRate = before.levels && (before.levels.phone || 0) > 0 ? null : 0.2;
const out = {
  url: "http://127.0.0.1:5173/",
  hookType,
  savedAtBefore,
  savedAtAfter: saveAfter ? saveAfter.savedAt : null,
  rewoundSeconds: rewindMs === null ? null : rewindMs / 1000,
  moyuBefore: before.moyu,
  moyuAfter: after.moyu,
  gainFromReload: after.moyu - before.moyu,
  expected8hAtBaseIdle: 0.2 * 28800,
  lifetimeBefore: before.lifetimeEarned,
  lifetimeAfter: after.lifetimeEarned,
  welcomePanelShown: welcomeShown,
  note: "首日离线效率 1.0；每次回拨+刷新即 +8h 挂机收益，可无限循环（8h/次）",
};
writeFileSync("playtest/r8-speedrun-rewind.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
ws.close();
proc.kill("SIGKILL");
