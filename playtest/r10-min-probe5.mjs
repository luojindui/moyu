/**
 * R10 探针 5：用 canvas 像素检测巡逻横幅（红/绿条），验证首次巡逻「乱点是否罚钱」
 * 用法：node playtest/r10-min-probe5.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT=9487; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const proc=spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run",`--user-data-dir=/tmp/chrome-min5-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"],{stdio:"ignore"});
async function wj(p,t=120){for(let i=0;i<t;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await wj("/json/version");
const tg=await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`,{method:"PUT"}).then(r=>r.json());
const ws=new WebSocket(tg.webSocketDebuggerUrl);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0;const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{resolve,reject,timer}=pend.get(m.id);pend.delete(m.id);clearTimeout(timer);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(method,params={},ms=30000)=>{const i=++id;ws.send(JSON.stringify({id:i,method,params}));return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pend.delete(i);reject(new Error("timeout "+method));},ms);pend.set(i,{resolve,reject,timer});});};
const ev=async(expression)=>{const r=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const shot=async(p)=>{const s=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(p,Buffer.from(s.data,"base64"));};

await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(500);
await ev("localStorage.clear(); location.reload(); true").catch(()=>{});
await sleep(3000);

const DETECT = `(() => {
  const c = document.getElementById('stage');
  if (!c) return JSON.stringify({err:'no canvas'});
  const ctx = c.getContext('2d');
  const w = c.width, h = c.height;
  const band = ctx.getImageData(0, 0, w, Math.round(h*0.42)).data;
  let red=0, green=0;
  for (let i=0;i<band.length;i+=4) {
    const r=band[i], g=band[i+1], b=band[i+2];
    if (r>140 && r<200 && g<90 && b<90) red++;
    if (g>90 && g<150 && r<90 && b<110) green++;
  }
  return JSON.stringify({red, green, w, h, t: +performance.now().toFixed(0)});
})()`;

let kind=null, waited=0, seen={red:0,green:0};
for (let i=0;i<200;i++){
  await sleep(400); waited+=0.4;
  let d;
  try { d = JSON.parse(await ev(DETECT)); } catch(e){ continue; }
  if (d.red > 3000) { kind='hold(红)'; seen=d; break; }
  if (d.green > 3000) { kind='task(绿)'; seen=d; break; }
}
console.log(`=== 巡逻检测: ${kind}（等待 ${waited.toFixed(1)}s）===`, JSON.stringify(seen));
if (!kind) { proc.kill(); process.exit(0); }
await shot('/tmp/r10-min5-patrol.png');
const pre = await ev("JSON.stringify({moyu:+window.__MOYU__.state.moyu.toFixed(2), surviveStreak:window.__MOYU__.state.surviveStreak, clicks:window.__MOYU__.state.totalClicks})");
console.log("=== 巡逻中（点击前）===", pre);
await sleep(1200);
const tapRes = await ev(`(async () => {
  const before = window.__MOYU__.state;
  const c = document.getElementById('stage'); const r = c.getBoundingClientRect();
  const log=[];
  for (let i=0;i<3;i++){ c.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'})); await new Promise(rr=>setTimeout(rr,180)); log.push(+window.__MOYU__.state.moyu.toFixed(2)); }
  await new Promise(rr=>setTimeout(rr,300));
  const after = window.__MOYU__.state;
  return JSON.stringify({ beforeMoyu:+before.moyu.toFixed(2), moyuSeq:log, afterMoyu:+after.moyu.toFixed(2), delta:+(after.moyu-before.moyu).toFixed(2), surviveStreakAfter: after.surviveStreak, clicksBefore: before.totalClicks, clicksAfter: after.totalClicks });
})()`);
console.log("=== 巡逻中乱点 3 下（越过 0.8s 宽限；应为 0 罚款/新手保护）===", tapRes);
await shot('/tmp/r10-min5-patrol-tap.png');
await sleep(8500);
const post = await ev("JSON.stringify({moyu:+window.__MOYU__.state.moyu.toFixed(2), surviveStreak:window.__MOYU__.state.surviveStreak})");
console.log("=== 巡逻结束后（安然应 +连胜1）===", post);
await shot('/tmp/r10-min5-after.png');
proc.kill();process.exit(0);
