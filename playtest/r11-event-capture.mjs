/**
 * r11 事件截图（只读）：等待随机事件窗口，抓 boss 横幅 / 丢梗气泡。
 * 用法：node playtest/r11-event-capture.mjs [width] [height] [outPrefix]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const OUT = process.argv[4] || "/tmp/r11-ev";
const PORT = Number(process.env.PROBE_PORT || 9691);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions",
  `--user-data-dir=/tmp/chrome-r11e-${PORT}-${Date.now()}`,
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });
async function waitJson(path, tries = 150) {
  for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(100); }
  throw new Error("CDP not ready");
}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
};
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(1200);

const marks = [];
// 每 1.2s 检测画布顶部横幅区域是否出现非背景色（boss 横幅）
for (let i = 0; i < 45; i++) {
  await sleep(1200);
  const info = await evalJs(`(() => {
    const c = document.getElementById('stage'); const ctx = c.getContext('2d');
    const scale = Math.max(2, Math.min(6, Math.min(Math.round(c.clientWidth/130), Math.floor(c.clientHeight/124))));
    const U = scale*devicePixelRatio;
    const d = ctx.getImageData(0, Math.round(0.5*16*U), c.width, Math.round(1.6*16*U)).data;
    let red=0, green=0, gold=0;
    for (let i=0;i<d.length;i+=4){ const r=d[i],g=d[i+1],b=d[i+2];
      if (r>150&&g<100&&b<100) red++; if (g>110&&r<80&&b<120) green++; if (r>230&&g>190&&b<140) gold++; }
    const t = performance.now()/1000;
    return { t: +t.toFixed(1), red, green, gold, frames: window.__MOYU__ ? window.__MOYU__.frames : null };
  })()`);
  marks.push(info);
  if (info.red > 5000 || info.green > 5000 || info.gold > 3000) {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const name = `${OUT}-${info.red > 5000 ? "boss-hold" : info.green > 5000 ? "boss-type" : "meme"}-${Math.round(info.t)}.png`;
    writeFileSync(name, Buffer.from(shot.data, "base64"));
    info.saved = name;
  }
}
writeFileSync(`${OUT}-marks.json`, JSON.stringify(marks, null, 1));
console.log(JSON.stringify(marks.filter(m => m.saved || m.red > 3000 || m.green > 3000 || m.gold > 2000), null, 1));
proc.kill();
process.exit(0);
