// R13 碎片党试玩探针 v2：每日卡弹窗 + 回合制老板（390x844，三段打开）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "http://127.0.0.1:5173/";
const PORT = 19000 + Math.floor(Math.random() * 800);
const PROFILE = `/tmp/chrome-r13frag-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

const proc = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio",
  "--no-first-run", "--disable-extensions", `--user-data-dir=${PROFILE}`,
  `--remote-debugging-port=${PORT}`, "about:blank",
], { stdio: "ignore" });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} process.exit(2); }, 170000);

async function waitJson(p, tries = 200) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error("cdp not ready");
}
await waitJson("/json/version");
const targets = await waitJson("/json/list");
const pageTarget = targets.find((x) => x.type === "page");
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200) || m.params.exceptionDetails?.text);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
};
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const js = async (expr) => {
  try {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: r.exceptionDetails.exception?.description?.slice(0, 300) || r.exceptionDetails.text };
    return r.result.value;
  } catch (e) { return { __err: String(e) }; }
};
const shot = async (p) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(p, Buffer.from(s.data, "base64")); return p; };
const tap = async (x, y) => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) { errors.push(`BAD TAP ${x},${y}`); return false; }
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return true;
};
const waitTrue = async (expr, timeout = 6000, step = 40) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const v = await js(expr); if (v === true) return Date.now() - t0; await sleep(step); }
  return -1;
};
const boot = async () => {
  const t0 = Date.now();
  const ms = await waitTrue(`!!window.__MOYU__ && !!document.getElementById('cards')`, 20000, 80);
  await sleep(350);
  return { bootMs: ms, wallMs: Date.now() - t0 };
};
const nav = async () => { await send("Page.navigate", { url: URL_ }); return boot(); };
const cardsOpen = `(()=>{const e=document.getElementById('cards');return !!e && !e.classList.contains('hidden')})()`;

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
log("URL:", pageTarget.url);

const out = {};
// ================= 打开 1 =================
out.A = {};
out.A.boot = await nav();
out.A.url = await js(`location.href`);
out.A.firstCardsVisibleMs = await waitTrue(cardsOpen, 5000, 40);
out.A.bootToPopup = out.A.boot.bootMs;
await sleep(200);
out.A.geo = await js(`(()=>{
  const panel=document.querySelector('#cards .cards-panel');
  const pr=panel.getBoundingClientRect();
  const cards=[...document.querySelectorAll('#cards .card')].map(c=>{const b=c.getBoundingClientRect();return {h:Math.round(b.height),w:Math.round(b.width),top:Math.round(b.top)}});
  const f=(sel)=>{const el=document.querySelector(sel);return el?getComputedStyle(el).fontSize:null};
  return {viewport:[innerWidth,innerHeight], panel:{w:Math.round(pr.width),h:Math.round(pr.height),top:Math.round(pr.top),bottom:Math.round(pr.bottom)},
    scroll:{scrollH:panel.scrollHeight,clientH:panel.clientHeight,needScroll:panel.scrollHeight>panel.clientHeight+1},
    cards, count:cards.length, fonts:{name:f('#cards .card-name'),desc:f('#cards .card-desc'),flavor:f('#cards .card-flavor')},
    closeButtons:document.querySelectorAll('#cards button').length,
    tapTargetHeight:Math.round(document.querySelector('#cards .card').getBoundingClientRect().height),
    canvasBlocked: (()=>{const el=document.elementFromPoint(innerWidth/2,innerHeight*0.35); return el?.id||el?.tagName})()};
})()`);
out.A.cards = await js(`[...document.querySelectorAll('#cards .card')].map(c=>({rarity:c.querySelector('.card-rarity')?.textContent,name:c.querySelector('.card-name')?.textContent,desc:c.querySelector('.card-desc')?.textContent,flavor:c.querySelector('.card-flavor')?.textContent}))`);
out.A.chars = (out.A.cards || []).map((c) => ({ name: (c.name || "").length, desc: (c.desc || "").length, flavor: (c.flavor || "").length }));
out.A.totalChars = (out.A.cards || []).reduce((s, c) => s + (c.name || "").length + (c.desc || "").length + (c.flavor || "").length, 0);
await shot("/tmp/r13f-a-open.png");

// 跳过尝试：点遮罩空白 → 观察是否回弹；Esc
const pt = await js(`(()=>{const p=document.querySelector('#cards .cards-panel').getBoundingClientRect();return {x:Math.round(p.left/2),y:12}})()`);
await tap(pt.x, pt.y); await sleep(80);
const off80 = await js(cardsOpen);
await sleep(500);
const off580 = await js(cardsOpen);
await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`); await sleep(150);
const afterEsc = await js(cardsOpen);
out.A.skip = { outsideClickStillOpen80ms: off80, outsideClickStillOpen580ms: off580, escStillOpen: afterEsc };

