/**
 * r14 复验探针：批2 P1 修复复验（叙事党）
 * 覆盖：卡弹窗关闭/跳过、HUD 今日卡、卡面承诺、老周好感、老板台词、新卡文案、超时
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { errors: [] };
const waitFor = async (expr, timeout = 6000) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { try { if (await evalJs(expr)) return true; } catch {} await sleep(100); } return false; };

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r14-" + Date.now(), "--remote-debugging-port=9560", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9560/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9560/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64")); };
const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
const visible = () => evalJs(`(()=>({cards:!document.getElementById('cards').classList.contains('hidden'),boss:!document.getElementById('boss-choice').classList.contains('hidden'),hudCard:(document.getElementById('hud-card')||{}).textContent,hudCardHidden:(document.getElementById('hud-card')||{className:''}).classList.contains('hidden'),toast:{text:(document.getElementById('dom-toast')||{}).textContent,show:(document.getElementById('dom-toast')||{className:''}).classList.contains('show')},sr:(document.getElementById('sr-live')||{}).textContent}))()`);
const cardDom = () => evalJs(`(()=>{const r=document.getElementById('cards');if(!r||r.classList.contains('hidden'))return null;return [...r.querySelectorAll('.card')].map(c=>({rarity:c.querySelector('.card-rarity')?.textContent,name:c.querySelector('.card-name')?.textContent,desc:c.querySelector('.card-desc')?.textContent,flavor:c.querySelector('.card-flavor')?.textContent}))})()`);
const bodyHas = async (t) => (await evalJs(`document.body.innerText`)).includes(t);
const rawSave = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save'))}catch(e){return null}})()`);
const saveState = () => evalJs(`window.__MOYU__?JSON.parse(JSON.stringify(window.__MOYU__.state)):null`);
const patchReload = async (blob) => { await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});Storage.prototype.setItem=function(){};return true})()`); await send("Page.reload"); await sleep(2300); await closeWelcome(); await sleep(400); };
const waitCards = async () => { const ok = await waitFor(`(()=>{const r=document.getElementById('cards');return !!(r&&!r.classList.contains('hidden')&&r.querySelector('.card'))})()`, 6000); if(!ok) out.errors.push('cards panel not visible'); return ok; };
const clickEl = (sel) => evalJs(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.click();return true})()`);
const today = async () => evalJs(`new Date().toLocaleDateString('sv-SE')`);

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3000); await closeWelcome(); await sleep(300);
const base = await rawSave();
const T = await today();
const baseCards = (offers, extra = {}) => ({ date: T, offers, chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "", ...extra });
const mk = (cardsState, extra = {}) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: cardsState, ...extra });

// ---------- 1. 弹窗可关：今天先不选 ----------
await patchReload(mk(baseCards(["hr_talk", "coffee_day", "overtime"])));
out.skip = { before: await visible(), dom: await cardDom() };
await shot("01-card-panel-skipbtn");
await clickEl("#cards-skip"); await sleep(300);
out.skip.afterSkip = await visible();
await sleep(2600);
out.skip.after2s = await visible();
out.skip.savedDismissed = (await rawSave())?.cards?.dismissed;
await shot("02-after-skip-2s");
await send("Page.reload"); await sleep(2300);
out.skip.afterReload = await visible();
out.skip.afterReloadBodyHasCard = await bodyHas("HR 约谈");

// ---------- 2. Esc 关闭 ----------
await patchReload(mk(baseCards(["hr_talk", "coffee_day", "overtime"])));
out.esc = { before: await visible() };
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await sleep(400);
out.esc.after = await visible();
out.esc.savedDismissed = (await rawSave())?.cards?.dismissed;

// ---------- 3. 点遮罩关闭 ----------
await patchReload(mk(baseCards(["hr_talk", "coffee_day", "overtime"])));
await evalJs(`(()=>{const r=document.getElementById('cards');r.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`);
await sleep(600);
out.backdrop = await visible();
await sleep(1200);
out.backdrop.after = await visible();

// ---------- 4. 选卡 toast 中文名 + HUD 常驻 + 可回看程度 ----------
await patchReload(mk(baseCards(["hr_talk", "coffee_day", "overtime"])));
await waitCards(); await sleep(1300); // 过 1.2s 防误触
out.panel4 = { visible: await visible(), dom: await cardDom() };
await evalJs(`document.querySelector('#cards .card[data-id="hr_talk"]').click()`);
await sleep(300);
out.chooseHr = { toast: (await visible()).toast, hud: (await visible()).hudCard, hidden: (await visible()).hudCardHidden };
await shot("03-choose-hr-toast-hud");
await sleep(2000);
out.chooseHr.later = await visible();
out.chooseHr.cardDescReReadable = await bodyHas("今晚挂机") || await bodyHas("明天卡池保证");
out.chooseHr.flavorReReadable = await bodyHas("别紧张");
await send("Page.reload"); await sleep(2300);
const afterReload = await visible();
out.chooseHr.afterReload = afterReload;
out.chooseHr.afterReloadFlavor = await bodyHas("别紧张");
await shot("04-hud-after-reload");

// ---------- 5. 老周的秘密「领奖好感 +1」是否兑现 ----------
const missionZhou = { level: 1, missionId: "stroll", startedAt: Date.now() - 120000, endsAt: Date.now() - 1000, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
const zhouTeam = { colleagues: { zhou: missionZhou } };
const withCard = mk(baseCards(["old_zhou_secret", "coffee_day", "overtime"], { chosen: "old_zhou_secret", chosenDate: T, until: Date.now() + 86400000, dismissed: true }), { team: zhouTeam });
const noCard = mk(baseCards(["coffee_day", "overtime", "team_bond"], { dismissed: true }), { team: { colleagues: { zhou: { ...missionZhou } } } });
const claimZhou = async (label) => {
  await closeWelcome();
  const s0 = await saveState();
  const before = s0.team.colleagues.zhou?.favor;
  await evalJs(`document.getElementById('btn-team').click()`);
  await sleep(300);
  const hasBtn = await evalJs(`!!document.querySelector('[data-act="claim"][data-id="zhou"]')`);
  if (hasBtn) await clickEl('[data-act="claim"][data-id="zhou"]');
  await sleep(400);
  const s1 = await saveState();
  const toast = await evalJs(`(document.getElementById('dom-toast')||{}).textContent`);
  out[label] = { before, after: s1.team.colleagues.zhou?.favor, hasBtn, toast, cardChosen: s1.cards?.chosen };
  await evalJs(`(()=>{const t=document.getElementById('team');if(!t.classList.contains('hidden'))document.getElementById('team-close').click();return true})()`);
  await sleep(300);
};
await patchReload(withCard);
await claimZhou("favorWithCard");
await patchReload(noCard);
await claimZhou("favorNoCard");

// ---------- 6. 新卡卡面（文案/数值） ----------
await patchReload(mk(baseCards(["deadline", "intern_ask", "remote_day"])));
out.newCards = await cardDom();
await shot("05-new-cards");

// ---------- 7. 回合制老板：无名字线索 + 台词 + 超时 ----------
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(200);
const correctOf = (t) => t.includes("脚步") ? "act-busy" : t.includes("盯着") ? "switch-screen" : "keep-slacking";
const seen = new Map();
out.boss = [];
for (let i = 0; i < 9; i++) {
  await evalJs(`window.__MOYU__.forceBoss('choice')`);
  await sleep(200);
  const panel = await evalJs(`(()=>{const r=document.getElementById('boss-choice');if(!r||r.classList.contains('hidden'))return null;return {tell:document.getElementById('boss-tell').textContent,opts:[...document.querySelectorAll('#boss-opts button')].map(b=>({id:b.dataset.choice,label:b.textContent})),timer:document.getElementById('boss-timer').innerHTML}})()`);
  if (!panel) { out.boss.push({ iter: i, error: "not open" }); await sleep(600); continue; }
  const rec = { iter: i, tell: panel.tell, opts: panel.opts, nameLeak: /安总|王总|老李/.test(panel.tell) };
  out.boss.push(rec);
  const correct = correctOf(panel.tell);
  rec.chosen = i === 4 ? panel.opts.find((o) => o.id !== correct).id : correct; // 第5次选错（过新手宽限）
  if (!seen.has(panel.tell)) {
    seen.set(panel.tell, true);
    await shot("06-boss-" + seen.size);
  }
  await sleep(300); // 过 250ms 防误触
  await evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${rec.chosen}"]');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
  await sleep(350);
  rec.toast = await evalJs(`(document.getElementById('dom-toast')||{}).textContent`);
  if (i === 0) await shot("07-boss-line-toast");
  await sleep(700);
}

// choice 窗口内点画布
await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(500);
const beforeTap = await saveState();
await evalJs(`(()=>{const c=document.getElementById('stage');c.dispatchEvent(new PointerEvent('pointerdown',{clientX:195,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
await sleep(250);
out.canvasTapDuringChoice = { fx: await evalJs(`window.__MOYU__.fxTexts()`), delta: (await saveState()).moyu - beforeTap.moyu, panelOpen: (await visible()).boss };
await shot("08-canvas-tap-hint");
// 超时
await sleep(5200);
out.timeout = await visible();
await shot("09-timeout-toast");

writeFileSync(DIR + "evidence.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
