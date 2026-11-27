/**
 * R9 中老年试玩探针 3（只读，不改 src/）
 * - 离线欢迎面板（老人回访首屏）字号/对比度/关闭方式
 * - 文本截断检查（HUD/卡片是否因 12px 挤到省略号）
 * - 320px 极窄屏首屏布局
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9583;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync("playtest/r9-screens", { recursive: true });

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r9c-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(`playtest/r9-screens/${name}.png`, Buffer.from(r.data, "base64")); };
const audit = (root) => `JSON.stringify((()=>{
  const parse=(s)=>{const m=String(s).match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(',').map(Number);return [p[0],p[1],p[2],p.length>3?p[3]:1];};
  const comp=(fg,bg)=>{const a=fg[3];return [fg[0]*a+bg[0]*(1-a),fg[1]*a+bg[1]*(1-a),fg[2]*a+bg[2]*(1-a),1];};
  const lum=([r,g,b])=>{const f=(c)=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b);};
  const ratio=(a,b)=>{const l1=lum(a),l2=lum(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);};
  const bgFor=(el)=>{const chain=[];let n=el;while(n&&n!==document.documentElement){chain.push(n);n=n.parentElement;}chain.push(document.documentElement);chain.reverse();let bg=[255,255,255,1];for(const e of chain){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c[3]>0.01)bg=comp(c,bg);}return bg;};
  const rootEl=document.querySelector(${JSON.stringify(root)}); if(!rootEl) return null;
  const rows=[];
  for(const el of rootEl.querySelectorAll('*')){
    const txt=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).filter(Boolean).join(' ');
    if(!txt) continue; const r=el.getBoundingClientRect(); if(!(r.width>0&&r.height>0)) continue;
    if(el.closest('.hidden')) continue;
    const cs=getComputedStyle(el); const bg=bgFor(el); const fg=comp(parse(cs.color)||[0,0,0,1],bg);
    rows.push({text:txt.slice(0,40),fs:Math.round(parseFloat(cs.fontSize)*10)/10,cr:Math.round(ratio(fg,bg)*100)/100,color:cs.color,
      clipped: el.scrollWidth > el.clientWidth + 1 && el.clientWidth>0, tag:el.tagName, id:el.id||null});
  }
  const seen=new Set();const u=[];for(const r of rows){const k=r.text+r.fs+r.color;if(seen.has(k))continue;seen.add(k);u.push(r);}return u;
})())`;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2500);
const out = {};
// 制造 1 小时离线后刷新，触发欢迎面板
await ev("__MOYU__.rewindSave(3600)");
await send("Page.reload");
await sleep(3000);
out.welcomeVisible = !(await ev("document.getElementById('welcome').classList.contains('hidden')"));
out.welcomeTexts = JSON.parse(await ev(audit("#welcome")) ?? "null");
const ok = await ev("JSON.stringify((()=>{const b=document.getElementById('welcome-ok');const r=b.getBoundingClientRect();const p=document.querySelector('.welcome-panel').getBoundingClientRect();return {btn:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),cx:Math.round(r.x+r.width/2),cy:Math.round(r.y+r.height/2)},panel:{w:Math.round(p.width),h:Math.round(p.height)}};})())").then(JSON.parse);
out.welcomeBtn = ok;
// 点面板外（老人直觉：点外面关）
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 30, y: 100, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
await sleep(50);
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(400);
out.welcomeStaysOpenAfterOutsideTap = !(await ev("document.getElementById('welcome').classList.contains('hidden')"));
await shot("r9-welcome-offline");
// 关掉欢迎面板
await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: ok.btn.cx, y: ok.btn.cy, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
await sleep(50);
await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
await sleep(400);
out.welcomeClosed = await ev("document.getElementById('welcome').classList.contains('hidden')");

// 首屏文本截断检查（390）
out.clipped390 = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('#hud *, #shop *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.top<innerHeight&&r.bottom>0;}).filter(e=>e.scrollWidth>e.clientWidth+1&&e.clientWidth>0).map(e=>({id:e.id||String(e.className).slice(0,20),text:(e.textContent||'').trim().slice(0,30),sw:e.scrollWidth,cw:e.clientWidth})))`));

// 320 窄屏
await send("Emulation.setDeviceMetricsOverride", { width: 320, height: 568, deviceScaleFactor: 2, mobile: true, screenWidth: 320, screenHeight: 568 });
await sleep(700);
out.layout320 = JSON.parse(await ev(`JSON.stringify((()=>{
  const R=(sel)=>{const e=document.querySelector(sel);if(!e)return null;const r=e.getBoundingClientRect();return {y:Math.round(r.y),h:Math.round(r.height),bottom:Math.round(r.bottom)}};
  return {hud:R('#hud'),quest:R('#quest'),stage:R('#stage-wrap'),shop:R('#shop'),journal:R('#btn-journal'),
    hudSubText:document.querySelector('.hud-sub').innerText.replace(/\\n/g,' | '),
    hudSubClipped: (()=>{const e=document.querySelector('.hud-sub');return e.scrollWidth>e.clientWidth+1;})(),
    shopHint:document.getElementById('shop-hint').innerText};
})())`));
await shot("r9-screen-320x568");

writeFileSync("playtest/r9-senior-evidence3.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
ws.close(); proc.kill(); process.exit(0);
