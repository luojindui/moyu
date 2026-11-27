/**
 * R9 探针 4：单独确认老板巡逻横幅（老人最关键的 8 秒警示）真实字号/文案/停留 + 截图
 * 只读，不改 src/
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9584;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("playtest/r9-screens", { recursive: true });
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r9d-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(`playtest/r9-screens/${name}.png`, Buffer.from(r.data, "base64")); };
const SCRIPT = `
(() => {
  const P = window.__r9b = { fill: [] };
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y) {
    try { const s = String(t); const last = P.fill[P.fill.length - 1];
      if (!last || last.text !== s) P.fill.push({ ts: Math.round(performance.now()), font: this.font, fill: String(this.fillStyle), text: s.slice(0, 80), x: Math.round(x), y: Math.round(y) });
      if (P.fill.length > 800) P.fill.splice(0, 400);
    } catch (e) {}
    return orig.apply(this, arguments);
  };
})();`;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2000);
const out = { samples: [], found: [], shots: [] };
let lastFps = 0;
for (let i = 0; i < 90; i++) {
  await sleep(2000);
  const info = JSON.parse(await ev("JSON.stringify({fps:__MOYU__.fps,frames:__MOYU__.frames,vis:document.visibilityState,t:Math.round(performance.now())})"));
  const rec = JSON.parse(await ev("JSON.stringify(__r9b.fill)"));
  const boss = rec.filter((r) => /老板|忍住|连点|假装工作摸鱼|摸鱼冲刺|没达标|安然/.test(r.text));
  for (const b of boss) {
    if (!out.found.some((f) => f.text === b.text)) {
      out.found.push(b);
      if (!out.shots.includes("r9-boss-event")) {
        out.shots.push("r9-boss-event");
        await shot("r9-boss-event");
      }
    }
  }
  if (info.fps !== lastFps || i % 10 === 0) out.samples.push({ ...info, bossCount: boss.length });
  lastFps = info.fps;
  if (boss.length > 0 && out.found.length >= 3) break;
}
// 记录横幅从出现到消失的持续时间
const t0 = Date.now();
let gone = false;
while (Date.now() - t0 < 20000) {
  const rec = JSON.parse(await ev("JSON.stringify(__r9b.fill)"));
  const bossNow = rec.filter((r) => /老板|忍住|连点|假装工作摸鱼|摸鱼冲刺/.test(r.text) && Math.round(performance.now()) - r.ts < 1200);
  if (bossNow.length === 0) { gone = true; break; }
  await sleep(500);
}
out.bannerGone = gone;
out.fillTail = JSON.parse(await ev("JSON.stringify(__r9b.fill.slice(-12))"));
writeFileSync("playtest/r9-senior-evidence4.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ found: out.found, shots: out.shots, samples: out.samples.slice(-4), bannerGone: gone }, null, 2));
ws.close(); proc.kill(); process.exit(0);
