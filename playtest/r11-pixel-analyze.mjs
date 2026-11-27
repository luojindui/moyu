/**
 * r11 像素纯度分析 v2（只读）：画布位图量化——调色板分布、抗锯齿混色、网格对齐、文字/圆形边缘。
 * 用法：node playtest/r11-pixel-analyze.mjs [width] [height] [outJson] [waitMs]
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const W = Number(process.argv[2] || 390);
const H = Number(process.argv[3] || 844);
const OUT = process.argv[4] || "/tmp/r11-p-analysis";
const WAIT = Number(process.argv[5] || 3000);
const PORT = Number(process.env.PROBE_PORT || 9671);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions",
  `--user-data-dir=/tmp/chrome-r11a-${PORT}-${Date.now()}`,
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
await sleep(WAIT);

const result = await evalJs(`(() => {
  const c = document.getElementById('stage');
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const scale = Math.max(2, Math.min(6, Math.min(Math.round(c.clientWidth/130), Math.floor(c.clientHeight/124))));
  const dpr = devicePixelRatio;
  const U = scale*dpr;             // 1 虚拟像素 = U 设备像素
  const vw = c.clientWidth/scale, vh = c.clientHeight/scale;
  const groundY = vh - 4.2*16, deskY = groundY - 2*16;
  const px = (x,y) => { const i=((y|0)*w+(x|0))*4; return [d[i],d[i+1],d[i+2]]; };
  const hex = a => '#'+a.map(v=>v.toString(16).padStart(2,'0')).join('');
  const key = a => (a[0]<<16)|(a[1]<<8)|a[2];

  // 1) 调色板分布
  const hist = new Map();
  for (let i=0;i<d.length;i+=4){ const k=(d[i]<<16)|(d[i+1]<<8)|d[i+2]; hist.set(k,(hist.get(k)||0)+1); }
  const sorted=[...hist.entries()].sort((a,b)=>b[1]-a[1]);
  const tone=(lo,hi)=>sorted.filter(([,n])=>n>=lo&&(hi==null||n<hi)).length;
  const pxTone=(lo,hi)=>sorted.filter(([,n])=>n>=lo&&(hi==null||n<hi)).reduce((s,[,n])=>s+n,0);
  const palette = { uniqueColors: hist.size, totalPx: w*h,
    colors_ge_1000px: tone(1000), colors_100_1000px: tone(100,1000), colors_10_100px: tone(10,100), colors_lt_10px: tone(0,10),
    px_ge_1000px: pxTone(1000), px_100_1000px: pxTone(100,1000), px_10_100px: pxTone(10,100), px_lt_10px: pxTone(0,10),
    top20: sorted.slice(0,20).map(([k,n])=>[hex([(k>>16)&255,(k>>8)&255,k&255]),n, +(n/w/h*100).toFixed(2)]) };

  // 2) 特定区域唯一色数（设备像素框：虚拟坐标 * U）
  const reg = (label, vx, vy, vwid, vhei) => {
    const x0=Math.max(0,Math.round(vx*U)), y0=Math.max(0,Math.round(vy*U));
    const x1=Math.min(w,Math.round((vx+vwid)*U)), y1=Math.min(h,Math.round((vy+vhei)*U));
    const set=new Map();
    for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++){ const i=(y*w+x)*4; const k=(d[i]<<16)|(d[i+1]<<8)|d[i+2]; set.set(k,(set.get(k)||0)+1); }
    const srt=[...set.entries()].sort((a,b)=>b[1]-a[1]);
    return { label, vx:+vx.toFixed(2), vy:+vy.toFixed(2), w:+(x1-x0), h:+(y1-y0), unique: set.size, top: srt.slice(0,5).map(([k,n])=>[hex([(k>>16)&255,(k>>8)&255,k&255]),n]) };
  };
  const regions = [
    reg('wall(墙+条纹)', 70, 4, 30, 30),
    reg('floor(地砖)', 5, groundY+6, 100, 20),
    reg('carpet(地毯半透明)', vw/2-3.1*16+1, groundY+1.3*16+1, 6.2*16-2, 1.5*16-2),
    reg('clock(圆钟)', vw-1.9*16-12, 2*16-12, 24, 24),
    reg('plant(绿植)', 0.5*16, groundY-24, 16, 24),
    reg('window(窗)', 1.6*16, 1.4*16, 3.6*16, 2.4*16),
    reg('board(公告板)', vw-3.9*16, 4.4*16, 2.5*16, 1.6*16),
    reg('worker(职员位)', vw/2-8, deskY-1.55*16, 16, 16),
    reg('screen(显示器)', vw/2-8, deskY-1.05*16, 16, 16),
    reg('hint(提示文字)', vw/2-20, groundY+2.2*16, 40, 3*16),
    reg('cooler(饮水机)', vw-1.9*16-2, groundY-1.05*16-2, 20, 20),
  ];

  // 3) 墙/地分界是否落在整像素：扫一列纯墙面（x = 20 虚拟单位处）
  const colX = Math.round(20*U);
  const wallFloor = [];
  const yStart = Math.round((groundY-3)*U), yEnd = Math.round((groundY+3)*U);
  for (let y=yStart; y<=yEnd; y++) wallFloor.push([y, hex(px(colX,y))]);
  // 相邻两行是否相同 => 整像素边界；出现中间色 => 半像素
  const boundaryBlendRows = [];
  for (let y=yStart+1; y<=yEnd; y++) {
    const a=px(colX,y-1), b=px(colX,y);
    if (hex(a)!==hex(b)) boundaryBlendRows.push([y, hex(a), hex(b)]);
  }

  // 4) 地板砖横线：逐行看是否为"混合行"（同一行里出现多种颜色）
  const floorRows = [];
  for (let vy=groundY; vy<vh-2; vy+=1) {
    const y=Math.round(vy*U);
    const cols=new Set();
    for (let x=0;x<w;x+=3){ const i=(y*w+x)*4; cols.add((d[i]<<16)|(d[i+1]<<8)|d[i+2]); }
    floorRows.push([+vy.toFixed(2), cols.size]);
  }

  // 5) 精灵边缘对齐：显示器左边扫描线（虚拟 y=deskY-0.6u 处，穿屏幕），找颜色跳变 x，看是否 9 的倍数
  const scanY = Math.round((deskY-0.8*16)*U);
  const edges=[];
  let prev=px(0,scanY);
  for (let x=1;x<w;x++){ const cur=px(x,scanY); if (hex(cur)!==hex(prev)) { edges.push([x, x%U, hex(prev), hex(cur)]); prev=cur; } }
  const spriteEdges = edges.filter(([x])=>x>=Math.round((vw/2-8)*U)-2 && x<=Math.round((vw/2+9)*U));

  // 6) 文字抗锯齿程度：提示文字区域里"非纯色"像素（颜色在该区域出现<8次）
  const textRegion=(()=> {
    const x0=Math.round((vw/2-20)*U), y0=Math.round((groundY+2.2*16)*U);
    const x1=Math.round((vw/2+20)*U), y1=Math.round((groundY+5.2*16)*U);
    const set=new Map(); let total=0;
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){ const i=(y*w+x)*4; const k=(d[i]<<16)|(d[i+1]<<8)|d[i+2]; set.set(k,(set.get(k)||0)+1); total++; }
    const rare=[...set.values()].filter(n=>n<8).length;
    return { unique: set.size, rareColors: rare, total };
  })();

  return { scale, dpr, U, vw:+vw.toFixed(2), vh:+vh.toFixed(2), groundY:+groundY.toFixed(2), deskY:+deskY.toFixed(2),
    bitmap:{w,h}, css:{w:c.clientWidth,h:c.clientHeight}, canvasTop:c.getBoundingClientRect().top,
    assets: window.__MOYU__ && window.__MOYU__.assets, fps: window.__MOYU__ && window.__MOYU__.fps,
    palette, regions, wallFloorBoundary: { colX, yStart, yEnd, rows: wallFloor, blendRows: boundaryBlendRows.length, blendDetail: boundaryBlendRows.slice(0,6) },
    floorRowColorCounts: floorRows.filter(([,n])=>n>1).slice(0,14),
    spriteEdgeSnap: { scanY, U, totalEdges: edges.length, nearScreenEdges: spriteEdges },
    textAA: textRegion };
})()`);

// 检查 worker.png 是否 404 / 是否返回 HTML
const assetCheck = await evalJs(`(async () => {
  const out = {};
  for (const [k, url] of Object.entries({ worker: './assets/sprites/worker.png', worker0: './assets/sprites/worker-0.png', computer: './assets/sprites/computer.png' })) {
    try { const r = await fetch(url); const txt = (r.headers.get('content-type')||''); out[k] = { status: r.status, type: txt, ok: r.ok }; } catch (e) { out[k] = { error: String(e) }; }
  }
  out.imgWorker = { complete: null };
  await new Promise((res) => { const i = new Image(); i.onload=()=>{out.imgWorker={complete:true,w:i.naturalWidth};res();}; i.onerror=()=>{out.imgWorker={complete:false};res();}; i.src='./assets/sprites/worker.png'; });
  return out;
})()`);

const out = { viewport: [W, H], result, assetCheck };
writeFileSync(`${OUT}.json`, JSON.stringify(out, null, 2));
const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(`${OUT}.png`, Buffer.from(shot.data, "base64"));
console.log(JSON.stringify({ scale: result.scale, dpr: result.dpr, U: result.U, assets: result.assets, uniqueColors: result.palette.uniqueColors, lt10: result.palette.colors_lt_10px, regions: result.regions.map(r=>[r.label, r.unique]), wallFloor: {blendRows: result.wallFloorBoundary.blendRows, detail: result.wallFloorBoundary.blendDetail}, textAA: result.textAA, spriteEdgeSnap: result.spriteEdgeSnap, assetCheck }, null, 1));
proc.kill();
process.exit(0);
