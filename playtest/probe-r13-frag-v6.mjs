// R13 复验 v6：卡打开时老板被延后 / 跳过是否稳定关闭 / 选对奖励 / 超时不误报
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 19400 + Math.floor(Math.random() * 60);
const PROFILE = `/tmp/chrome-r13v6-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} process.exit(2); }, 120000);
async function waitJson(p, tries = 200) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch {} await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const list = await waitJson("/json/list");
const ws = new WebSocket(list.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails?.exception?.description || "").slice(0, 160)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (m2, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m2, params: p })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const js = async (expr) => { try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || "").slice(0, 200) } : r.result.value; } catch (e) { return { __err: String(e) }; } };
const shot = async (p) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(p, Buffer.from(s.data, "base64")); };
const tap = async (x, y) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
const waitTrue = async (expr, timeout = 6000, step = 50) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await js(expr) === true) return Date.now() - t0; await sleep(step); } return -1; };
const cardsOpen = `(()=>{const e=document.getElementById('cards');return !!e && !e.classList.contains('hidden')})()`;
const bossOpen = `(()=>{const e=document.getElementById('boss-choice');return !!e && !e.classList.contains('hidden')})()`;
function mapTell(t) { if (t.includes("脚步声又快又重") || t.includes("走路带风")) return "立刻装忙"; if (t.includes("盯着别人的屏幕")) return "切到工作界面"; return "继续摸鱼"; }
async function pickBoss(label) { const b = await js(`(()=>{const x=[...document.querySelectorAll('#boss-opts button')].find(b=>b.textContent===${JSON.stringify(label)});if(!x)return null;const r=x.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`); if (b) await tap(b.x, b.y); }
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
const out = {};
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await waitTrue(`!!window.__MOYU__`, 15000, 50);
// 等卡弹窗（12s 空闲路径）
const cardsMs = await waitTrue(cardsOpen, 18000, 100);
out.cardsAppearMs = cardsMs;
await sleep(200);
// 卡开着时 force 老板 → 应被延后
await js(`window.__MOYU__.forceBoss('choice')`);
await sleep(1400);
out.mutex = { bossWhileCards: await js(bossOpen), cardsStill: await js(cardsOpen) };
// 点"今天先不选"，采样关闭状态
const sk = await js(`(()=>{const b=document.getElementById('cards-skip').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
await tap(sk.x, sk.y);
const samples = [];
for (const ms of [0, 60, 150, 400, 900]) { if (ms) await sleep(ms - (samples.length ? samples.reduce((s, x) => s + x.gap, 0) : 0)); samples.push({ at: ms, open: await js(cardsOpen), gap: 0 }); }
out.skipSamples = samples.map((s) => ({ at: s.at, open: s.open }));
out.skipState = await js(`({dismissed:window.__MOYU__.state.cards.dismissed})`);
// 卡关闭后老板应在数秒内出现
const bossMs = await waitTrue(bossOpen, 6000, 60);
out.bossAfterSkipMs = bossMs;
if (bossMs >= 0) {
  await sleep(300);
  const tell = await js(`document.getElementById('boss-tell').textContent`);
  const want = mapTell(tell);
  const before = await js(`window.__MOYU__.state.moyu`);
  await pickBoss(want); await sleep(120);
  out.correct = { tell, want, result: await js(`document.querySelector('.boss-result')?.textContent||''`) };
  await shot("/tmp/r13v6-correct.png");
  await sleep(600);
  out.correct.delta = +((await js(`window.__MOYU__.state.moyu`)) - before).toFixed(2);
  out.correct.toast = await js(`document.getElementById('dom-toast')?.textContent`);
  await sleep(5200);
  out.correct.toastAfter6s = await js(`document.getElementById('dom-toast')?.textContent`);
  out.correct.panelAfter6s = await js(bossOpen);
}
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13v6.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog); try { proc.kill("SIGKILL"); } catch {} process.exit(0);