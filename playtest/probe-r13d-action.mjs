// r13 操作党 终测（当前构建：CHOICE_SECONDS=5 + 画布点击屏蔽 + 新手宽限 + 超时提示）
// 记录：反应时间/窗口消耗、选对率、点击精度（间隙重定向）、按压反馈、超时/迟到、误触、播报文案
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9842;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13d]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13d-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Page.frameNavigated") log("NAV",m.params.frame.url);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
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
const out={meta:{},trials:[],special:{},errors:[]};
// 跳过今日卡（避免卡效果污染奖励数值）
out.meta.cardSkipped = await ev(`(()=>{const s=document.getElementById('cards-skip');if(s&&!document.getElementById('cards').classList.contains('hidden')){s.click();return true;}const c=document.querySelector('#cards-body .card');if(c&&!document.getElementById('cards').classList.contains('hidden')){return 'no-skip-btn';}return 'no-panel';})()`);
await sleep(300);
await ev(`window.__MOYU__.grant(1e9)`);
await sleep(400);
out.meta.build = await ev(`JSON.stringify({choiceSecs:5})`);

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
const waitClosed=(ms=8000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const o=document.getElementById('boss-choice');if(o&&o.classList.contains('hidden'))return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const waitShow=(ms=3000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const rects=()=>ev(`(()=>{const w=document.getElementById('boss-choice');const r=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
  const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,label:b.textContent,...r(b)}));
  const cs=getComputedStyle(w.querySelector('.boss-box'));
  return {box:r(w.querySelector('.boss-box')),btns,tell:window.__RT.tell,
   boxAnim:cs.animationName, boxTransition:cs.transitionDuration,
   srLive:(document.getElementById('sr-live')||{}).textContent||'',
   toast:(()=>{const e=document.getElementById('dom-toast');const b=e.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),text:e.textContent,show:e.classList.contains('show')}})(),
   btnActive: (()=>{const b=w.querySelector('.boss-opts button');const st=getComputedStyle(b);return {bg:st.backgroundColor,transform:st.transform}})()};})()`);
const KEY={"走路带风":"act-busy","盯着别人屏幕":"switch-screen","看手机":"keep-slacking","眼神是散":"keep-slacking"};
const mapping=(tell)=>{for(const k in KEY) if(tell.includes(k)) return KEY[k];return null;};
const fire=async()=>{await waitClosed();await ev(`window.__MOYU__.forceBoss('choice')`);};
async function trial(name,{reactionMs=400,guess=false,forceWrong=false}={}){
  await resetRT();
  const s0=await state();
  await fire();
  if(!(await waitShow())){out.trials.push({name,error:"no panel"});return;}
  const info=await rects(); const correct=mapping(info.tell);
  const pick = guess ? ["act-busy","switch-screen","keep-slacking"][Math.floor(Math.random()*3)] : forceWrong ? ["act-busy","switch-screen","keep-slacking"].find(c=>c!==correct) : correct;
  const t={name,tell:info.tell,tellLen:info.tell.length,correct,pick,isRight:pick===correct,modelMs:reactionMs,patrol:s0.patrolSurvives};
  const b=info.btns.find(x=>x.choice===pick);
  await sleep(reactionMs);
  await ev(`window.__RT.tPre=performance.now()`);
  await tap(b.x+b.w/2,b.y+b.h/2);
  await sleep(150);
  const r=await ev(`(()=>{const s=window.__MOYU__.state;return {clicks:window.__RT.clicks,ptr:window.__RT.ptr,show:window.__RT.show,paint:window.__RT.paint,tPre:window.__RT.tPre,streak:s.surviveStreak,patrol:s.patrolSurvives,moyu:Math.round(s.moyu*100)/100,toast:(document.getElementById('dom-toast')||{}).textContent||'',sr:(document.getElementById('sr-live')||{}).textContent||''}})()`);
  t.windowUsedMs=r.clicks[0]?+(r.clicks[0].t-r.show).toFixed(0):null;
  t.ptrToClickMs=r.ptr[0]&&r.clicks[0]?+(r.clicks[0].t-r.ptr[0].t).toFixed(1):null;
  t.delta=+(r.moyu-s0.moyu).toFixed(1);
  t.streak=[s0.surviveStreak,r.streak];
  t.toast=r.toast; t.srLive=r.sr;
  t.toastDelayMs=r.clicks[0]?+(r.clicks[0].t-r.tPre).toFixed(0):null;
  t.panelClosed=!(await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`));
  out.trials.push(t);
  log(name,t.windowUsedMs,t.isRight?'✓':'✗',t.delta,t.toast);
  await sleep(350);
}

// A) 前 4 次故意选错：验新手宽限边界（patrol 1-3 应 0 罚，第 4 次开始罚）
for(let i=1;i<=4;i++) await trial(`A${i}-故意选错`,{reactionMs:450,forceWrong:true});
// B) 熟练快按 8 次
for(let i=1;i<=8;i++) await trial(`B${i}-熟练快按`,{reactionMs:260+Math.random()*160});
// C) 慢读整句 2 次
for(let i=1;i<=2;i++) await trial(`C${i}-慢读整句`,{reactionMs:2400+i*400});

// D) 超时（不按）
{
  await resetRT(); await waitClosed();
  const s0=await state();
  await fire(); await waitShow();
  const info=await rects();
  const tShow=await ev(`window.__RT.show`);
  const samples=[]; let bar0=null;
  for(let i=0;i<160;i++){
    const w=await ev(`(()=>{const i=document.querySelector('#boss-timer i');const o=document.getElementById('boss-choice');return {bar:i?+(parseFloat(i.style.width)||0).toFixed(2):null,open:o?!o.classList.contains('hidden'):false,t:performance.now()}})()`);
    samples.push({rel:+(w.t-tShow).toFixed(0),bar:w.bar,open:w.open});
    if(w.bar===0 && bar0===null) bar0=+(w.t-tShow).toFixed(0);
    if(!w.open) break;
    await sleep(40);
  }
  await sleep(400);
  const s1=await state();
  out.special.timeout={tell:info.tell,srLiveAtShow:info.srLive,
    windowMs:await ev(`+(window.__RT.showHiddenAt-window.__RT.show).toFixed(0)`),
    barZeroAtMs:bar0, samples:samples.filter((s,i)=>i%3===0||s.bar===0),
    delta:+(s1.moyu-s0.moyu).toFixed(1), streak:[s0.surviveStreak,s1.surviveStreak],
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`),
    toastShown:await ev(`(document.getElementById('dom-toast')||{classList:{contains:()=>false}}).classList.contains('show')`)};
  await shot("/tmp/r13d-timeout.png");
  await sleep(300);
}

// E) 迟到点击：面板关闭后再点按钮位置（应不结算）
{
  await resetRT(); await waitClosed();
  const s0=await state();
  await fire(); await waitShow();
  const info=await rects();
  await waitClosed(8000); // 等超时关闭
  await sleep(300);
  const s1=await state();
  const b=info.btns[0];
  await tap(b.x+b.w/2,b.y+b.h/2);
  await sleep(200);
  const s2=await state();
  out.special.lateClick={afterTimeoutDelta:+(s1.moyu-s0.moyu).toFixed(1),
    tapAfterCloseDelta:+(s2.moyu-s1.moyu).toFixed(1), streak:[s0.surviveStreak,s2.surviveStreak],
    toastAfterTap:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`)};
  await sleep(300);
}

// F) 窗口内画布点击（新构建 doTap 直接 return）：应无收入无罚款、无飘字
{
  await resetRT(); await waitClosed();
  const s0=await state();
  await fire(); await waitShow();
  const info=await rects();
  await sleep(1500);
  const fx0=(await ev(`window.__MOYU__.fxTexts()`)).length;
  await tap(195,300);
  await sleep(200);
  const s1=await state();
  const fx1=await ev(`window.__MOYU__.fxTexts()`);
  // 再正常选对
  const correct=mapping(info.tell);
  const b=info.btns.find(x=>x.choice===correct);
  await sleep(300);
  await tap(b.x+b.w/2,b.y+b.h/2);
  await sleep(150);
  const s2=await state();
  out.special.canvasTapDuringWindow={deltaDuring:+(s1.moyu-s0.moyu).toFixed(1), fxNew:fx1.slice(fx0),
    streakAfterAll:s2.surviveStreak, totalDelta:+(s2.moyu-s0.moyu).toFixed(1), tell:info.tell};
  await sleep(300);
}

// G) 精度扫掠：按钮间隙/边缘（touch-adjust 是否把间隙点重定向到相邻按钮）
for(const [dx,r,note] of [[-3,3,"间隙正中(距按钮1左边缘 3px)"],[-5,3,"间隙偏左"],[-1,3,"间隙偏右"],[-6,3,"按钮0右边缘"],[-3,12,"间隙+大指腹 r=12"]]){
  await resetRT(); await waitClosed();
  const s0=await state();
  await fire(); await waitShow();
  const info=await rects(); const correct=mapping(info.tell);
  const b1=info.btns[1]; const x=b1.x+dx, y=b1.y+b1.h/2;
  const target=await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?e.tagName+(e.className?'.'+e.className:'')+'/'+(e.dataset&&e.dataset.choice||'')+'/ txt='+(e.textContent||'').slice(0,6):null})()`);
  await sleep(120);
  await tap(x,y,50,r);
  await sleep(160);
  const s1=await state();
  const rt=await ev(`({clicks:window.__RT.clicks,ptr:window.__RT.ptr})`);
  out.special[`precision-${note}`]={dx,radius:r,x:+x.toFixed(1),domTarget:target,
    resolved:rt.clicks[0]?.choice??null,ptrChoice:rt.ptr[0]?.choice??null,
    correct,isRight:(rt.clicks[0]?.choice??null)===correct,delta:+(s1.moyu-s0.moyu).toFixed(1),
    panelClosedAfterOneTap:!(await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`))};
  await sleep(300);
}

// H) 按压反馈 + 面板出现前是否有提示（动画/音效）
{
  await resetRT(); await waitClosed();
  await fire(); await waitShow();
  const info=await rects();
  const b=info.btns[0]; const cx=b.x+b.w/2, cy=b.y+b.h/2;
  const before=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter,outline:s.outlineStyle,boxShadow:s.boxShadow}})()`);
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:cx,y:cy,radiusX:3,radiusY:3,force:1}]});
  await sleep(170);
  const during=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter,outline:s.outlineStyle,boxShadow:s.boxShadow,clicks:window.__RT.clicks.length,panelOpen:!document.getElementById('boss-choice').classList.contains('hidden')}})()`);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await sleep(150);
  out.special.pressFeedback={before,during,boxAnim:info.boxAnim,boxTransition:info.boxTransition,
    note:"按住期间样式零变化；结算在 touchend"};
  await sleep(300);
}

// I) 面板几何 / 文案 / 遮挡 / 面板下方商店
{
  await resetRT(); await waitClosed();
  await ev(`(()=>{const t=document.getElementById('dom-toast');t.textContent='新章节：303 · 新的工位';t.classList.add('show');return 1})()`);
  await fire(); await waitShow();
  const info=await rects();
  await sleep(300);
  await shot("/tmp/r13d-overlap.png");
  const sA=await state();
  const card=await ev(`(()=>{const e=document.querySelector('[data-upgrade]');if(!e)return null;const b=e.getBoundingClientRect();return {id:e.dataset.upgrade,x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0)}})()`);
  let shopDelta=null;
  if(card && card.y>0 && card.y<844){
    await tap(card.x+card.w/2,card.y+card.h/2,50);
    await sleep(200);
    const sB=await state();
    shopDelta=+(sB.moyu-sA.moyu).toFixed(1);
  }
  out.special.layout={tell:info.tell,tellLen:info.tell.length,srLive:info.srLive,
    toastRect:info.toast,box:info.box,btn:info.btns[0],gapPx:+(info.btns[1].x-(info.btns[0].x+info.btns[0].w)).toFixed(1),
    btnActiveStyle:info.btnActive,panelToShopGap:card?+(card.y-(info.box.y+info.box.h)).toFixed(0):null,
    shopCard:card, shopTapDeltaDuringWindow:shopDelta};
  await waitClosed(8000);
}
out.errors=errors;
writeFileSync("/tmp/r13d-action.json", JSON.stringify(out,null,1));
console.log(JSON.stringify({meta:out.meta,trials:out.trials,special:out.special},null,1));
proc.kill("SIGKILL"); process.exit(0);
