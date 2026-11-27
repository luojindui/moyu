// r13 操作党 recon：加载态 + 回合制面板几何/截图
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9833;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-r13r-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,tries=100){for(let i=0;i<tries;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{__err:JSON.stringify(r.exceptionDetails).slice(0,300)}:r.result.value;};
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Emulation.setTouchEmulationEnabled",{enabled:true,maxTouchPoints:5});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(3000);
const out={};
out.cardsVisible = await ev(`(()=>{const e=document.getElementById('cards');return e?!e.classList.contains('hidden'):'no-el'})()`);
out.welcomeVisible = await ev(`(()=>{const e=document.getElementById('welcome');return e?!e.classList.contains('hidden'):'no-el'})()`);
const s0 = await send("Page.captureScreenshot",{format:"png"}); writeFileSync("/tmp/r13-load.png", Buffer.from(s0.data,"base64"));
// 关卡片
await ev(`(()=>{const b=document.querySelector('#cards-body .card'); if(b) b.click(); return !!b})()`);
await sleep(300);
await ev(`window.__MOYU__.grant(1e9)`);
await sleep(400);
const s1 = await send("Page.captureScreenshot",{format:"png"}); writeFileSync("/tmp/r13-granted.png", Buffer.from(s1.data,"base64"));
// 触发回合制
await ev(`window.__MOYU__.forceBoss('choice')`);
// 等面板出现
await ev(`new Promise(res=>{const t0=performance.now();const f=()=>{const e=document.getElementById('boss-choice');if(e&&!e.classList.contains('hidden'))return res(1);if(performance.now()-t0>3000)return res(0);requestAnimationFrame(f)};f()})`);
const info = await ev(`(()=>{
  const wrap=document.getElementById('boss-choice');
  const box=wrap.querySelector('.boss-box');
  const btns=[...wrap.querySelectorAll('.boss-opts button')];
  const r=(el)=>{const b=el.getBoundingClientRect();return {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)}};
  const br=r(box);
  return {
    tell: document.getElementById('boss-tell').textContent,
    tellLen: document.getElementById('boss-tell').textContent.length,
    tellRect: r(document.getElementById('boss-tell')),
    box: br, opts: r(wrap.querySelector('.boss-opts')),
    timer: r(document.getElementById('boss-timer')),
    btns: btns.map(b=>({label:b.textContent, ...r(b)})),
    gaps: btns.length>1 ? +(btns[1].getBoundingClientRect().left-btns[0].getBoundingClientRect().right).toFixed(1) : null,
    fontSize: getComputedStyle(document.getElementById('boss-tell')).fontSize,
    btnFontSize: getComputedStyle(btns[0]).fontSize,
    zIndex: getComputedStyle(wrap).zIndex,
    wrapperPE: getComputedStyle(wrap).pointerEvents,
    boxPE: getComputedStyle(box).pointerEvents,
    canvasRect: (()=>{const c=document.getElementById('stage');const b=c.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})(),
    vh: innerHeight, vw: innerWidth,
    // 命中测试：按钮中心、间隙、按钮外侧 3px、面板上方/下方
    hitCenter: (()=>{const b=btns[0].getBoundingClientRect();const el=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return el?(el.tagName+'.'+el.className):null})(),
    hitGap: (()=>{const a=btns[1].getBoundingClientRect();const el=document.elementFromPoint(a.x-3,a.y+a.height/2);return el?(el.tagName+'.'+el.className):null})(),
    hitAboveBox: (()=>{const el=document.elementFromPoint(195, br.y-6);return el?(el.tagName+'.'+(el.className||el.id)):null})(),
    hitBelowBox: (()=>{const el=document.elementFromPoint(195, br.y+br.h+6);return el?(el.tagName+'.'+(el.className||el.id)):null})(),
    hitLeftGutter: (()=>{const el=document.elementFromPoint(br.x-5, br.y+br.h/2);return el?(el.tagName+'.'+(el.className||el.id)):null})(),
  };
})()`);
out.info = info;
const s2 = await send("Page.captureScreenshot",{format:"png"}); writeFileSync("/tmp/r13-choice.png", Buffer.from(s2.data,"base64"));
out.errors=errors;
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
