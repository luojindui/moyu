// R13 碎片党复验 v3：修复后（skip/首日门控/互斥/HUD 卡/老板 5s+免罚/首巡逻必 choice）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "http://127.0.0.1:5173/";
const PORT = 19100 + Math.floor(Math.random() * 80);
const PROFILE = `/tmp/chrome-r13v3-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} console.log("TIMEOUT"); process.exit(2); }, 170000);
async function waitJson(p, tries = 200) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch {} await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const list = await waitJson("/json/list");
const ws = new WebSocket(list.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || "").slice(0, 180)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (m2, p = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method: m2, params: p })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const js = async (expr) => { try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || "").slice(0, 200) } : r.result.value; } catch (e) { return { __err: String(e) }; } };
const shot = async (p) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(p, Buffer.from(s.data, "base64")); };
const tap = async (x, y) => { if (!Number.isFinite(x) || !Number.isFinite(y)) { errors.push(`BADTAP ${x},${y}`); return; } await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
const waitTrue = async (expr, timeout = 6000, step = 50) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await js(expr) === true) return Date.now() - t0; await sleep(step); } return -1; };
const boot = async () => { const t0 = Date.now(); const ms = await waitTrue(`!!window.__MOYU__`, 20000, 60); await sleep(400); return { bootMs: ms, wallMs: Date.now() - t0 }; };
const nav = async () => { await send("Page.navigate", { url: URL_ }); return boot(); };
const cardsOpen = `(()=>{const e=document.getElementById('cards');return !!e && !e.classList.contains('hidden')})()`;
const bossOpen = `(()=>{const e=document.getElementById('boss-choice');return !!e && !e.classList.contains('hidden')})()`;
const canvasPt = `(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height*0.3)}})()`;
async function tapCanvas(n, gap = 170) { const p = await js(canvasPt); for (let i = 0; i < n; i++) { await tap(p.x, p.y); await sleep(gap); } }
async function bossTell() { return await js(`document.getElementById('boss-tell')?.textContent||''`); }
function mapTell(tell) {
  if (tell.includes("走路带风")) return { correct: "立刻装忙", wrong: "继续摸鱼" };
  if (tell.includes("盯着别人屏幕")) return { correct: "切到工作界面", wrong: "继续摸鱼" };
  return { correct: "继续摸鱼", wrong: "立刻装忙" };
}
async function pickBoss(label) {
  const b = await js(`(()=>{const x=[...document.querySelectorAll('#boss-opts button')].find(b=>b.textContent===${JSON.stringify(label)}); if(!x) return null; const r=x.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  if (!b) { errors.push("no-btn " + label); return; }
  await tap(b.x, b.y);
}
async function saveHack(mut) {
  return await js(`(()=>{
    const orig = Storage.prototype.setItem; const key='moyu-save';
    const blob = JSON.parse(localStorage.getItem(key) || 'null'); if(!blob) return 'no-save';
    (${mut})(blob);
    orig.call(localStorage, key, JSON.stringify(blob));
    Storage.prototype.setItem = function(){};
    return {ok:true, cards: blob.cards, savedAt: blob.savedAt};
  })()`);
}

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
const out = {};

// ============ 打开 1：新档首开（应不被拦） ============
out.A = {};
out.A.boot = await nav();
await sleep(900);
out.A.cardsAtBoot = await js(cardsOpen);
out.A.hudCardAtBoot = await js(`({text:document.getElementById('hud-card')?.textContent, hidden:document.getElementById('hud-card')?.classList.contains('hidden')})`);
// 连戳 8 下：期间不应弹
await tapCanvas(8, 160);
out.A.cardsRightAfter8Taps = await js(cardsOpen);
const appearMs = await waitTrue(cardsOpen, 3000, 50);
out.A.cardsAppearAfterStopMs = appearMs;
out.A.cardsFacts = await js(`(()=>{
  const skip=document.getElementById('cards-skip'); const sr=skip?skip.getBoundingClientRect():null;
  const p=document.querySelector('#cards .cards-panel').getBoundingClientRect();
  return {skipText:skip?.textContent, skipH: sr?Math.round(sr.height):null, panel:{w:Math.round(p.width),h:Math.round(p.height)},
    closeButtons:document.querySelectorAll('#cards button').length, shown:!document.getElementById('cards').classList.contains('hidden')};
})()`);
await shot("/tmp/r13v3-a-cards.png");
// 跳过：点遮罩空白
const pt = await js(`(()=>{const p=document.querySelector('#cards .cards-panel').getBoundingClientRect();return {x:Math.round(p.left/2),y:12}})()`);
await tap(pt.x, pt.y); await sleep(120);
out.A.afterMaskSkip = await js(`({hidden:document.getElementById('cards').classList.contains('hidden'), dismissed:window.__MOYU__.state.cards.dismissed})`);
await sleep(1500);
out.A.reopenedAfterSkip = await js(cardsOpen);
// 同日重开：不弹
out.B0 = {};
out.B0.boot = await nav();
out.B0.cardsVisible = await js(cardsOpen);
out.B0.hudCard = await js(`({text:document.getElementById('hud-card')?.textContent, hidden:document.getElementById('hud-card')?.classList.contains('hidden')})`);

// ============ 打开 2：同日再开 + 首次巡逻必 choice ============
out.B = {};
const tBoot = Date.now();
const bossMs = await waitTrue(bossOpen, 45000, 100);
out.B.firstPatrol = { appearAfterBootMs: bossMs, wallMs: Date.now() - tBoot };
if (bossMs >= 0) {
  out.B.tell = await bossTell();
  out.B.bossGeo = await js(`(()=>{const box=document.querySelector('#boss-choice .boss-box').getBoundingClientRect();
    const btns=[...document.querySelectorAll('#boss-opts button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,w:Math.round(r.width),h:Math.round(r.height)}});
    return {w:Math.round(box.width),h:Math.round(box.height),btns,timerW:document.querySelector('#boss-timer i')?.style.width}})()`);
  await shot("/tmp/r13v3-b-first-boss.png");
  // 不理会：测窗口 + 超时提示
  const t0 = Date.now();
  const hideMs = await waitTrue(`!${bossOpen}`, 8000, 50);
  await sleep(120);
  out.B.timeout = { visibleMs: hideMs, wallMs: Date.now() - t0, toast: await js(`document.getElementById('dom-toast')?.textContent`), toastShown: await js(`document.getElementById('dom-toast')?.classList.contains('show')`), moyu: await js(`Math.round(window.__MOYU__.state.moyu*100)/100`) };
}
// 巡逻 2：选错 → 应不扣钱（前 3 次宽限）
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(bossOpen, 2500, 30); await sleep(300);
let tell2 = await bossTell(); let m2 = mapTell(tell2);
let bal2 = await js(`window.__MOYU__.state.moyu`);
await pickBoss(m2.wrong);
await sleep(120);
out.B.wrongPatrol2 = { tell: tell2, picked: m2.wrong, resultInPanel: await js(`document.querySelector('.boss-result')?.textContent||''`), panelVisible: await js(bossOpen) };
await sleep(400);
out.B.wrongPatrol2.delta = +((await js(`window.__MOYU__.state.moyu`)) - bal2).toFixed(2);
out.B.wrongPatrol2.toast = await js(`document.getElementById('dom-toast')?.textContent`);
await shot("/tmp/r13v3-b-result.png");
await sleep(400);
// 巡逻 3：选对 → 应有奖励
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(bossOpen, 2500, 30); await sleep(300);
let tell3 = await bossTell(); let m3 = mapTell(tell3);
let bal3 = await js(`window.__MOYU__.state.moyu`);
await pickBoss(m3.correct); await sleep(500);
out.B.correctPatrol3 = { tell: tell3, delta: +((await js(`window.__MOYU__.state.moyu`)) - bal3).toFixed(2), toast: await js(`document.getElementById('dom-toast')?.textContent`), resultInPanel: await js(`document.querySelector('.boss-result')?.textContent||''`) };
await sleep(400);
// 巡逻 4：选错 → 超出新手宽限，应扣钱
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(bossOpen, 2500, 30); await sleep(300);
let tell4 = await bossTell(); let m4 = mapTell(tell4);
let bal4 = await js(`window.__MOYU__.state.moyu`);
await pickBoss(m4.wrong); await sleep(500);
out.B.wrongPatrol4 = { tell: tell4, delta: +((await js(`window.__MOYU__.state.moyu`)) - bal4).toFixed(2), toast: await js(`document.getElementById('dom-toast')?.textContent`) };
// 互斥：日报打开时 force 不出老板，关日报后 ~3s 内出
await js(`document.getElementById('btn-journal').click()`); await sleep(300);
await js(`window.__MOYU__.forceBoss('choice')`); await sleep(1500);
out.B.journalExclusion = { bossWhileJournal: await js(bossOpen), journalOpen: await js(`!document.getElementById('journal').classList.contains('hidden')`) };
await js(`document.getElementById('journal-close').click()`);
const deferredMs = await waitTrue(bossOpen, 8000, 80);
out.B.journalExclusion.appearAfterCloseMs = deferredMs;
if (deferredMs >= 0) { await sleep(250); const t = await bossTell(); await pickBoss(mapTell(t).correct); await sleep(500); }

// ============ 打开 3：隔天 + 离线 3 小时回归（只应一层模态） ============
out.C = {};
out.C.savePrep = await saveHack(`(b)=>{const y=new Date(Date.now()-864e5).toLocaleDateString('sv-SE');
  b.cards={date:y,offers:[],chosen:null,chosenDate:'',until:0,nextDayGuaranteed:null,dismissed:false};
  b.savedAt=Date.now()-3*3600*1000;}`);
out.C.boot = await nav();
await sleep(500);
out.C.atReturn = await js(`(()=>{const w=document.getElementById('welcome'),c=document.getElementById('cards');
  return {welcomeVisible:!w.classList.contains('hidden'), cardsVisible:!c.classList.contains('hidden'), both:!w.classList.contains('hidden')&&!c.classList.contains('hidden'),
    welcomeGain:document.getElementById('welcome-gain')?.textContent}})()`);
await shot("/tmp/r13v3-c-welcome.png");
const ok = await js(`(()=>{const b=document.getElementById('welcome-ok').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
await tap(ok.x, ok.y);
const cardsAfterWelcome = await waitTrue(cardsOpen, 4000, 60);
out.C.cardsAfterWelcomeMs = cardsAfterWelcome;
out.C.cardsAfterWelcome = await js(`({welcomeHidden:document.getElementById('welcome').classList.contains('hidden'), cardsVisible:${cardsOpen}})`);
if (cardsAfterWelcome >= 0) {
  await sleep(1500); // 1.2s 防误触
  const c = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2),name:document.querySelector('#cards .card-name').textContent}})()`);
  await tap(c.x, c.y); await sleep(600);
  out.C.chosen = await js(`({toast:document.getElementById('dom-toast')?.textContent, chosenId:window.__MOYU__.state.cards.chosen, chosenDate:window.__MOYU__.state.cards.chosenDate})`);
  out.C.hudCard = await js(`(()=>{const e=document.getElementById('hud-card');const r=e.getBoundingClientRect();
    return {text:e.textContent, hidden:e.classList.contains('hidden'), w:Math.round(r.width), x:Math.round(r.x), right:Math.round(r.right), vw:innerWidth,
      hudSubText:document.querySelector('.hud-sub')?.innerText.replace(/\n/g,' | ')}})()`);
  out.C.toastIsChinese = !/[a-z]{3,}_/.test(out.C.chosen?.toast || "");
  await shot("/tmp/r13v3-c-hud.png");
}
// 同日重开：HUD 仍在、不弹卡
out.C.reload = {};
out.C.reload.boot = await nav(); await sleep(600);
out.C.reload.cardsVisible = await js(cardsOpen);
out.C.reload.hudCard = await js(`({text:document.getElementById('hud-card')?.textContent, hidden:document.getElementById('hud-card')?.classList.contains('hidden')})`);
// 跨天旧 buff 仍显示 + 可再次弹卡（模拟第二天）
out.C.crossDay = await saveHack(`(b)=>{const y=new Date(Date.now()-864e5).toLocaleDateString('sv-SE'); b.cards.date=y; b.cards.chosenDate=y; b.cards.dismissed=false;}`);
out.C.crossDay.boot = await nav(); await sleep(700);
out.C.crossDay.hudCard = await js(`({text:document.getElementById('hud-card')?.textContent, hidden:document.getElementById('hud-card')?.classList.contains('hidden')})`);
out.C.crossDay.cardsAfterStop = await waitTrue(cardsOpen, 3000, 60);
// Esc 关闭
await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(150);
out.C.esc = await js(`({hidden:document.getElementById('cards').classList.contains('hidden'), dismissed:window.__MOYU__.state.cards.dismissed})`);
await sleep(1200);
out.C.esc.reopened = await js(cardsOpen);
out.C.esc.reloadBoot = await nav(); await sleep(500);
out.C.esc.cardsAfterReload = await js(cardsOpen);

out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13v3.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog); try { proc.kill("SIGKILL"); } catch {} process.exit(0);