// 秒选：点第一张卡（盲点，不看内容）
const c0 = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
const hud0 = await js(`({idle:document.getElementById('hud-idle').textContent,click:document.getElementById('hud-click').textContent,moyu:document.getElementById('hud-moyu').textContent})`);
await tap(c0.x, c0.y);
const closeMs = await waitTrue(`document.getElementById('cards').classList.contains('hidden')`, 1200, 15);
await sleep(100);
out.A.afterPick = await js(`({closed:document.getElementById('cards').classList.contains('hidden'), toast:document.getElementById('dom-toast')?.textContent, chosen:window.__MOYU__.state.cards.chosen, hudIdle:document.getElementById('hud-idle').textContent, hudClick:document.getElementById('hud-click').textContent})`);
out.A.hudBefore = hud0; out.A.closeLatencyMs = closeMs;
await shot("/tmp/r13f-a-after.png");
await sleep(2200);
out.A.afterToastGone = await js(`(()=>{
  const txt=document.body.innerText;
  const names=['咖啡管够','老板出差','提前下班','手速上头','团建吃饭','通宵摸鱼','全员大会','秘密项目','HR 约谈','老周的秘密'];
  return {visibleCardNames:names.filter(n=>txt.includes(n)), hudText:document.getElementById('hud').innerText.replace(/\\n/g,' | ').slice(0,240)}
})()`);
out.A.errorsSoFar = errors.slice();
log("A done", JSON.stringify({ boot: out.A.boot, popup: out.A.firstCardsVisibleMs, skip: out.A.skip, chars: out.A.totalChars, pick: out.A.afterPick }));

