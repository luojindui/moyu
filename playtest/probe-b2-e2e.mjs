// 批次2 E2E：每日卡选择 + 回合制老板
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9820;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-b2-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,tries=100){for(let i=0;i<tries;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,180)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{__err:JSON.stringify(r.exceptionDetails).slice(0,180)}:r.result.value;};
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(3000);
const out={};
// 1) 卡弹窗应出现
out.cardsVisible = await ev(`!document.getElementById('cards').classList.contains('hidden')`);
out.cardCount = await ev(`document.querySelectorAll('#cards-body .card').length`);
out.cardNames = await ev(`[...document.querySelectorAll('#cards-body .card-name')].map(e=>e.textContent).join('|')`);
const shot1 = await send("Page.captureScreenshot",{format:"png"});
writeFileSync("/tmp/b2-cards.png", Buffer.from(shot1.data,"base64"));
// 2) 选第一张
const before = await ev(`Math.round(window.__MOYU__.state.moyu)`);
await ev(`document.querySelector('#cards-body .card').click()`);
await sleep(400);
out.chosen = await ev(`window.__MOYU__.state.cards.chosen`);
out.cardsHidden = await ev(`document.getElementById('cards').classList.contains('hidden')`);
// 3) 挂机倍率是否变化（对比 idle）
out.idleAfterCard = await ev(`Math.round(window.__MOYU__.state.moyu*100)/100`);
// 4) 强制触发回合制老板
await ev(`(()=>{const s=window.__MOYU__; s.grant(1e9);})()`);
await sleep(300);
out.bossTrigger = await ev(`(()=>{ try { window.__MOYU__.forceBoss && window.__MOYU__.forceBoss('choice'); return 'has-force'; } catch(e) { return 'no-force'; } })()`);
out.errors = errors;
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
