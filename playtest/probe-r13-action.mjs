// r13 操作党实测：回合制老板反应时间 / 命中 / 误触 / 边缘窗口
// 方法：CDP 真实触点（390×844 DPR3 touch），页面内 MutationObserver 记 tShow，pointerdown/click 记输入时延。
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9834;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r13]", ...a);
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,tries=120){for(let i=0;i<tries;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails){const d=JSON.stringify(r.exceptionDetails).slice(0,400);log("EVAL_ERR",d,"| expr:",String(x).slice(0,80));return {__err:d};}return r.result.value;};
const shot=async(path)=>{const s=await send("Page.captureScreenshot",{format:"png"});writeFileSync(path,Buffer.from(s.data,"base64"));};
const tap=async(x,y,hold=60)=>{
  await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,radiusX:3,radiusY:3,force:1}]});
  await sleep(hold);
  await send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
};
const state=()=>ev(`window.__MOYU__.state`);
const panelOpen=()=>ev(`document.getElementById('boss-choice')? !document.getElementById('boss-choice').classList.contains('hidden') : false`);

await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(3000);
const out={meta:{vw:390,vh:844,dpr:3,mem:[]},trials:[],special:{}};
out.meta.cardsVisible = await ev(`(()=>{const e=document.getElementById('cards');return e?!e.classList.contains('hidden'):'no-el'})()`);
await ev(`(()=>{const b=document.querySelector('#cards-body .card'); if(b) b.click(); return !!b})()`);
await sleep(300);
await ev(`window.__MOYU__.grant(1e9)`);
await sleep(400);

// —— 页面内仪表 ——
await ev(`(()=>{
  const el=document.getElementById('boss-choice');
  const tellEl=document.getElementById('boss-tell');
  window.__RT={show:null,paint:null,tell:'',clicks:[],ptr:[],toasts:[],picks:0};
  if(window.__RTO) window.__RTO.disconnect();
  window.__RTO=new MutationObserver(()=>{
    if(!el.classList.contains('hidden') && window.__RT.show===null){
      window.__RT.show=performance.now();
      window.__RT.tell=tellEl.textContent;
      requestAnimationFrame(()=>{window.__RT.paint=performance.now();});
    }
    if(el.classList.contains('hidden')) window.__RT.showHiddenAt = performance.now();
  });
  window.__RTO.observe(el,{attributes:true,attributeFilter:['class']});
  document.addEventListener('pointerdown',(e)=>{
    const b=e.target.closest && e.target.closest('#boss-opts button');
    window.__RT.ptr.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName+(e.target.className?'.'+e.target.className:'')});
  },true);
  document.addEventListener('click',(e)=>{
    const b=e.target.closest && e.target.closest('#boss-opts button');
    window.__RT.clicks.push({t:performance.now(),choice:b?b.dataset.choice:null,tag:e.target.tagName});
  },true);
  if(!window.__TO){
    window.__TO=new MutationObserver(()=>{
      const el2=document.getElementById('dom-toast');
      if(el2&&el2.classList.contains('show')&&el2.textContent){
        window.__RT.toasts.push({t:performance.now(),text:el2.textContent});
      }else if(el2&&!el2.classList.contains('show')&&window.__RT.toasts.length){
        window.__RT.toasts[window.__RT.toasts.length-1].tHide=performance.now();
      }
    });
    window.__TO.observe(document.getElementById('dom-toast')||document.body,{attributes:true,childList:true,subtree:true,characterData:true});
  }
  return 'ok';
})()`);

// 关键字 → 应对（模拟"已学会地图"的老手）
const KEY = { "走路带风": "act-busy", "盯着别人屏幕": "switch-screen", "看手机": "keep-slacking", "眼神是散": "keep-slacking" };
const mapping = (tell) => { for (const k in KEY) if (tell.includes(k)) return KEY[k]; return null; };
const CHOICE_LABEL = { "act-busy": "立刻装忙", "switch-screen": "切到工作界面", "keep-slacking": "继续摸鱼" };

