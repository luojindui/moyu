// r13 复验（HEAD 6ecbeef）：竖排按钮 / :active / pointerdown 结算 / 250ms 守卫 / 商店屏蔽 / 画布提示
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9845;
const URL_ = process.env.R13_URL || "http://127.0.0.1:5181/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13f]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13f-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[]; let navs=0;
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Page.frameNavigated"){navs++;log("NAV",navs,m.params.frame.url);}
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error).slice(0,120))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails){log("EVAL_ERR",(r.exceptionDetails.exception?.description||"").slice(0,160));return null;}return r.result.value;};
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
const out={meta:{url:URL_,navs:0},trials:[],special:{},errors:[]};
await ev(`window.__MOYU__.grant(1e9)`); await sleep(300);
await ev(`(()=>{
  const el=document.getElementById('boss-choice');
  window.__RT={show:null,showHiddenAt:null,tell:'',ptr:[],picks:[],fx:[]};
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
  const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,label:b.textContent,...r(b)}));
  const opts=w.querySelector('.boss-opts'); const cs=getComputedStyle(opts);
  return {box:r(w.querySelector('.boss-box')),btns,opts:r(opts),flexDir:cs.flexDirection,gap:cs.gap,
   tell:window.__RT.tell, srLive:(document.getElementById('sr-live')||{}).textContent||'',
   bodyChoiceOpen:document.body.classList.contains('choice-open'),
   shopPE:(()=>{const s=document.getElementById('shop-cards');const x=getComputedStyle(s);return {pe:x.pointerEvents,opacity:x.opacity}})(),
   toast:(()=>{const e=document.getElementById('dom-toast');const b=e.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),text:e.textContent,show:e.classList.contains('show')}})()};})()`);
const KEY={"脚步声又快又重":"act-busy","盯着别人的屏幕":"switch-screen","看手机":"keep-slacking","眼神是散":"keep-slacking"};
const mapping=(tell)=>{for(const k in KEY) if(tell.includes(k)) return KEY[k];return null;};
async function closeModals(){
  for(let i=0;i<5;i++){
    const st=JSON.parse(await ev(`JSON.stringify({cards:!document.getElementById('cards').classList.contains('hidden'),journal:!document.getElementById('journal').classList.contains('hidden'),team:!document.getElementById('team').classList.contains('hidden'),welcome:!document.getElementById('welcome').classList.contains('hidden')})`)||'{}');
    if(!st.cards&&!st.journal&&!st.team&&!st.welcome) return;
    await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
    await ev(`(()=>{const b=document.getElementById('cards-skip');if(b&&!document.getElementById('cards').classList.contains('hidden'))b.click();return 1})()`);
    await sleep(250);
  }
}
let panelfails=0;
async function openChoice(){
  for(let a=1;a<=3;a++){
    await closeModals();
    if(await isOpen()){ const inf=await rects(); const b=inf.btns[0]; if(b){await tap(b.x+b.w/2,b.y+b.h/2,40);await sleep(250);} else await sleep(400); }
    await waitClosed(8000); await resetRT();
    await ev(`window.__MOYU__.forceBoss('choice')`);
    if(await waitShow(2500)){ const inf=await rects(); if(inf.tell&&mapping(inf.tell)) return inf; }
  }
  panelfails++; throw new Error("openChoice failed");
}

// ===== 1) 几何 =====
{
  const info=await openChoice();
  out.special.geometry={box:info.box,opts:info.opts,flexDir:info.flexDir,gap:info.gap,btns:info.btns,
    btnH:info.btns[0]?.h,btnW:info.btns[0]?.w,verticalGaps:[+(info.btns[1].y-(info.btns[0].y+info.btns[0].h)).toFixed(1),+(info.btns[2].y-(info.btns[1].y+info.btns[1].h)).toFixed(1)],
    tell:info.tell,tellLen:info.tell?.length,srLive:info.srLive,bodyChoiceOpen:info.bodyChoiceOpen,
    shopPointerEvents:info.shopPE,boxTopY:info.box.y,boxBottomY:+(info.box.y+info.box.h).toFixed(1)};
  await shot("/tmp/r13f-panel.png");
  await waitClosed(9000); await sleep(250);
}

