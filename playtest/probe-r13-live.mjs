// R13 实机探针：每日卡 + 回合制老板（headless Chrome + CDP；只操作 localStorage，不改 src/）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9847;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(p, tries = 120) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch { } await sleep(100); } throw new Error("cdp not ready"); }
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 200)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: JSON.stringify(r.exceptionDetails).slice(0, 250) } : r.result.value; };
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });

const out = {};
const reload = async (wait = 2000) => { await send("Page.navigate", { url: URL }); await sleep(wait); };
const snap = async () => ev(`(()=>{const s=window.__MOYU__&&window.__MOYU__.state; if(!s) return null; return {moyu:s.moyu, totalEarned:s.totalEarned, streak:s.surviveStreak, survives:s.patrolSurvives, cards:s.cards};})()`);
const injectSave = async (over = {}) => {
  await ev(`(()=>{const now=Date.now(); const today=new Date().toLocaleDateString('sv-SE'); const blob={v:2, moyu:1000000, totalEarned:1000000, levels:{}, savedAt:now, createdAt:now-2*86400000, cards:{date:today, offers:['coffee_day','overtime','hr_talk'], chosen:null, until:0, nextDayGuaranteed:null}, ...${JSON.stringify(over)}}; localStorage.setItem('moyu-save', JSON.stringify(blob)); return blob;})()`);
  await send("Page.navigate", { url: URL }); await sleep(2000);
};

// ---------- 1. 首开卡弹窗 ----------
await ev(`localStorage.clear()`);
await reload(2600);
out.step1_cardModal = await ev(`(()=>{const root=document.getElementById('cards'); const cards=[...document.querySelectorAll('#cards-body .card')]; return {visible:!root.classList.contains('hidden'), count:cards.length, ids:cards.map(c=>c.dataset.id), rarities:cards.map(c=>c.className), sub:document.querySelector('.cards-sub')?.textContent};})()`);
// ---------- 2. 点遮罩关闭后是否自动重开 ----------
out.step2_backdropDismiss = await ev(`(async()=>{const root=document.getElementById('cards'); root.click(); const nowHidden=root.classList.contains('hidden'); await new Promise(r=>setTimeout(r,600)); return {hiddenRightAfter:nowHidden, reopenedAfter600ms:!root.classList.contains('hidden')};})()`);
// ---------- 3. 选卡：一天一次 / 24h / 弹窗关闭 ----------
out.step3_choose = await ev(`(async()=>{const before=window.__MOYU__.state.cards; const card=document.querySelector('#cards-body .card'); const id=card.dataset.id; card.click(); await new Promise(r=>setTimeout(r,300)); const c=window.__MOYU__.state.cards; return {picked:id, chosen:c.chosen, untilMinusNow:Math.round(c.until-Date.now()), sameAsPicked:c.chosen===id, modalHidden:document.getElementById('cards').classList.contains('hidden'), toast:[...document.querySelectorAll('.toast')].map(e=>e.textContent).slice(-2)};})()`);
// ---------- 4. 刷新后 cards 保留 ----------
await send("Page.navigate", { url: URL }); await sleep(2200);
out.step4_reloadPersist = await ev(`(()=>{const c=window.__MOYU__.state.cards; return {chosen:c.chosen, untilFuture:c.until>Date.now(), modalVisible:!document.getElementById('cards').classList.contains('hidden'), offerCount:(c.offers||[]).length};})()`);

// ---------- 5. idle 卡效果实机（注入 coffee_day vs 无卡，测 moyu 增速） ----------
await injectSave({ cards: { date: new Date().toLocaleDateString("sv-SE"), offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: Date.now() + 86400000, nextDayGuaranteed: null } });
await sleep(1200);
const rateNo = await (async () => { await injectSave({ cards: { date: new Date().toLocaleDateString("sv-SE"), offers: ["coffee_day", "overtime", "hr_talk"], chosen: null, until: 0, nextDayGuaranteed: null } }); const a = (await snap()).moyu; await sleep(1600); const b = (await snap()).moyu; return b - a; })();
await injectSave({ cards: { date: new Date().toLocaleDateString("sv-SE"), offers: ["coffee_day", "overtime", "hr_talk"], chosen: "coffee_day", until: Date.now() + 86400000, nextDayGuaranteed: null } });
const a5 = (await snap()).moyu; await sleep(1600); const b5 = (await snap()).moyu;
out.step5_idleCardLive = { noCardDelta1600ms: rateNo, coffeeDayDelta1600ms: b5 - a5, ratio: (b5 - a5) / rateNo };

