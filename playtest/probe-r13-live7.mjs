// R13 第三次实机复验（HEAD 0e58b20 引擎；dev 5173 当前含未提交 UI 改动）
// 重点：① 跨天时旧 buff 保留后卡弹窗是否还能弹出（UI 门槛）② skip 关闭 ③ forceBoss 性格 ④ 赔率/窗口 ⑤ 线索去答案化
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9854;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13rv4-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
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
const toastText = () => ev(`document.getElementById('dom-toast')?.textContent||''`);
const srText = () => ev(`document.getElementById('sr-live')?.textContent||''`);
const snap = () => ev(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,totalClicks:s.totalClicks,streak:s.surviveStreak,survives:s.patrolSurvives,cards:s.cards,hud:document.getElementById('hud-card').classList.contains('hidden')?'':document.getElementById('hud-card').textContent};})()`);
const loadWithSave = async (cards, extra = {}, wait = 2300) => {
  const now = Date.now();
  const save = { v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000, cards, ...extra };
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});sessionStorage.setItem('moyu-boot-ms',String(Date.now()-60000));}catch(e){}`;
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await nav(wait);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
};
const cardState = (date, chosen, until, chosenDate, dismissed = false, offers = ["coffee_day", "overtime", "hr_talk"]) => ({ date, offers, chosen, until, nextDayGuaranteed: null, dismissed, chosenDate });
const TELL_MAP = { "脚步声又快又重": "act-busy", "盯着别人的屏幕": "switch-screen", "边走边看手机": "keep-slacking" };
const correctOfTell = (tell) => { for (const k in TELL_MAP) if (tell.includes(k)) return TELL_MAP[k]; return null; };
const clickChoice = (choice) => ev(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${choice}"]');if(!b)return 'no-btn';b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));b.click();return 'ok';})()`);
const openChoice = async () => { await ev(`window.__MOYU__.forceBoss('choice')`); await sleep(400); return ev(`(()=>{const root=document.getElementById('boss-choice');const btns=[...document.querySelectorAll('#boss-opts button')];return {visible:!root.classList.contains('hidden'),tell:document.getElementById('boss-tell').textContent,choices:btns.map(b=>b.dataset.choice)};})()`); };

// ---------- 1. 跨天：昨天选的卡仍在 24h 内，今天是否有新卡池且弹窗可弹出 ----------
await loadWithSave(cardState(yesterday(), "coffee_day", Date.now() + 2 * 3600000, yesterday()));
out.s1_crossDayUi = {
  state: await snap(),
  modalVisible: await modalVisible(), // 期望 true（今天还没选）；若 false = UI 仍被旧 chosen 挡住
  cardNames: await ev(`[...document.querySelectorAll('#cards-body .card-name')].map(e=>e.textContent)`),
  bodyHasCardUI: await ev(`!!document.querySelector('#cards-body .card')`),
};
// 玩家是否有别的入口打开卡面板
out.s1_entryPoints = await ev(`[...document.querySelectorAll('button')].map(b=>b.id||b.textContent).filter(x=>/卡|card/i.test(String(x)))`);

// ---------- 2. 旧卡过期 + 刷新后：能否选今天的新卡 ----------
await loadWithSave(cardState(today(), "coffee_day", Date.now() - 1000, yesterday()));
out.s2_expiredReload = { state: await snap(), modalVisible: await modalVisible() };
await sleep(500);
out.s2_choose = await ev(`(async()=>{const c=document.querySelector('#cards-body .card');if(!c)return {noCard:true};const name=c.querySelector('.card-name').textContent;c.click();await new Promise(r=>setTimeout(r,300));const s=window.__MOYU__.state;return {pickedName:name,chosen:s.cards.chosen,chosenDate:s.cards.chosenDate,toast:document.getElementById('dom-toast')?.textContent||'',hud:document.getElementById('hud-card').textContent};})()`);
// 同日二次选择应被拒（引擎层：直接看 UI 是否还有卡可点）
out.s2_sameDayAgain = await ev(`(()=>window.__MOYU__.state.cards)().then(s=>s)`);

// ---------- 3. skip 是否真关面板 ---
await loadWithSave(cardState(today(), null, 0, "", false));
await sleep(400);
const skipBefore = await modalVisible();
await ev(`document.getElementById('cards-skip').click()`);
await sleep(250);
out.s3_skip = { visibleBefore: skipBefore, hiddenRightAfter: !(await modalVisible()), dismissed: (await snap()).cards.dismissed };
await sleep(1200);
out.s3_skipLater = { staysHidden: !(await modalVisible()) };
await nav(2200);
out.s3_afterReload = { modalVisible: await modalVisible(), dismissed: (await snap()).cards.dismissed };

// ---------- 4. forceBoss 性格是否稳定 + 线索是否去名字 ----------
await loadWithSave(cardState(today(), "coffee_day", Date.now() + 86400000, today()));
const runs = [];
for (let i = 0; i < 6; i++) {
  const p = await openChoice();
  runs.push({ tell: p.tell, hasPersonalityName: /急性子|多疑|健忘|安总|王总|老李/.test(p.tell), correct: correctOfTell(p.tell) });
  await clickChoice(correctOfTell(p.tell));
  await sleep(250);
}
out.s4_forcedPersonality = { runs, distinctTells: [...new Set(runs.map((r) => r.tell))], anyNameLeak: runs.some((r) => r.hasPersonalityName) };

// ---------- 5. 赔率 + 窗口 5s + 播报 ----------
await loadWithSave(cardState(today(), "coffee_day", Date.now() + 86400000, today()));
const p5 = await openChoice();
out.s5_announce = { sr: await srText(), tell: p5.tell };
const a5 = await snap();
await clickChoice(correctOfTell(p5.tell));
await sleep(350);
const b5 = await snap();
out.s5_correct = { delta: +(b5.moyu - a5.moyu).toFixed(1), expected: "base50×1.8=90 + 挂机", streak: b5.streak, toast: await toastText() };
// 连续 3 次选错：第 2、3 次（巡逻 2/3）新手免罚，第 4 次（巡逻 4）罚 base×1.0=50
const wrongRuns = [];
for (let i = 0; i < 3; i++) {
  const p = await openChoice();
  const wrong = ["act-busy", "switch-screen", "keep-slacking"].find((c) => c !== correctOfTell(p.tell));
  const a = await snap();
  await clickChoice(wrong);
  await sleep(350);
  const b = await snap();
  wrongRuns.push({ patrol: 2 + i, delta: +(b.moyu - a.moyu).toFixed(1), streak: b.streak });
}
out.s5_wrongRookie = wrongRuns;
// 窗口时长：开窗后 4.6s 仍可见，5.4s 后隐藏 + 超时提示
const p6 = await openChoice();
const t0 = Date.now();
await sleep(4600);
const at46 = { visible: await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`) };
await sleep(900);
const at55 = { visible: await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`), toast: await toastText() };
out.s6_window = { at4_6s: at46, at5_5s: at55, elapsed: Date.now() - t0 };

// ---------- 6. 卡池 UI：3 张不重复 + 稀有度标签 ----------
await loadWithSave(cardState(today(), null, 0, "", false));
await sleep(300);
out.s7_modal = {
  visible: await modalVisible(),
  count: await ev(`document.querySelectorAll('#cards-body .card').length`),
  rarities: await ev(`[...document.querySelectorAll('#cards-body .card-rarity')].map(e=>e.textContent)`),
  ids: await ev(`[...document.querySelectorAll('#cards-body .card')].map(e=>e.dataset.id)`),
  sub: await ev(`document.querySelector('.cards-sub')?.textContent`),
};
out.consoleErrors = errors;
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL"); process.exit(0);
