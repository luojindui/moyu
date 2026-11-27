// R13 碎片党试玩探针：每日卡弹窗打断性 + 回合制老板打断性（390x844）
// 3 次"打开"：A 首次打开（新档）；B 同日重开；C 模拟隔天/离线回归（弹窗叠加）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.R13_PORT || 9877);
const URL_ = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 390;
const H = 844;

const proc = spawn(
  CHROME,
  [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--mute-audio", "--no-first-run", "--disable-extensions",
    `--user-data-dir=/tmp/chrome-r13-${Date.now()}`,
    `--remote-debugging-port=${PORT}`, "about:blank",
  ],
  { stdio: "ignore" },
);
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} process.exit(2); }, 150000);

async function waitJson(p, tries = 150) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch {}
    await sleep(100);
  }
  throw new Error("cdp not ready");
}
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails?.exception?.description?.slice(0, 200) || m.params.exceptionDetails?.text);
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
};
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const js = async (expr) => { try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: r.exceptionDetails.text } : r.result.value; } catch (e) { return { __err: String(e) }; } };
const shot = async (p) => { const s = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(p, Buffer.from(s.data, "base64")); return p; };
const tap = async (x, y) => {
  if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) { console.error("BAD TAP", x, y); return; }
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const waitTrue = async (expr, timeout = 6000, step = 30) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await js(expr)) return Date.now() - t0; await sleep(step); }
  return -1;
};
const navWait = async (ms = 2600) => { await send("Page.navigate", { url: URL_ }); await sleep(ms); };

await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 3, mobile: true, screenWidth: W, screenHeight: H });

const out = {};

// ========== 打开 1：新档首次打开 ==========
const tA = Date.now();
await send("Page.navigate", { url: URL_ });
const cardsShownMs = await waitTrue(`(()=>{const e=document.getElementById('cards');return e && !e.classList.contains('hidden')})()`, 8000);
out.A = { firstCardsVisibleMs: cardsShownMs, bootToPopup: Date.now() - tA };
await sleep(250);
out.A.geo = await js(`(()=>{
  const panel=document.querySelector('#cards .cards-panel'); const r=panel.getBoundingClientRect();
  const cards=[...document.querySelectorAll('#cards .card')].map(c=>{const b=c.getBoundingClientRect();return {h:Math.round(b.h||b.height),w:Math.round(b.w||b.width),top:Math.round(b.top)}});
  const cs=(el,prop)=>getComputedStyle(el)[prop];
  return {
    viewport:[innerWidth,innerHeight], panel:{w:Math.round(r.width),h:Math.round(r.height),top:Math.round(r.top),bottom:Math.round(r.bottom)},
    panelScroll:{scrollH:panel.scrollHeight, clientH:panel.clientHeight, needScroll:panel.scrollHeight>panel.clientHeight+1},
    cards, cardCount:cards.length,
    fonts:{name:cs(document.querySelector('#cards .card-name'),'fontSize'),desc:cs(document.querySelector('#cards .card-desc'),'fontSize'),flavor:cs(document.querySelector('#cards .card-flavor'),'fontSize')},
    hasCloseBtn:document.querySelectorAll('#cards button').length,
    overlayRect:(()=>{const b=document.getElementById('cards').getBoundingClientRect();return {w:Math.round(b.width),h:Math.round(b.height)}})(),
    title:document.getElementById('cards-title')?.textContent, sub:document.querySelector('.cards-sub')?.textContent
  }})()`);
out.A.texts = await js(`[...document.querySelectorAll('#cards .card')].map(c=>({
  rarity:c.querySelector('.card-rarity')?.textContent, name:c.querySelector('.card-name')?.textContent,
  desc:c.querySelector('.card-desc')?.textContent, flavor:c.querySelector('.card-flavor')?.textContent,
  descChars:(c.querySelector('.card-desc')?.textContent||'').length, flavorChars:(c.querySelector('.card-flavor')?.textContent||'').length
}))`);
out.A.totalChars = out.A.texts.reduce((s, c) => s + (c.name?.length || 0) + c.descChars + c.flavorChars, 0);
await shot("/tmp/r13-a-open.png");