// ---------- 6. 回合制老板：正确 / 错误 / 超时 ----------
await injectSave({ cards: { date: new Date().toLocaleDateString("sv-SE"), offers: ["old_zhou_secret", "coffee_day", "overtime"], chosen: "old_zhou_secret", until: Date.now() + 86400000, nextDayGuaranteed: null } });
const TELL_MAP = { "急性子": "act-busy", "多疑": "switch-screen", "健忘": "keep-slacking" };
const openChoice = async () => {
  out.__forceReturn = await ev(`window.__MOYU__.forceBoss('choice')`);
  await sleep(350);
  return ev(`(()=>{const root=document.getElementById('boss-choice'); const btns=[...document.querySelectorAll('#boss-opts button')]; return {visible:!root.classList.contains('hidden'), tell:document.getElementById('boss-tell').textContent, buttons:btns.map(b=>b.dataset.choice), labels:btns.map(b=>b.textContent), timerHtml:document.getElementById('boss-timer').innerHTML.slice(0,60)};})()`);
};
const clickChoice = async (choice) => ev(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${choice}"]'); if(!b) return 'no-btn'; b.click(); return 'clicked';})()`);
const correctOf = (tell) => { for (const k in TELL_MAP) if (tell.includes(k)) return TELL_MAP[k]; return null; };

const p1 = await openChoice();
const before1 = await snap();
const correct1 = correctOf(p1.tell);
await clickChoice(correct1); await sleep(350);
const after1 = await snap();
out.step6a_correct = { tell: p1.tell, correct: correct1, delta: after1.moyu - before1.moyu, streak: after1.streak, survives: after1.survives, panelHidden: await ev(`document.getElementById('boss-choice').classList.contains('hidden')`), toast: await ev(`[...document.querySelectorAll('.toast')].map(e=>e.textContent).slice(-1)[0]||''`) };

const p2 = await openChoice();
const before2 = await snap();
const wrong2 = ["act-busy", "switch-screen", "keep-slacking"].find((c) => c !== correctOf(p2.tell));
await clickChoice(wrong2); await sleep(350);
const after2 = await snap();
out.step6b_wrong = { tell: p2.tell, wrong: wrong2, delta: Math.round((after2.moyu - before2.moyu) * 10) / 10, streak: after2.streak, toast: await ev(`[...document.querySelectorAll('.toast')].map(e=>e.textContent).slice(-1)[0]||''`) };

// 先选对一次把连胜拉到 1，再超时验证"超时 0 奖且不误伤连胜"
const p3 = await openChoice(); await clickChoice(correctOf(p3.tell)); await sleep(250);
const p4 = await openChoice();
const beforeTO = await snap();
await sleep(4600);
const afterTO = await snap();
out.step6c_timeout = { tell: p4.tell, deltaDuringWindow: Math.round((afterTO.moyu - beforeTO.moyu) * 10) / 10, streakBefore: beforeTO.streak, streakAfter: afterTO.streak, panelHidden: await ev(`document.getElementById('boss-choice').classList.contains('hidden')`), toast: await ev(`[...document.querySelectorAll('.toast')].map(e=>e.textContent).slice(-1)[0]||''`) };

// ---------- 7. 超时后延迟 click()：窗口校验缺失的实机证据 ----------
const p5 = await openChoice();
const st5 = await snap();
await ev(`(()=>{const b=document.querySelector('#boss-opts button'); const c=${JSON.stringify(correctOf(p5.tell))}; const btn=document.querySelector('#boss-opts button[data-choice="'+c+'"]')||b; window.__lateClickResult='scheduled'; setTimeout(()=>{btn.click(); window.__lateClickResult='fired';}, 4800); return window.__lateClickResult;})()`);
await sleep(5600);
const after5 = await snap();
out.step7_lateClickAfterTimeout = { tell: p5.tell, delta: Math.round((after5.moyu - st5.moyu) * 10) / 10, streakBefore: st5.streak, streakAfter: after5.streak, lateClickFired: await ev(`window.__lateClickResult`), toast: await ev(`[...document.querySelectorAll('.toast')].map(e=>e.textContent).slice(-1)[0]||''`), panelHidden: await ev(`document.getElementById('boss-choice').classList.contains('hidden')`) };

// ---------- 8. 性格覆盖：forceBoss('choice') 是否固定 suspicious ----------
const tells = [];
for (let i = 0; i < 6; i++) {
  const p = await openChoice();
  tells.push(p.tell.slice(0, 6));
  await clickChoice(correctOf(p.tell)); await sleep(200);
}
out.step8_forcedPersonality = { forceReturn: out.__forceReturn, tells, distinct: [...new Set(tells)] };

// ---------- 9. 双击同一选项是否重复结算 ----------
const p9 = await openChoice();
const before9 = await snap();
const c9 = correctOf(p9.tell);
await ev(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${c9}"]'); b.click(); b.click(); return 1;})()`);
await sleep(300);
const after9 = await snap();
out.step9_doubleClick = { tell: p9.tell, delta: after9.moyu - before9.moyu, streak: after9.streak };

out.consoleErrors = errors;
out.screenshot = "/tmp/r13-live.png";
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/r13-live.png", Buffer.from(shot.data, "base64"));
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL");
process.exit(0);
