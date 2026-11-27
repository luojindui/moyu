// r13 操作党 探针 2：点击精度（按钮间隙/边缘）、按压反馈、变体对比、超时静默、规则播报
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9836;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13b]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13b-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails){log("EVAL_ERR",JSON.stringify(r.exceptionDetails).slice(0,200));return null;}return r.result.value;};
const shot=async(path)=>{const s=await send("Page.captureScreenshot",{format:"png"});writeFileSync(path,Buffer.from(s.data,"base64"));};
const tap=async(x,y,hold=60,r=3)=>{
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,radiusX:r,radiusY:r,force:1}]});
  await sleep(hold);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
};
const state=()=>ev(`window.__MOYU__.state`);

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(3000);
await ev(`(()=>{const b=document.querySelector('#cards-body .card'); if(b) b.click(); return !!b})()`);
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
  document.addEventListener('pointerdown',(e)=>{const b=e.target.closest&&e.target.closest('#boss-opts button');window.__RT.ptr.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName+(e.target.className?'.'+e.target.className:'')});},true);
  document.addEventListener('click',(e)=>{const b=e.target.closest&&e.target.closest('#boss-opts button');window.__RT.clicks.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName+(e.target.className?'.'+e.target.className:'')});},true);
  return 'ok';
})()`);
const resetRT=()=>ev(`(()=>{window.__RT.show=null;window.__RT.showHiddenAt=null;window.__RT.tell='';window.__RT.clicks=[];window.__RT.ptr=[];return 1})()`);
const waitClosed=(ms=7000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const o=document.getElementById('boss-choice');if(o&&o.classList.contains('hidden'))return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const waitShow=(ms=3000)=>ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
const rects=()=>ev(`(()=>{const w=document.getElementById('boss-choice');const r=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
  const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,label:b.textContent,...r(b)}));
  return {box:r(w.querySelector('.boss-box')),btns,tell:window.__RT.tell,
   toast:(()=>{const e=document.getElementById('dom-toast');const b=e.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0),text:e.textContent,show:e.classList.contains('show')}})(),
   srLive:(document.getElementById('sr-live')||{}).textContent||'',
   shopRect:(()=>{const s=document.querySelector('#shop, .shop, #upgrades');if(!s)return null;const b=s.getBoundingClientRect();return {x:+b.x.toFixed(0),y:+b.y.toFixed(0),h:+b.height.toFixed(0)}})(),
  };})()`);
const KEY={"走路带风":"act-busy","盯着别人屏幕":"switch-screen","看手机":"keep-slacking","眼神是散":"keep-slacking"};
const mapping=(tell)=>{for(const k in KEY) if(tell.includes(k)) return KEY[k];return null;};

const out={precision:[],variants:{},press:{},timeout:{},misc:{}};
const r0 = await ev(`(()=>{const w=document.getElementById('boss-choice');const b=w.querySelector('.boss-box');return 1})()`);

// ===== 1) 点击精度扫掠：从按钮1左边缘往左，不同半径的触点 =====
for(const [dx,radius] of [[-18,3],[-12,3],[-8,3],[-6,3],[-3,3],[-2,3],[+2,3],[-3,10],[-8,10],[-3,18]]){
  await resetRT(); await waitClosed();
  const s0=await state();
  await ev(`window.__MOYU__.forceBoss('choice')`);
  const shown=await waitShow();
  if(!shown){out.precision.push({dx,radius,error:"no panel"});continue;}
  const info=await rects();
  const b1=info.btns[1];
  const x=b1.x+dx, y=b1.y+b1.h/2;
  const target=await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?e.tagName+(e.className?'.'+e.className:'')+':'+(e.dataset&&e.dataset.choice||'')+'|text='+(e.textContent||'').slice(0,8):null})()`);
  await sleep(90);
  await tap(x,y,50,radius);
  await sleep(160);
  const s1=await state();
  const rt=await ev(`({clicks:window.__RT.clicks,ptr:window.__RT.ptr,hiddenAt:window.__RT.showHiddenAt,show:window.__RT.show})`);
  out.precision.push({dx,radius,x:+x.toFixed(1),y:+y.toFixed(1),domTarget:target,resolvedChoice:rt.clicks[0]?.choice??null,
    ptrChoice:rt.ptr[0]?.choice??null, ptrTag:rt.ptr[0]?.tag??null, delta:+(s1.moyu-s0.moyu).toFixed(1),
    panelClosed:!(await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`)),
    tell:info.tell, correct:mapping(info.tell)});
  await sleep(250);
}

// ===== 2) 按压反馈：touchStart 按住时按钮样式是否变化 =====
{
  await resetRT(); await waitClosed();
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await waitShow(); const info=await rects();
  const c=info.btns[0];
  const cx=c.x+c.w/2, cy=c.y+c.h/2;
  const before=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter,outline:s.outlineStyle,boxShadow:s.boxShadow}})()`);
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:cx,y:cy,radiusX:3,radiusY:3,force:1}]});
  await sleep(160);
  const during=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=getComputedStyle(b);return {bg:s.backgroundColor,transform:s.transform,filter:s.filter,outline:s.outlineStyle,boxShadow:s.boxShadow,panelOpen:!document.getElementById('boss-choice').classList.contains('hidden'),clicks:window.__RT.clicks.length}})()`);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await sleep(150);
  const after=await ev(`(()=>{const b=document.querySelector('#boss-opts button');const s=b?getComputedStyle(b):null;return {bg:s&&s.backgroundColor,panelOpen:!document.getElementById('boss-choice').classList.contains('hidden'),clicks:window.__RT.clicks.length}})()`);
  out.press={before,during,after,note:"按住 160ms 期间按钮无任何样式变化；点击在 touchEnd 才结算"};
  await sleep(300);
}

// ===== 3) 超时静默：清空 toast 后触发，等到自动关闭 =====
{
  await sleep(2100); // 让上一条 toast 消失
  await resetRT(); await waitClosed();
  const s0=await state();
  const fx0=await ev(`window.__MOYU__.fxTexts().length`);
  const toast0=await ev(`(document.getElementById('dom-toast')||{}).textContent+'|'+(document.getElementById('dom-toast')||{classList:{contains:()=>false}}).classList.contains('show')`);
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await waitShow(); const info=await rects();
  const tShow=await ev(`window.__RT.show`);
  await waitClosed(7000);
  await sleep(300);
  const s1=await state();
  const fx1=await ev(`window.__MOYU__.fxTexts().length`);
  const toast1=await ev(`(document.getElementById('dom-toast')||{}).textContent+'|'+(document.getElementById('dom-toast')||{classList:{contains:()=>false}}).classList.contains('show')`);
  out.timeout={tell:info.tell, closedAtMs:await ev(`+(window.__RT.showHiddenAt-window.__RT.show).toFixed(0)`),
    delta:+(s1.moyu-s0.moyu).toFixed(1), streak:[s0.surviveStreak,s1.surviveStreak], fxBefore:fx0,fxAfter:fx1,
    toastBefore:toast0, toastAfter:toast1, srLive:info.srLive, note:"超时=无奖、不算被抓，且无任何提示"};
}

// ===== 4) 变体对比：每种变体按规则操作，等巡逻自然结束，量奖励/耗时 =====
async function variantRun(v){
  await resetRT(); await waitClosed();
  const s0=await state();
  await ev(`window.__MOYU__.forceBoss('${v}')`);
  await waitShow();
  const info=await rects();
  const tStart=Date.now();
  let presses=0;
  if(v==="hold"){ /* 0 次 */ }
  else if(v==="type"){ for(let i=0;i<5;i++){ await tap(195,300,40); presses++; await sleep(110);} }
  else if(v==="blitz"){ for(let i=0;i<16;i++){ await tap(195,300,30); presses++; await sleep(80);} }
  else { const correct=mapping(info.tell); const b=info.btns.find(x=>x.choice===correct); await sleep(300); await tap(b.x+b.w/2,b.y+b.h/2,50); presses++; }
  // 等横幅里的巡逻结束（hold/type/blitz 8s，choice 立即）
  const endT = Date.now();
  await sleep(v==="choice"?300:8600);
  const s1=await state();
  return {variant:v, presses, actionMs:endT-tStart, waitExtraMs: v==="choice"?0:8600,
    delta:+(s1.moyu-s0.moyu).toFixed(1), streak:[s0.surviveStreak,s1.surviveStreak],
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`), tell:info.tell};
}
for(const v of ["hold","type","blitz","choice"]){ out.variants[v]=await variantRun(v); await sleep(400); }