// ===== 2) 竖排间隙/边缘误点（大指腹）=====
for(const [name,ddx,ddy,r] of [["行1-行2间隙(中点)",0,0,3],["行间隙+大指腹",0,0,16],["行1上缘外2px",0,-2,3],["行3下缘外2px",0,2,3]]){
  const info=await openChoice(); const s0=await state(); const correct=mapping(info.tell);
  const b1=info.btns[0], b2=info.btns[1], b3=info.btns[2];
  let x,y;
  if(ddx===0&&ddy===0){ x=b1.x+b1.w/2; y=b1.y+b1.h+(b2.y-(b1.y+b1.h))/2; }
  else if(name==="行1上缘外2px"){ x=b1.x+b1.w/2; y=b1.y-2; }
  else { x=b3.x+b3.w/2; y=b3.y+b3.h+2; }
  const domTarget=await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?e.tagName+'/'+(e.dataset&&e.dataset.choice||'-')+'/'+(e.textContent||'').slice(0,6):null})()`);
  const tt=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter}})()`);
  await sleep(320);
  await touchStart(x,y,r); await sleep(70); await touchEnd();
  await sleep(180);
  const ptr=await ev(`window.__RT.ptr.slice(-1)[0]`);
  const s1=await state();
  out.special[`gap-${name}`]={x:+x.toFixed(1),y:+y.toFixed(1),radius:r,domTarget,pointerTarget:ptr?.tag+'/'+(ptr?.choice||'-'),
    resolvedChoice:ptr?.choice??null,correct,isRight:(ptr?.choice??null)===correct,delta:+(s1.moyu-s0.moyu).toFixed(1),
    panelClosedAfterOnePress:!(await isOpen())};
  await sleep(280);
}

// ===== 3) 按下反馈 + pointerdown 即结算 =====
{
  const info=await openChoice();
  const b=info.btns[1]; const cx=b.x+b.w/2, cy=b.y+b.h/2;
  const s0=await state();
  await sleep(350);
  const before=await ev(`(()=>{const b=document.querySelectorAll('#boss-opts button')[1];const s=getComputedStyle(b);return {transform:s.transform,filter:s.filter,bg:s.backgroundColor}})()`);
  const tShow=await ev(`window.__RT.show`);
  await touchStart(cx,cy);
  await sleep(90);
  const during=await ev(`(()=>{const b=document.querySelectorAll('#boss-opts button')[1];const s=b?getComputedStyle(b):null;return {transform:s&&s.transform,filter:s&&s.filter,bg:s&&s.backgroundColor,open:!document.getElementById('boss-choice').classList.contains('hidden'),ptr:window.__RT.ptr.slice(-1)[0]}})()`);
  await sleep(120);
  const openWhileHeld=await isOpen();
  await touchEnd();
  await sleep(120);
  const s1=await state();
  const hid=await ev(`window.__RT.showHiddenAt`);
  out.special.pressFeedback={before,during,
    panelStillOpenDuringPress:during.open, openAfter180msHold:openWhileHeld,
    pointerdownChoice:during.ptr?.choice??null,
    pressToHideMs:hid?+(hid-tShow).toFixed(1):null,
    delta:+(s1.moyu-s0.moyu).toFixed(1),resolvedOnPress:!(openWhileHeld)};
  await sleep(350);
}

// ===== 4) 250ms 开局守卫 =====
for(const delay of [100,180,420]){
  const info=await openChoice(); const s0=await state(); const correct=mapping(info.tell);
  const b=info.btns.find(x=>x.choice===correct);
  const tShow=await ev(`window.__RT.show`);
  const now=await ev(`performance.now()`);
  const wait=Math.max(0, delay-(now-tShow));
  await sleep(wait);
  await touchStart(b.x+b.w/2,b.y+b.h/2); await sleep(60); await touchEnd();
  await sleep(200);
  const pressedAt=await ev(`+(window.__RT.ptr.slice(-1)[0]?.t-window.__RT.show).toFixed(0)`);
  const s1=await state();
  const stillOpen=await isOpen();
  out.special[`guard-${delay}ms`]=({targetDelay:delay,pressedAtMs:pressedAt,
    resolved:!stillOpen, delta:+(s1.moyu-s0.moyu).toFixed(1), fx:(await ev(`window.__MOYU__.fxTexts()`)).slice(-2)});
  if(stillOpen){ // 别卡住：补一按
    await sleep(200); await touchStart(b.x+b.w/2,b.y+b.h/2); await sleep(60); await touchEnd(); await sleep(250);
  }
  await waitClosed(9000); await sleep(250);
}

