// R13 碎片党复验 v4：补验 正确选对奖励 / 秒选防误触死区 / 跳过按钮 / HUD 390 布局 / 第4次巡逻点画布
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "http://127.0.0.1:5173/";
const PORT = 19200 + Math.floor(Math.random() * 80);
const PROFILE = `/tmp/chrome-r13v4-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} process.exit(2); }, 150000);
async function waitJson(p, tries = 200) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch {} await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const list = await waitJson("/json/list");
const ws = new WebSocket(list.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 160)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (m2, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m2, params: p })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const js = async (expr) => { try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || "").slice(0, 200) } : r.result.value; } catch (e) { return { __err: String(e) }; } };
const shot = async (p) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(p, Buffer.from(s.data, "base64")); };
const tap = async (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) { errors.push("BADTAP"); return; } await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
const waitTrue = async (expr, timeout = 6000, step = 50) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await js(expr) === true) return Date.now() - t0; await sleep(step); } return -1; };
const boot = async () => { const ms = await waitTrue(`!!window.__MOYU__`, 20000, 60); await sleep(400); return ms; };
const nav = async () => { await send("Page.navigate", { url: URL_ }); return boot(); };
const cardsOpen = `(()=>{const e=document.getElementById('cards');return !!e && !e.classList.contains('hidden')})()`;
const bossOpen = `(()=>{const e=document.getElementById('boss-choice');return !!e && !e.classList.contains('hidden')})()`;
async function tapCanvas(n, gap = 170) { const p = await js(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height*0.3)}})()`); for (let i = 0; i < n; i++) { await tap(p.x, p.y); await sleep(gap); } return p; }
function mapTell(tell) { if (tell.includes("走路带风")) return "立刻装忙"; if (tell.includes("盯着别人的屏幕")) return "切到工作界面"; return "继续摸鱼"; }
async function pickBoss(label) { const b = await js(`(()=>{const x=[...document.querySelectorAll('#boss-opts button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!x) return null; const r=x.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`); if (!b) { errors.push("no-btn"); return; } await tap(b.x, b.y); }
async function saveHack(mut) { return await js(`(()=>{const orig=Storage.prototype.setItem;const key='moyu-save';const blob=JSON.parse(localStorage.getItem(key)||'null');if(!blob)return 'no-save';(${mut})(blob);orig.call(localStorage,key,JSON.stringify(blob));Storage.prototype.setItem=function(){};return 'ok';})()`); }
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
const out = {};

await nav();
await tapCanvas(8);
await waitTrue(cardsOpen, 3000, 40);
// 秒选死区：弹窗刚出现就点卡（<1.2s）
const cardPt = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
await tap(cardPt.x, cardPt.y); await sleep(120);
out.instantTap = await js(`({stillOpen:${cardsOpen}, chosen:window.__MOYU__.state.cards.chosen, toast:document.getElementById('dom-toast')?.textContent})`);
// 等防误触窗口过后再选
await sleep(1300);
await tap(cardPt.x, cardPt.y); await sleep(700);
out.afterGuardTap = await js(`({closed:!${cardsOpen}, chosen:window.__MOYU__.state.cards.chosen, toast:document.getElementById('dom-toast')?.textContent})`);
out.hud = await js(`(()=>{
  const e=document.getElementById('hud-card'); const r=e.getBoundingClientRect();
  const spans=[...document.querySelectorAll('.hud-sub > span')].map(s=>({id:s.id||s.className||s.tagName, text:s.textContent, x:Math.round(s.getBoundingClientRect().x), right:Math.round(s.getBoundingClientRect().right), y:Math.round(s.getBoundingClientRect().y)}));
  const hud=document.getElementById('hud').getBoundingClientRect();
  return {cardText:e.textContent, hidden:e.classList.contains('hidden'), card:{x:Math.round(r.x),right:Math.round(r.right),w:Math.round(r.width),y:Math.round(r.y)}, vw:innerWidth, hudH:Math.round(hud.height), spans};
})()`);
await shot("/tmp/r13v4-hud.png");
// 跳过按钮（第二天场景）：造一个新日期 + dismissed=false
await sleep(1200);
await saveHack(`(b)=>{const y=new Date(Date.now()-864e5).toLocaleDateString('sv-SE');b.cards.date=y;b.cards.chosenDate=y;b.cards.dismissed=false;}`);
await nav(); await sleep(300);
out.newDay = { cardsVisible: await js(cardsOpen), hud: await js(`document.getElementById('hud-card')?.textContent`) };
await sleep(1200);
const skip = await js(`(()=>{const b=document.getElementById('cards-skip');const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),text:b.textContent}})()`);
await tap(skip.x, skip.y); await sleep(150);
out.skipButton = { text: skip.text, closed: await js(`!${cardsOpen}`), dismissed: await js(`window.__MOYU__.state.cards.dismissed`) };
await sleep(1200); out.skipButton.reopened = await js(cardsOpen);
await nav(); await sleep(400);
out.skipButton.noPromptAfterReload = !(await js(cardsOpen));

// 正确选对奖励（刷新会话后首次巡逻=choice）
const bossMs = await waitTrue(bossOpen, 42000, 100);
out.firstPatrolMs = bossMs;
if (bossMs >= 0) {
  await sleep(350);
  const tell = await js(`document.getElementById('boss-tell')?.textContent||''`);
  const want = mapTell(tell);
  const before = await js(`window.__MOYU__.state.moyu`);
  await pickBoss(want); await sleep(120);
  out.correctPick = { tell, want, resultInPanel: await js(`document.querySelector('.boss-result')?.textContent||''`), panelStill: await js(bossOpen) };
  await shot("/tmp/r13v4-correct-result.png");
  await sleep(600);
  out.correctPick.delta = +((await js(`window.__MOYU__.state.moyu`)) - before).toFixed(2);
  out.correctPick.toast = await js(`document.getElementById('dom-toast')?.textContent`);
  await sleep(400);
}
// 第 4 次巡逻：弹层里点画布（旧 P2 是否仍在）
for (let i = 0; i < 2; i++) { await js(`window.__MOYU__.forceBoss('choice')`); await waitTrue(bossOpen, 2500, 40); await sleep(400); const t = await js(`document.getElementById('boss-tell')?.textContent||''`); await pickBoss(mapTell(t)); await sleep(500); }
await js(`window.__MOYU__.forceBoss('choice')`); await waitTrue(bossOpen, 2500, 40);
await sleep(1000);
const mb = await js(`window.__MOYU__.state.moyu`);
const cp = await js(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height*0.22)}})()`);
await tap(cp.x, cp.y); await sleep(200);
out.fourthPatrolCanvasTap = await js(`({fx:(window.__MOYU__?.fxTexts?window.__MOYU__.fxTexts().map(f=>f.text):[]), delta:+(window.__MOYU__.state.moyu-${mb}).toFixed(2), toast:document.getElementById('dom-toast')?.textContent})`);
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13v4.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog); try { proc.kill("SIGKILL"); } catch {} process.exit(0);