// ===== 5) 杂项：播报/横幅遮挡/计时条首帧 =====
{
  await resetRT(); await waitClosed();
  const fxm=await ev(`window.__MUO__.fxTexts`)? null:null;
  // 先制造一条 toast 遮住顶部横幅
  await ev(`(()=>{const t=document.getElementById('dom-toast');t.textContent='新章节：303 · 新的工位';t.classList.add('show');return 1})()`);
  await ev(`window.__MOYU__.forceBoss('choice')`);
  await waitShow();
  const info=await rects();
  await sleep(400);
  await shot("/tmp/r13b-overlap.png");
  const toastRect=info.toast, box=info.box, btns=info.btns;
  out.misc={tell:info.tell, tellLen:info.tell.length, srLive:info.srLive,
    toastRect, box, btnSample:btns[0], gapPx:+(btns[1].x-(btns[0].x+btns[0].w)).toFixed(1),
    btnHeight:btns[0].h, btnWidth:btns[0].w,
    panelToShopGap: info.shopRect? +(info.shopRect.y-(box.y+box.h)).toFixed(0):null,
    shopRect:info.shopRect};
  // 计时条首帧值：面板出现后立刻读
  const barNow=await ev(`(()=>{const i=document.querySelector('#boss-timer i');return i?i.style.width:'none'})()`);
  out.misc.barAtFirstRead=barNow;
  await sleep(200);
  out.misc.barAfter200ms=await ev(`(()=>{const i=document.querySelector('#boss-timer i');return i?i.style.width:'none'})()`);
  // 面板下方 40px（商店区）误触会不会买到东西
  const sA=await state();
  const shopY=780;
  const allCards=await ev(`(()=>[...document.querySelectorAll('[data-upgrade]')].map(e=>{const b=e.getBoundingClientRect();return {id:e.dataset.upgrade,x:+b.x.toFixed(0),y:+b.y.toFixed(0),w:+b.width.toFixed(0),h:+b.height.toFixed(0)}}))()`);
  out.misc.upgradeCards=allCards;
  await sleep(400);
  if(allCards && allCards[0]){
    const c0=allCards[0];
    const s0b=await state();
    await tap(c0.x+c0.w/2, c0.y+c0.h/2, 50);
    await sleep(200);
    const s1b=await state();
    out.misc.tapShopDuringChoice={card:c0.id, delta:+(s1b.moyu-s0b.moyu).toFixed(1), upgradesBefore:s0b.upgrades, upgradesAfter:s1b.upgrades};
  }
  await waitClosed(5000);
}
out.errors=errors;
writeFileSync("/tmp/r13b-action.json", JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
