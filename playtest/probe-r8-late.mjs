/** R8 后期外观探针：满级/满图鉴存档下场景与图鉴外观是否变化。只读探针。 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9572;
const W = 390, H = 844;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r8-late-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch { } await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result.value; };
const shot = async (path, clip) => { const r = await send("Page.captureScreenshot", clip ? { format: "png", clip: { ...clip, scale: 3 } } : { format: "png" }); writeFileSync(path, Buffer.from(r.data, "base64")); console.log("shot", path); };

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const late = {
  v: 1, moyu: 1e9, totalEarned: 2e10, savedAt: Date.now(), createdAt: Date.now() - 3600_000,
  levels: { coffee: 100, water: 100, chair: 100, phone: 200, toilet: 200, group: 200, meeting: 200, deep: 200, retire: 200 },
  collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: [...Array(45).keys()] },
  surviveStreak: 5, totalClicks: 50000, visits: { date: "", count: 0 }, lifetimeEarned: 3.2e11, prestige: 20,
};
const seed = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(late))})}catch(e){}`;
await send("Page.addScriptToEvaluateOnNewDocument", { source: seed });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(4000);
await shot("/tmp/r8-late2.png");
console.log("LATE HUD", await ev("document.getElementById('hud').innerText.replace(/\\n/g,' | ')"));
const canvasRect = JSON.parse(await ev("JSON.stringify((()=>{const c=document.getElementById('stage').getBoundingClientRect();return {x:c.x,y:c.y,width:c.width,height:c.height}})())"));
console.log("canvasRect", canvasRect);
await ev("document.getElementById('btn-journal').click()");
await sleep(900);
await shot("/tmp/r8-late-journal2.png");
console.log("LATE JOURNAL", (await ev("document.getElementById('journal').innerText.replace(/\\n/g,' | ')")).slice(0, 1500));
// 图鉴网格解锁样式
console.log("GRID first 12", await ev("JSON.stringify([...document.querySelectorAll('.c-item')].slice(0,12).map(e=>e.className+'::'+e.innerText.replace(/\\n/g,'/'))) "));
await ev("document.getElementById('journal-close').click()");
await sleep(300);
// 满图鉴时的卡片/分享相关 DOM
console.log("BUTTONS", await ev("JSON.stringify([...document.querySelectorAll('button')].map(b=>b.id+':'+b.innerText.replace(/\\n/g,' ')))"));
try { await send("Browser.close"); } catch { }
proc.kill();
process.exit(0);
