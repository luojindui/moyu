// R13 复验实机探针（HEAD 888ec11）：卡弹窗 skip/不重开、选卡反馈、choice 倍率/窗口/误触、超时迟到点击、forceBoss 性格、riskPenalty 离线
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9851;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13rv-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(p, tries = 120) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch { } await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description || "").slice(0, 200)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: JSON.stringify(r.exceptionDetails).slice(0, 220) } : r.result.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
const out = {};
const today = () => new Date().toLocaleDateString("sv-SE");
const nav = async (wait = 2300) => { await send("Page.navigate", { url: URL }); await sleep(wait); };
const tapCanvas = (n) => ev(`(async()=>{const cv=document.getElementById('stage');const r=cv.getBoundingClientRect();for(let i=0;i<${n};i++){cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+Math.max(80,r.height/2-60),bubbles:true}));await new Promise(x=>setTimeout(x,110));}return document.getElementById('cards').classList.contains('hidden');})()`);
const toastText = () => ev(`document.getElementById('dom-toast')?.textContent||''`);
const srText = () => ev(`document.getElementById('sr-live')?.textContent||''`);
const snap = () => ev(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,totalEarned:s.totalEarned,totalClicks:s.totalClicks,streak:s.surviveStreak,survives:s.patrolSurvives,cards:s.cards,hudCard:(document.getElementById('hud-card').classList.contains('hidden')?'':document.getElementById('hud-card').textContent)};})()`);
const correctOfTell = (tell) => (tell.includes("急性子") ? "act-busy" : tell.includes("多疑") ? "switch-screen" : tell.includes("健忘") ? "keep-slacking" : null);
const openChoice = async () => {
  const ret = await ev(`window.__MOYU__.forceBoss('choice')`);
  await sleep(400);
  return ev(`(()=>{const root=document.getElementById('boss-choice');const b=[...document.querySelectorAll('#boss-opts button')];return {ret:${JSON.stringify(ret)},visible:!root.classList.contains('hidden'),tell:document.getElementById('boss-tell').textContent,choices:b.map(x=>x.dataset.choice),timerWidth:document.querySelector('#boss-timer i')?.style.width||''};})()`);
};
const loadWithSave = async (save, wait = 2300) => {
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`;
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await nav(wait);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
};
const mkSave = (chosen, offers, extra = {}) => {
  const now = Date.now();
  return { v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000, cards: { date: today(), offers, chosen, until: chosen ? now + 86400000 : 0, nextDayGuaranteed: null, dismissed: false }, ...extra };
};

// ---------- 1. 卡弹窗首开门槛 + skip 不重开 + 刷新后保持 ----------
await ev(`localStorage.clear()`);
await nav(2600);
out.s1_gateBeforeClicks = {
  modalVisible: await ev(`!document.getElementById('cards').classList.contains('hidden')`),
  totalClicks: (await snap()).totalClicks,
};
out.s1_after8Clicks = { hiddenAfter: await tapCanvas(8) };
await sleep(300);
out.s1_modalShown = {
  visible: await ev(`!document.getElementById('cards').classList.contains('hidden')`),
  cardCount: await ev(`document.querySelectorAll('#cards-body .card').length`),
  sub: await ev(`document.querySelector('.cards-sub')?.textContent`),
  hasSkipBtn: await ev(`!!document.getElementById('cards-skip')`),
};
await ev(`document.getElementById('cards-skip').click()`);
await sleep(1300);
out.s1_skip = {
  hiddenRightAfter: await ev(`document.getElementById('cards').classList.contains('hidden')`),
  stillHiddenAfter1300ms: await ev(`document.getElementById('cards').classList.contains('hidden')`),
  cards: await snap().then((s) => s.cards),
};
await nav(2400);
out.s1_afterReload = {
  modalVisible: await ev(`!document.getElementById('cards').classList.contains('hidden')`),
  dismissed: (await snap()).cards.dismissed,
};

// ---------- 2. 选卡：中文名 toast / HUD 常驻 / 刷新保留 ----------
await ev(`localStorage.clear()`);
await nav(2400);
await tapCanvas(8);
await sleep(500); // 越过 400ms 防误触
const names = await ev(`[...document.querySelectorAll('#cards-body .card-name')].map(e=>e.textContent)`);
out.s2_choose = await ev(`(async()=>{const c=document.querySelector('#cards-body .card');const name=c.querySelector('.card-name').textContent;c.click();await new Promise(r=>setTimeout(r,350));const s=window.__MOYU__.state;return {name,chosen:s.cards.chosen,toast:document.getElementById('dom-toast')?.textContent||'',hud:document.getElementById('hud-card').textContent,untilMinusNow:Math.round(s.cards.until-Date.now())};})()`);
out.s2_offerNames = names;
await nav(2300);
out.s2_reload = (await snap()).hudCard;

