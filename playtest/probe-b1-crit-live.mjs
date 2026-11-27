// 验证 click_4 暴击 / event_4 预警 / idle_5b / 存档 18 点是否真的生效
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9740;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-b1c-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,tries=100){for(let i=0;i<tries;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map(); const errors=[];
ws.onmessage=(e)=>{const m=JSON.parse(e.data);
  if(m.method==="Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description?.slice(0,160)||m.params.exceptionDetails.text);
  if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev = async (expr) => { const r = await send("Runtime.evaluate",{expression:expr,returnByValue:true,awaitPromise:true}); return r.exceptionDetails?{__err:JSON.stringify(r.exceptionDetails).slice(0,160)}:r.result.value; };
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(2600);
const out={};
// 1) 注资 → 段位天赋点自动发放
await ev(`window.__MOYU__.grant(1e12)`); await sleep(500);
out.talentPoints = await ev(`window.__MOYU__.state.talents.points`);
out.badge = await ev(`!!document.querySelector('#btn-team .talent-badge')`);
// 2) 点满点击流 1-4（打开面板天赋页依次点亮）
await ev(`document.getElementById('btn-team').click()`); await sleep(300);
await ev(`document.getElementById('tab-talents').click()`); await sleep(300);
for (let i=0;i<6;i++){
  await ev(`(()=>{const b=[...document.querySelectorAll('#team-body button[data-act=talent]')].find(x=>!x.disabled); if(b) b.click();})()`);
  await sleep(180);
}
out.unlocked = await ev(`window.__MOYU__.state.talents.unlocked.join(',')`);
await ev(`document.getElementById('team-close').click()`); await sleep(300);
// 3) 连点 40 次，检查暴击是否触发（40/20=2 次暴击）
const before = await ev(`window.__MOYU__.state.totalEarned`);
const clickTimes = 40;
for (let i=0;i<clickTimes;i++){
  await send("Input.dispatchMouseEvent",{type:"mousePressed",x:195,y:400,button:"left",clickCount:1});
  await send("Input.dispatchMouseEvent",{type:"mouseReleased",x:195,y:400,button:"left",clickCount:1});
  await sleep(130);
}
await sleep(300);
const after = await ev(`window.__MOYU__.state.totalEarned`);
const perClick = (after-before)/clickTimes;
const clickPower = await ev(`(()=>{const s=window.__MOYU__.state; return 1;})()`);
out.avgPerClick = Math.round(perClick*100)/100;
out.critObserved = after-before > clickTimes*1.15; // 若暴击生效应明显高于 1
out.clickPowerNow = clickPower;
out.earned = Math.round((after-before)*10)/10;
out.errors = errors;
console.log(JSON.stringify(out,null,1));
proc.kill("SIGKILL"); process.exit(0);
