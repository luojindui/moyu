/**
 * R11 宠物画像探针：评估现有场景「陪伴感」（只读 src/，不修改）。
 * 1) 资产/角色可见性：worker 精灵是否加载、屏幕上是像素角色还是占位色块
 * 2) 屏上可见动画频次：分区像素哈希采样 35s（职员/显示器/饮水机/背景）
 * 3) 交互反馈：点职员 vs 点空地 是否不同
 * 4) 章节换色：存档 seed 到高章节后 reload，比较职员区像素
 * 输出：playtest/r11-pet-scene.json + /tmp/r11-*.png
 */
import { writeFileSync } from "node:fs";
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";

const PORT = 9490;
const b = await openBrowser({ port: PORT, tag: "r11pet" });
const out = { assets: null, layout: null, anim: null, click: null, palette: null, crops: {} };

await b.send("Page.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
await b.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3200);

// ---- 0. 页面/画布布局 ----
out.layout = JSON.parse(
  await b.ev(`JSON.stringify((()=>{const c=document.getElementById('stage');const r=c.getBoundingClientRect();
    return {rect:{x:r.x,y:r.y,w:r.width,h:r.height},cw:c.width,ch:c.height,dpr:c.width/r.width,
      canvasCssH:r.height, parentH: c.parentElement.getBoundingClientRect().height};})())`),
);

// ---- 1. 资产状态（等 3s 确保全部 settle）----
out.assets = JSON.parse(await b.ev(`JSON.stringify(window.__MOYU__.assets)`));
const probeImg = await b.ev(`(async()=>{const load=(src)=>new Promise(res=>{const i=new Image();i.onload=()=>res({src,ok:true,w:i.naturalWidth,h:i.naturalHeight});i.onerror=()=>res({src,ok:false});i.src=src;});
  return JSON.stringify(await Promise.all([load('./assets/sprites/worker.png'),load('./assets/sprites/worker-0.png'),load('./assets/sprites/worker-1.png'),load('./assets/sprites/worker-2.png'),load('./assets/sprites/worker-3.png')]));})()`);
out.spriteFiles = JSON.parse(probeImg);

// ---- 2. 采样屏上可见动画（35s @ 125ms）----
const anim = JSON.parse(
  await b.ev(`(async()=>{
  const c=document.getElementById('stage');const ctx=c.getContext('2d');
  const dpr=c.width/c.getBoundingClientRect().width;
  const sc=Math.max(2,Math.min(6,Math.min(Math.round(c.getBoundingClientRect().width/130),Math.floor(c.getBoundingClientRect().height/124))));
  const vw=c.getBoundingClientRect().width/sc, vh=c.getBoundingClientRect().height/sc;
  const groundY=vh-67.2, deskY=groundY-30.4;
  const R=(x,y,w,h)=>({x:x*sc,y:y*sc,w:w*sc,h:h*sc});
  const regions={
    workerVisible: R(vw/2-8,deskY-24.8,16,8),      // 显示器上沿以上：只露上半身
    workerFull:    R(vw/2-8,deskY-24.8,16,16),
    monitor:       R(vw/2-8,deskY-16.8,16,16),
    cooler:        R(vw-1.9*16,groundY-16.8,16,16),
    wallLeft:      R(0,0,vw*0.45,vh*0.35),
    plant:         R(0.3*16,groundY-7*16,4*16,7*16)
  };
  const hash=(d)=>{let h=2166136261;for(let i=0;i<d.length;i+=7){h^=d[i];h=Math.imul(h,16777619);}return h>>>0;};
  const grab=(g)=>{const d=ctx.getImageData(Math.round(g.x*dpr),Math.round(g.y*dpr),Math.max(1,Math.round(g.w*dpr)),Math.max(1,Math.round(g.h*dpr))).data;return d;};
  const prev={};const stats={};for(const k of Object.keys(regions))stats[k]={samples:0,changes:0,distinct:new Set(),last:null};
  const t0=performance.now();const times=[];
  await new Promise(done=>{const iv=setInterval(()=>{
    for(const [k,g] of Object.entries(regions)){const d=grab(g);const h=hash(d);const s=stats[k];s.samples++;s.distinct.add(h);
      if(s.last!==null&&s.last!==h)s.changes++;s.last=h;}
    times.push(Math.round(performance.now()-t0));
    if(performance.now()-t0>35000){clearInterval(iv);done();}
  },125);});
  // 取平均色（判断占位色块 / 角色分辨）
  const avg=(g)=>{const d=grab(g);let r=0,gg=0,bb=0,n=0;for(let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];bb+=d[i+2];n++;}return [Math.round(r/n),Math.round(gg/n),Math.round(bb/n)];};
  const res={scale:sc,dpr,vw:Math.round(vw),vh:Math.round(vh),durationS:Math.round((performance.now()-t0)/100)/10,
    regions:Object.fromEntries(Object.entries(stats).map(([k,s])=>[k,{samples:s.samples,changes:s.changes,distinctFrames:s.distinct.size}])),
    avgColors:Object.fromEntries(Object.entries(regions).map(([k,g])=>[k,avg(g)])),
    // 采样时刻（检测长间隔/掉帧）
    sampleCount:times.length};
  return JSON.stringify(res);})()`),
);
out.anim = anim;