// ---------- 3. choice 吃巡逻倍率（big_meeting ×2） ----------
await loadWithSave(mkSave("big_meeting", ["big_meeting", "coffee_day", "overtime"]));
const p3 = await openChoice();
const a3 = await snap();
out.s3_open = { tell: p3.tell, srAnnounce: await srText(), timerAtStart: p3.timerWidth };
await ev(`document.querySelector('#boss-opts button[data-choice="${correctOfTell(p3.tell)}"]').click()`);
await sleep(350);
const b3 = await snap();
out.s3_correctWithCard = { delta: +(b3.moyu - a3.moyu).toFixed(1), expected: "50×2(卡)×2.2=220 + 挂机", streak: b3.streak, toast: await toastText() };

// ---------- 4. choice 窗口内点画布：不罚、不赚 ----------
const p4 = await openChoice();
const a4 = await snap();
await ev(`(()=>{const cv=document.getElementById('stage');const r=cv.getBoundingClientRect();cv.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+100,bubbles:true}));return 1;})()`);
await sleep(300);
const b4 = await snap();
out.s4_tapDuringChoice = { moyuDelta: +(b4.moyu - a4.moyu).toFixed(2), clicksDelta: b4.totalClicks - a4.totalClicks, streakBefore: a4.streak, streakAfter: b4.streak, panelsStillVisible: !(await ev(`document.getElementById('boss-choice').classList.contains('hidden')`)) };
// 关闭
await ev(`document.querySelector('#boss-opts button[data-choice="${correctOfTell(p4.tell)}"]').click()`); await sleep(300);

// ---------- 5. 超时后迟到点击是否被拒（窗口 5s） ----------
const p5 = await openChoice();
const a5 = await snap();
await ev(`(()=>{const c='${correctOfTell(p5.tell)}';const b=document.querySelector('#boss-opts button[data-choice="'+c+'"]');setTimeout(()=>{b.click();window.__lateFired=true;},5800);return 1;})()`);
await sleep(5400);
const toastAtTimeout = await toastText();
const mid5 = await snap();
await sleep(900);
const b5 = await snap();
out.s5_lateClick = {
  tell: p5.tell,
  toastAtTimeout,
  deltaWindowToTimeout: +(mid5.moyu - a5.moyu).toFixed(2),
  deltaAfterLateClick: +(b5.moyu - mid5.moyu).toFixed(2),
  streakBefore: a5.streak,
  streakAfterLate: b5.streak,
  lateFired: await ev(`window.__lateFired===true`),
  panelHidden: await ev(`document.getElementById('boss-choice').classList.contains('hidden')`),
  toastAfterLate: await toastText(),
};

// ---------- 6. forceBoss 性格是否仍随机 ----------
await loadWithSave(mkSave("coffee_day", ["coffee_day", "overtime", "hr_talk"]));
const tells = [];
for (let i = 0; i < 6; i++) {
  const p = await openChoice();
  tells.push(p.tell.slice(0, 5));
  await ev(`document.querySelector('#boss-opts button[data-choice="${correctOfTell(p.tell)}"]').click()`);
  await sleep(250);
}
out.s6_forcedPersonality = { forceReturn: (await openChoice()).ret, tells, distinct: [...new Set(tells)] };
await ev(`document.querySelector('#boss-opts button').click()`); await sleep(200);

// ---------- 7. 过期 chosen 净化 + 新卡可选出 ----------
await loadWithSave(mkSave("coffee_day", ["coffee_day", "overtime", "hr_talk"], { cards: { date: today(), offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: Date.now() - 5000, nextDayGuaranteed: null, dismissed: false } }));
const s7 = await snap();
out.s7_expiredChosen = { chosen: s7.cards.chosen, until: s7.cards.until, hud: s7.hudCard, modalVisible: await ev(`!document.getElementById('cards').classList.contains('hidden')`) };

// ---------- 8. riskPenalty 实机：离线效率 —— 无卡 vs overtime ----------
const offlineSave = (chosen, offers) => {
  const now = Date.now();
  return { v: 2, moyu: 0, totalEarned: 0, levels: {}, savedAt: now - 7200 * 1000, createdAt: now - 3 * 86400000, visits: { date: "", count: 0 }, cards: { date: today(), offers, chosen, until: chosen ? now + 86400000 : 0, nextDayGuaranteed: null, dismissed: false } };
};
await loadWithSave(offlineSave(null, ["coffee_day", "overtime", "hr_talk"]), 2600);
const offNo = (await snap()).totalEarned;
await loadWithSave(offlineSave("overtime", ["coffee_day", "overtime", "hr_talk"]), 2600);
const offOt = (await snap()).totalEarned;
out.s8_riskPenaltyOffline = {
  noCardEarned2h: Math.round(offNo),
  overtimeEarned2h: Math.round(offOt),
  idleRateNo: 0.2,
  idleRateOvertime: 0.32,
  expectedIfRiskWired: "0.32×7200×eff(0.5)=1152 vs 0.2×7200×0.7=1008（含 visit/streak 加成共同缩放）",
  ratio: +(offOt / Math.max(1, offNo)).toFixed(3),
};

out.consoleErrors = errors;
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/r13-reverify.png", Buffer.from(shot.data, "base64"));
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL"); process.exit(0);
