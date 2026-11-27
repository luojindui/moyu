// R13 复验实机探针 2：skip/遮罩/Esc 是否真的关闭卡弹窗；选卡中文名 toast + HUD
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9852;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13rv2-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
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
const today = () => new Date().toLocaleDateString("sv-SE");
const out = {};
const nav = async (wait = 2300) => { await send("Page.navigate", { url: URL }); await sleep(wait); };
const toastText = () => ev(`document.getElementById('dom-toast')?.textContent||''`);
const snap = () => ev(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,cards:s.cards,hud:document.getElementById('hud-card').classList.contains('hidden')?'':document.getElementById('hud-card').textContent};})()`);
const loadWithSave = async (save, wait = 2300) => {
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`;
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await nav(wait);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
};
const mkSave = (chosen = null, offers = ["coffee_day", "overtime", "hr_talk"]) => {
  const now = Date.now();
  return { v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000, cards: { date: today(), offers, chosen, until: chosen ? now + 86400000 : 0, nextDayGuaranteed: null, dismissed: false } };
};
const modalVisible = () => ev(`!document.getElementById('cards').classList.contains('hidden')`);

// 先让 sessionStorage 里 boot-ms 变旧，确保 waited=true（卡弹窗不被首开门槛拦住）
await nav(1500);
await loadWithSave(mkSave(null), 2400);
out.p1_modalShown = { visible: await modalVisible(), count: await ev(`document.querySelectorAll('#cards-body .card').length`) };
// A) 「今天先不选」按钮
await ev(`document.getElementById('cards-skip').click()`);
await sleep(250);
out.p2_skip = {
  visibleRightAfter: await modalVisible(),
  dismissed: (await snap()).cards.dismissed,
  visibleAfter1500ms: await ev(`new Promise(r=>setTimeout(()=>r(!document.getElementById('cards').classList.contains('hidden')),1500))`),
};
// B) 选卡点击是否仍可用（弹窗没关也不算死锁）
const beforeChoose = await snap();
const cardCount = await ev(`document.querySelectorAll('#cards-body .card').length`);
out.p3_chooseWhileStillOpen = await ev(`(async()=>{const c=document.querySelector('#cards-body .card');if(!c)return {err:'no-card'};const name=c.querySelector('.card-name').textContent;c.click();await new Promise(r=>setTimeout(r,350));const s=window.__MOYU__.state;return {cardCount:${cardCount},name,chosen:s.cards.chosen,toast:document.getElementById('dom-toast')?.textContent||'',hud:document.getElementById('hud-card').textContent,panelHidden:document.getElementById('cards').classList.contains('hidden')};})()`);
// C) Esc 关闭
await loadWithSave(mkSave(null), 2400);
const visBeforeEsc = await modalVisible();
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await sleep(250);
out.p4_esc = { visibleBefore: visBeforeEsc, visibleAfter: await modalVisible(), dismissed: (await snap()).cards.dismissed };
// D) 遮罩点击
await loadWithSave(mkSave(null), 2400);
await ev(`(()=>{const r=document.getElementById('cards');r.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 1;})()`);
await sleep(300);
out.p5_backdrop = { visibleAfter: await modalVisible(), dismissed: (await snap()).cards.dismissed };
// E) HUD 常驻卡名 + 中文 toast
await loadWithSave(mkSave(null), 2400);
out.p6 = await ev(`(async()=>{await new Promise(r=>setTimeout(r,500));const c=document.querySelector('#cards-body .card');const name=c.querySelector('.card-name').textContent;c.click();await new Promise(r=>setTimeout(r,300));const s=window.__MOYU__.state;return {pickedName:name,chosen:s.cards.chosen,toast:document.getElementById('dom-toast')?.textContent||'',hud:document.getElementById('hud-card').textContent};})()`);
// F) 400ms 防误触：弹窗刚出现立刻点第一张
await loadWithSave(mkSave(null), 2400);
out.p7_400msGuard = await ev(`(()=>{const c=document.querySelector('#cards-body .card');const name=c?.querySelector('.card-name')?.textContent||'';c?.click();return {clickedImmediately:true,name,chosenNow:window.__MOYU__.state.cards.chosen};})()`);
out.p7_after = await ev(`(()=>{const s=window.__MOYU__.state;return {chosen:s.cards.chosen, modalVisible:!document.getElementById('cards').classList.contains('hidden')};})()`);
out.consoleErrors = errors;
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL"); process.exit(0);
