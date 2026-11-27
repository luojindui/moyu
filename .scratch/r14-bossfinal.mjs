/** r14 复验：回合制老板当前实现（面板内台词停留时长/超时/画布提示/三性格） */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14m-" + Date.now(), "--remote-debugging-port=9580", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 120; i++) { try { await fetch("http://127.0.0.1:9580/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9580/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve } = pending.get(m.id); pending.delete(m.id); resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64")); };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(3500);
await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
await sleep(300);
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(400);
const openChoice = async () => { for (let t = 0; t < 30; t++) { const p = await evalJs(`(()=>{const r=document.getElementById('boss-choice');return r&&!r.classList.contains('hidden')?document.getElementById('boss-tell').textContent:null})()`); if (p) return p; await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(150); } return null; };
const snap = () => evalJs(`(()=>({panel:!document.getElementById('boss-choice').classList.contains('hidden'),optsText:document.getElementById('boss-opts')?.innerText||'',timer:(document.querySelector('#boss-timer i')||{style:{}}).style.width,toast:{text:(document.getElementById('dom-toast')||{}).textContent,show:(document.getElementById('dom-toast')||{className:''}).classList.contains('show')},moyu:window.__MOYU__?.state?.moyu}))()`);
const out = { rounds: [], timeout: {}, canvasTap: {} };
const correctOf = (t) => t.includes("脚步") ? "act-busy" : t.includes("盯着") ? "switch-screen" : "keep-slacking";
const seen = new Set();
for (let i = 0; i < 9 && seen.size < 3; i++) {
  const tell = await openChoice();
  if (!tell) { out.rounds.push({ iter: i, error: "no panel" }); break; }
  const correct = correctOf(tell);
  const wrong = ["act-busy", "switch-screen", "keep-slacking"].find((x) => x !== correct);
  const choice = i === 4 ? wrong : correct;
  await sleep(300);
  const before = await snap();
  await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${choice}"]');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
  // 每 40ms 采样 1s：结果台词停留多久
  const samples = [];
  for (let t = 0; t < 25; t++) { samples.push({ ms: t * 40, ...(await snap()) }); await sleep(40); }
  const visibleSamples = samples.filter((s) => s.panel);
  out.rounds.push({ iter: i, tell, choice, nameLeak: /安总|王总|老李/.test(tell), resultText: samples.map((s) => s.optsText.split("\n").filter(Boolean).pop()).find((t) => t && !/立刻装忙|切到工作界面|继续摸鱼/.test(t)) ?? null, panelVisibleMs: visibleSamples.length ? visibleSamples[visibleSamples.length - 1].ms : 0, before, samples: samples.slice(0, 12) });
  if (seen.size < 3 && !seen.has(tell)) { seen.add(tell); await shot("11-boss-" + seen.size); }
  await sleep(900);
}
// 超时
const t0 = await openChoice();
await sleep(5600);
out.timeout = await snap();
out.timeout.tell = t0;
await shot("12-boss-timeout");
// 画布提示
await sleep(600); const t1 = await openChoice();
await sleep(500);
const before = await snap();
await evalJs(`(()=>{const c=document.getElementById('stage');c.dispatchEvent(new PointerEvent('pointerdown',{clientX:195,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
await sleep(300);
const after = await snap();
out.canvasTap = { tell: t1, fx: await evalJs(`window.__MOYU__.fxTexts()`), delta: after.moyu - before.moyu, panel: after.panel };
await shot("13-canvas-hint");
writeFileSync(DIR + "evidence-boss.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