// 跳过尝试 1：点遮罩外部（面板外）
const overlayPoint = await js(`(()=>{const p=document.querySelector('#cards .cards-panel').getBoundingClientRect();return {x:Math.round(p.left/2), y:12}})()`);
await tap(overlayPoint.x, overlayPoint.y);
await sleep(60);
const afterOutside = await js(`!document.getElementById('cards').classList.contains('hidden')`);
await sleep(400);
const afterOutside2 = await js(`!document.getElementById('cards').classList.contains('hidden')`);
// 跳过尝试 2：Esc
await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
await sleep(150);
const afterEsc = await js(`!document.getElementById('cards').classList.contains('hidden')`);
out.A.skipAttempts = { clickOutside_hidden60ms: !afterOutside, clickOutside_hidden460ms: !afterOutside2, esc_hidden: !afterEsc };

// 秒选：点第一张卡中心，测关闭时延
const c0 = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2)}})()`);
const hudBefore = await js(`({moyu:document.getElementById('hud-moyu').textContent, idle:document.getElementById('hud-idle').textContent, click:document.getElementById('hud-click').textContent})`);
const tTap = Date.now();
await tap(c0.x, c0.y);
const closeMs = await waitTrue(`document.getElementById('cards').classList.contains('hidden')`, 1500, 20);
out.A.chooseTapLatencyMs = closeMs; out.A.tapAt = Date.now() - tTap;
await sleep(120);
out.A.afterChoose = await js(`({
  toast:document.getElementById('dom-toast')?.textContent,
  toastShown:document.getElementById('dom-toast')?.classList.contains('show'),
  stateCards: window.__MOYU__ ? window.__MOYU__.state.cards : null,
  hudIdle:document.getElementById('hud-idle').textContent,
  hudClick:document.getElementById('hud-click').textContent
})`);
out.A.hudBefore = hudBefore;
// 2 秒后（toast 消失）检查"今日卡"是否还能在界面上看到
await sleep(2100);
out.A.afterToastGone = await js(`(()=>{
  const txt=document.body.innerText;
  const names=['咖啡管够','老板出差','提前下班','手速上头','团建吃饭','通宵摸鱼','全员大会','秘密项目','HR 约谈','老周的秘密'];
  return { visibleCardNames:names.filter(n=>txt.includes(n)), hasRawId:['coffee_day','quiet_day','early_leave','click_frenzy','team_bond','overtime','big_meeting','secret_project','hr_talk','old_zhou_secret'].filter(s=>txt.includes(s)), hudText:document.getElementById('hud').innerText.replace(/\\n/g,' | ').slice(0,220) };
})()`);
await shot("/tmp/r13-a-after.png");

// ========== 打开 2：同一天重开（存卡已选） ==========
await navWait(2800);
out.B = { cardsVisibleAfterReopen: await js(`!document.getElementById('cards').classList.contains('hidden')`), welcomeVisible: await js(`!document.getElementById('welcome').classList.contains('hidden')`) };
out.B.hud = await js(`({idle:document.getElementById('hud-idle').textContent, click:document.getElementById('hud-click').textContent, moyu:document.getElementById('hud-moyu').textContent})`);
// 先验证画布还能正常点（碎片党打开就点两下）
const canvasRect = await js(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height*0.35),w:Math.round(b.width),h:Math.round(b.height)}})()`);
const beforeTap = await js(`window.__MOYU__.state.moyu`);
await tap(canvasRect.x, canvasRect.y); await sleep(120);
const afterTap = await js(`window.__MOYU__.state.moyu`);
out.B.canvasTap = { before: beforeTap, after: afterTap, gained: afterTap - beforeTap, rect: canvasRect };

