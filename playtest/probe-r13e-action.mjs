// r13 操作党 终测 B（当前构建 5s + 画布屏蔽 + 新手宽限）：只跑特别项，带面板重试
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9843;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13e]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13e-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Page.frameNavigated") log("NAV",m.params.frame.url);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error).slice(0,120))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails){log("EVAL_ERR",(r.exceptionDetails.exception?.description||"").slice(0,160));return null;}return r.result.value;};
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
for(let i=0;i<150;i++){const ok=await ev(`typeof window.__MOYU__==='object' && document.readyState==='complete'`);if(ok===true)break;await sleep(100);}
await sleep(600);
const out={trials:[],special:{},errors:[]};
out.meta={cardSkipped: await ev(`(()=>{const s=document.getElementById('cards-skip');if(s&&!document.getElementById('cards').classList.contains('hidden')){s.click();return true;}return 'no-panel'})()`)};
await sleep(300);
await ev(`window.__MOYU__.grant(1e9)`);
await sleep(400);
await ev(`(()=>{
  const el=document.getElementById('boss-choice');
  window.__RT={show:null,showHiddenAt:null,tell:'',clicks:[],ptr:[]};
  if(window.__RTO) window.__RTO.disconnect();
  window.__RTO=new MutationObserver(()=>{
    if(!el.classList.contains('hidden') && window.__RT.show===null){window.__RT.show=performance.now();window.__RT.tell=document.getElementById('boss-tell').textContent;}
    if(el.classList.contains('hidden')) window.__RT.showHiddenAt=performance.now();
  });
  window.__RTO.observe(el,{attributes:true,attributeFilter:['class']});
  document.addEventListener('pointerdown',(e)=>{const b=e.target.closest&&e.target.closest('#boss-opts button');window.__RT.ptr.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName});},true);
  document.addEventListener('click',(e)=>{const b=e.target.closest&&e.target.closest('#boss-opts button');window.__RT.clicks.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName});},true);
  return 'ok';
})()`);
const resetRT=()=>ev(`(()=>{window.__RT.show=null;window.__RT.showHiddenAt=null;window.__RT.tell='';window.__RT.clicks=[];window.__RT.ptr=[];return 1})()`);
const isOpen=()=>ev(`!document.getElementById('boss-choice').classList.contains('hidden')`);
const waitClosed=(ms=8000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const o=document.getElementById('boss-choice');if(o&&o.classList.contains('hidden'))return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const waitShow=(ms=3000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const rects=()=>ev(`(()=>{const w=document.getElementById('boss-choice');const r=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
  const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,label:b.textContent,...r(b)}));
  const cs=getComputedStyle(w.querySelector('.boss-box'));
  return {box:r(w.querySelector('.boss-box')),btns,tell:window.__RT.tell,
   boxAnim:cs.animationName, boxTransition:cs.transitionDuration,
   srLive:(document.getElementById('sr-live')||{}).textContent||'',
   toast:(()=>{const e=document.getElementById('dom-toast');const b=e.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),text:e.textContent,show:e.classList.contains('show')}})()};})()`);
const KEY={"走路带风":"act-busy","盯着别人屏幕":"switch-screen","看手机":"keep-slacking","眼神是散":"keep-slacking"};
const mapping=(tell)=>{for(const k in KEY) if(tell.includes(k)) return KEY[k];return null;};
// 开一次确定的新面板（带重试：上一轮残留面板会吞掉 show 突变）
async function closeModals(){
  for(let i=0;i<6;i++){
    const st=await ev(`JSON.stringify({cards:!document.getElementById('cards').classList.contains('hidden'),journal:!document.getElementById('journal').classList.contains('hidden'),team:!document.getElementById('team').classList.contains('hidden'),welcome:!document.getElementById('welcome').classList.contains('hidden')})`);
    const o=JSON.parse(st||'{}');
    if(!o.cards&&!o.journal&&!o.team&&!o.welcome) return;
    if(o.cards){ await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27}); await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27}); }
    if(o.welcome){ await ev(`(()=>{const b=document.getElementById('welcome-ok');if(b)b.click();return 1})()`); }
    if(o.journal||o.team){ await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27}); await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27}); }
    await sleep(250);
  }
}
async function openChoice(){
  for(let attempt=1;attempt<=3;attempt++){
    await closeModals();
    if(await isOpen()){ // 残留面板：点掉它
      const info=await rects();
      const b=info.btns[0];
      if(b){await tap(b.x+b.w/2,b.y+b.h/2,40);await sleep(250);}
      else {await sleep(500);}
    }
    await waitClosed(8000);
    await resetRT();
    await ev(`window.__MOYU__.forceBoss('choice')`);
    const shown=await waitShow(2500);
    const info=shown? await rects():null;
    log(`openChoice attempt=${attempt} shown=${shown} tell=${info?JSON.stringify(info.tell):null} modals=${await ev(`JSON.stringify({cards:!document.getElementById('cards').classList.contains('hidden'),journal:!document.getElementById('journal').classList.contains('hidden'),team:!document.getElementById('team').classList.contains('hidden'),welcome:!document.getElementById('welcome').classList.contains('hidden'),fb:window.__MOYU__.forceBoss('choice')})`)}`);
    if(shown && info.tell && mapping(info.tell)) return info;
  }
  throw new Error("openChoice failed");
}

