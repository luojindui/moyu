// R13 最终实机审计（HEAD fa9ad17）：跨天旧 buff 下弹窗可达 / 同日过期解锁 / forceBoss 性格 / 结果展示时长 / HUD
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9856;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13fin-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(p, tries = 120) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch { } await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description || "").slice(0, 200)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: JSON.stringify(r.exceptionDetails).slice(0, 250) } : r.result.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
const today = () => new Date().toLocaleDateString("sv-SE");
const yesterday = () => new Date(Date.now() - 86400000).toLocaleDateString("sv-SE");
const out = {};
const nav = async (wait = 2300) => { await send("Page.navigate", { url: URL }); await sleep(wait); };
const modalVisible = () => ev(`!document.getElementById('cards').classList.contains('hidden')`);
const snap = () => ev(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,streak:s.surviveStreak,survives:s.patrolSurvives,cards:s.cards,hud:document.getElementById('hud-card').classList.contains('hidden')?'':document.getElementById('hud-card').textContent};})()`);
const loadWithSave = async (cards, wait = 2300) => {
  const now = Date.now();
  const save = { v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000, cards };
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});sessionStorage.setItem('moyu-boot-ms',String(Date.now()-60000));}catch(e){}`;
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await nav(wait);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
};
const cs = (date, chosen, until, chosenDate, dismissed = false) => ({ date, offers: ["coffee_day", "overtime", "hr_talk"], chosen, until, nextDayGuaranteed: null, dismissed, chosenDate });
const clickChoice = (choice) => ev(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${choice}"]');if(!b)return 'no-btn';b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));return 'ok';})()`);
const openChoice = async () => { await ev(`window.__MOYU__.forceBoss('choice')`); await sleep(400); return ev(`(()=>{const root=document.getElementById('boss-choice');return {visible:!root.classList.contains('hidden'),tell:document.getElementById('boss-tell').textContent,choices:[...document.querySelectorAll('#boss-opts button')].map(b=>b.dataset.choice)};})()`); };
const TELL_MAP = { "脚步声又快又重": "act-busy", "盯着别人的屏幕": "switch-screen", "边走边看手机": "keep-slacking" };
const correctOfTell = (tell) => { for (const k in TELL_MAP) if (tell.includes(k)) return TELL_MAP[k]; return null; };

// ---------- 1. 昨天选卡、buff 仍有效 → 今天卡弹窗应可达 ----------
await loadWithSave(cs(yesterday(), "coffee_day", Date.now() + 2 * 3600000, yesterday()));
out.s1 = {
  state: await snap(),
  modalVisible: await modalVisible(),
  cardCount: await ev(`document.querySelectorAll('#cards-body .card').length`),
  cardIds: await ev(`[...document.querySelectorAll('#cards-body .card')].map(e=>e.dataset.id)`),
};
await sleep(500);
out.s1_choose = await ev(`(async()=>{const c=document.querySelector('#cards-body .card');if(!c)return {noCard:true};const name=c.querySelector('.card-name').textContent;c.click();await new Promise(r=>setTimeout(r,350));const s=window.__MOYU__.state;return {pickedName:name,chosen:s.cards.chosen,chosenDate:s.cards.chosenDate,toast:document.getElementById('dom-toast')?.textContent||'',hud:document.getElementById('hud-card').textContent,modalHidden:document.getElementById('cards').classList.contains('hidden')};})()`);
// 刷新后同日不再弹（今天已选）
await nav(2300);
out.s1_afterReload = { modalVisible: await modalVisible(), chosenDate: (await snap()).cards.chosenDate, hud: (await snap()).hud };

// ---------- 2. 同日过期清理 → 解锁提示 ----------
await loadWithSave(cs(today(), "coffee_day", Date.now() + 3000, today()));
out.s2_before = { modalVisible: await modalVisible(), chosen: (await snap()).cards.chosen, hud: (await snap()).hud };
await sleep(6500);
out.s2_afterExpiry = { modalVisible: await modalVisible(), state: await snap() };

// ---------- 3. forceBoss 性格是否稳定 suspicious ----------
await loadWithSave(cs(today(), "coffee_day", Date.now() + 86400000, today()));
const runs = [];
for (let i = 0; i < 8; i++) {
  const p = await openChoice();
  runs.push(p.tell);
  await clickChoice(correctOfTell(p.tell));
  await sleep(400);
}
out.s3_forceBoss = { tells: runs, distinct: [...new Set(runs)], allSuspicious: runs.every((x) => x.includes("盯着别人的屏幕")) };

// ---------- 4. 选完结果是否真的显示约 220ms（面板内 + 变色） ----------
const p4 = await openChoice();
const res = await ev(`(async()=>{
  const btn=document.querySelector('#boss-opts button[data-choice="${correctOfTell(p4.tell)}"]');
  const t0=performance.now();
  btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
  const samples=[];
  for(let i=0;i<30;i++){
    const vis=!document.getElementById('boss-choice').classList.contains('hidden');
    const result=document.querySelector('.boss-result')?.textContent||'';
    const picked=!!document.querySelector('#boss-opts button.picked');
    samples.push({t:Math.round(performance.now()-t0),vis,result,picked});
    if(!vis) break;
    await new Promise(r=>setTimeout(r,20));
  }
  return {samples:samples.slice(0,14), hiddenAt:samples.find(s=>!s.vis)?.t ?? null, resultShown:samples.some(s=>s.result)};
})()`);
out.s4_resultDisplay = res;
await sleep(400);

// ---------- 5. 150ms 守卫：开局连点不结算且给抖动反馈 ----------
const p5 = await openChoice();
const guard = await ev(`(async()=>{
  const btn=document.querySelector('#boss-opts button');
  const before=window.__MOYU__.state.moyu;
  btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
  const shake=btn.classList.contains('shake');
  const during=window.__MOYU__.state.moyu;
  await new Promise(r=>setTimeout(r,300));
  const still=!document.getElementById('boss-choice').classList.contains('hidden') && !window.__MOYU__.state.cards;
  return {shake,duringStayed:+(during-before).toFixed(2),panelStillVisible:!document.getElementById('boss-choice').classList.contains('hidden')};
})()`);
out.s5_guard = guard;
// 结束这次巡逻（超时）
await sleep(5500);

// ---------- 6. 画布误触提示坐标 ----------
const p6 = await openChoice();
out.s6_canvasHint = await ev(`(()=>{const cv=document.getElementById('stage');const r=cv.getBoundingClientRect();const before=window.__MOYU__.fxTexts().length;cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+100,clientY:r.top+100,bubbles:true,pointerType:'touch'}));const list=window.__MOYU__.fxTexts().slice(-1);return {added:window.__MOYU__.fxTexts().length-before,last:list[0]||null};})()`);
await sleep(5500);
out.consoleErrors = errors;
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL"); process.exit(0);
