// R13 复验实机探针 3：卡弹窗关闭路径（skip 按钮 / 遮罩 / Esc / 400ms 防误触）
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9853;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13rv3-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
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
const loadFresh = async () => {
  const now = Date.now();
  const save = { v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000, cards: { date: today(), offers: ["coffee_day", "overtime", "hr_talk"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false } };
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});sessionStorage.setItem('moyu-boot-ms',String(Date.now()-60000));}catch(e){}`;
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await nav(2000);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
};
const visible = () => ev(`!document.getElementById('cards').classList.contains('hidden')`);
const cardsState = () => ev(`window.__MOYU__.state.cards`);

// A) skip 按钮
await loadFresh(); await sleep(300);
out.a_initialVisible = await visible();
await ev(`document.getElementById('cards-skip').click()`);
await sleep(300);
out.a_skip = { visibleAfter300: await visible(), dismissed: (await cardsState()).dismissed };
await sleep(1200);
out.a_skipLater = { visibleAfter1500: await visible() };
// 弹窗还开着时选卡是否可用
out.a_chooseStillWorks = await ev(`(()=>{const c=document.querySelector('#cards-body .card');if(!c)return {noCard:true,visible:!document.getElementById('cards').classList.contains('hidden')};c.click();return {clicked:true,chosen:window.__MOYU__.state.cards.chosen};})()`);
await sleep(300);
out.a_afterChoose = { chosen: (await cardsState()).chosen, visible: await visible(), hud: await ev(`document.getElementById('hud-card').textContent`) };

// B) 遮罩点击
await loadFresh(); await sleep(300);
out.b_initialVisible = await visible();
await ev(`(()=>{const r=document.getElementById('cards');r.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 1;})()`);
await sleep(300);
out.b_backdrop = { visibleAfter300: await visible(), dismissed: (await cardsState()).dismissed };

// C) Esc
await loadFresh(); await sleep(300);
out.c_initialVisible = await visible();
await ev(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
await sleep(300);
out.c_esc = { visibleAfter300: await visible(), dismissed: (await cardsState()).dismissed };

// D) 400ms 防误触：一出现立刻点
await loadFresh();
out.d_guard = await ev(`(async()=>{await new Promise(res=>{const iv=setInterval(()=>{const root=document.getElementById('cards');if(!root.classList.contains('hidden')){clearInterval(iv);const c=document.querySelector('#cards-body .card');c.click();res();}},5);setTimeout(()=>{clearInterval(iv);res();},3000);});await new Promise(r=>setTimeout(r,80));return {chosenRightAfterImmediateClick:window.__MOYU__.state.cards.chosen, visible:!document.getElementById('cards').classList.contains('hidden')};})()`);
await sleep(600);
out.d_guardLater = await ev(`(()=>{const c=document.querySelector('#cards-body .card');if(c)c.click();return 1;})()`).then(() => sleep(300)).then(() => ev(`({chosen:window.__MOYU__.state.cards.chosen, visible:!document.getElementById('cards').classList.contains('hidden')})`));
out.consoleErrors = errors;
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL"); process.exit(0);