// 0) 「今天先不选」按钮专项：点了是否关闭弹窗 / 是否还挡事件
out.special.skipButton = await (async()=>{
  // 点 8 下画布促进卡片弹出（8 次点击后 maybeShow 生效）
  for(let i=0;i<9;i++){ await tap(195,320,35); await sleep(120); }
  let appeared=false;
  for(let i=0;i<80;i++){ appeared=!(await ev(`document.getElementById('cards').classList.contains('hidden')`)); if(appeared)break; await sleep(250); }
  if(!appeared) return {appeared:false};
  const r=await ev(`(()=>{const s=document.getElementById('cards-skip');const b=s.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),txt:s.textContent}})()`);
  await tap(r.x+r.w/2,r.y+r.h/2,50);
  await sleep(700);
  const hiddenAfterClick=await ev(`document.getElementById('cards').classList.contains('hidden')`);
  const dismissed=await ev(`JSON.stringify(window.__MOYU__.state.cards)`);
  // 弹窗还在时：forceBoss 是否被"模态期间推迟事件"吞掉
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await sleep(1200);
  const bossShownWhileModal=!(await ev(`document.getElementById('boss-choice').classList.contains('hidden')`));
  await shot("/tmp/r13e-skip.png");
  // Esc 兜底
  await send("Input.dispatchKeyEvent",{type:"keyDown",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await send("Input.dispatchKeyEvent",{type:"keyUp",key:"Escape",code:"Escape",windowsVirtualKeyCode:27});
  await sleep(500);
  const hiddenAfterEsc=await ev(`document.getElementById('cards').classList.contains('hidden')`);
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await sleep(800);
  const bossShownAfterEsc=!(await ev(`document.getElementById('boss-choice').classList.contains('hidden')`));
  return {appeared:true,skipBtn:r,hiddenAfterSkipClick:hiddenAfterClick,cardsState:dismissed,
    bossShownWhileModalStillOpen:bossShownWhileModal,hiddenAfterEsc, bossShownAfterEsc};
})();
await waitClosed(9000); await sleep(300);

// 1) 慢读 2 次（模型 2.4s / 2.8s）
for(const ms of [2400,2800]){
  const info=await openChoice(); const s0=await state();
  const correct=mapping(info.tell); const b=info.btns.find(x=>x.choice===correct);
  await sleep(ms);
  await tap(b.x+b.w/2,b.y+b.h/2,60);
  await sleep(150);
  const rt=await ev(`({clicks:window.__RT.clicks,show:window.__RT.show,ptr:window.__RT.ptr})`);
  const s1=await state();
  out.trials.push({name:`慢读${ms}`,tell:info.tell,windowUsedMs:rt.clicks[0]?+(rt.clicks[0].t-rt.show).toFixed(0):null,
    isRight:(rt.clicks[0]?.choice??null)===correct,delta:+(s1.moyu-s0.moyu).toFixed(1),streakAfter:s1.surviveStreak});
  await sleep(350);
}

// 2) 超时：窗口时长 + 提示
{
  await openChoice(); const s0=await state();
  const tShow=await ev(`window.__RT.show`);
  await waitClosed(9000);
  const winMs=await ev(`+(window.__RT.showHiddenAt-window.__RT.show).toFixed(0)`);
  await sleep(250);
  const s1=await state();
  out.special.timeout={windowMs:winMs,delta:+(s1.moyu-s0.moyu).toFixed(1),streak:[s0.surviveStreak,s1.surviveStreak],
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`),
    toastShown:await ev(`(document.getElementById('dom-toast')||{classList:{contains:()=>false}}).classList.contains('show')`)};
  await shot("/tmp/r13e-timeout.png");
  await sleep(300);
}

// 3) 迟到点击（超时关闭后再点原按钮位置）
{
  const info=await openChoice(); const s0=await state();
  await waitClosed(9000); await sleep(200);
  const s1=await state();
  const b=info.btns[1];
  await tap(b.x+b.w/2,b.y+b.h/2,50); await sleep(200);
  const s2=await state();
  out.special.lateClick={afterTimeoutDelta:+(s1.moyu-s0.moyu).toFixed(1),tapDelta:+(s2.moyu-s1.moyu).toFixed(1),
    streak:[s0.surviveStreak,s2.surviveStreak],toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`)};
  await sleep(300);
}

// 4) 窗口内画布点击：应完全无响应（doTap 早退）
{
  const info=await openChoice(); const s0=await state();
  await sleep(1500);
  const fx0=(await ev(`window.__MOYU__.fxTexts()`)).length;
  await tap(195,300); await sleep(120);
  await tap(120,420); await sleep(200);
  const fx1=await ev(`window.__MOYU__.fxTexts()`);
  const s1=await state();
  const correct=mapping(info.tell); const b=info.btns.find(x=>x.choice===correct);
  await sleep(300); await tap(b.x+b.w/2,b.y+b.h/2,60); await sleep(150);
  const s2=await state();
  out.special.canvasTapDuringWindow={deltaDuring:+(s1.moyu-s0.moyu).toFixed(1),fxNew:fx1.slice(fx0),
    panelStillOpen:await ev(`null`),streakAfterAll:s2.surviveStreak,totalDelta:+(s2.moyu-s0.moyu).toFixed(1),tell:info.tell};
  await sleep(300);
}

// 5) 精度扫掠
for(const [dx,r,note] of [[-3,3,"间隙正中"],[0,3,"按钮1左边缘"],[+3,3,"按钮1内3px"],[-3,14,"间隙+大指腹"]]){
  const info=await openChoice(); const s0=await state();
  const correct=mapping(info.tell);
  const b1=info.btns[1]; const x=b1.x+dx, y=b1.y+b1.h/2;
  const domTarget=await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?e.tagName+'/'+(e.dataset&&e.dataset.choice||'-')+'/'+(e.textContent||'').slice(0,6):null})()`);
  await sleep(120);
  await tap(x,y,50,r); await sleep(180);
  const rt=await ev(`({clicks:window.__RT.clicks,ptr:window.__RT.ptr})`);
  const s1=await state();
  out.special[`precision-${note}`]={x:+x.toFixed(1),radius:r,domTarget,resolved:rt.clicks[0]?.choice??null,
    correct,isRight:(rt.clicks[0]?.choice??null)===correct,delta:+(s1.moyu-s0.moyu).toFixed(1),
    oneTapResolvedPanelClosed:!(await isOpen())};
  await sleep(300);
}

// 6) 按压反馈 / 出现动画 / 播报文案 / 布局 / 商店可点
{
  const info=await openChoice();
  const b=info.btns[0]; const cx=b.x+b.w/2, cy=b.y+b.h/2;
  const before=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter}})()`);
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:cx,y:cy,radiusX:3,radiusY:3,force:1}]});
  await sleep(180);
  const during=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter,clicks:window.__RT.clicks.length,open:!document.getElementById('boss-choice').classList.contains('hidden')}})()`);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await sleep(150);
  const sA=await state();
  const card=await ev(`(()=>{const e=document.querySelector('[data-upgrade]');if(!e)return null;const b=e.getBoundingClientRect();return {id:e.dataset.upgrade,x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),txt:e.textContent.slice(0,10)}})()`);
  // 再开一次测量商店误触（面板下方）
  const info2=await openChoice();
  const s0b=await state();
  await sleep(900);
  let shopDelta=null;
  const card2=await ev(`(()=>{const e=document.querySelector('[data-upgrade]');if(!e)return null;const b=e.getBoundingClientRect();return {id:e.dataset.upgrade,x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0)}})()`);
  if(card2){ await tap(card2.x+card2.w/2,card2.y+card2.h/2,50); await sleep(200); const s1b=await state(); shopDelta=+(s1b.moyu-s0b.moyu).toFixed(1); }
  out.special.feel={press:{before,during},boxAnim:info.boxAnim,boxTransition:info.boxTransition,
    srLiveAtShow:info.srLive,tell:info.tell,tellLen:info.tell.length,
    toastRect:info.toast,box:info.box,btn:info.btns[0],
    gapPx:+(info.btns[1].x-(info.btns[0].x+info.btns[0].w)).toFixed(1),
    panelToShopGap:card&&info.box?+(card.y-(info.box.y+info.box.h)).toFixed(0):null,
    shopCard:card,shopTapDuringWindowDelta:shopDelta};
  await shot("/tmp/r13e-panel.png");
  await waitClosed(9000);
}
out.errors=errors;
writeFileSync("/tmp/r13e-action.json", JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
