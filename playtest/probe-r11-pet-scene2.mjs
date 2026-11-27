/** R11 补充探针：紧采样「职员可见区」、what-if 合成、章节配色正确 seed。只读 src/。 */
import { writeFileSync } from "node:fs";
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";

const b = await openBrowser({ port: 9491, tag: "r11pet2" });
const out = {};
await b.send("Page.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

// ---------- A. 紧采样：职员可见区 vs 显示器（前 18s 避开 20s 后巡逻/12s 后丢梗尽量） ----------
await b.send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3000);
console.log("A start");
out.tight = JSON.parse(
  await b.ev(`(async()=>{
  const c=document.getElementById('stage'),ctx=c.getContext('2d');
  const r=c.getBoundingClientRect(),dpr=c.width/r.width;
  const sc=Math.max(2,Math.min(6,Math.min(Math.round(r.width/130),Math.floor(r.height/124))));
  const vw=r.width/sc,vh=r.height/sc,groundY=vh-67.2,deskY=groundY-30.4;
  const rects={
    workerHead:  {x:(vw/2-7.5)*sc,y:(deskY-24.5)*sc,w:15*sc,h:7*sc},   // 只含角色头肩，不含显示器
    monitorTop:  {x:(vw/2-7.5)*sc,y:(deskY-16.5)*sc,w:15*sc,h:2*sc},
    clock:       {x:(vw-2.4)*16*sc,y:1.2*16*sc,w:1.4*16*sc,h:1.4*16*sc},
    plantLeaf:   {x:0.8*16*sc,y:(groundY-4.4*16)*sc,w:1.6*16*sc,h:1.6*16*sc}
  };
  const hash=(d)=>{let h=2166136261;for(let i=0;i<d.length;i+=5){h^=d[i];h=Math.imul(h,16777619);}return h>>>0;};
  const grab=(g)=>ctx.getImageData(Math.round(g.x*dpr),Math.round(g.y*dpr),Math.max(1,Math.round(g.w*dpr)),Math.max(1,Math.round(g.h*dpr))).data;
  const st={};for(const k in rects)st[k]={last:null,changes:0,distinct:new Set()};
  const t0=performance.now();
  await new Promise(done=>{const iv=setInterval(()=>{
    for(const [k,g] of Object.entries(rects)){const h=hash(grab(g));const s=st[k];if(s.last!==null&&s.last!==h)s.changes++;s.last=h;s.distinct.add(h);}
    if(performance.now()-t0>18000){clearInterval(iv);done();}
  },125);});
  return JSON.stringify({sc,duration:18,regions:Object.fromEntries(Object.entries(st).map(([k,s])=>[k,{changes:s.changes,distinct:s.distinct.size}]))});})()`),
);

// ---------- B. what-if 合成：把 worker-0 精灵画到正确位置，看修好后会是什么样 ----------
console.log("B start");
out.whatif = await b.ev(`(async()=>{
  const img=await new Promise(res=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>res(null);i.src='./assets/sprites/worker-0.png';});
  const c=document.getElementById('stage'),r=c.getBoundingClientRect(),dpr=c.width/r.width;
  const sc=Math.max(2,Math.min(6,Math.min(Math.round(r.width/130),Math.floor(r.height/124))));
  const vw=r.width/sc,groundY=r.height/sc-67.2,deskY=groundY-30.4;
  const o=document.createElement('canvas');o.width=c.width;o.height=c.height;
  const octx=o.getContext('2d');octx.imageSmoothingEnabled=false;octx.drawImage(c,0,0);
  // 显示器覆盖前把角色画上（模拟 sprite 加载成功后的绘制顺序：角色→桌→显示器）
  const wx=(vw/2-8)*sc,wy=(deskY-24.8)*sc,sz=16*sc;
  const pil=c.getContext('2d'); // 先画角色再重画显示器：直接在副本上画角色 + 把显示器区域重绘会破坏，改为只画上半身（可见部分）
  octx.drawImage(img,0,2*16,16,16,wx,wy,sz,sz);
  // 裁一张放大图：现状 vs 修好后
  const mk=(srcCanvas)=>{const z=5;const cc=document.createElement('canvas');cc.width=70*z;cc.height=80*z;const cx=cc.getContext('2d');cx.imageSmoothingEnabled=false;
    cx.drawImage(srcCanvas,(vw/2-35)*sc*dpr,(deskY-30)*sc*dpr,70*sc*dpr,80*sc*dpr,0,0,cc.width,cc.height);return cc;};
  const a=mk(c),bb=mk(o);
  const pair=document.createElement('canvas');pair.width=a.width*2+20;pair.height=a.height;
  const px=pair.getContext('2d');px.fillStyle='#111';px.fillRect(0,0,pair.width,pair.height);
  px.drawImage(a,0,0);px.drawImage(bb,a.width+20,0);
  px.fillStyle='#fff';px.font='bold 20px system-ui';px.fillText('现状（占位色块）',10,24);px.fillText('若修好加载 worker-0',a.width+30,24);
  return pair.toDataURL('image/png');})()`);
