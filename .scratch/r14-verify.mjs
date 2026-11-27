/**
 * r14 复验（叙事党）v2：每个场景独立 Chrome，避免多次 reload 后页面卡死
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r14/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { errors: [] };
const URL_ = "http://127.0.0.1:5173/";
let portSeq = 9570;

async function session(label, fn) {
  const port = portSeq++;
  const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r14b-${port}`, `--remote-debugging-port=${port}`, "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 120; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(100); } }
  const target = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
  const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64")); };
  const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
  const visible = () => evalJs(`(()=>({cards:!document.getElementById('cards').classList.contains('hidden'),boss:!document.getElementById('boss-choice').classList.contains('hidden'),toast:{text:(document.getElementById('dom-toast')||{}).textContent,show:(document.getElementById('dom-toast')||{className:''}).classList.contains('show')},sr:(document.getElementById('sr-live')||{}).textContent,hudCard:(document.getElementById('hud-card')||{}).textContent,hudHidden:(document.getElementById('hud-card')||{className:''}).classList.contains('hidden')}))()`);
  const rawSave = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save'))}catch(e){return null}})()`);
  const state = () => evalJs(`window.__MOYU__?JSON.parse(JSON.stringify(window.__MOYU__.state)):null`);
  const cardDom = () => evalJs(`(()=>{const r=document.getElementById('cards');if(!r||r.classList.contains('hidden'))return null;return [...r.querySelectorAll('.card')].map(c=>({rarity:c.querySelector('.card-rarity')?.textContent,name:c.querySelector('.card-name')?.textContent,desc:c.querySelector('.card-desc')?.textContent,flavor:c.querySelector('.card-flavor')?.textContent}))})()`);
  const waitCards = async () => { for (let i = 0; i < 80; i++) { if (await evalJs(`(()=>{const r=document.getElementById('cards');return !!(r&&!r.classList.contains('hidden')&&r.querySelector('.card'))})()`)) return true; await sleep(100); } return false; };
  const waitBoot = async () => { for (let i = 0; i < 100; i++) { try { if (await evalJs(`!!window.__MOYU__ && window.__MOYU__.frames>0`)) return true; } catch {} await sleep(120); } return false; };
  const craft = async (mut) => { const base = await rawSave(); const blob = mut(base); await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});Storage.prototype.setItem=function(){}})()`); await send("Page.reload"); };
  const helpers = { send, evalJs, shot, closeWelcome, visible, rawSave, state, cardDom, waitCards, waitBoot, craft, sleep, port };
  try {
    await send("Runtime.enable"); await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await send("Page.navigate", { url: URL_ }); await sleep(3200);
    await closeWelcome(); await sleep(300);
    await waitBoot();
    await fn(helpers);
  } catch (e) { out.errors.push(label + ": " + e.message); }
  try { proc.kill("SIGKILL"); } catch {}
  await sleep(200);
}

await session("skip", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  const got = await h.waitCards();
  out.skip = { panelShown: got, before: await h.visible(), dom: await h.cardDom() };
  await h.shot("01-panel-skip-button");
  await h.evalJs(`document.getElementById('cards-skip').click()`);
  await h.sleep(300);
  out.skip.afterSkip = await h.visible();
  await h.sleep(2500);
  out.skip.after2s = await h.visible();
  out.skip.saved = (await h.rawSave())?.cards;
  await h.shot("02-after-skip-2s");
  await h.send("Page.reload"); await h.sleep(2600); await h.closeWelcome(); await h.sleep(400);
  out.skip.afterReload = await h.visible();
});

await session("esc", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  out.esc = { before: await h.waitCards() };
  await h.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await h.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await h.sleep(400);
  out.esc.after = await h.visible();
  await h.sleep(1800);
  out.esc.after2s = await h.visible();
  out.esc.saved = (await h.rawSave())?.cards;
});

await session("backdrop", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  out.backdrop = { before: await h.waitCards() };
  await h.evalJs(`(()=>{document.getElementById('cards').dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`);
  await h.sleep(500);
  out.backdrop.after = await h.visible();
  await h.sleep(1500);
  out.backdrop.after15 = await h.visible();
});

await session("choose-hud", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  out.choose = { panel: await h.waitCards() };
  await h.sleep(1400);
  await h.evalJs(`document.querySelector('#cards .card[data-id="hr_talk"]').click()`);
  await h.sleep(300);
  out.choose.after = await h.visible();
  await h.shot("03-choose-hr-toast-hud");
  await h.sleep(2200);
  const body = await h.evalJs(`document.body.innerText`);
  out.choose.flavorReReadable = body.includes("别紧张");
  out.choose.descReReadable = body.includes("明天卡池保证");
  out.choose.hudOnly = (await h.visible()).hudCard;
  await h.send("Page.reload"); await h.sleep(2600); await h.closeWelcome(); await h.sleep(400);
  out.choose.afterReload = await h.visible();
  out.choose.afterReloadFlavor = (await h.evalJs(`document.body.innerText`)).includes("别紧张");
  await h.shot("04-hud-after-reload");
});

await session("favor", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  const now = Date.now();
  const mission = { level: 1, missionId: "stroll", startedAt: now - 120000, endsAt: now - 1000, favor: 0, autoRepeat: false, rewardSnapshot: 0 };
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["old_zhou_secret", "coffee_day", "overtime"], chosen: "old_zhou_secret", until: now + 86400000, nextDayGuaranteed: null, dismissed: true, chosenDate: T }, team: { colleagues: { zhou: mission } } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  const s0 = await h.state();
  out.favor = { before: s0.team.colleagues.zhou?.favor, hudCard: (await h.visible()).hudCard };
  await h.evalJs(`document.getElementById('btn-team').click()`);
  await h.sleep(400);
  out.favor.claimBtn = await h.evalJs(`!!document.querySelector('[data-act="claim"][data-id="zhou"]')`);
  if (out.favor.claimBtn) await h.evalJs(`document.querySelector('[data-act="claim"][data-id="zhou"]').click()`);
  await h.sleep(500);
  const s1 = await h.state();
  out.favor.after = s1.team.colleagues.zhou?.favor;
  out.favor.toast = await h.evalJs(`(document.getElementById('dom-toast')||{}).textContent`);
  await h.shot("05-favor-claim");
});

await session("newcards", async (h) => {
  const T = await h.evalJs(`new Date().toLocaleDateString('sv-SE')`);
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: T, offers: ["deadline", "intern_ask", "remote_day"], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  out.newCards = { panel: await h.waitCards(), dom: await h.cardDom() };
  await h.shot("06-new-cards");
});

await session("boss", async (h) => {
  await h.evalJs(`window.__MOYU__.grant(1e9)`);
  await h.sleep(200);
  const correctOf = (t) => t.includes("脚步") ? "act-busy" : t.includes("盯着") ? "switch-screen" : "keep-slacking";
  const seen = new Map();
  out.boss = [];
  for (let i = 0; i < 9; i++) {
    await h.evalJs(`window.__MOYU__.forceBoss('choice')`);
    await h.sleep(220);
    const panel = await h.evalJs(`(()=>{const r=document.getElementById('boss-choice');if(!r||r.classList.contains('hidden'))return null;return {tell:document.getElementById('boss-tell').textContent,opts:[...document.querySelectorAll('#boss-opts button')].map(b=>({id:b.dataset.choice,label:b.textContent}))}})()`);
    if (!panel) { out.boss.push({ iter: i, error: "low" }); await sleep(500); continue; }
    const correct = correctOf(panel.tell);
    const rec = { iter: i, tell: panel.tell, nameLeak: /安总|王总|老李/.test(panel.tell), chosen: i === 4 ? panel.opts.find((o) => o.id !== correct).id : correct };
    out.boss.push(rec);
    if (!seen.has(panel.tell)) { seen.set(panel.tell, true); await h.shot("07-boss-" + seen.size); }
    await h.sleep(320);
    await h.evalJs(`(()=>{const b=document.querySelector('#boss-opts button[data-choice="${rec.chosen}"]');b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
    await h.sleep(350);
    rec.toast = await h.evalJs(`(document.getElementById('dom-toast')||{}).textContent`);
    if (i === 0) await h.shot("08-boss-toast-line");
    await h.sleep(700);
  }
  // 画布点击提示
  await h.evalJs(`window.__MOYU__.forceBoss('choice')`); await h.sleep(600);
  const before = await h.state();
  await h.evalJs(`(()=>{const c=document.getElementById('stage');c.dispatchEvent(new PointerEvent('pointerdown',{clientX:195,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
  await h.sleep(250);
  const after = await h.state();
  out.canvasTap = { fx: await h.evalJs(`window.__MOYU__.fxTexts()`), delta: after.moyu - before.moyu, panel: (await h.visible()).boss };
  await h.shot("09-canvas-tap");
  await h.sleep(5200);
  out.timeout = await h.visible();
  await h.shot("10-timeout");
});

await session("hr-chain", async (h) => {
  await h.craft((base) => ({ ...base, moyu: 1e9, totalEarned: 1e9, lifetimeEarned: 1e9, totalClicks: 20, cards: { date: "2026-11-26", offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: "secret_project", dismissed: true, chosenDate: "" } }));
  await h.sleep(2400); await h.closeWelcome(); await h.sleep(400);
  out.hrChain = { state: (await h.state()).cards, bodyHasXiaomei: (await h.evalJs(`document.body.innerText`)).includes("小美") };
});

writeFileSync(DIR + "evidence.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