// ---- 3. 截取画布关键区域（放大看角色到底是像素人还是占位块）----
const crop = async (name, x, y, w, h, zoom = 6) =>
  b.ev(`(()=>{const c=document.getElementById('stage');const dpr=c.width/c.getBoundingClientRect().width;
    const src=document.createElement('canvas');src.width=${w}*dpr;src.height=${h}*dpr;
    src.getContext('2d').drawImage(c,${x}*dpr,${y}*dpr,${w}*dpr,${h}*dpr,0,0,${w}*dpr,${h}*dpr);
    const o=document.createElement('canvas');o.width=${w}*${zoom};o.height=${h}*${zoom};
    const octx=o.getContext('2d');octx.imageSmoothingEnabled=false;octx.drawImage(src,0,0,o.width,o.height);
    return o.toDataURL('image/png');})()`);
const sceneCss = { w: out.layout.rect.w, h: out.layout.rect.h };
const saveCrop = (name, dataUrl) => {
  const b64 = dataUrl.split(",")[1];
  writeFileSync(`/tmp/r11-${name}.png`, Buffer.from(b64, "base64"));
  out.crops[name] = `/tmp/r11-${name}.png`;
};
// worker 区域（CSS：中心 x=195，y=184.8..232.8）
saveCrop("worker", await crop("worker", 165, 178, 60, 60, 6));
saveCrop("scene", await crop("scene", 0, 0, 390, 340, 2));

// ---- 4. 点击反馈：点职员 12 下 vs 点空地 12 下 ----
const clickAt = async (x, y, n = 12) => {
  for (let i = 0; i < n; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y: y + out.layout.rect.y, button: "left", clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: y + out.layout.rect.y, button: "left", clickCount: 1 });
    await sleep(90);
  }
};
const stateBefore = JSON.parse(await b.ev(`JSON.stringify(window.__MOYU__.state)`));
await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }).then((r) => writeFileSync("/tmp/r11-before-click.png", Buffer.from(r.data, "base64")));
await clickAt(195, 196, 12);
await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }).then((r) => writeFileSync("/tmp/r11-after-click-worker.png", Buffer.from(r.data, "base64")));
await sleep(400);
const stateAfterWorker = JSON.parse(await b.ev(`JSON.stringify(window.__MOYU__.state)`));
await sleep(600);
await clickAt(60, 640, 12);
await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }).then((r) => writeFileSync("/tmp/r11-after-click-empty.png", Buffer.from(r.data, "base64")));
await sleep(400);
const stateAfterEmpty = JSON.parse(await b.ev(`JSON.stringify(window.__MOYU__.state)`));
out.click = {
  clicksBefore: stateBefore.totalClicks, clicksAfterWorker: stateAfterWorker.totalClicks, clicksAfterEmpty: stateAfterEmpty.totalClicks,
  moyuBefore: stateBefore.moyu, moyuAfterWorker: stateAfterWorker.moyu, moyuAfterEmpty: stateAfterEmpty.moyu,
  note: "点击只走全局 doTap：无角色/宠物分区反馈（源码 main.ts doTap 无坐标语义，除巡逻/丢梗）",
};

// ---- 5. 章节配色：seed 高生涯收入后 reload，看职员可见区是否换色 ----
const seedSave = (lifetime) => {
  const blob = { v: 1, moyu: 10, totalEarned: 10, levels: {}, savedAt: Date.now(), createdAt: Date.now(), collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, totalClicks: 0, visits: { date: "", count: 0 }, lifetimeEarned: lifetime, prestige: 0 };
  return `localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});`;
};
const paletteShot = async (lifetime, tag) => {
  await b.ev(seedSave(lifetime));
  await b.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
  await sleep(3200);
  const st = JSON.parse(await b.ev(`JSON.stringify({note: window.__MOYU__.state.lifetimeEarned, assets: window.__MOYU__.assets})`));
  const avg = JSON.parse(await b.ev(`JSON.stringify((()=>{const c=document.getElementById('stage');const ctx=c.getContext('2d');
    const dpr=c.width/c.getBoundingClientRect().width;const sc=Math.max(2,Math.min(6,Math.min(Math.round(c.getBoundingClientRect().width/130),Math.floor(c.getBoundingClientRect().height/124))));
    const vw=c.getBoundingClientRect().width/sc,vh=c.getBoundingClientRect().height/sc;const groundY=vh-67.2,deskY=groundY-30.4;
    const d=ctx.getImageData(Math.round((vw/2-8)*sc*dpr),Math.round((deskY-24.8)*sc*dpr),Math.round(16*sc*dpr),Math.round(8*sc*dpr)).data;
    let r=0,g=0,bb=0,n=0;for(let i=0;i<d.length;i+=4){r+=d[i];g+=d[i+1];bb+=d[i+2];n++;}
    return {avg:[Math.round(r/n),Math.round(g/n),Math.round(bb/n)],sc};})())`));
  await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 844, scale: 1 } }).then((r) => writeFileSync(`/tmp/r11-${tag}.png`, Buffer.from(r.data, "base64")));
  return { lifetime, note: st.note, assets: st.assets, workerAvg: avg };
};
out.palette = [];
out.palette.push(await paletteShot(0, "chapter1"));
out.palette.push(await paletteShot(1e8, "chapter4"));
out.palette.push(await paletteShot(3.2e11, "chapter6"));

// ---- 6. 事件/声音：首 30s 内可见的自动行为次数（代码常量核对）----
out.codeFacts = {
  typingFPS: 7,
  drinkEveryS: 22,
  drinkForS: 2.5,
  monitorFPS: 2,
  coolerFPS: 3,
  "R10 定格": "scene.ts 常量；但 worker 精灵加载失败时以上全部不可见",
};

writeFileSync("playtest/r11-pet-scene.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
