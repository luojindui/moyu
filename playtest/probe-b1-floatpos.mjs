// 验证点击飘字是否出现在手指位置（单位/钳制）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9750;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new","--disable-gpu","--no-sandbox","--hide-scrollbars","--mute-audio","--no-first-run","--disable-extensions",`--user-data-dir=/tmp/chrome-fp-${Date.now()}`,`--remote-debugging-port=${PORT}`,"about:blank"], { stdio: "ignore" });
async function waitJson(p,tries=100){for(let i=0;i<tries;i++){try{const r=await fetch(`http://127.0.0.1:${PORT}${p}`);if(r.ok)return await r.json();}catch{}await sleep(100);}throw new Error("cdp");}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`,{method:"PUT"}).then(r=>r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
let id=0; const pending=new Map();
ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const{resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result);}};
const send=(m,p={})=>{const i=++id;ws.send(JSON.stringify({id:i,method:m,params:p}));return new Promise((resolve,reject)=>pending.set(i,{resolve,reject}));};
const ev=async(x)=>{const r=await send("Runtime.evaluate",{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{__err:JSON.stringify(r.exceptionDetails).slice(0,120)}:r.result.value;};
await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:3,mobile:true,screenWidth:390,screenHeight:844});
await send("Page.navigate",{url:"http://127.0.0.1:5173/"});
await sleep(2600);
// 点三个已知位置，测量飘字渲染位置（通过 fx 内部状态不可达，改用像素采样：找白色文字像素重心）
const points = [[80,600],[195,380],[300,300]];
const results = [];
for (const [x,y] of points) {
  await send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1});
  await send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1});
  await sleep(90);
  const shot = await send("Page.captureScreenshot",{format:"png"});
  writeFileSync(`/tmp/float-${x}-${y}.png`, Buffer.from(shot.data,"base64"));
  results.push({click:[x,y], file:`/tmp/float-${x}-${y}.png`});
  await sleep(1200);
}
console.log(JSON.stringify(results,null,1));
proc.kill("SIGKILL"); process.exit(0);