// 回合制老板：一边连点一边弹出（模拟"正在玩，突然弹层"）
await tap(canvasRect.x, canvasRect.y);
const tBoss = Date.now();
const bBoss = await js(`(()=>{ try { window.__MOYU__.forceBoss('choice'); return 'ok'; } catch(e){ return String(e); } })()`);
const bossShownMs = await waitTrue(`(()=>{const e=document.getElementById('boss-choice');return e && !e.classList.contains('hidden')})()`, 3000, 16);
out.B.boss = { force: bBoss, shownAfterMs: bossShownMs, wallSinceForce: Date.now() - tBoss };
out.B.boss.geo = await js(`(()=>{
  const box=document.querySelector('#boss-choice .boss-box').getBoundingClientRect();
  const btns=[...document.querySelectorAll('#boss-opts button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),bottom:Math.round(r.bottom)}});
  const shop=document.getElementById('shop').getBoundingClientRect();
  const stage=document.getElementById('stage').getBoundingClientRect();
  const tell=document.getElementById('boss-tell').textContent;
  return {tell, box:{x:Math.round(box.x),y:Math.round(box.y),w:Math.round(box.width),h:Math.round(box.height),bottom:Math.round(box.bottom)},
    btns, shopTop:Math.round(shop.top), shopH:Math.round(shop.height), stage:{top:Math.round(stage.top),bottom:Math.round(stage.bottom)},
    boxOverlapsShop: box.bottom>shop.top, timerW:document.querySelector('#boss-timer i')?.style.width,
    pointerEventsContainer:getComputedStyle(document.getElementById('boss-choice')).pointerEvents,
    pointerEventsBox:getComputedStyle(document.querySelector('#boss-choice .boss-box')).pointerEvents,
    zBoss:getComputedStyle(document.getElementById('boss-choice')).zIndex, zJournal:getComputedStyle(document.getElementById('journal')).zIndex,
    atCanvasCenter: (document.elementFromPoint(innerWidth/2, innerHeight*0.3)?.id||document.elementFromPoint(innerWidth/2, innerHeight*0.3)?.tagName)
  }})()`);
await shot("/tmp/r13-b-boss.png");

// 弹层期间继续点画布：会不会被当成"偷点"？
const moyuB1 = await js(`window.__MOYU__.state.moyu`);
await tap(canvasRect.x, canvasRect.y); await sleep(150);
out.B.tapWhileBoss = await js(`({fx: (window.__MOYU__.fxTexts? window.__MOYU__.fxTexts().map(f=>f.text):[]), moyu: window.__MOYU__.state.moyu})`);
out.B.tapWhileBoss.delta = out.B.tapWhileBoss.moyu - moyuB1;

