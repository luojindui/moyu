/**
 * 移动端真实视口截图工具（CDP）：解决 headless Chrome 最小窗口 500px 宽的问题。
 * 用法：node scripts/shot.mjs [url] [outPath] [width] [height]
 * 默认：http://127.0.0.1:5173/  /tmp/moyu-shot.png  390  844
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = process.argv[2] || "http://127.0.0.1:5173/";
const OUT = process.argv[3] || "/tmp/moyu-shot.png";
const W = Number(process.argv[4] || 390);
const H = Number(process.argv[5] || 844);
const PORT = Number(process.env.SHOT_PORT || 9444);
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
    `--user-data-dir=/tmp/chrome-shot-${Date.now()}`,
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

await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, {
  method: "PUT",
}).then((r) => r.json());
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

await send("Emulation.setDeviceMetricsOverride", {
  width: W,
  height: H,
  deviceScaleFactor: 3,
  mobile: true,
  screenWidth: W,
  screenHeight: H,
});
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(2500);
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(OUT, Buffer.from(shot.data, "base64"));
const metrics = await send("Runtime.evaluate", {
  expression: `JSON.stringify({vw:innerWidth,vh:innerHeight,canvas:(()=>{const c=document.getElementById('stage');return c?{w:c.width,h:c.height,cw:c.clientWidth,ch:c.clientHeight}:null})()})`,
  returnByValue: true,
});
console.log(OUT, metrics.result.value);
proc.kill();
process.exit(0);
