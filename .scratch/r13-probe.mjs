/**
 * r13 叙事党试玩探针 v2：每日卡文案/剧情链 + 回合制老板三性格
 * 只读 src，不改源码；证据写 .scratch/r13/
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "http://127.0.0.1:5173/";
const DIR = new URL("./r13/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = { cardScreens: {}, toast: [], personalities: [], errors: [], keyData: {} };
const saveEvidence = () => writeFileSync(DIR + "evidence.json", JSON.stringify(evidence, null, 2));

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r13-" + Date.now(),
  "--remote-debugging-port=9556", "about:blank",
], { stdio: "ignore" });
const fetchJson = async (path) => (await fetch("http://127.0.0.1:9556" + path)).json();
for (let i = 0; i < 100; i++) { try { await fetchJson("/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9556/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); return; }
  if (m.method === "Runtime.exceptionThrown") evidence.errors.push("EX " + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") evidence.errors.push("ERR " + m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
  return r.result.value;
};
const shot = async (name) => {
  const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64"));
};
const closeWelcome = async () => { try { return await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`); } catch { return false; } };
const cardDom = () => evalJs(`(()=>{const r=document.getElementById('cards');if(!r||r.classList.contains('hidden'))return null;return [...r.querySelectorAll('.card')].map(c=>({rarity:c.querySelector('.card-rarity')?.textContent,name:c.querySelector('.card-name')?.textContent,desc:c.querySelector('.card-desc')?.textContent,flavor:c.querySelector('.card-flavor')?.textContent}))})()`);
const state = () => evalJs(`window.__MOYU__?JSON.parse(JSON.stringify(window.__MOYU__.state)):null`);
const rawSave = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save'))}catch(e){return null}})()`);
const toastText = () => evalJs(`(()=>{const t=document.getElementById('dom-toast');return t?{text:t.textContent,shown:t.classList.contains('show')}:null})()`);

/** 写档并重载：先备份 setItem 再 patch 成 no-op，避免 pagehide 自动存档覆盖 */
const writeSaveThenReload = async (blob) => {
  const json = JSON.stringify(blob);
  await evalJs(`(()=>{const orig=Storage.prototype.setItem;localStorage.setItem('moyu-save', ${JSON.stringify(json)});Storage.prototype.setItem=function(){};return true})()`);
  await send("Page.reload");
  await sleep(2200);
  await closeWelcome();
  await sleep(300);
};

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: URL_ });
await sleep(3000);
await closeWelcome();
await sleep(300);
await shot("01-first-load");
evidence.cardScreens.first = await cardDom();
evidence.keyData.firstSave = await rawSave();
const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
evidence.keyData.today = today;

