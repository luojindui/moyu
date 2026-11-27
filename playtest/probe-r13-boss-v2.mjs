/**
 * R13 赌徒党：回合制老板 v2（针对 17:56 后的当前工作区：5s 窗口 / 新手宽限 / 选择期间点画布被吞 / 超时提示）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, tapCanvas, READ_CARDS } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9842 });
const out = { sampledAt: new Date().toISOString(), ready: b.ready, trials: [], extras: {}, errors: b.errors };
const PANEL_OPEN = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
const ALL = ["act-busy", "switch-screen", "keep-slacking"];

function decideFromTell(tell) {
  if (tell.includes("急性子")) return "act-busy";
  if (tell.includes("多疑")) return "switch-screen";
  if (tell.includes("健忘")) return "keep-slacking";
  return null;
}
async function triggerChoice() {
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const t0 = Date.now();
  const seen = await b.waitFor(PANEL_OPEN, 5000, 25);
  return { seen: !!seen, t0 };
}
const readState = () =>
  b.ev("(() => { const s=window.__MOYU__.state; return { moyu:s.moyu, surviveStreak:s.surviveStreak, patrolSurvives:s.patrolSurvives }; })()");

try {
  // 先把卡面板处理掉：戳 10 下 → 弹卡 → 选一张
  await sleep(2200);
  await tapCanvas(b, 10);
  await sleep(700);
  const cards = await b.ev(READ_CARDS);
  out.extras.firstCards = cards && cards.cards.map((c) => `${c.name}/${c.rarity}`);
  await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
  await sleep(300);
  await b.ev("window.__MOYU__.grant(1e9)");
  await sleep(200);

  const seenPersonality = {};
  for (let i = 1; i <= 14; i++) {
    const trig = await triggerChoice();
    if (!trig.seen) {
      out.trials.push({ i, error: "面板未出现" });
      await sleep(600);
      continue;
    }
    const panel = await b.ev(
      "(() => ({ tell: document.getElementById('boss-tell')?.textContent ?? '', opts: [...document.querySelectorAll('#boss-opts button')].map(x=>x.dataset.choice) }))()",
    );
    const clueAnswer = decideFromTell(panel.tell);
    const strategy = i <= 3 ? "blind" : "clue";
    const pick = strategy === "blind" ? ALL[Math.floor(Math.random() * 3)] : clueAnswer ?? ALL[Math.floor(Math.random() * 3)];
    const before = await readState();
    const clickedAt = Date.now();
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${pick}"]').click()`);
    await sleep(330);
    const after = await readState();
    const toast = await b.ev("(() => { const el=document.getElementById('dom-toast'); return {text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false}; })()");
    out.trials.push({
      i,
      strategy,
      tell: panel.tell,
      clueAnswer,
      picked: pick,
      reactionMs: clickedAt - trig.t0,
      correct: /忙你的|屏幕挺干净|要说什么/.test(toast.text) ? true : /表格昨天|切得真快|是不是在摸鱼/.test(toast.text) ? false : null,
      toast: toast.text,
      delta: Math.round(after.moyu - before.moyu),
      streakBefore: before.surviveStreak,
      streakAfter: after.surviveStreak,
      panelGone: !(await b.ev(PANEL_OPEN)),
    });
    const t = panel.tell;
    if (t.includes("急性子")) seenPersonality.hasty = (seenPersonality.hasty ?? 0) + 1;
    if (t.includes("多疑")) seenPersonality.suspicious = (seenPersonality.suspicious ?? 0) + 1;
    if (t.includes("健忘")) seenPersonality.forgetful = (seenPersonality.forgetful ?? 0) + 1;
    if (i === 5) await b.shot("/tmp/r13-v3-boss.png");
    await sleep(420);
  }
  out.extras.personalityDistribution = seenPersonality;

  // A) 选择期间点画布：应被吞掉（不计收入、不罚款、面板仍在）
  {
    const trig = await triggerChoice();
    const panel = await b.ev("document.getElementById('boss-tell')?.textContent ?? ''");
    const before = await readState();
    await sleep(1200);
    await tapCanvas(b, 1, { x: 195, y: 260, gap: 60 });
    await sleep(300);
    const after = await readState();
    out.extras.canvasTapIrrelevant = {
      tell: panel,
      delta: +(after.moyu - before.moyu).toFixed(2),
      panelStillOpen: await b.ev(PANEL_OPEN),
      toast: await b.ev("document.getElementById('dom-toast')?.textContent ?? ''"),
    };
    const answer = decideFromTell(panel);
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${answer}"]').click()`);
    await sleep(400);
  }

  // B) 超时：等 6s 不选 → 面板消失、有提示、无罚、连胜不变、余额只涨挂机
  {
    const trig = await triggerChoice();
    const panel = await b.ev("document.getElementById('boss-tell')?.textContent ?? ''");
    const before = await readState();
    const t0 = Date.now();
    const hidden = await b.ev(
      "new Promise(res=>{ const root=document.getElementById('boss-choice'); const t=setInterval(()=>{ if(root.classList.contains('hidden')){ clearInterval(t); res(1);} },20); setTimeout(()=>{clearInterval(t);res(0);},8000); })",
    );
    const hideMs = Date.now() - t0;
    await sleep(120);
    const after = await readState();
    const toast = await b.ev("(() => { const el=document.getElementById('dom-toast'); return {text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false}; })()");
    out.extras.timeout = {
      tell: panel,
      clueAnswer: decideFromTell(panel),
      panelHidden: !!hidden,
      hideMs,
      toast,
      delta: +(after.moyu - before.moyu).toFixed(2),
      streakSame: before.surviveStreak === after.surviveStreak,
    };
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}

out.summary = (() => {
  const t = out.trials.filter((x) => !x.error);
  const clue = t.filter((x) => x.strategy === "clue");
  const blind = t.filter((x) => x.strategy === "blind");
  return {
    trials: t.length,
    clueCorrect: `${clue.filter((x) => x.correct).length}/${clue.length}`,
    blindCorrect: `${blind.filter((x) => x.correct).length}/${blind.length}`,
    clueAlwaysContainsAnswer: t.every((x) => x.clueAnswer),
    reactionMsRange: [Math.min(...t.map((x) => x.reactionMs)), Math.max(...t.map((x) => x.reactionMs))],
    correctDeltas: t.filter((x) => x.correct).map((x) => x.delta),
    wrongDeltas: t.filter((x) => x.correct === false).map((x) => x.delta),
  };
})();

writeFileSync("playtest/r13-boss-v2.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ summary: out.summary, extras: out.extras, trials: out.trials.map((x) => ({ i: x.i, strategy: x.strategy, tell: x.tell, picked: x.picked, correct: x.correct, toast: x.toast, delta: x.delta, reactionMs: x.reactionMs })), fatal: out.fatal, errors: out.errors }, null, 1));
b.close();
