/**
 * R10 探针 6：像素精确检测巡逻横幅（#b3413c 红 / #2f7a4f 绿），验证首次巡逻点击结果
 * 用法：node playtest/r10-min-probe6.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT=9493; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const proc=spawn(CHROME,["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run",`--user-data-dir=/tmp/chrome-min6-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"],{stdio:"ignore"});
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
await sleep(2800);

const DETECT = `(() => {
  const c = document.getElementById('stage'); if (!c) return JSON.stringify({err:'no canvas'});
  const ctx = c.getContext('2d'); const w=c.width, h=c.height;
  const d = ctx.getImageData(0,0,w,Math.round(h*0.5)).data;
  let red=0, green=0, redY={min:1e9,max:-1}, greenY={min:1e9,max:-1};
  for (let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    if (r===179 && g===65 && b===60) { red++; const y=((i/4/w)|0); if(y<redY.min)redY.min=y; if(y>redY.max)redY.max=y; }
    if (r===47 && g===122 && b===79) { green++; const y=((i/4/w)|0); if(y<greenY.min)greenY.min=y; if(y>greenY.max)greenY.max=y; }
  }
  return JSON.stringify({red,green,redY,greenY,w,h,t:+performance.now().toFixed(0)});
})()`;

let kind=null, waited=0, seen=null;
for (let i=0;i<220;i++){
  await sleep(300); waited+=0.3;
  let d; try { d=JSON.parse(await ev(DETECT)); } catch { continue; }
  if (d.red>2000) { kind='hold(红)'; seen=d; break; }
  if (d.green>2000) { kind='type/blitz(绿)'; seen=d; break; }
}
console.log(`=== 巡逻命中 ${kind} @ ${waited.toFixed(1)}s ===`, JSON.stringify(seen));
if(!kind){ proc.kill(); process.exit(0); }
await shot('/tmp/r10-min6-patrol.png');
const pre = await ev("JSON.stringify({moyu:+window.__MOYU__.state.moyu.toFixed(2), surviveStreak:window.__MOYU__.state.surviveStreak, clicks:window.__MOYU__.state.totalClicks, stateAt:+performance.now().toFixed(0)})");
console.log("=== 巡逻中（点击前）===", pre);
await sleep(1200);
const res = await ev(`(async () => {
  const before = window.__MOYU__.state; const c=document.getElementById('stage'); const r=c.getBoundingClientRect();
  const seq=[];
  for (let i=0;i<3;i++){ c.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height*0.6,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'})); await new Promise(rr=>setTimeout(rr,180)); seq.push(+window.__MOYU__.state.moyu.toFixed(2)); }
  await new Promise(rr=>setTimeout(rr,300));
  const after = window.__MOYU__.state;
  return JSON.stringify({beforeMoyu:+before.moyu.toFixed(2), moyuSeq:seq, afterMoyu:+after.moyu.toFixed(2), delta:+(after.moyu-before.moyu).toFixed(2), surviveStreakAfter:after.surviveStreak, clicksDelta: after.totalClicks-before.totalClicks});
})()`);
console.log("=== 巡逻中乱点 3 下（越过 0.8s 宽限；新手 ≤3 次应免罚）===", res);
await shot('/tmp/r10-min6-patrol-tap.png');
// 等巡逻结束
for (let i=0;i<40;i++){ await sleep(300); const d=JSON.parse(await ev(DETECT)); if(d.red<500&&d.green<500) break; }
await sleep(600);
const post = await ev("JSON.stringify({moyu:+window.__MOYU__.state.moyu.toFixed(2), surviveStreak:window.__MOYU__.state.surviveStreak, earned:window.__MOYU__.state.totalEarned})");
console.log("=== 巡逻结束后 ===", post);
await shot('/tmp/r10-min6-after.png');
proc.kill();process.exit(0);