// 回合制老板期间打开日报（碎片党会点📔）：弹层是否压在日报上
await js(`document.getElementById('btn-journal').click()`);
await sleep(250);
out.B.journalCovered = await js(`(()=>{
  const jr=document.getElementById('journal'); const boss=document.getElementById('boss-choice');
  const jrVis=!jr.classList.contains('hidden'), bossVis=!boss.classList.contains('hidden');
  const box=document.querySelector('#boss-choice .boss-box').getBoundingClientRect();
  const el=document.elementFromPoint(innerWidth/2, box.top+box.height/2);
  return {journalVisible:jrVis, bossVisible:bossVis, topElementAtBossBox:(el?.closest('#boss-choice')?'boss':'journal/other'), zBoss:getComputedStyle(boss).zIndex, zJournal:getComputedStyle(jr).zIndex};
})()`);
await shot("/tmp/r13-b-journal.png");
// 选对（forceBoss 强制 suspicious → 切到工作界面）
const opt = await js(`(()=>{const b=[...document.querySelectorAll('#boss-opts button')].find(b=>b.textContent.includes('切到工作界面'));const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
const moyuB2 = await js(`window.__MOYU__.state.moyu`);
const tPick = Date.now();
await tap(opt.x, opt.y);
await sleep(250);
out.B.pick = await js(`({hidden:document.getElementById('boss-choice').classList.contains('hidden'), toast:document.getElementById('dom-toast')?.textContent, moyu:window.__MOYU__.state.moyu})`);
out.B.pick.moyuDelta = out.B.pick.moyu - moyuB2; out.B.pick.pickLatencyMs = Date.now() - tPick;
await js(`document.getElementById('journal-close').click()`); await sleep(200);

// 超时测试：强制后完全不理会，看多久消失 + 有无提示
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 2000, 16);
const tTimeout = Date.now();
const hideMs = await waitTrue(`document.getElementById('boss-choice').classList.contains('hidden')`, 7000, 50);
out.B.timeout = { visibleMs: hideMs, wallSinceShown: Date.now() - tTimeout, toastAfter: await js(`document.getElementById('dom-toast')?.textContent`), toastShown: await js(`document.getElementById('dom-toast')?.classList.contains('show')`) };

// 第 4 次巡逻（超过新手保护 3 次）时在弹层里点画布，是否罚款
for (let i = 0; i < 2; i++) { // 之前已 force 2 次（1 次选对 + 1 次超时），再补 1 次后到第 4 次
  await js(`window.__MOYU__.forceBoss('choice')`);
  await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 1500, 16);
  await sleep(900); // 过宽限期
  await tap(canvasRect.x, canvasRect.y); await sleep(120);
  await js(`document.querySelector('#boss-opts button').click()`); await sleep(250);
}
await js(`window.__MOYU__.forceBoss('choice')`);
await waitTrue(`!document.getElementById('boss-choice').classList.contains('hidden')`, 1500, 16);
await sleep(1000);
const moyu4 = await js(`window.__MOYU__.state.moyu`);
await tap(canvasRect.x, canvasRect.y); await sleep(200);
out.B.fourthPatrolTap = await js(`({fx:(window.__MOYU__.fxTexts?window.__MOYU__.fxTexts().map(f=>f.text):[]), moyu:window.__MOYU__.state.moyu, toast:document.getElementById('dom-toast')?.textContent})`);
out.B.fourthPatrolTap.delta = out.B.fourthPatrolTap.moyu - moyu4;
await js(`document.querySelector('#boss-opts button')?.click()`); await sleep(200);

// ========== 打开 3：模拟隔天回归（离线 3 小时 + 新一天卡） ==========
out.C = {};
out.C.saveOk = await js(`(()=>{
  const k='moyu-save'; const blob=JSON.parse(localStorage.getItem(k)||'null'); if(!blob) return 'no-save';
  const y=new Date(Date.now()-864e5).toLocaleDateString('sv-SE');
  blob.cards={date:y, offers:[], chosen:null, until:0, nextDayGuaranteed:null};
  blob.savedAt=Date.now()-3*3600*1000;
  localStorage.setItem(k, JSON.stringify(blob)); return 'ok';
})()`);
await navWait(3200);
out.C.afterReturn = await js(`(()=>{
  const cards=document.getElementById('cards'), w=document.getElementById('welcome');
  const cardsVis=!cards.classList.contains('hidden'), wVis=!w.classList.contains('hidden');
  const p=document.querySelector('#cards .cards-panel').getBoundingClientRect();
  const el=document.elementFromPoint(innerWidth/2, p.top+p.height/2);
  return {cardsVisible:cardsVis, welcomeVisible:wVis, bothModals:cardsVis&&wVis,
    zCards:getComputedStyle(cards).zIndex, zWelcome:getComputedStyle(w).zIndex,
    topLayer:el?.closest('#cards')?'cards':(el?.closest('#welcome')?'welcome':'other'),
    offers: window.__MOYU__?.state?.cards?.offers, welcomeGain:document.getElementById('welcome-gain')?.textContent,
    welcomeTime:document.getElementById('welcome-time')?.textContent};
})()`);
await shot("/tmp/r13-c-both.png");
// 选卡后欢迎面板是否还压着
const c1 = await js(`(()=>{const b=document.querySelector('#cards .card').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
await tap(c1.x, c1.y); await sleep(400);
out.C.afterChoose = await js(`({cardsHidden:document.getElementById('cards').classList.contains('hidden'), welcomeStillVisible:!document.getElementById('welcome').classList.contains('hidden'), toast:document.getElementById('dom-toast')?.textContent, chosen:window.__MOYU__.state.cards.chosen})`);
await shot("/tmp/r13-c-after.png");
// 点"继续摸鱼"后才真正能玩：记录总计步骤
const okRect = await js(`(()=>{const b=document.getElementById('welcome-ok').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)}})()`);
const tPlay = Date.now();
await tap(okRect.x, okRect.y); await sleep(300);
out.C.playReady = await js(`({welcomeHidden:document.getElementById('welcome').classList.contains('hidden'), cardsHidden:document.getElementById('cards').classList.contains('hidden')})`);
out.C.totalUnblockMs = Date.now() - tPlay;

out.errors = errors;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13-frag.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog);
try { proc.kill("SIGKILL"); } catch {}
process.exit(0);
