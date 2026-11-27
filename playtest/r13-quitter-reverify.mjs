/**
 * R13 弃坑型玩家：修复后复验（线上 v0.4.0 卡弹窗 + dev 回合制老板）。
 * 只读探针，不改 src。输出 playtest/r13-q-reverify.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const OUT = "playtest/r13-q-reverify.json";
const SCREENS = "playtest/r13-q-screens-re";
mkdirSync(SCREENS, { recursive: true });
const out = {};
let shotN = 200;
const sh = async (b, name) => { shotN++; const p = `${SCREENS}/${shotN}-${name}.png`; await b.shot(p); return p; };
const rectOf = (b, sel, text = null) => b.ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${text ? `els.find(e=>e.textContent.includes(${JSON.stringify(text)}))` : "els[0]"}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}; })()`);
async function tapAt(b, pt) { if (!pt) return false; await b.touch("touchStart", [{ x: pt.x, y: pt.y, id: 1 }]); await b.touch("touchEnd", []); return true; }
const LIVE = "https://luojindui.github.io/moyu/";
const SNAP = `(() => {
  const q=(id)=>document.getElementById(id); const vis=(id)=>{const e=q(id);return !!e&&!e.classList.contains('hidden');};
  const t=q('dom-toast');
  return { cardsOpen: vis('cards'), skipBtn: !!(q('cards-skip') && q('cards-skip').offsetParent!==null),
    cardTexts:[...document.querySelectorAll('#cards-body .card')].map(e=>e.innerText.replace(/\\n/g,' | ')),
    cardRects:[...document.querySelectorAll('#cards-body .card')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];}),
    bossOpen: vis('boss-choice'), tell:q('boss-tell')?.textContent||'', opts:[...document.querySelectorAll('#boss-opts button')].map(x=>x.textContent),
    timerW:q('boss-timer')?.firstElementChild?getComputedStyle(q('boss-timer').firstElementChild).width:'',
    journalOpen: vis('journal'), toast:t?t.textContent:'', toastShown:t?t.classList.contains('show'):false,
    hudCard: q('hud-card') ? { text:q('hud-card').textContent, hidden:q('hud-card').classList.contains('hidden') } : null,
    moyu:q('hud-moyu')?.textContent||'', clicks:q('hud-click')?.textContent||'',
  };
})()`;

/** 戳 n 次（每次间隔 ms），并记录每次后是否弹卡 */
async function tapsAndWatch(b, n, gapMs, log) {
  for (let i = 0; i < n; i++) {
    await tapAt(b, { x: 195, y: 430 });
    await sleep(gapMs);
    const s = await b.ev(SNAP);
    log.push({ tap: i + 1, cardsOpen: s.cardsOpen });
    if (s.cardsOpen) return { tapCount: i + 1, s };
  }
  return { tapCount: n, s: await b.ev(SNAP) };
}

async function waitCardsOpen(b, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await b.ev(SNAP);
    if (s.cardsOpen) return { atMs: Date.now() - t0, s };
    await sleep(80);
  }
  return { atMs: -1, s: await b.ev(SNAP) };
}

// ================= A：线上，8 下门槛 + 「今天先不选」关掉后不重开 =================
{
  const b = await openBrowser({ port: 9481, tag: "r13reA" });
  await setupMobilePage(b, { url: LIVE });
  const t0 = Date.now();
  const A = { log: [] };
  // 前 3 秒不点，确认首屏没被拦
  await sleep(2500);
  A.initial = await b.ev(SNAP);
  A.initialAtS = +((Date.now() - t0) / 1000).toFixed(1);
  await sh(b, "A1-first-screen");
  const r = await tapsAndWatch(b, 8, 380, A.log);
  A.tapTrigger = r.tapCount;
  A.cardsAfterTaps = { open: r.s.cardsOpen, atS: +((Date.now() - t0) / 1000).toFixed(1), skipBtn: r.s.skipBtn, texts: r.s.cardTexts };
  await sleep(300);
  A.afterAppear = await b.ev(SNAP);
  await sh(b, "A2-cards-open");
  const skip = await rectOf(b, "#cards-skip");
  A.skipRect = skip;
  await tapAt(b, skip);
  await sleep(400);
  A.afterSkip = await b.ev(SNAP);
  await sh(b, "A3-after-skip");
  // 15s 观察是否重开
  let reopened = false; let openCount = 0;
  const tSkip = Date.now();
  while (Date.now() - tSkip < 15000) {
    const s = await b.ev(SNAP);
    if (s.cardsOpen) { reopened = true; openCount++; }
    await sleep(300);
  }
  A.reopenedAfterSkip = reopened;
  A.reopenSamples = openCount;
  A.hudCardAfterSkip = (await b.ev(SNAP)).hudCard;
  out.A_liveSkip = A;
  await sh(b, "A4-15s-later");
  b.close();
}

