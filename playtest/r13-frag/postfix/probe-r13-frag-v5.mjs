// R13 碎片党复验 v5（最终，测当前 dev 工作区）：首巡逻必 choice / 正确奖励 / 超时不误报 / HUD 390
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 19300 + Math.floor(Math.random() * 60);
const PROFILE = `/tmp/chrome-r13v5-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} process.exit(2); }, 160000);
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
const waitTrue = async (expr, timeout = 6000, step = 60) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await js(expr) === true) return Date.now() - t0; await sleep(step); } return -1; };
const boot = async () => { const t0 = Date.now(); const ms = await waitTrue(`!!window.__MOYU__`, 20000, 50); await sleep(300); return { bootMs: ms, wall: Date.now() - t0 }; };
const nav = async () => { await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); const b = await boot(); await js(`window.__r13mark=1`); return b; };
const cardsOpen = `(()=>{const e=document.getElementById('cards');return !!e && !e.classList.contains('hidden')})()`;
const bossOpen = `(()=>{const e=document.getElementById('boss-choice');return !!e && !e.classList.contains('hidden')})()`;
const hudCard = `(()=>{const e=document.getElementById('hud-card');return {text:e?e.textContent:'',hidden:e?e.classList.contains('hidden'):true}})()`;
function mapTell(tell) { if (tell.includes("走路带风")) return "立刻装忙"; if (tell.includes("盯着别人的屏幕")) return "切到工作界面"; return "继续摸鱼"; }
async function pickBoss(label) { const b = await js(`(()=>{const x=[...document.querySelectorAll('#boss-opts button')].find(b=>b.textContent===${JSON.stringify(label)});if(!x)return null;const r=x.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`); if (b) await tap(b.x, b.y); else errors.push("no-btn"); }
async function saveHack(mut) { return await js(`(()=>{const orig=Storage.prototype.setItem;const k='moyu-save';const blob=JSON.parse(localStorage.getItem(k)||'null');if(!blob)return 'no-save';(${mut})(blob);orig.call(localStorage,k,JSON.stringify(blob));Storage.prototype.setItem=function(){};return 'ok';})()`); }
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
const out = {};

// ---- 首次打开：12s 无操作后卡弹窗；先跳过，再等自然首巡逻（必 choice） ----
out.boot = await nav();
const t0 = Date.now();
let cardsAppearMs = -1, bossAppearMs = -1;
while (Date.now() - t0 < 50000) {
  const st = await js(`({c:${cardsOpen}, b:${bossOpen}})`);
  const el = Date.now() - t0;
  if (st.c && cardsAppearMs < 0) {
    cardsAppearMs = el;
    out.cardsAfterIdle = { appearMs: el };
    // 跳过
    const sk = await js(`(()=>{const b=document.getElementById('cards-skip').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
    await tap(sk.x, sk.y);
    await sleep(200);
    out.cardsAfterIdle.skipped = await js(`({hidden:${cardsOpen}, dismissed:window.__MOYU__.state.cards.dismissed})`);
  }
  if (st.b && bossAppearMs < 0) { bossAppearMs = el; break; }
  await sleep(100);
}
out.cardsAfterIdle = out.cardsAfterIdle || { appearMs: -1, note: "未弹（8击/12s门控）" };
out.bossAppearMs = bossAppearMs;
if (bossAppearMs >= 0) {
  await sleep(300);
  out.firstBoss = await js(`(()=>{const box=document.querySelector('#boss-choice .boss-box').getBoundingClientRect();
    return {tell:document.getElementById('boss-tell').textContent, w:Math.round(box.width),h:Math.round(box.height),
      btns:[...document.querySelectorAll('#boss-opts button')].map(b=>{const r=b.getBoundingClientRect();return {t:b.textContent,h:Math.round(r.height)}})}})()`);
  await shot("/tmp/r13v5-first-boss.png");
  const want = mapTell(out.firstBoss.tell);
  const before = await js(`window.__MOYU__.state.moyu`);
  await pickBoss(want);
  await sleep(110);
  out.answer = { want, resultInPanel: await js(`document.querySelector('.boss-result')?.textContent||''`), panelVisible: await js(bossOpen) };
  await shot("/tmp/r13v5-answer.png");
  await sleep(500);
  out.answer.delta = +((await js(`window.__MOYU__.state.moyu`)) - before).toFixed(2);
  out.answer.toast = await js(`document.getElementById('dom-toast')?.textContent`);
  // 等 6s：确认不会误报"没来得及选"
  await sleep(5500);
  out.answer.toastAfter6s = await js(`document.getElementById('dom-toast')?.textContent`);
  out.answer.panelAfter6s = await js(bossOpen);
  out.answer.moyuAfter6s = await js(`Math.round(window.__MOYU__.state.moyu*100)/100`);
}
// ---- HUD 390：造新一天→选卡→看常驻+布局 ----
out.hud = {};
await sleep(800);
await saveHack(`(b)=>{const y=new Date(Date.now()-864e5).toLocaleDateString('sv-SE');b.cards.date=y;b.cards.chosenDate=y;b.cards.dismissed=false;}`);
out.hud.reloadBoot = await nav();
await sleep(1200);
const appear = await waitTrue(cardsOpen, 4000, 60);
out.hud.cardsAppearMs = appear;
if (appear >= 0) {
  await sleep(1400); // 防误触窗口
  const cp = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2),name:document.querySelector('#cards .card-name').textContent}})()`);
  await tap(cp.x, cp.y); await sleep(700);
  out.hud.afterChoose = await js(`({closed:!${cardsOpen}, chosen:window.__MOYU__.state.cards.chosen, toast:document.getElementById('dom-toast')?.textContent, cardName:${JSON.stringify(cp.name)}})`);
  out.hud.layout = await js(`(()=>{
    const e=document.getElementById('hud-card'); const r=e.getBoundingClientRect();
    const btn=[...document.querySelectorAll('.hud-sub button')].map(b=>{const q=b.getBoundingClientRect();return {id:b.id,x:Math.round(q.x),right:Math.round(q.right),y:Math.round(q.y)}});
    const sub=document.querySelector('.hud-sub').getBoundingClientRect();
    return {cardText:e.textContent, cardRect:{x:Math.round(r.x),right:Math.round(r.right),w:Math.round(r.width),y:Math.round(r.y)},
      subRect:{w:Math.round(sub.width),h:Math.round(sub.height)}, buttons:btn, vw:innerWidth,
      hudH:Math.round(document.getElementById('hud').getBoundingClientRect().height)};
  })()`);
  await shot("/tmp/r13v5-hud.png");
}
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13v5.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog); try { proc.kill("SIGKILL"); } catch {} process.exit(0);