writeFileSync("/tmp/r11-whatif.png", Buffer.from(out.whatif.split(",")[1], "base64"));
out.whatif = "/tmp/r11-whatif.png";

console.log("A/B done");
writeFileSync("playtest/r11-pet-scene2a.json", JSON.stringify(out, null, 2));
// ---------- C. 章节配色：addScriptToEvaluateOnNewDocument 在 boot 前写入 seed ----------
const seed = (lifetime) => {
  const blob = { v: 1, moyu: 0, totalEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now(), collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, totalClicks: 0, visits: { date: "", count: 0 }, lifetimeEarned: lifetime, prestige: 0 };
  return `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});}catch(e){}`;
};
out.palette = [];
for (const [lifetime, tag] of [[0, "ch1"], [1e8, "ch4"], [3.2e11, "ch6"]]) {
  console.log("C seed", tag);
  const id = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: seed(lifetime) });
  // 先跳到空白页，避免旧页面 pagehide 写档覆盖 seed
  await b.send("Page.navigate", { url: "about:blank" });
  await sleep(300);
  await b.send("Page.navigate", { url: "http://127.0.0.1:5173/?t=" + Date.now() });
  await sleep(3200);
  const info = JSON.parse(
    await b.ev(`JSON.stringify((()=>{const c=document.getElementById('stage'),r=c.getBoundingClientRect(),dpr=c.width/r.width;
      const sc=Math.max(2,Math.min(6,Math.min(Math.round(r.width/130),Math.floor(r.height/124))));const vw=r.width/sc,groundY=r.height/sc-67.2,deskY=groundY-30.4;
      const ctx=c.getContext('2d');
      const avg=(x,y,w,h)=>{const d=ctx.getImageData(Math.round(x*dpr),Math.round(y*dpr),Math.round(w*dpr),Math.round(h*dpr)).data;let R=0,G=0,B=0,n=0;for(let i=0;i<d.length;i+=4){R+=d[i];G+=d[i+1];B+=d[i+2];n++;}return [Math.round(R/n),Math.round(G/n),Math.round(B/n)];};
      return {lifetime:window.__MOYU__.state.lifetimeEarned, assets:window.__MOYU__.assets,
        workerAvg:avg((vw/2-7.5)*sc,(deskY-24.5)*sc,15*sc,7*sc),
        noteAvg:avg((vw-3.6*16)*sc,Math.min(4.6*16,groundY-4.4*16)*sc,2.3*16*sc,0.5*16*sc)};})())`),
  );
  const shot = await b.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 131, width: 390, height: 340, scale: 2 } });
  writeFileSync(`/tmp/r11-${tag}.png`, Buffer.from(shot.data, "base64"));
  await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id.identifier });
  out.palette.push({ ...info, screenshot: `/tmp/r11-${tag}.png` });
}

writeFileSync("playtest/r11-pet-scene2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
try{b.close();}catch(e){}
process.exit(0);