// ================= 打开 2 =================
out.B = {};
out.B.boot = await nav();
out.B.cardsVisible = await js(cardsOpen);
out.B.welcomeVisible = await js(`!document.getElementById('welcome').classList.contains('hidden')`);
out.B.hud = await js(`({idle:document.getElementById('hud-idle').textContent,click:document.getElementById('hud-click').textContent,moyu:document.getElementById('hud-moyu').textContent})`);
const cr = await js(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height*0.3)}})()`);
const m0 = await js(`window.__MOYU__.state.moyu`); await tap(cr.x, cr.y); await sleep(140);
const m1 = await js(`window.__MOYU__.state.moyu`);
out.B.canvasTap = { before: m0, after: m1, gained: +(m1 - m0).toFixed(3) };

// 连点中被老板弹出
await tap(cr.x, cr.y);
await js(`window.__MOYU__.forceBoss('choice')`);
const shownMs = await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 2500, 16);
out.B.bossShownAfterMs = shownMs;
out.B.bossGeo = await js(`(()=>{
  const box=document.querySelector('#boss-choice .boss-box').getBoundingClientRect();
  const btns=[...document.querySelectorAll('#boss-opts button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,w:Math.round(r.width),h:Math.round(r.height)}});
  const shop=document.getElementById('shop').getBoundingClientRect();
  return {tell:document.getElementById('boss-tell').textContent, box:{y:Math.round(box.top),w:Math.round(box.width),h:Math.round(box.height),bottom:Math.round(box.bottom)}, btns,
    shopTop:Math.round(shop.top), overlapsShop:box.bottom>shop.top, timerW:document.querySelector('#boss-timer i')?.style.width,
    canvasStillClickable:(()=>{const el=document.elementFromPoint(innerWidth/2, innerHeight*0.3);return el?.id||el?.tagName})(),
    zBoss:getComputedStyle(document.getElementById('boss-choice')).zIndex};
})()`);
await shot("/tmp/r13f-b-boss.png");
// 弹层期间继续点画布
const mb = await js(`window.__MOYU__.state.moyu`); await tap(cr.x, cr.y); await sleep(150);
out.B.tapWhileBoss = await js(`({fx:(window.__MOYU__?.fxTexts?window.__MOYU__.fxTexts().map(f=>f.text):[]), delta:+(window.__MOYU__.state.moyu-${mb}).toFixed(3)})`);
// 老板期间打开日报
await js(`document.getElementById('btn-journal').click()`); await sleep(250);
out.B.journalVsBoss = await js(`(()=>{
  const box=document.querySelector('#boss-choice .boss-box').getBoundingClientRect();
  const el=document.elementFromPoint(innerWidth/2, box.top+box.height/2);
  return {journalVisible:!document.getElementById('journal').classList.contains('hidden'), bossVisible:!document.getElementById('boss-choice').classList.contains('hidden'),
    topAtBossBox: el?.closest('#boss-choice')?'boss':'journal/other', zBoss:getComputedStyle(document.getElementById('boss-choice')).zIndex, zJournal:getComputedStyle(document.getElementById('journal')).zIndex};
})()`);
await shot("/tmp/r13f-b-journal.png");
// 按线索选对
const tell = out.B.bossGeo.tell || "";
const want = tell.includes("走路带风") ? "立刻装忙" : tell.includes("盯着别人屏幕") ? "切到工作界面" : "继续摸鱼";
const opt = await js(`(()=>{const b=[...document.querySelectorAll('#boss-opts button')].find(x=>x.textContent===${JSON.stringify(want)}); if(!b) return null; const r=b.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2),label:b.textContent}})()`);
const mp = await js(`window.__MOYU__.state.moyu`);
await tap(opt.x, opt.y); await sleep(250);
out.B.pick = await js(`({hidden:document.getElementById('boss-choice').classList.contains('hidden'), toast:document.getElementById('dom-toast')?.textContent, delta:+(window.__MOYU__.state.moyu-${mp}).toFixed(2), expect:${JSON.stringify(want)}})`);
await js(`document.getElementById('journal-close').click()`); await sleep(200);

// 超时（不理会 4 秒）
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 1500, 16);
const t0 = Date.now();
const hideMs = await waitTrue(`document.getElementById('boss-choice').classList.contains('hidden')`, 7000, 50);
await sleep(100);
out.B.timeout = { visibleMs: hideMs, wallMs: Date.now() - t0, toast: await js(`document.getElementById('dom-toast')?.textContent`), toastShown: await js(`document.getElementById('dom-toast')?.classList.contains('show')`) };

// 第 4 次巡逻（超出新手保护）弹层里点画布 → 是否被当"偷点"
for (let i = 0; i < 2; i++) {
  await js(`window.__MOYU__.forceBoss('choice')`);
  await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 1500, 16);
  await sleep(950);
  await tap(cr.x, cr.y); await sleep(100);
  await js(`document.querySelector('#boss-opts button')?.click()`); await sleep(200);
}
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 1500, 16);
await sleep(1000);
const m4 = await js(`window.__MOYU__.state.moyu`); await tap(cr.x, cr.y); await sleep(200);
out.B.fourthPatrolTap = await js(`({fx:(window.__MOYU__?.fxTexts?window.__MOYU__.fxTexts().map(f=>f.text):[]), delta:+(window.__MOYU__.state.moyu-${m4}).toFixed(2)})`);
await js(`document.querySelector('#boss-opts button')?.click()`); await sleep(200);
out.B.errorsSoFar = errors.slice();
log("B done", JSON.stringify({ cardsVisible: out.B.cardsVisible, boss: out.B.bossShownAfterMs, geo: out.B.bossGeo, journal: out.B.journalVsBoss, pick: out.B.pick, timeout: out.B.timeout, fourth: out.B.fourthPatrolTap }));

// ================= 打开 3：隔天 + 离线 3 小时回归 =================
out.C = {};
await sleep(1200); // 等自动存档写入
out.C.savePrep = await js(`(()=>{
  const orig = Storage.prototype.setItem;
  const key='moyu-save';
  const blob = JSON.parse(localStorage.getItem(key) || 'null');
  if(!blob) return 'no-save';
  const y=new Date(Date.now()-864e5).toLocaleDateString('sv-SE');
  blob.cards={date:y, offers:[], chosen:null, until:0, nextDayGuaranteed:null};
  blob.savedAt = Date.now()-3*3600*1000;
  orig.call(localStorage, key, JSON.stringify(blob));
  Storage.prototype.setItem = function(){ /* 阻止 pagehide 覆盖 */ };
  return {ok:true, date:y, savedAt:blob.savedAt};
})()`);
out.C.boot = await nav();
out.C.afterReturn = await js(`(()=>{
  const cards=document.getElementById('cards'), w=document.getElementById('welcome');
  const cv=!cards.classList.contains('hidden'), wv=!w.classList.contains('hidden');
  const p=document.querySelector('#cards .cards-panel').getBoundingClientRect();
  const el=document.elementFromPoint(innerWidth/2, p.top+p.height/2);
  return {cardsVisible:cv, welcomeVisible:wv, bothModals:cv&&wv, zCards:getComputedStyle(cards).zIndex, zWelcome:getComputedStyle(w).zIndex,
    topAtCards:el?.closest('#cards')?'cards':(el?.closest('#welcome')?'welcome':'other'),
    welcomeGain:document.getElementById('welcome-gain')?.textContent, welcomeTime:document.getElementById('welcome-time')?.textContent,
    offers:window.__MOYU__.state.cards.offers};
})()`);
await shot("/tmp/r13f-c-both.png");
const c1 = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
await tap(c1.x, c1.y); await sleep(400);
out.C.afterPick = await js(`({cardsHidden:document.getElementById('cards').classList.contains('hidden'), welcomeStill:!document.getElementById('welcome').classList.contains('hidden'), toast:document.getElementById('dom-toast')?.textContent, chosen:window.__MOYU__.state.cards.chosen})`);
await shot("/tmp/r13f-c-after.png");
const ok = await js(`(()=>{const b=document.getElementById('welcome-ok').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
await tap(ok.x, ok.y); await sleep(300);
out.C.ready = await js(`({welcomeHidden:document.getElementById('welcome').classList.contains('hidden'), cardsHidden:document.getElementById('cards').classList.contains('hidden')})`);
out.C.cardStillVisibleAfter = await js(`(()=>{const txt=document.body.innerText;return {hudText:document.getElementById('hud').innerText.replace(/\\n/g,' | ').slice(0,200)}})()`);
log("C done", JSON.stringify(out.C));
out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13frag.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog);
try { proc.kill("SIGKILL"); } catch {}
process.exit(0);