// ===== 5) 窗口内商店拦截 =====
{
  const info=await openChoice(); const s0=await state();
  const card=await ev(`(()=>{const e=document.querySelector('[data-upgrade]');if(!e)return null;const b=e.getBoundingClientRect();return {id:e.dataset.upgrade,x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0)}})()`);
  const shopPE=info.shopPE;
  await sleep(400);
  await tap(card.x+card.w/2,card.y+card.h/2,50);
  await sleep(200);
  const s1=await state();
  out.special.shopBlocked={shopPointerEventsDuringWindow:shopPE,card,delta:+(s1.moyu-s0.moyu).toFixed(1),
    bought:(await ev(`window.__MOYU__.state.upgrades`))};
  await shot("/tmp/r13f-shopblock.png");
  await waitClosed(9000); await sleep(250);
}

// ===== 6) 画布点击提示 =====
{
  const info=await openChoice(); const s0=await state();
  await sleep(400);
  const fx0=(await ev(`window.__MOYU__.fxTexts()`)).length;
  const tapX=195, tapY=300;
  await tap(tapX,tapY,50); await sleep(200);
  const fx1=await ev(`window.__MOYU__.fxTexts()`);
  const s1=await state();
  out.special.canvasHint={tapAt:{x:tapX,y:tapY},fxNew:fx1.slice(fx0),delta:+(s1.moyu-s0.moyu).toFixed(1),
    panelStillOpen:await isOpen(),
    canvasRect:await ev(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:b.x,y:b.y}})()`)};
  const correct=mapping(info.tell); const b=info.btns.find(x=>x.choice===correct);
  await touchStart(b.x+b.w/2,b.y+b.h/2); await sleep(60); await touchEnd(); await sleep(200);
  await waitClosed(9000); await sleep(250);
}

// ===== 7) 正常试玩 8 次（快按）+ 2 次慢读 + 2 次故意错 =====
for(let i=1;i<=8;i++){
  const info=await openChoice(); const s0=await state(); const correct=mapping(info.tell);
  const b=info.btns.find(x=>x.choice===correct);
  await sleep(300+Math.random()*180);
  await touchStart(b.x+b.w/2,b.y+b.h/2); await sleep(50); await touchEnd();
  await sleep(160);
  const ptr=await ev(`window.__RT.ptr.slice(-1)[0]`);
  const s1=await state();
  out.trials.push({name:`快按${i}`,tell:info.tell,pressAtMs:+(ptr.t-info.show).toFixed(0),
    isRight:(ptr.choice??null)===correct,delta:+(s1.moyu-s0.moyu).toFixed(1),streakAfter:s1.surviveStreak,
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`)});
  await sleep(300);
}
for(const ms of [2600,3200]){
  const info=await openChoice(); const s0=await state(); const correct=mapping(info.tell);
  const b=info.btns.find(x=>x.choice===correct);
  await sleep(ms);
  await touchStart(b.x+b.w/2,b.y+b.h/2); await sleep(50); await touchEnd();
  await sleep(160);
  const ptr=await ev(`window.__RT.ptr.slice(-1)[0]`);
  const s1=await state();
  out.trials.push({name:`慢读${ms}`,pressAtMs:+(ptr.t-info.show).toFixed(0),isRight:(ptr.choice??null)===correct,
    delta:+(s1.moyu-s0.moyu).toFixed(1),streakAfter:s1.surviveStreak});
  await sleep(300);
}
for(const [i] of [[1],[2]]){
  const info=await openChoice(); const s0=await state(); const correct=mapping(info.tell);
  const alt=info.btns.find(x=>x.choice!==correct);
  await sleep(400);
  await touchStart(alt.x+alt.w/2,alt.y+alt.h/2); await sleep(50); await touchEnd();
  await sleep(160);
  const s1=await state();
  out.trials.push({name:`故意错${i}`,isRight:false,delta:+(s1.moyu-s0.moyu).toFixed(1),streakAfter:s1.surviveStreak,
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`)});
  await sleep(300);
}

// ===== 8) 超时 / 横幅遮挡 / 迟到 =====
{
  await openChoice(); const s0=await state();
  await sleep(700);
  await shot("/tmp/r13f-overlap.png");
  const toastRect=await ev(`(()=>{const e=document.getElementById('dom-toast');const b=e.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),text:e.textContent,show:e.classList.contains('show')}})()`);
  await waitClosed(9000);
  const winMs=await ev(`+(window.__RT.showHiddenAt-window.__RT.show).toFixed(0)`);
  await sleep(250);
  const s1=await state();
  out.special.timeout={windowMs:winMs,delta:+(s1.moyu-s0.moyu).toFixed(1),streak:[s0.surviveStreak,s1.surviveStreak],
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`),toastAtShow:toastRect};
  await waitClosed(9000); await sleep(200);
}
out.meta.navs=navs; out.meta.panelfails=panelfails; out.errors=errors;
writeFileSync("/tmp/r13f-action.json", JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
