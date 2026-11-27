// r13 探针3：4s 窗口精确时长 / 计时条与真实截止 / 音效语义 / 320px 线索换行
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9837;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13c]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions","--autoplay-policy=no-user-gesture-required",`--user-data-dir=/tmp/chrome-r13c-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Page.frameNavigated") log("NAV",m.params.frame.url,m.params.frame.loaderId&&m.params.frame.loaderId.slice(0,8));
  if(m.method==="Runtime.executionContextsCleared") log("CTX_CLEARED");
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails){const d=(r.exceptionDetails.exception&&(r.exceptionDetails.exception.description||r.exceptionDetails.exception.value))||r.exceptionDetails.text;log("EVAL_ERR",String(d).slice(0,300),"| expr:",String(x).slice(0,60));return null;}return r.result.value;};
const shot=async(path)=>{const s=await send("Page.captureScreenshot",{format:"png"});writeFileSync(path,Buffer.from(s.data,"base64"));};
const tap=async(x,y,hold=60,r=3)=>{
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,radiusX:r,radiusY:r,force:1}]});
  await sleep(hold);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
};
const state=()=>ev(`window.__MOYU__.state`);
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
// 等真正 ready（避免导航竞态把注入的全局冲掉）
await (async()=>{for(let i=0;i<150;i++){const ok=await ev(`typeof window.__MOYU__==='object' && document.readyState==='complete' && !!document.getElementById('stage')`);if(ok===true)return;await sleep(100);}throw new Error('game not ready');})();
await sleep(400);
await ev(`(()=>{const b=document.querySelector('#cards-body .card'); if(b) b.click(); return !!b})()`);
await sleep(300);
await ev(`window.__MOYU__.grant(1e9)`);
await sleep(400);

// 音频钩子：记录 oscillator 频率
await ev(`(()=>{
  window.__AUD=[];
  const P=AudioContext.prototype;
  if(!P.__hooked){
    P.__hooked=true;
    const orig=P.createOscillator;
    P.createOscillator=function(){const o=orig.call(this);const sv=o.frequency.setValueAtTime.bind(o.frequency);
      o.frequency.setValueAtTime=(v,t)=>{window.__AUD.push({freq:v,t:performance.now(),type:o.type});return sv(v,t);};
      return o;};
  }
  return 'hooked';
})()`);

