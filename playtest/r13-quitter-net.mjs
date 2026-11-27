/**
 * R13 弃坑型玩家：dev 专项打「回合制老板」——线索可读性 / 4s 够不够 / 选错与超时后果 / 与摸鱼点击的冲突。
 * 只读探针，不改 src。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { openBrowser, setupMobilePage, sleep } from "./r9-cdp-lib.mjs";

const OUT = "playtest/r13-q-net.json";
const SCREENS = "playtest/r13-q-screens";
mkdirSync(SCREENS, { recursive: true });

const b = await openBrowser({ port: 9474, tag: "r13qn" });
await setupMobilePage(b, { url: "http://127.0.0.1:5173/" });
const out = { tests: [], card: null, notes: [] };
let shotN = 100;
async function shot(name) {
  shotN += 1;
  const p = `${SCREENS}/${shotN}-${name}.png`;
  await b.shot(p);
  return p;
}
async function tap(x, y) {
  await b.touch("touchStart", [{ x, y, id: 1 }]);
  await b.touch("touchEnd", []);
}
const SNAP = `(() => {
  const q=(id)=>document.getElementById(id); const vis=(id)=>{const e=q(id);return !!e&&!e.classList.contains('hidden');};
  const t=q('dom-toast');
  return { bossOpen: vis('boss-choice'), tell: q('boss-tell')?.textContent||'', opts:[...document.querySelectorAll('#boss-opts button')].map(x=>x.textContent),
    timerW: q('boss-timer')?.firstElementChild?getComputedStyle(q('boss-timer').firstElementChild).width:'',
    cardsOpen: vis('cards'), journalOpen: vis('journal'), toast: t?t.textContent:'', toastShown: t?t.classList.contains('show'):false,
    moyu: q('hud-moyu')?.textContent||'', streak: q('hud-streak')?.textContent||'', streakShown: vis('hud-streak') };
})()`;
const snap = () => b.ev(SNAP);
const st = () => b.ev("JSON.parse(JSON.stringify(window.__MOYU__.state))");
const pickCard = async () => {
  const r = await b.ev(`(() => { const el=[...document.querySelectorAll('#cards-body .card')][0]; if(!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  if (r) { await tap(r.x, r.y); out.card = { pickedAtCard: 0, rect: r }; await sleep(400); }
};
const clickChoice = async (label) => {
  const r = await b.ev(`(() => { const el=[...document.querySelectorAll('#boss-opts button')].find(e=>e.textContent.includes(${JSON.stringify(label)})); if(!el) return null; const b=el.getBoundingClientRect(); return {x:b.x+b.width/2,y:b.y+b.height/2}; })()`);
  if (!r) throw new Error("button not found: " + label);
  await tap(r.x, r.y);
  return r;
};
/** 等一次 choice 老板出现（forceBoss 后） */
async function waitBossOpen(maxMs = 3000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const s = await snap();
    if (s.bossOpen) return { s, t: Date.now() - t0 };
    await sleep(40);
  }
  return { s: await snap(), t: -1 };
}

// 等游戏就绪
let ready = false;
for (let i = 0; i < 200; i++) {
  try { if (await b.ev("!!window.__MOYU__ && !!document.getElementById('stage')")) { ready = true; break; } } catch {}
  await sleep(100);
}
out.notes.push({ ready });
await sleep(700);
out.firstSnapshot = await snap();
await pickCard();
await sleep(500);
out.afterCard = await snap();

// ===== T1：不选，等 4s 超时 =====
{
  const before = await st();
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const { s, t } = await waitBossOpen();
  const openWall = Date.now();
  const record = { name: "T1-timeout", openAfterMs: t, tell: s.tell, opts: s.opts, timerW: s.timerW, samples: [] };
  await sleep(300);
  await shot("T1-choice-timeout-0.3s");
  const s1 = await snap(); record.samples.push({ at: 300, timerW: s1.timerW });
  await sleep(900);
  await shot("T1-choice-timeout-1.2s");
  const s2 = await snap(); record.samples.push({ at: 1200, timerW: s2.timerW });
  await sleep(900);
  await shot("T1-choice-timeout-2.1s");
  const s3 = await snap(); record.samples.push({ at: 2100, timerW: s3.timerW });
  // 等面板关闭
  let closedAt = -1;
  const toastsSeen = [];
  let lastToast = "";
  for (let i = 0; i < 120; i++) {
    const cur = await snap();
    if (cur.toastShown && cur.toast !== lastToast) { toastsSeen.push(cur.toast); lastToast = cur.toast; }
    if (!cur.bossOpen) { closedAt = Date.now() - openWall; break; }
    await sleep(50);
  }
  await shot("T1-choice-timeout-after");
  await sleep(600);
  const after = await st();
  const a2 = await snap();
  record.closedAfterMs = closedAt;
  record.toastsSeen = toastsSeen;
  record.afterToast = a2.toast; record.afterToastShown = a2.toastShown;
  record.stateDelta = {
    moyu: after.moyu - before.moyu,
    totalEarned: after.totalEarned - before.totalEarned,
    patrolSurvives: after.patrolSurvives - before.patrolSurvives,
    surviveStreak: after.surviveStreak,
    beforeStreak: before.surviveStreak,
  };
  record.elapsedToFirstTapMs = 4000;
  out.tests.push(record);
}

