// r13 复验补测：:active 可见性 / 250ms 守卫吞按 / 竖排间隙与内边距误点细节
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9846;
const URL_ = process.env.R13_URL || "http://127.0.0.1:5181/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13g]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13g-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map();
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error).slice(0,120))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails){log("EVAL_ERR",(r.exceptionDetails.exception?.description||"").slice(0,150));return null;}return r.result.value;};
const shot=async(path)=>{const s=await send("Page.captureScreenshot",{format:"png"});writeFileSync(path,Buffer.from(s.data,"base64"));};
const touchStart=async(x,y,r=3)=>send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,radiusX:r,radiusY:r,force:1}]});
const touchEnd=async()=>send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
const tap=async(x,y,hold=60,r=3)=>{await touchStart(x,y,r);await sleep(hold);await touchEnd();};
const state=()=>ev(`window.__MOYU__.state`);
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:URL_});
for(let i=0;i<150;i++){const ok=await ev(`typeof window.__MOYU__==='object' && document.readyState==='complete'`);if(ok===true)break;await sleep(100);}
await sleep(500);
await ev(`window.__MOYU__.grant(1e9)`); await sleep(300);
await ev(`(()=>{
  const el=document.getElementById('boss-choice');
  window.__RT={show:null,showHiddenAt:null,tell:'',ptr:[]};
  if(window.__RTO) window.__RTO.disconnect();
  window.__RTO=new MutationObserver(()=>{
    if(!el.classList.contains('hidden') && window.__RT.show===null){window.__RT.show=performance.now();window.__RT.tell=document.getElementById('boss-tell').textContent;}
    if(el.classList.contains('hidden')) window.__RT.showHiddenAt=performance.now();
  });
  window.__RTO.observe(el,{attributes:true,attributeFilter:['class']});
  document.addEventListener('pointerdown',(e)=>{const b=e.target.closest&&e.target.closest('#boss-opts button');window.__RT.ptr.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName,open:!el.classList.contains('hidden')});},true);
  return 'ok';
})()`);
const resetRT=()=>ev(`(()=>{window.__RT.show=null;window.__RT.showHiddenAt=null;window.__RT.tell='';window.__RT.ptr=[];return 1})()`);
const isOpen=()=>ev(`!document.getElementById('boss-choice').classList.contains('hidden')`);
const waitClosed=(ms=8000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const o=document.getElementById('boss-choice');if(o&&o.classList.contains('hidden'))return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const waitShow=(ms=3000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const rects=()=>ev(`(()=>{const w=document.getElementById('boss-choice');const r=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
  const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,...r(b)}));
  return {box:r(w.querySelector('.boss-box')),btns,tell:window.__RT.tell,opts:r(w.querySelector('.boss-opts'))};})()`);
const KEY={"脚步声又快又重":"act-busy","盯着别人的屏幕":"switch-screen","看手机":"keep-slacking","眼神是散":"keep-slacking"};
const mapping=(tell)=>{for(const k in KEY) if(tell.includes(k)) return KEY[k];return null;};
async function closeModals(){
  for(let i=0;i<5;i++){
    const st=JSON.parse(await ev(`JSON.stringify({cards:!document.getElementById('cards').classList.contains('hidden'),journal:!document.getElementById('journal').classList.contains('hidden'),team:!document.getElementById('team').classList.contains('hidden'),welcome:!document.getElementById('welcome').classList.contains('hidden')})`)||'{}');
    if(!st.cards&&!st.journal&&!st.team&&!st.welcome) return;
    await ev(`(()=>{const b=document.getElementById('cards-skip');if(b&&!document.getElementById('cards').classList.contains('hidden'))b.click();const w=document.getElementById('welcome-ok');if(w&&!document.getElementById('welcome').classList.contains('hidden'))w.click();return 1})()`);
    await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await sleep(250);
  }
}
async function openChoice(){
  for(let a=1;a<=3;a++){
    await closeModals();
    if(await isOpen()){ const i=await rects(); const b=i.btns[0]; if(b){await tap(b.x+b.w/2,b.y+b.h/2,40);await sleep(250);} else await sleep(400); }
    await waitClosed(8000); await resetRT();
    await ev(`window.__MOYU__.forceBoss('choice')`);
    if(await waitShow(2500)){ const i=await rects(); if(i.tell&&mapping(i.tell)) return i; }
  }
  throw new Error("openChoice failed");
}
const out={active:{},guard:{},gapDetail:[],errors:[]};

// A) :active 可见性：在 250ms 守卫窗内按住（面板不会被隐藏）→ 采样样式 + 截图
{
  const info=await openChoice();
  const b=info.btns[1]; const cx=b.x+b.w/2, cy=b.y+b.h/2;
  const tShow=await ev(`window.__RT.show`);
  // 等到 150ms 左右按下
  const now=await ev(`performance.now()`); await sleep(Math.max(0,150-(now-tShow)));
  const before=await ev(`(()=>{const b=document.querySelectorAll('#boss-opts button')[1];const s=getComputedStyle(b);return {transform:s.transform,filter:s.filter,transition:s.transitionDuration}})()`);
  await touchStart(cx,cy);
  await sleep(120);
  const duringGuard=await ev(`(()=>{const b=document.querySelectorAll('#boss-opts button')[1];const s=getComputedStyle(b);return {transform:s.transform,filter:s.filter,panelOpen:!document.getElementById('boss-choice').classList.contains('hidden'),ptr:window.__RT.ptr.slice(-1)[0]}})()`);
  await shot("/tmp/r13g-active.png");
  await sleep(300); // 按住超过守卫
  const afterGuardHold=await ev(`({open:!document.getElementById('boss-choice').classList.contains('hidden'),ptr:window.__RT.ptr.slice(-1)})`);
  await touchEnd(); await sleep(200);
  const s=await state();
  // 守卫内的按下是否给出任何提示？
  out.active={before,duringGuard,afterGuardHold,stillOpenAfterRelease:await isOpen(),
    delta:null,fx:await ev(`window.__MOYU__.fxTexts()`),
    note:"250ms 内按下被守卫吞掉时按钮仍显示 :active（可通过按住看到）"};
  await waitClosed(9000); await sleep(300);
}

// B) 守卫内的按下：是否有任何提示（fx/toast/音效）→ 需要比对 fx 数量
{
  const info=await openChoice();
  const b=info.btns[0]; const correct=mapping(info.tell);
  const s0=await state();
  const tShow=await ev(`window.__RT.show`);
  const now=await ev(`performance.now()`); await sleep(Math.max(0,120-(now-tShow)));
  const fxBefore=(await ev(`window.__MOYU__.fxTexts()`)).length;
  const toastBefore=await ev(`(document.getElementById('dom-toast')||{}).textContent||''`);
  await touchStart(b.x+b.w/2,b.y+b.h/2); await sleep(60); await touchEnd();
  await sleep(250);
  const fxAfter=await ev(`window.__MOYU__.fxTexts()`);
  const stillOpen=await isOpen();
  const s1=await state();
  out.guard={pressedAtMs:await ev(`+(window.__RT.ptr.slice(-1)[0].t-window.__RT.show).toFixed(0)`),
    panelStillOpen:stillOpen,delta:+(s1.moyu-s0.moyu).toFixed(1),fxNew:fxAfter.slice(fxBefore),
    toastBefore,toastAfter:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`),
    note:"守卫吞按后玩家看不到任何提示，需要再按一次"};
  await shot("/tmp/r13g-guard.png");
  // 补按一次正常选对
  const cb=info.btns.find(x=>x.choice===correct);
  await sleep(150); await touchStart(cb.x+cb.w/2,cb.y+cb.h/2); await sleep(60); await touchEnd(); await sleep(200);
  await waitClosed(9000); await sleep(300);
}

// C) 竖排间隙/内边距细节 ×3
for(const [name,which] of [["行1-行2间隙",0],["行1上内边距(盒顶-6px)",1],["行3下内边距(盒底-6px)",2]]){
  for(let rep=1;rep<=2;rep++){
    const info=await openChoice(); const s0=await state(); const correct=mapping(info.tell);
    const b1=info.btns[0],b2=info.btns[1],b3=info.btns[2];
    let x=195,y;
    if(which===0) y=(b1.y+b1.h+b2.y)/2;
    else if(which===1) y=b1.y-6;
    else y=b3.y+b3.h+6;
    const domTarget=await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?e.tagName+'/'+(e.dataset&&e.dataset.choice||'-'):null})()`);
    await sleep(420);
    await touchStart(x,y); await sleep(60); await touchEnd();
    await sleep(200);
    const ptr=await ev(`window.__RT.ptr.slice(-1)[0]`);
    const s1=await state();
    out.gapDetail.push({name,rep,x:+x.toFixed(1),y:+y.toFixed(1),domTarget,
      ptrChoice:ptr?.choice??null,correct,isRight:(ptr?.choice??null)===correct,
      delta:+(s1.moyu-s0.moyu).toFixed(1),closed:!(await isOpen()),
      toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`)});
    await waitClosed(9000); await sleep(280);
  }
}
writeFileSync("/tmp/r13g-action.json",JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