await ev(`(()=>{
  const el=document.getElementById('boss-choice');
  window.__RT={show:null,showHiddenAt:null,tell:''};
  if(window.__RTO) window.__RTO.disconnect();
  window.__RTO=new MutationObserver(()=>{
    if(!el.classList.contains('hidden') && window.__RT.show===null){window.__RT.show=performance.now();window.__RT.tell=document.getElementById('boss-tell').textContent;}
    if(el.classList.contains('hidden')) window.__RT.showHiddenAt=performance.now();
  });
  window.__RTO.observe(el,{attributes:true,attributeFilter:['class']});
  return 'ok';
})()`);
const resetRT=()=>ev(`(()=>{window.__RT.show=null;window.__RT.showHiddenAt=null;window.__RT.tell='';return 1})()`);
const waitClosed=(ms=7000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const o=document.getElementById('boss-choice');if(o&&o.classList.contains('hidden'))return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const waitShow=(ms=3000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const KEY={"走路带风":"act-busy","盯着别人屏幕":"switch-screen","看手机":"keep-slacking","眼神是散":"keep-slacking"};
const mapping=(tell)=>{for(const k in KEY) if(tell.includes(k)) return KEY[k];return null;};
const rects=()=>ev(`(()=>{const w=document.getElementById('boss-choice');const r=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
  const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,label:b.textContent,...r(b)}));
  return {box:r(w.querySelector('.boss-box')),btns,tell:window.__RT.tell,
   anim:getComputedStyle(w.querySelector('.boss-box')).animationName,
   transition:getComputedStyle(w).transitionDuration,
   tellRect:r(document.getElementById('boss-tell')),
   tellFont:getComputedStyle(document.getElementById('boss-tell')).fontSize,
   boxPos:getComputedStyle(w).bottom};})()`);

const out={windows:[],latePress:null,audio:{},narrow:{},errors:[]};

// ===== 1) 精确窗口时长：高速采样 bar/open =====
for(let k=1;k<=3;k++){
  await resetRT(); await waitClosed();
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await waitShow();
  const tShow=await ev(`window.__RT.show`);
  const samples=[];
  for(let i=0;i<140;i++){
    const w=await ev(`(()=>{const i=document.querySelector('#boss-timer i');const o=document.getElementById('boss-choice');return {bar:i?+(parseFloat(i.style.width)||0).toFixed(2):null,open:o?!o.classList.contains('hidden'):false,t:performance.now()}})()`);
    samples.push({rel:+(w.t-tShow).toFixed(0),bar:w.bar,open:w.open});
    if(!w.open) break;
    await sleep(40);
  }
  const th=await ev(`window.__RT.showHiddenAt`);
  const first0=samples.find(s=>s.bar===0);
  const bars=samples.slice(0,3).map(s=>({bar:s.bar}));
  out.windows.push({trial:k, windowMs:+(th-tShow).toFixed(0), firstBarSamples:bars,
    barZeroAtMs: first0? first0.rel:null,
    emptyBarButOpenMs: first0? +(th-(tShow+first0.rel)).toFixed(0):null,
    sampleCount:samples.length});
  await sleep(300);
}

// ===== 2) 条已空但仍可点？=====
{
  await resetRT(); await waitClosed();
  const s0=await state();
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await waitShow(); const info=await rects(); const correct=mapping(info.tell);
  const tShow=await ev(`window.__RT.show`);
  // 等到 bar 归零且面板未关
  let got=false, usedMs=null;
  for(let i=0;i<160;i++){
    const w=await ev(`(()=>{const i=document.querySelector('#boss-timer i');const o=document.getElementById('boss-choice');return {bar:i?+(parseFloat(i.style.width)||0).toFixed(2):null,open:o?!o.classList.contains('hidden'):false,t:performance.now()}})()`);
    if(!w.open) break;
    if(w.bar!==null && w.bar<=1){got=true; usedMs=+(w.t-tShow).toFixed(0); break;}
    await sleep(25);
  }
  await sleep(60);
  const b=info.btns.find(x=>x.choice===correct);
  await tap(b.x+b.w/2,b.y+b.h/2,40);
  await sleep(160);
  const s1=await state();
  out.latePress={reachedEmptyBar:got, usedMs, delta:+(s1.moyu-s0.moyu).toFixed(1),
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`),
    panelOpenAfter:await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`)};
  await sleep(400);
}

// ===== 3) 音效语义：选对 vs 选错 的振荡器频率 =====
async function pickAudio(forceWrong){
  await resetRT(); await waitClosed();
  await ev(`window.__AUD=[]`);
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await waitShow(); const info=await rects();
  const correct=mapping(info.tell);
  let pick=correct;
  if(forceWrong){ const alt=["act-busy","switch-screen","keep-slacking"].find(c=>c!==correct); pick=alt; }
  const b=info.btns.find(x=>x.choice===pick);
  await sleep(300);
  await tap(b.x+b.w/2,b.y+b.h/2,50);
  await sleep(300);
  return {isRight:pick===correct, tell:info.tell, pick, aud:await ev(`window.__AUD`)};
}
out.audio.right = await pickAudio(false);
await sleep(400);
out.audio.wrong = await pickAudio(true);
await sleep(400);

// ===== 4) 窄屏 320px：线索是否换行 / 面板几何 =====
await send("Emulation.setDeviceMetricsOverride",{width:320,height:720,deviceScaleFactor:3,mobile:true,screenWidth:320,screenHeight:720});
await sleep(800);
await ev(`(()=>{const b=document.querySelector('#cards-body .card'); if(b) b.click(); return 1})()`);
await sleep(300);
await resetRT(); await waitClosed();
await ev(`window.__MOYU__.forceBoss('choice')`);
await waitShow();
out.narrow = {vw:await ev(`innerWidth`), ...(await rects())};
await shot("/tmp/r13c-320.png");
await sleep(200);
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await sleep(600);
out.errors=errors;
writeFileSync("/tmp/r13c-action.json", JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