// ===== T2：选“正确”的答案（按线索→应对映射） =====
const MAP = [
  { key: "急性子", correct: "立刻装忙" },
  { key: "多疑", correct: "切到工作界面" },
  { key: "健忘", correct: "继续摸鱼" },
];
for (const [idx, shouldBeRight] of [[0, true], [1, false]]) {
  const before = await st();
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const { s } = await waitBossOpen();
  const clue = s.tell;
  const row = MAP.find((m) => clue.includes(m.key));
  const correctLabel = row ? row.correct : null;
  const desc = s.opts.find((o) => o !== correctLabel) ?? s.opts[0];
  const pick = shouldBeRight ? correctLabel : desc;
  const record = { name: shouldBeRight ? "T2-correct" : "T3-wrong", clue, opts: s.opts, inferredCorrect: correctLabel, picked: pick };
  await shot(shouldBeRight ? "T2-choice-correct-before" : "T3-choice-wrong-before");
  await sleep(300);
  await clickChoice(pick);
  await sleep(500);
  const after = await st();
  const a2 = await snap();
  record.toast = a2.toast;
  record.moyuDelta = after.moyu - before.moyu;
  record.stateDelta = { totalEarned: after.totalEarned - before.totalEarned, patrolSurvives: after.patrolSurvives - before.patrolSurvives, surviveStreak: after.surviveStreak, beforeStreak: before.surviveStreak };
  await shot(shouldBeRight ? "T2-choice-correct-after" : "T3-choice-wrong-after");
  out.tests.push(record);
  await sleep(1200);
}

// ===== T4：选择期间手贱戳屏幕（摸鱼本能在 4 秒内必然发生） =====
{
  const before = await st();
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const { s } = await waitBossOpen();
  await sleep(1200); // 过 0.8s 宽限
  const mid = await snap();
  await tap(195, 470); // 面板在 bottom 200px，这里戳画布
  await sleep(200);
  const afterTap = await st();
  const record = {
    name: "T4-tap-during-choice",
    clue: s.tell,
    moyuBefore: before.moyu,
    moyuAfterTap: afterTap.moyu,
    deltaByTap: afterTap.moyu - before.moyu,
    surviveStreakBefore: before.surviveStreak,
    surviveStreakAfterTap: afterTap.surviveStreak,
    panelStillOpen: (await snap()).bossOpen,
    totalClicksBefore: before.totalClicks,
    totalClicksAfter: afterTap.totalClicks,
  };
  await shot("T4-tap-during-choice");
  out.tests.push(record);
  // 让它自然超时
  await sleep(3200);
  await shot("T4-after-timeout");
  await sleep(800);
}

// ===== T5：图鉴/日报面板开着时被回合制老板打断 =====
{
  const btn = await b.ev(`(() => { const el=document.getElementById('btn-journal'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await tap(btn.x, btn.y);
  await sleep(400);
  const journalShot = await shot("T5-journal-open");
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const { s, t } = await waitBossOpen(1500);
  await shot("T5-boss-over-journal");
  const rec = { name: "T5-boss-over-journal", bossOpen: s.bossOpen, journalOpen: s.journalOpen, tell: s.tell, appearedAfterMs: t, journalShot };
  out.tests.push(rec);
  await sleep(4200);
  // 关 journal
  const x = await b.ev(`(() => { const el=document.getElementById('journal-close'); const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
  await tap(x.x, x.y).catch(() => {});
}

// ===== T6：刷新后今日卡是否还弹（已选过同一天应不弹） =====
try {
  await b.send("Page.reload");
  await sleep(2500);
  const s = await snap();
  out.tests.push({ name: "T6-reload-same-day-card", cardsOpen: s.cardsOpen });
  await shot("T6-reload");
} catch (e) {
  out.notes.push({ reloadErr: String(e).slice(0, 200) });
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 6000));
b.close();
process.exit(0);
