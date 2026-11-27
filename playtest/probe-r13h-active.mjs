// r13 复验：:active 是否真的可见（守卫窗内按住采样）+ 按下→隐藏延迟
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9847;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13h-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,n=120){for(let i=0;i<n;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map();
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error).slice(0,100))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?null:r.result.value;};
const shot=async(p)=>{const s=await send("Page.captureScreenshot",{format:"png"});writeFileSync(p,Buffer.from(s.data,"base64"));};
const ts=async(x,y)=>{await send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x,y,radiusX:3,radiusY:3,force:1}]});};
const te=async()=>send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:"http://127.0.0.1:5181/"});
for(let i=0;i<150;i++){const ok=await ev(`typeof window.__MOYU__==='object'&&document.readyState==='complete'`);if(ok===true)break;await sleep(100);}
await sleep(500); await ev(`window.__MOYU__.grant(1e9)`); await sleep(300);
await ev(`(()=>{const el=document.getElementById('boss-choice');window.__RT={show:null,tell:'',ptr:[],pd:null,hid:null};
  if(window.__RTO)window.__RTO.disconnect();
  window.__RTO=new MutationObserver(()=>{if(!el.classList.contains('hidden')&&window.__RT.show===null){window.__RT.show=performance.now();}
    if(el.classList.contains('hidden'))window.__RT.hid=performance.now();});
  window.__RTO.observe(el,{attributes:true,attributeFilter:['class']});
  document.addEventListener('pointerdown',(e)=>{const b=e.target.closest&&e.target.closest('#boss-opts button');window.__RT.ptr.push({t:performance.now(),choice:b?b.dataset.choice:null});},true);
  return 1})()`);
await ev(`window.__MOYU__.forceBoss('choice')`);
await ev(`new Promise(res=>{const t0=performance.now();const f=()=>{if(window.__RT.show!==null)return res(1);if(performance.now()-t0>2500)return res(0);requestAnimationFrame(f)};f()})`);
// 不插任何 eval，直接在第 ~80ms 按下（按钮2中心 y=538）
await sleep(50);
const before=await ev(`(()=>{const b=document.querySelectorAll('#boss-opts button')[1];const s=b?getComputedStyle(b):null;return s?{transform:s.transform,filter:s.filter,transition:s.transitionDuration}:null})()`);
await ts(195,538);
await sleep(120);
const during=await ev(`(()=>{const b=document.querySelectorAll('#boss-opts button')[1];const s=b?getComputedStyle(b):null;const el=document.getElementById('boss-choice');const p=window.__RT.ptr.slice(-1)[0];return {transform:s&&s.transform,filter:s&&s.filter,open:!el.classList.contains('hidden'),pressedAt:+(p.t-window.__RT.show).toFixed(0)}})()`);
await shot("/tmp/r13h-active.png");
await sleep(250);
const stillHeld=await ev(`({open:!document.getElementById('boss-choice').classList.contains('hidden'),ptr:window.__RT.ptr.slice(-1)})`);
await te(); await sleep(200);
const afterRelease=await ev(`({open:!document.getElementById('boss-choice').classList.contains('hidden')})`);
// 再正常按到 400ms 后
await sleep(200);
const s0=await ev(`Math.round(window.__MOYU__.state.moyu*100)/100`);
await ts(195,538); await sleep(60); await te(); await sleep(200);
const lag=await ev(`(()=>{const p=window.__RT.ptr.slice(-1)[0];const h=window.__RT.hid;return {pressToHideMs:h&&p?+(h-p.t).toFixed(1):null,closed:!document.getElementById('boss-choice').classList.contains('hidden')}})()`);
const s1=await ev(`Math.round(window.__MOYU__.state.moyu*100)/100`);
console.log(JSON.stringify({before,during,stillHeld,afterRelease,settle:lag,delta:+(s1-s0).toFixed(1)},null,1));
proc.kill("SIGKILL"); process.exit(0);
