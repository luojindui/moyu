// 批次1 E2E：小队面板完整流程（招募→升级→派遣→自动重复→一键领取→天赋）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-b1e2e-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,tries=100){for(let i=0;i<tries;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,200)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(method,params={})=>{const i=++id;ws.send(JSON.stringify({id:i,method,params}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev = async (expr) => { const r = await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true}); return r.exceptionDetails ? {__err:JSON.stringify(r.exceptionDetails).slice(0,200)} : r.result.value; };
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(2600);
const out = {};
// 新号引导
await ev(`document.getElementById('btn-team').click()`); await sleep(400);
out.newbieHint = await ev(`(document.querySelector('.team-hint')||{innerText:'none'}).innerText.slice(0,80)`);
await ev(`document.getElementById('tab-talents').click()`); await sleep(300);
out.talentHint = await ev(`(document.querySelector('.team-hint')||{innerText:'none'}).innerText.slice(0,60)`);
await ev(`document.getElementById('team-close').click()`); await sleep(200);
// 注资后完整流程
out.grant = await ev(`(()=>{window.__MOYU__.grant(1e10); return Math.round(window.__MOYU__.state.moyu);})()`);
await sleep(300);
await ev(`document.getElementById('btn-team').click()`); await sleep(400);
await ev(`document.getElementById('tab-colleagues').click()`); await sleep(300);
for (let i=0;i<5;i++){ await ev(`(()=>{const b=document.querySelector('#team-body button[data-act=recruit]'); if(b&&!b.disabled) b.click();})()`); await sleep(200); }
out.teamSize = await ev(`Object.keys(window.__MOYU__.state.team.colleagues).length`);
out.summary = await ev(`(document.querySelector('.team-summary')||{innerText:'none'}).innerText.replace(/\\n/g,' ')`);
out.missionBtn = await ev(`(()=>{const b=document.querySelector('#team-body button[data-act=dispatch]'); return b?b.innerText.replace(/\\n/g,'|'):'none';})()`);
// 派单 + 自动重复
await ev(`document.querySelector('#team-body button[data-act=dispatch]').click()`); await sleep(400);
await ev(`(()=>{const b=document.querySelector('#team-body button[data-act=auto]'); if(b) b.click();})()`); await sleep(300);
out.autoRepeat = await ev(`window.__MOYU__.state.team.colleagues.zhou.autoRepeat`);
out.progress = await ev(`(document.querySelector('.mate-progress')||{innerText:'none'}).innerText`);
// 是否显示"派遣中只算一半"
out.awayHint = await ev(`document.body.innerText.includes('派遣中只算一半')`);
// 快进任务到完成
await ev(`window.__MOYU__.endMissions()`);
await sleep(1200);
out.claimBtns = await ev(`document.querySelectorAll('#team-body button[data-act=claim]').length`);
out.claimAll = await ev(`(()=>{const b=document.querySelector('#team-body button[data-act=claim-all]'); return b?b.innerText:'none';})()`);
const before = await ev(`Math.round(window.__MOYU__.state.moyu)`);
await ev(`(()=>{const b=document.querySelector('#team-body button[data-act=claim-all]'); if(b) b.click();})()`); await sleep(700);
out.claimDelta = (await ev(`Math.round(window.__MOYU__.state.moyu)`)) - before;
out.flash = await ev(`!!document.querySelector('.team-flash')`);
await sleep(1600);
const shot = await send("Page.captureScreenshot",{format:"png"});
writeFileSync("/tmp/b1e2e.png", Buffer.from(shot.data,"base64"));
out.errors = errors;
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
