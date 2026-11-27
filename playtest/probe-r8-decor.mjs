/** R8 装扮/外观向只读探针：截图首屏、图鉴、商店、事件、后期存档外观。不改 src/ */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.SHOT_PORT || 9571);
const W = 390, H = 844;
const OUT = "/tmp/r8";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r8-decor-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch { } await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result.value; };
const shot = async (path, clip) => {
  const r = await send("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 3 } } : { format: "png" });
  writeFileSync(path, Buffer.from(r.data, "base64"));
  console.log("shot", path);
};

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
// 确定性事件时序（Math.random=0 → 最快 boss 90s / meme 45s）
await send("Page.addScriptToEvaluateOnNewDocument", { source: "try{localStorage.removeItem('moyu-save')}catch(e){}; Math.random = () => 0;" });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3500);

const canvasRect = JSON.parse(await ev("JSON.stringify((()=>{const c=document.getElementById('stage').getBoundingClientRect();return {x:c.x,y:c.y,width:c.width,height:c.height}})())"));
console.log("canvasRect", canvasRect);
await shot(`${OUT}-base.png`);
await shot(`${OUT}-canvas.png`, canvasRect);

// 商店全部卡片文案
const cards = await ev("JSON.stringify([...document.querySelectorAll('.shop-card')].map(c=>c.innerText.replace(/\\n/g,' | ')))");
console.log("CARDS", cards);
// hud 结构
console.log("HUD", await ev("document.getElementById('hud').innerText.replace(/\\n/g,' | ')"));

// 图鉴
await ev("document.getElementById('btn-journal').click()");
await sleep(700);
await shot(`${OUT}-journal.png`);
console.log("JOURNAL", (await ev("document.getElementById('journal').innerText.replace(/\\n/g,' | ')")).slice(0, 1200));
await ev("document.getElementById('journal-close').click()");
await sleep(300);

// 商店滚动到后段
await ev("(()=>{const s=document.getElementById('shop-cards'); s.scrollLeft = s.scrollWidth; return s.scrollWidth})()");
await sleep(500);
await shot(`${OUT}-shop-end.png`);

// 点击特效（连点 8 下）
for (let i = 0; i < 8; i++) await ev("(()=>{const c=document.getElementById('stage');const r=c.getBoundingClientRect();c.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height*0.52,pointerId:1,isPrimary:true}));c.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height*0.52,pointerId:1,isPrimary:true}));})()");
await sleep(120);
await shot(`${OUT}-clickfx.png`);

// 事件：等 meme（~46s）与 boss（~92s）
await sleep(44000);
await shot(`${OUT}-meme.png`);
console.log("STATE@meme", await ev("JSON.stringify({hud:document.getElementById('hud').innerText.replace(/\\n/g,' | ')})"));
await sleep(46000);
await shot(`${OUT}-boss.png`);
console.log("STATE@boss", await ev("JSON.stringify({hud:document.getElementById('hud').innerText.replace(/\\n/g,' | ')})"));

// 后期存档（满级/满图鉴）外观是否变化
const late = {
  v: 1, moyu: 1e9, totalEarned: 2e10, savedAt: Date.now(), createdAt: Date.now() - 3600_000,
  levels: { coffee: 100, water: 100, chair: 100, phone: 200, toilet: 200, group: 200, meeting: 200, deep: 200, retire: 200 },
  collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: [...Array(45).keys()] },
  surviveStreak: 5, totalClicks: 50000, visits: { date: "", count: 0 }, lifetimeEarned: 3.2e11, prestige: 20,
};
await ev(`localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(late))}); location.reload()`);
await sleep(5000);
await shot(`${OUT}-late.png`);
console.log("LATE HUD", await ev("document.getElementById('hud').innerText.replace(/\\n/g,' | ')"));
await ev("document.getElementById('btn-journal').click()");
await sleep(800);
await shot(`${OUT}-late-journal.png`);
console.log("LATE JOURNAL", (await ev("document.getElementById('journal').innerText.replace(/\\n/g,' | ')")).slice(0, 900));

try { await send("Browser.close"); } catch { }
proc.kill();
process.exit(0);
