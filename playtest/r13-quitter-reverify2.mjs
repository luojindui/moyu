/**
 * R13 复验补测：①线上遮罩点击是否真能跳过 ②dev 回合制老板（用 Esc 关掉卡弹窗后）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const SCREENS = "playtest/r13-q-screens-re2";
mkdirSync(SCREENS, { recursive: true });
const out = {};
let n = 300;
const sh = async (b, name) => { n++; const p = `${SCREENS}/${n}-${name}.png`; await b.shot(p); return p; };
const rectOf = (b, sel, text = null) => b.ev(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})]; const el=${text ? `els.find(e=>e.textContent.includes(${JSON.stringify(text)}))` : "els[0]"}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
const tapAt = async (b, pt) => { if (!pt) return false; await b.touch("touchStart", [{ x: pt.x, y: pt.y, id: 1 }]); await b.touch("touchEnd", []); return true; };
const SNAP = `(() => {
  const q=(id)=>document.getElementById(id); const vis=(id)=>{const e=q(id);return !!e&&!e.classList.contains('hidden');};
  const t=q('dom-toast');
  return { cardsOpen:vis('cards'), skipBtn:!!(q('cards-skip')&&q('cards-skip').offsetParent!==null),
    cardTexts:[...document.querySelectorAll('#cards-body .card')].map(e=>e.innerText.replace(/\\n/g,' | ')),
    bossOpen:vis('boss-choice'), tell:q('boss-tell')?.textContent||'', opts:[...document.querySelectorAll('#boss-opts button')].map(x=>x.textContent),
    journalOpen:vis('journal'), teamOpen:vis('team'),
    toast:t?t.textContent:'', toastShown:t?t.classList.contains('show'):false,
    hudCard:q('hud-card')?{text:q('hud-card').textContent,hidden:q('hud-card').classList.contains('hidden')}:null,
    moyu:q('hud-moyu')?.textContent||'' };
})()`;
const tap8 = async (b, gap = 320) => { for (let i = 0; i < 8; i++) { await tapAt(b, { x: 195, y: 430 }); await sleep(gap); } };
const esc = async (b) => { await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); };

// ---------- 线上：遮罩点击 ----------
{
  const b = await openBrowser({ port: 9491, tag: "r13re2A" });
  await setupMobilePage(b, { url: "https://luojindui.github.io/moyu/" });
  await sleep(2000);
  await tap8(b);
  await sleep(400);
  const s1 = await b.ev(SNAP);
  await sh(b, "live-mask-before");
  const mask = { x: 30, y: 120 };
  await tapAt(b, mask);
  await sleep(600);
  const s2 = await b.ev(SNAP);
  await sleep(3000);
  const s3 = await b.ev(SNAP);
  out.liveMask = { openBefore: s1.cardsOpen, openAfterMask: s2.cardsOpen, openAfter3s: s3.cardsOpen, skipBtn: s1.skipBtn };
  await sh(b, "live-mask-after");
  b.close();
}

// ---------- dev：回合制老板 ----------
{
  const b = await openBrowser({ port: 9492, tag: "r13re2B" });
  await setupMobilePage(b, { url: "http://127.0.0.1:5173/" });
  const D = { tests: [] };
  const st = () => b.ev("JSON.parse(JSON.stringify(window.__MOYU__.state))");
  for (let i = 0; i < 200; i++) { try { if (await b.ev("!!window.__MOYU__")) break; } catch {} await sleep(100); }
  await sleep(600);
  await tap8(b);
  await sleep(400);
  const beforeEsc = await b.ev(SNAP);
  await esc(b);
  await sleep(500);
  const afterEsc = await b.ev(SNAP);
  D.cardModal = { openedAfter8Taps: beforeEsc.cardsOpen, jumpBtn: beforeEsc.skipBtn, closedByEsc: !afterEsc.cardsOpen };
  const key = () => sleep(0);
  async function waitBoss(maxMs = 3000) {
    const t0 = Date.now();
    while (Date.now() - t0 < maxMs) { const s = await b.ev(SNAP); if (s.bossOpen) return { s, at: Date.now() - t0 }; await sleep(50); }
    return { s: await b.ev(SNAP), at: -1 };
  }
  const map = [["急性子", "立刻装忙"], ["多疑", "切到工作界面"], ["健忘", "继续摸鱼"]];
  const wrongOf = (clue) => { const r = map.find((m) => clue.includes(m[0])); return r ? (r[1] === "立刻装忙" ? "切到工作界面" : "立刻装忙") : "继续摸鱼"; };
  const correctOf = (clue) => { const r = map.find((m) => clue.includes(m[0])); return r ? r[1] : "继续摸鱼"; };
  const clickOpt = async (label) => { await tapAt(b, await rectOf(b, "#boss-opts button", label)); };

  // T1 超时
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    const tOpen = Date.now();
    const toasts = []; let last = ""; let closedAt = -1;
    while (Date.now() - tOpen < 9000) {
      const c = await b.ev(SNAP);
      if (c.toastShown && c.toast !== last) { toasts.push({ at: Date.now() - tOpen, text: c.toast }); last = c.toast; }
      if (!c.bossOpen) { closedAt = Date.now() - tOpen; break; }
      await sleep(60);
    }
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T1-timeout", clue: s.tell, opts: s.opts, windowMs: closedAt, toastsSeen: toasts, toastAfter: fin.toast, toastAfterShown: fin.toastShown, moyuDelta: +(after.moyu - before.moyu).toFixed(2), patrolSurvives: after.patrolSurvives, streak: after.surviveStreak });
    await sh(b, "dev-T1-timeout");
  }
  // T2 新手选错
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(600);
    await clickOpt(wrongOf(s.tell));
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T2-wrong-rookie", clue: s.tell, picked: wrongOf(s.tell), toast: fin.toast, moyuDelta: +(after.moyu - before.moyu).toFixed(2), streak: after.surviveStreak, patrolSurvives: after.patrolSurvives });
    await sh(b, "dev-T2-wrong-rookie");
  }
  // T3 选对
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(600);
    await clickOpt(correctOf(s.tell));
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T3-correct", clue: s.tell, picked: correctOf(s.tell), toast: fin.toast, moyuDelta: +(after.moyu - before.moyu).toFixed(2), streak: after.surviveStreak, patrolSurvives: after.patrolSurvives });
    await sh(b, "dev-T3-correct");
  }
  // T4 第 4 次选错
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(600);
    await clickOpt(wrongOf(s.tell));
    await sleep(500);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T4-wrong-late", clue: s.tell, picked: wrongOf(s.tell), toast: fin.toast, moyuDelta: +(after.moyu - before.moyu).toFixed(2) });
    await sh(b, "dev-T4-wrong-late");
  }
  // T5 窗口内点画布
  {
    const before = await st();
    await b.ev("window.__MOYU__.forceBoss('choice')");
    const { s } = await waitBoss();
    await sleep(1200);
    const mid = await st();
    await tapAt(b, { x: 195, y: 470 });
    await sleep(250);
    const after = await st(); const fin = await b.ev(SNAP);
    D.tests.push({ name: "T5-tap-in-window", clue: s.tell, moyuMid: +mid.moyu.toFixed(2), moyuAfter: +after.moyu.toFixed(2), deltaTap: +(after.moyu - mid.moyu).toFixed(2), panelStillOpen: fin.bossOpen });
    await sh(b, "dev-T5-tap-in-window");
    await sleep(4300); // 自然超时
  }
  // T6 日报打开时不触发
  {
    await tapAt(b, await rectOf(b, "#btn-journal"));
    await sleep(500);
    const openJ = (await b.ev(SNAP)).journalOpen;
    await b.ev("window.__MOYU__.forceBoss('choice')");
    await sleep(2500);
    const during = await b.ev(SNAP);
    await sh(b, "dev-T6-boss-blocked-by-journal");
    await tapAt(b, await rectOf(b, "#journal-close"));
    await sleep(400);
    const tj = Date.now();
    let openedAt = -1;
    while (Date.now() - tj < 8000) { if ((await b.ev(SNAP)).bossOpen) { openedAt = Date.now() - tj; break; } await sleep(80); }
    D.tests.push({ name: "T6-modal-block", journalOpen: openJ, bossWhileJournalOpen: during.bossOpen, bossOpenedAfterCloseMs: openedAt });
    await sh(b, "dev-T6b-after-close");
  }
  out.devBoss = D;
  b.close();
}

writeFileSync("playtest/r13-q-reverify2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