// ================= B：线上，8 下门槛选卡：400ms 防误触 + 中文名 + HUD 常驻 =================
{
  const b = await openBrowser({ port: 9482, tag: "r13reB" });
  await setupMobilePage(b, { url: LIVE });
  const t0 = Date.now();
  const B = { log: [] };
  await sleep(1500);
  const r = await tapsAndWatch(b, 8, 350, B.log);
  B.tapTrigger = r.tapCount;
  const detect = Date.now();
  // 防误触：出现后 ~150ms 内点第 2 张卡，应无效
  const card2 = await b.ev(`(() => { const els=[...document.querySelectorAll('#cards-body .card')]; const el=els[1]; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await tapAt(b, card2);
  await sleep(120);
  B.afterEarlyTap = { open: (await b.ev(SNAP)).cardsOpen, tapDelayMs: Date.now() - detect };
  await sh(b, "B1-cards");
  // 正常选第 2 张
  await sleep(600);
  await tapAt(b, card2);
  await sleep(400);
  B.afterChoose = await b.ev(SNAP);
  B.chooseAtS = +((Date.now() - t0) / 1000).toFixed(1);
  await sleep(2000);
  B.toastAfter2s = (await b.ev(SNAP));
  await sh(b, "B2-after-choose");
  await sleep(5000);
  B.hudAfter7s = (await b.ev(SNAP)).hudCard;
  await sh(b, "B3-hud-card");
  out.B_liveChoose = B;
  b.close();
}

// ================= C：线上，0 戳 → 12s fallback 弹卡 + Esc 跳过 =================
{
  const b = await openBrowser({ port: 9483, tag: "r13reC" });
  await setupMobilePage(b, { url: LIVE });
  const t0 = Date.now();
  const C = {};
  const w = await waitCardsOpen(b, 20000);
  C.appearAtS = +((Date.now() - t0) / 1000).toFixed(1);
  C.appearFound = w.atMs >= 0;
  C.tapTrigger = "0 taps (wait fallback)";
  C.skipBtn = w.s.skipBtn;
  await sh(b, "C1-fallback-cards");
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(400);
  C.afterEsc = { open: (await b.ev(SNAP)).cardsOpen };
  let reopened = false;
  const tEsc = Date.now();
  while (Date.now() - tEsc < 6000) { if ((await b.ev(SNAP)).cardsOpen) reopened = true; await sleep(300); }
  C.reopenedAfterEsc = reopened;
  out.C_liveFallbackEsc = C;
  b.close();
}

// ================= D：dev，回合制老板全套 =================
{
  const b = await openBrowser({ port: 9484, tag: "r13reD" });
  await setupMobilePage(b, { url: "http://127.0.0.1:5173/" });
  const D = { tests: [] };
  const st = () => b.ev("JSON.parse(JSON.stringify(window.__MOYU__.state))");
  const done = { log: [] };
  for (let i = 0; i < 200; i++) { try { if (await b.ev("!!window.__MOYU__ && !!document.getElementById('stage')")) break; } catch {} await sleep(100); }
  await sleep(800);
  // 戳 8 下弹卡 → 用「今天先不选」处理掉
  const rt = await tapsAndWatch(b, 8, 300, done.log);
  if (rt.s.cardsOpen) { await sleep(500); await tapAt(b, await rectOf(b, "#cards-skip")); await sleep(300); }
  D.cardSkipOk = !(await b.ev(SNAP)).cardsOpen;

  async function waitBoss(maxMs = 2500) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) { const s = await b.ev(SNAP); if (s.bossOpen) return { s, at: Date.now() - t0 }; await sleep(50); }
    return { s: await b.ev(SNAP), at: -1 };
  }
  const map = [["急性子", "立刻装忙"], ["多疑", "切到工作界面"], ["健忘", "继续摸鱼"]];
  const wrongOf = (clue) => { const row = map.find((m) => clue.includes(m[0])); return row ? (row[1] === "立刻装忙" ? "切到工作界面" : "立刻装忙") : "立刻装忙"; };
  const correctOf = (clue) => { const row = map.find((m) => clue.includes(m[0])); return row ? row[1] : "继续摸鱼"; };

  // T1 超时：窗口长度 + 超时反馈
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    const tOpen = Date.now();
    const toasts = []; let last = "";
    let closedAt = -1;
    while (Date.now() - tOpen < 8000) {
      const c = await b.ev(SNAP);
      if (c.toastShown && c.toast !== last) { toasts.push(c.toast); last = c.toast; }
      if (!c.bossOpen) { closedAt = Date.now() - tOpen; break; }
      await sleep(60);
    }
    await sleep(400);
    const after = await st();
    const fin = await b.ev(SNAP);
    D.tests.push({ name: "T1-timeout", clue: s.tell, opts: s.opts, windowMs: closedAt, toastsSeen: toasts, toastAtClose: fin.toast, toastShown: fin.toastShown, moyuDelta: +(after.moyu - before.moyu).toFixed(2), patrolSurvives: after.patrolSurvives });
    await sh(b, "D1-timeout");
  }
  // T2 新手期选错（应不扣钱）
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(500);
    await tapAt(b, await rectOf(b, "#boss-opts button", wrongOf(s.tell)));
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T2-wrong-rookie", clue: s.tell, picked: wrongOf(s.tell), toast: fin.toast, moyuDelta: +(after.moyu - before.moyu).toFixed(2), streakAfter: after.surviveStreak, patrolSurvives: after.patrolSurvives, patrolCount: undefined });
    await sh(b, "D2-wrong-rookie");
    await sleep(300);
  }
  // T3 选对
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(500);
    await tapAt(b, await rectOf(b, "#boss-opts button", correctOf(s.tell)));
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T3-correct", clue: s.tell, picked: correctOf(s.tell), toast: fin.toast, moyuDelta: +(after.moyu - before.moyu).toFixed(2), streakAfter: after.surviveStreak });
    await sh(b, "D3-correct");
    await sleep(300);
  }
  // T4 第 4 次巡逻选错（应真扣钱）
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(500);
    await tapAt(b, await rectOf(b, "#boss-opts button", wrongOf(s.tell)));
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T4-wrong-late", clue: s.tell, picked: wrongOf(s.tell), toast: fin.toast, moyuDelta: +(after.moyu - before.moyu).toFixed(2) });
    await sh(b, "D4-wrong-late");
    await sleep(300);
  }
  // T5 选择窗口内点画布：不应罚款（收入应上涨）
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(1200);
    const mid = await st();
    await tapAt(b, { x: 195, y: 470 });
    await sleep(250);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T5-tap-in-window", clue: s.tell, moyuBefore: +before.moyu.toFixed(2), moyuMid: +mid.moyu.toFixed(2), moyuAfter: +after.moyu.toFixed(2), deltaTap: +(after.moyu - mid.moyu).toFixed(2), panelStillOpen: fin.bossOpen, toast: fin.toastShown ? fin.toast : "" });
    await sh(b, "D5-tap-in-window");
    await sleep(4200); // 自然超时收尾
    await sleep(400);
  }
  // T6 日报开着时 forceBoss：不应弹出，关掉后延迟触发
  {
    const journalBtn = await rectOf(b, "#btn-journal");
    await tapAt(b, journalBtn);
    await sleep(500);
    const openJ = (await b.ev(SNAP)).journalOpen;
    await b.ev("window.__MOYU__.forceBoss('choice')");
    await sleep(2500);
    const during = await b.ev(SNAP);
    await sh(b, "D6-boss-blocked-by-journal");
    // 关日报
    await tapAt(b, await rectOf(b, "#journal-close"));
    await sleep(400);
    const tj = Date.now();
    let openedAt = -1;
    while (Date.now() - tj < 8000) { if ((await b.ev(SNAP)).bossOpen) { openedAt = Date.now() - tj; break; } await sleep(80); }
    D.tests.push({ name: "T6-modal-block", journalOpen: openJ, bossOpenWhileJournal: during.bossOpen, bossOpenedAfterCloseMs: openedAt });
    await sh(b, "D6b-after-journal-close");
    await sleep(400);
  }
  out.D_devBoss = D;
  b.close();
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
