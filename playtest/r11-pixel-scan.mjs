/**
 * r11 扫描线探针（只读）：在画布位图上取指定扫描线，输出"颜色运行段"，判断边界落在整像素还是半像素。
 * 用法：node playtest/r11-pixel-scan.mjs [width] [height] [outJson]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const OUT = process.argv[4] || "/tmp/r11-scan";
const PORT = Number(process.env.PROBE_PORT || 9681);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions",
  `--user-data-dir=/tmp/chrome-r11s-${PORT}-${Date.now()}`,
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

async function waitJson(path, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(100);
  }
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
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: Number(process.env.DPR || 3), mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3000);

const data = await evalJs(`(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  const d = ctx.getImageData(0,0,w,h).data;
  const scale = Math.max(2, Math.min(6, Math.min(Math.round(c.clientWidth/130), Math.floor(c.clientHeight/124))));
  const dpr = devicePixelRatio, U = scale*dpr;
  const vw = c.clientWidth/scale, vh = c.clientHeight/scale;
  const groundY = vh - 4.2*16, deskY = groundY - 2*16;
  const hex = (i) => '#'+[d[i],d[i+1],d[i+2]].map(v=>v.toString(16).padStart(2,'0')).join('');
  const at = (x,y) => hex((y*w+x)*4);
  const scanCol = (vx, vy0, vy1) => {
    const x = Math.round(vx*U), out=[];
    let prev=null, startY=null;
    for (let y=Math.round(vy0*U); y<=Math.round(vy1*U); y++) {
      const col = at(x,y);
      if (col !== prev) { if (prev!==null) out.push({from:startY,to:y-1,rows:y-startY,color:prev}); prev=col; startY=y; }
    }
    if (prev!==null) out.push({from:startY,to:Math.round(vy1*U),rows:Math.round(vy1*U)-startY+1,color:prev});
    return { vx, x, runs: out };
  };
  const scanRow = (vy, vx0, vx1, step) => {
    const y = Math.round(vy*U), out=[]; let prev=null,startX=null;
    for (let x=Math.round(vx0*U); x<=Math.round(vx1*U); x+=(step||1)) {
      const col=at(x,y);
      if (col!==prev){ if(prev!==null) out.push({from:startX,to:x-1,cols:x-startX,color:prev}); prev=col; startX=x; }
    }
    if(prev!==null) out.push({from:startX,to:Math.round(vx1*U),cols:Math.round(vx1*U)-startX+1,color:prev});
    return { vy, y, runs: out };
  };
  return {
    scale, dpr, U, vw:+vw.toFixed(2), vh:+vh.toFixed(2),
    groundY:+groundY.toFixed(2), deskY:+deskY.toFixed(2), deskYdev:+(deskY*U).toFixed(2), groundYdev:+(groundY*U).toFixed(2),
    // A: 纯墙面列 x=90 跨墙/地分界
    A_wallFloor: scanCol(90, groundY-2.5, groundY+2.5),
    // B: 地板砖列 x=120（纯地板）
    B_floorBricks: scanCol(120, groundY+0.5, vh-1),
    // C: 桌面边缘列 x=70（跨桌面上沿）
    C_deskTop: scanCol(70, deskY-1.5, deskY+1.5),
    // D: 显示器精灵横向扫描 y=deskY-0.1u
    D_spriteRow: scanRow(deskY-0.2*16, vw/2-12, vw/2+12),
    // E: 饮水机边缘列（设备像素）x=虚拟 vw-1.9u
    E_coolerEdge: scanRow(groundY-0.6*16, vw-1.9*16-2, vw-1.9*16+18),
    // F: 便签文字行
    F_noteRow: scanRow(4.6*16+0.62*16, vw-3.9*16+1.6*16, vw-3.9*16+3.4*16),
    // G: 窗户左边列（x=1.6u）
    G_windowLeft: scanRow(2*16, 1.6*16-1.2, 1.6*16+1.2),
    // H: 光锥斜边（左下斜边 y=groundY-5 行）
    H_coneEdge: scanRow(groundY-5, vw/2-4*16, vw/2-1*16),
  };
})()`);

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(`${OUT}.png`, Buffer.from(shot.data, "base64"));
writeFileSync(`${OUT}.json`, JSON.stringify({ viewport: [W,H], data }, null, 2));
// 摘要
const summary = { scale: data.scale, dpr: data.dpr, U: data.U, groundY: data.groundY, deskY: data.deskY, groundYdev: data.groundYdev, deskYdev: data.deskYdev,
  A: data.A_wallFloor.runs, B: data.B_floorBricks.runs.slice(0,10), C: data.C_deskTop.runs, D: data.D_spriteRow.runs.slice(0,8), E: data.E_coolerEdge.runs.slice(0,6), G: data.G_windowLeft.runs, H: data.H_coneEdge.runs.slice(0,6) };
console.log(JSON.stringify(summary, null, 1));
proc.kill();
process.exit(0);
