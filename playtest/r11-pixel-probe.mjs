/**
 * r11 像素纯度探针：截图 + 画布位图分析（网格泄漏/抗锯齿混色/调色板）+ 动画帧间隔取样。
 * 用法：node playtest/r11-pixel-probe.mjs [width] [height] [outPrefix] [waitMs]
 * 只读探针，不改 src。
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const OUT = process.argv[4] || "/tmp/r11-p";
const WAIT = Number(process.argv[5] || 3000);
const PORT = Number(process.env.PROBE_PORT || 9663);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions",
  `--user-data-dir=/tmp/chrome-r11-${PORT}-${Date.now()}`,
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });

async function waitJson(path, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
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
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};

await send("Emulation.setDeviceMetricsOverride", {
  width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H,
});
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(WAIT);

const meta = await evalJs(`(() => {
  const c = document.getElementById('stage');
  const r = c.getBoundingClientRect();
  return { dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight,
    canvasBitmap: {w: c.width, h: c.height}, canvasCss: {w: r.width, h: r.height}, canvasTop: r.top, canvasLeft: r.left,
    assets: window.__MOYU__ ? window.__MOYU__.assets : null,
    fps: window.__MOYU__ ? window.__MOYU__.fps : null,
    frames: window.__MOYU__ ? window.__MOYU__.frames : null,
    activity: window.__MOYU__ ? window.__MOYU__.activity : null };
})()`);

const analysis = await evalJs(`(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const bmp = c.width && c.height ? ctx.getImageData(0,0,c.width,c.height) : null;
  if (!bmp) return {error:'empty canvas'};
  const d = bmp.data, w = c.width, h = c.height;
  const colors = new Map();
  const hex = (r,g,b) => '#' + [r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
  for (let i=0;i<d.length;i+=4){
    const k = (d[i]<<16)|(d[i+1]<<8)|d[i+2];
    colors.set(k,(colors.get(k)||0)+1);
  }
  const top = [...colors.entries()].sort((a,b)=>b[1]-a[1]).slice(0,18)
    .map(([k,n])=>[hex((k>>16)&255,(k>>8)&255,k&255),n]);
  return { uniqueColors: colors.size, totalPx: w*h, topColors: top, bitmap:{w,h} };
})()`);

// 网格泄漏：scale*dpr = 单虚拟像素的设备像素数。检查每个 cell 是否单一颜色。
const grid = await evalJs(`(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0,0,c.width,c.height).data;
  const w = c.width, h = c.height;
  const scale = Math.max(2, Math.min(6, Math.min(Math.round(c.clientWidth/130), Math.floor(c.clientHeight/124))));
  const g = scale * devicePixelRatio; // 一个虚拟像素的设备像素
  let cells=0, mixed=0, mixedPx=0;
  const mixedSamples=[];
  for (let cy=0; cy<Math.ceil(h/g); cy++) for (let cx=0; cx<Math.ceil(w/g); cx++) {
    const x0=cx*g|0, y0=cy*g|0, x1=Math.min(w,(cx+1)*g|0), y1=Math.min(h,(cy+1)*g|0);
    if (x1-x0<g || y1-y0<g) continue;
    const first = ((y0*w+x0)*4);
    let diff=0;
    for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++) {
      const i=(y*w+x)*4;
      if (Math.abs(d[i]-d[first])+Math.abs(d[i+1]-d[first+1])+Math.abs(d[i+2]-d[first+2])>6) diff++;
    }
    cells++;
    if (diff>0) { mixed++; mixedPx+=diff; if (mixedSamples.length<12) mixedSamples.push({cx,cy,offPx:diff,size:g*g}); }
  }
  // 统计非纯色像素（与最近邻 8 邻域颜色都不同 -> 典型的抗锯齿/半透明混色）占比，粗算即可
  return { scale, dpr: devicePixelRatio, cellDevicePx: g, cells, mixedCells: mixed, mixedCellRatio: +(mixed/cells*100).toFixed(2), mixedSamples };
})()`);

// 动画取样：在页面内 rAF 循环，对若干区域做 32bit 哈希，返回 {t,hash} 序列
const anim = await evalJs(`(() => new Promise((resolve) => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const scale = Math.max(2, Math.min(6, Math.min(Math.round(c.clientWidth/130), Math.floor(c.clientHeight/124))));
  const dpr = devicePixelRatio;
  const S = scale*dpr;
  const vw = c.clientWidth/scale, vh = c.clientHeight/scale;
  const groundY = vh - 4.2*16;
  const deskY = groundY - 2*16;
  const regions = {
    // 职员 16x16 帧位置（虚拟坐标 -> 设备像素）
    worker: [ (vw/2-8)*S, (deskY-1.55*16)*S, 16*S, 16*S ],
    // 显示器 16x16 帧
    screen: [ (vw/2-8)*S, (deskY-1.05*16)*S, 16*S, 16*S ],
    // 饮水机 16x16 帧
    cooler: [ (vw-1.9*16)*S, (groundY-1.05*16)*S, 16*S, 16*S ],
    // 纯静态背景（墙面）用于检测"静止区域是否抖动"
    wall:   [ 8*S, 4*S, 16*S, 8*S ],
  };
  const hashRegion = (x,y,w,h) => { const d = ctx.getImageData(x|0,y|0,w|0,h|0).data; let hv=2166136261; for(let i=0;i<d.length;i+=4){ hv ^= (d[i]<<16)^(d[i+1]<<8)^d[i+2]; hv = Math.imul(hv,16777619);} return hv>>>0; };
  const out = {}; for (const k of Object.keys(regions)) out[k]=[];
  const start = performance.now();
  const loop = () => {
    const t = performance.now();
    const ts = +((t-start)/1000).toFixed(3);
    for (const k of Object.keys(regions)) { const [x,y,w,h]=regions[k]; out[k].push([ts, hashRegion(x,y,w,h)]); }
    if (t-start < 4200) requestAnimationFrame(loop); else { window.__r11anim = out; resolve({ ok:true, sampleCount: out.worker.length, firstTs: out.worker[0] && out.worker[0][0] }); }
  };
  requestAnimationFrame(loop);
  window.__r11anim = out;
}))()`);

// 抓动画抽样结果
const animData = await evalJs("window.__r11anim");
// 采样“点击后的像素粒子/飘字”以及场景：触摸点击 6 次
for (let i = 0; i < 6; i++) {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: W / 2, y: H * 0.45, id: 1 }] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(120);
}
await sleep(60);

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(`${OUT}-full.png`, Buffer.from(shot.data, "base64"));

// 关键区域裁剪截图（设备像素坐标；基于 canvas 位置计算）
const clipRegions = {
  clock: () => ({}),
};
void clipRegions;

const clips = await evalJs(`(() => {
  const c = document.getElementById('stage');
  const r = c.getBoundingClientRect();
  const scale = Math.max(2, Math.min(6, Math.min(Math.round(c.clientWidth/130), Math.floor(c.clientHeight/124))));
  const dpr = devicePixelRatio;
  const S = scale*dpr;
  const vw = c.clientWidth/scale, vh = c.clientHeight/scale;
  const groundY = vh - 4.2*16, deskY = groundY - 2*16;
  const R = (vx,vy,vwv,vhv) => ({ x: Math.max(0, r.left + vx*S), y: Math.max(0, r.top + vy*S), width: vwv*S, height: vhv*S, scale });
  return {
    meta: { canvasTop: r.top, canvasLeft: r.left, cssW: r.width, cssH: r.height, scale, dpr },
    workerZone: R(vw/2-16, deskY-30, 32, 40),
    clock: R(vw-1.9*16-12, 2*16-12, 24, 24),
    plant: R(0, groundY-32, 20, 34),
    cooler: R(vw-1.9*16-4, groundY-1.05*16-4, 24, 26),
    carpet: R(vw/2-3.1*16-2, groundY+1.1*16-2, 6.2*16+4, 1.5*16+4),
    floorEdge: R(0, groundY-4, vw, 8),
    board: R(vw-3.9*16-2, 4.4*16, 2.5*16+4, 1.6*16+8),
    hint: R(0, groundY+1.6*16, vw, 8),
  };
})()`);

for (const [name, box] of Object.entries(clips)) {
  if (name === "meta") continue;
  const b = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), scale: 1 };
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...b, scale: 3 } });
  writeFileSync(`${OUT}-${name}.png`, Buffer.from(s.data, "base64"));
}

console.log(JSON.stringify({ viewport: [W, H], meta, analysis, grid, anim: { sampleCount: animData && animData.worker ? animData.worker.length : 0 }, clipsMeta: clips.meta }, null, 2));
writeFileSync(`${OUT}-anim.json`, JSON.stringify(animData));
writeFileSync(`${OUT}-report.json`, JSON.stringify({ viewport: [W, H], meta, analysis, grid, clipsMeta: clips.meta }, null, 2));
proc.kill();
process.exit(0);