async function resetRT(){
  await ev(`(()=>{window.__RT.show=null;window.__RT.paint=null;window.__RT.showHiddenAt=null;window.__RT.tell='';window.__RT.clicks=[];window.__RT.ptr=[];window.__RT.toasts=[];return 1})()`);
}
async function waitClosed(ms=6000){
  return await ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const o=document.getElementById('boss-choice');if(o&&o.classList.contains('hidden'))return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
}
async function fire(){
  await waitClosed();
  await ev(`window.__MOYU__.forceBoss('choice')`);
}
async function waitShow(ms=3000){
  return await ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(true);if(performance.now()-t0>${ms})return res(false);requestAnimationFrame(f)};f()})`);
}
async function rects(){
  return await ev(`(()=>{const w=document.getElementById('boss-choice');const r=e=>{const b=e.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
    const btns=[...w.querySelectorAll('.boss-opts button')].map(b=>({choice:b.dataset.choice,label:b.textContent,...r(b)}));
    return {box:r(w.querySelector('.boss-box')),btns,tell:window.__RT.tell};})()`);
}
const btnCenter = (btns, choice) => { const b=btns.find(x=>x.choice===choice); return {x:b.x+b.w/2, y:b.y+b.h/2}; };

// 单次"正常玩家"试玩
async function trial({name, reactionMs, guess=false, useCorrect=true}){
  await resetRT();
  const s0 = await state();
  await fire();
  const appeared = await waitShow();
  if(!appeared){ out.trials.push({name,error:"panel not shown"}); return; }
  const info = await rects();
  const correct = mapping(info.tell);
  const pick = guess ? ["act-busy","switch-screen","keep-slacking"][Math.floor(Math.random()*3)] : (useCorrect ? correct : "act-busy");
  const t = { name, tell: info.tell, tellLen: info.tell.length, correct, pick, isRight: pick===correct, reactionModel: reactionMs };
  const c = btnCenter(info.btns, pick);
  await sleep(reactionMs);
  await ev(`window.__RT.tPre=performance.now()`);
  await tap(c.x, c.y);
  await sleep(120);
  const { rt, s1, toast } = await ev(`(()=>{const s=window.__MOYU__.state;return {rt:{show:window.__RT.show,paint:window.__RT.paint,tell:window.__RT.tell,ptr:window.__RT.ptr,clicks:window.__RT.clicks,toasts:window.__RT.toasts,tPre:window.__RT.tPre},s1:{moyu:Math.round(s.moyu*100)/100,surviveStreak:s.surviveStreak,patrolSurvives:s.patrolSurvives},toast:(document.getElementById('dom-toast')||{}).textContent||''}})()`);
  t.windowUsedMs = rt.clicks[0] ? +(rt.clicks[0].t - rt.show).toFixed(0) : null;
  t.paintLatencyMs = rt.paint ? +(rt.paint - rt.show).toFixed(0) : null;
  t.ptrToClickMs = (rt.ptr[0] && rt.clicks[0]) ? +(rt.clicks[0].t - rt.ptr[0].t).toFixed(1) : null;
  t.dispatchToClickMs = rt.clicks[0] && rt.tPre ? +(rt.clicks[0].t - rt.tPre).toFixed(1) : null;
  t.clickedChoice = rt.clicks[0]?.choice ?? null;
  t.pointerTargets = rt.ptr.map(p=>p.tag);
  t.delta = +(s1.moyu - s0.moyu).toFixed(1);
  t.streakBefore = s0.surviveStreak; t.streakAfter = s1.surviveStreak;
  t.toast = toast || (rt.toasts[0]?.text ?? '');
  t.toastDelayMs = rt.toasts[0] && rt.show ? +(rt.toasts[0].t - rt.clicks[0].t).toFixed(0) : null;
  t.panelClosed = !(await panelOpen());
  out.trials.push(t);
  await sleep(320); // 等巡逻收尾/下一帧复位
  log(name, t.windowUsedMs+'ms', t.isRight?'✓':'✗', t.delta, t.toast);
}

// —— A) 新手（未学映射）：随机猜 3 次 ——
for(let i=1;i<=3;i++) await trial({name:`A${i}-新手乱选`, reactionMs: 500+Math.random()*300, guess:true});

// —— B) 老手快反应 8 次 ——
for(let i=1;i<=8;i++) await trial({name:`B${i}-老手快按`, reactionMs: 280+Math.random()*170});

// —— C) 慢读 2 次（模拟逐字读整句 2.2-2.8s）——
for(let i=1;i<=2;i++) await trial({name:`C${i}-慢读整句`, reactionMs: 2200+i*300});

// —— D) 超出窗口：一直等到面板自己关 ——
{
  await resetRT(); const s0=await state(); await fire(); await waitShow();
  const info=await rects();
  const tShow = await ev(`window.__RT.show`);
  const samples=[];
  for(let k=0;k<24;k++){
    const w = await ev(`(()=>{const i=document.querySelector('#boss-timer i');const o=document.getElementById('boss-choice');return {bar:i?+(parseFloat(i.style.width)||0).toFixed(1):null,open:o?!o.classList.contains('hidden'):false,t:performance.now()}})()`);
    samples.push({leftMs:+(w.t-tShow).toFixed(0), barPct:w.bar, open:w.open});
    if(!w.open) break;
    await sleep(200);
  }
  await waitClosed(3000);
  const s1=await state();
  const closed = !(await panelOpen());
  const hiddenAt = await ev(`window.__RT.showHiddenAt`);
  const toast=await ev(`(document.getElementById('dom-toast')||{}).textContent||''`);
  out.special.timeout={tell:info.tell, closedAtMs: hiddenAt? +(hiddenAt-tShow).toFixed(0):null, samples, delta:+(s1.moyu-s0.moyu).toFixed(1), streakBefore:s0.surviveStreak, streakAfter:s1.surviveStreak, toast, status_after_timeout: closed};
  await shot("/tmp/r13-timeout.png");
  await sleep(400);
}

// —— E) 误触：面板开着时点场景中心（点击手的肌肉记忆）——
for(const [label, delayMs, px, py] of [["E1-宽限内点场景",200,195,300],["E2-过宽限点场景",1500,195,300],["E3-面板正上方6px",1400,195,null]]){
  await resetRT(); const s0=await state(); await fire(); await waitShow();
  const info=await rects();
  const correct=mapping(info.tell);
  const ty = py===null ? info.box.y-6 : py;
  await sleep(delayMs);
  const fxC0 = await ev(`window.__MOYU__.fxTexts().length`);
  await tap(px, ty);
  await sleep(150);
  const mid = await ev(`(()=>{const s=window.__MOYU__.state;return {moyu:Math.round(s.moyu*100)/100,fx:window.__MOYU__.fxTexts(),open:!document.getElementById('boss-choice').classList.contains('hidden')}})()`);
  const sMid = mid;
  // 然后正常选对，看连胜/奖励是否被误触影响
  const c = btnCenter(info.btns, correct);
  await ev(`window.__RT.tPre=performance.now()`);
  await tap(c.x,c.y);
  await sleep(150);
  const s2 = await state();
  out.special[label]={tell:info.tell,correct,tapAt:{x:px,y:ty},delayMs,panelStillOpenAfterMisTap:mid.open,
    misTapDelta:+(mid.moyu-s0.moyu).toFixed(1), fxAfterMisTap:mid.fx.slice(fxC0),
    finalDelta:+(s2.moyu-s0.moyu).toFixed(1), streakBefore:s0.surviveStreak, streakAfter:s2.surviveStreak,
    toast:await ev(`(document.getElementById('dom-toast')||{}).textContent||''`)};
  await shot(`/tmp/r13-mis-${label}.png`);
  await sleep(400);
}

// —— F) 点按钮之间的 6px 间隙 ——
{
  await resetRT(); const s0=await state(); await fire(); await waitShow();
  const info=await rects();
  const correct=mapping(info.tell);
  const b1=info.btns[1];
  await sleep(600);
  await tap(b1.x-3, b1.y+b1.h/2); // 落在 .boss-opts 上
  await sleep(120);
  const mid=await ev(`(()=>{const s=window.__MOYU__.state;return {moyu:Math.round(s.moyu*100)/100,open:!document.getElementById('boss-choice').classList.contains('hidden'),clicks:window.__RT.clicks}})()`);
  const c=btnCenter(info.btns,correct);
  await sleep(200);
  await tap(c.x,c.y);
  await sleep(150);
  const s2=await state();
  out.special["F-点间隙"]={tell:info.tell,openAfterGapTap:mid.open,clicksAfterGap:mid.clicks.length,gapDelta:+(mid.moyu-s0.moyu).toFixed(1),finalDelta:+(s2.moyu-s0.moyu).toFixed(1),note:"间隙点击是否静默吞掉"};
  await sleep(400);
}

// —— G) 连点两个按钮（手快双押）——
{
  await resetRT(); const s0=await state(); await fire(); await waitShow();
  const info=await rects();
  const correct=mapping(info.tell);
  const other = ["act-busy","switch-screen","keep-slacking"].find(c=>c!==correct);
  await sleep(400);
  const c1=btnCenter(info.btns,correct), c2=btnCenter(info.btns,other);
  await tap(c1.x,c1.y,40);
  await tap(c2.x,c2.y,40);
  await sleep(200);
  const s2=await state();
  out.special["G-双押"]={correct,delta:+(s2.moyu-s0.moyu).toFixed(1),streakAfter:s2.surviveStreak,panelOpen:await panelOpen()};
  await sleep(400);
}

// —— H) 迟到点击：倒计时条快空时再按 ——
{
  await resetRT(); const s0=await state(); await fire(); await waitShow();
  const info=await rects(); const correct=mapping(info.tell);
  // 等到 bar < 12%
  let bar=100, used=0;
  const tShow=await ev(`window.__RT.show`);
  for(let k=0;k<80;k++){
    const w=await ev(`(()=>{const i=document.querySelector('#boss-timer i');const o=document.getElementById('boss-choice');return {bar:i?parseFloat(i.style.width)||0:null,open:o?!o.classList.contains('hidden'):false,t:performance.now()}})()`);
    if(!w.open){used=+(w.t-tShow).toFixed(0);bar=0;break;}
    bar=w.bar;
    if(bar<12) {used=+(w.t-tShow).toFixed(0);break;}
    await sleep(40);
  }
  const c=btnCenter(info.btns,correct);
  await ev(`window.__RT.tPre=performance.now()`);
  await tap(c.x,c.y);
  await sleep(150);
  const rt=await ev(`({clicks:window.__RT.clicks,show:window.__RT.show,ptr:window.__RT.ptr})`);
  const s2=await state();
  const toast=await ev(`(document.getElementById('dom-toast')||{}).textContent||''`);
  out.special["H-迟到按"]={tell:info.tell,correct,barPctAtTap:+bar.toFixed(1),approxUsedMs:used,
    clickAtMs: rt.clicks[0]? +(rt.clicks[0].t-rt.show).toFixed(0):null,
    windowMs:4100, delta:+(s2.moyu-s0.moyu).toFixed(1), toast, streakAfter:s2.surviveStreak};
  await shot("/tmp/r13-late.png");
  await sleep(400);
}

// —— I) 计时条与真实截止是否同步（采样式）——
{
  await resetRT(); await fire(); await waitShow();
  const tShow=await ev(`window.__RT.show`);
  const ss=[];
  for(let k=0;k<12;k++){
    const w=await ev(`(()=>{const i=document.querySelector('#boss-timer i');const o=document.getElementById('boss-choice');return {bar:i?+(parseFloat(i.style.width)||0).toFixed(2):null,open:o?!o.classList.contains('hidden'):false,t:performance.now()}})()`);
    ss.push({relMs:+(w.t-tShow).toFixed(0),bar:w.bar,open:w.open});
    if(!w.open) break;
    await sleep(300);
  }
  out.special["I-条与截止"]={samples:ss,hiddenAt:await ev(`window.__RT.showHiddenAt`)};
}

// —— J) 三种性格是否都被 forceBoss 覆盖（映射线索一致性）——
out.meta.personalities = out.trials.map(t=>({tell:t.tell, correct:t.correct}));

// —— K) 对比：hold/type/blitz 的"操作密度/中断感"（同一玩家视角）——
for(const v of ["hold","type","blitz"]){
  await resetRT();
  const s0=await state();
  await ev(`window.__MOYU__.forceBoss('${v}')`);
  await ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const t=document.getElementById('boss-choice');const banner=performance.now();if(performance.now()-t0>2500)return res(0);requestAnimationFrame(f)};f()})`);
  await sleep(100);
  // 用状态变化推断：巡逻期间点击是否计为任务
  const tapsTarget = v==="hold"?0:v==="type"?5:16;
  const t0=Date.now();
  let taps=0;
  for(let i=0;i<tapsTarget;i++){ await tap(195,260,30); taps++; await sleep(120); }
  await sleep(1000);
  const s1=await state();
  out.special[`K-${v}`]={variant:v,requiredTaps:tapsTarget,tapsDone:taps,elapsedMs:Date.now()-t0,delta:+(s1.moyu-s0.moyu).toFixed(1),streakAfter:s1.surviveStreak};
  await sleep(600);
}

out.errors=errors;
writeFileSync("/tmp/r13-action.json", JSON.stringify(out,null,1));
console.log(JSON.stringify({trials:out.trials.map(t=>({name:t.name,pick:t.pick,isRight:t.isRight,windowUsedMs:t.windowUsedMs,paintLatencyMs:t.paintLatencyMs,ptrToClickMs:t.ptrToClickMs,dispatchToClickMs:t.dispatchToClickMs,delta:t.delta,streak:[t.streakBefore,t.streakAfter],toast:t.toast})),special:out.special,errors},null,1));
proc.kill("SIGKILL"); process.exit(0);