// ---------- A. 剧情卡展示 ----------
let save = await rawSave();
if (!save) { evidence.errors.push("no save blob at 3s"); save = {}; }
save.moyu = 1e9; save.totalEarned = 1e9; save.lifetimeEarned = 1e9;
save.cards = { date: today, offers: ["hr_talk", "old_zhou_secret", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null };
await writeSaveThenReload(save);
evidence.keyData.afterCraftSave = (await rawSave())?.cards;
evidence.cardScreens.storyOffer = await cardDom();
await shot("02-story-cards");
if (!evidence.cardScreens.storyOffer) evidence.errors.push("story cards panel not shown after craft");

// 选择 HR 约谈
try {
  await evalJs(`document.querySelector('#cards .card[data-id="hr_talk"]').click()`);
  await sleep(250);
  evidence.toast.push({ step: "choose hr_talk", ...(await toastText()) });
  await shot("03-choose-hr-toast");
} catch (e) { evidence.errors.push("choose hr fail: " + e.message); }
evidence.keyData.afterHr = (await state())?.cards;
evidence.keyData.afterHrSave = (await rawSave())?.cards;

// ---------- B. 次日：HR 剧情的后续 ----------
let save2 = await rawSave();
save2.cards = { date: "2026-11-26", offers: save2.cards?.offers ?? [], chosen: null, until: 0, nextDayGuaranteed: "secret_project" };
await writeSaveThenReload(save2);
evidence.cardScreens.nextDay = await cardDom();
await shot("04-next-day-secret-project");
evidence.keyData.nextDay = (await state())?.cards;
const np = evidence.cardScreens.nextDay;
if (np && np.some((c) => c.name === "秘密项目")) {
  try {
    await evalJs(`document.querySelector('#cards .card[data-id="secret_project"]').click()`);
    await sleep(250);
    evidence.toast.push({ step: "choose secret_project", ...(await toastText()) });
    await shot("05-choose-secret-toast");
  } catch (e) { evidence.errors.push("choose secret fail: " + e.message); }
} else {
  evidence.errors.push("next-day panel missing 秘密项目: " + JSON.stringify(np));
}

// ---------- C. 回合制老板 ----------
await evalJs(`window.__MOYU__.grant(1e9)`);
await sleep(200);
const correctOf = (tell) => tell.includes("走路带风") ? "act-busy" : tell.includes("盯着别人屏幕") ? "switch-screen" : "keep-slacking";
const seen = new Map();
for (let i = 0; i < 8; i++) {
  await evalJs(`window.__MOYU__.forceBoss('choice')`);
  await sleep(200);
  const panel = await evalJs(`(()=>{const r=document.getElementById('boss-choice');if(!r||r.classList.contains('hidden'))return null;return {tell:document.getElementById('boss-tell').textContent,opts:[...document.querySelectorAll('#boss-opts button')].map(b=>({id:b.dataset.choice,label:b.textContent})),timerW:document.getElementById('boss-timer').innerHTML}})()`);
  if (!panel) { evidence.errors.push("boss panel not open at iter " + i); await sleep(500); continue; }
  const person = panel.tell.split("走过来了")[0];
  const correct = correctOf(panel.tell);
  const rec = { iter: i, person, tell: panel.tell, opts: panel.opts, chosen: i === 1 ? panel.opts.find((o) => o.id !== correct).id : correct };
  evidence.personalities.push(rec);
  if (!seen.has(person)) {
    seen.set(person, true);
    await shot("06-boss-" + (person.includes("安") ? "hasty" : person.includes("王") ? "suspicious" : "forgetful"));
  }
  try {
    await evalJs(`document.querySelector('#boss-opts button[data-choice="${rec.chosen}"]').click()`);
    await sleep(300);
    rec.toast = await toastText();
    evidence.toast.push({ step: "boss pick " + i, choice: rec.chosen, ...rec.toast });
    if (i === 0) await shot("07-boss-correct-toast");
  } catch (e) { evidence.errors.push("boss click fail: " + e.message); }
  await sleep(700);
}

// 超时：不点，等 4.8s
await evalJs(`window.__MOYU__.forceBoss('choice')`);
await sleep(300);
const beforeTimeout = await evalJs(`(()=>{const r=document.getElementById('boss-choice');return r&&!r.classList.contains('hidden')?document.getElementById('boss-tell').textContent:null})()`);
await sleep(4800);
const afterTimeout = await evalJs(`(()=>{const r=document.getElementById('boss-choice');return {open:!!(r&&!r.classList.contains('hidden')),toast:(document.getElementById('dom-toast')||{}).textContent,toastShown:(document.getElementById('dom-toast')||{className:''}).className}})()`);
evidence.keyData.timeout = { before: beforeTimeout, after: afterTimeout };
await shot("08-boss-timeout");

// ---------- D. 桌面视口卡片样张（补充） ----------
await evalJs(`(()=>{const orig=Storage.prototype.setItem;const s=JSON.parse(localStorage.getItem('moyu-save'));s.cards={date:new Date().toLocaleDateString('sv-SE'),offers:['coffee_day','old_zhou_secret','big_meeting'],chosen:null,until:0,nextDayGuaranteed:null};localStorage.setItem('moyu-save',JSON.stringify(s));Storage.prototype.setItem=function(){};return true})()`);
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 800 });
await send("Page.reload");
await sleep(2000);
await shot("09-desktop-cards");
evidence.cardScreens.desktop = await cardDom();

evidence.errors = evidence.errors.slice(0, 30);
saveEvidence();
console.log(JSON.stringify(evidence, null, 2));
proc.kill("SIGKILL");
process.exit(0);
