/**
 * R13 赌徒党：回合制老板探查（CDP，390x844）
 * 1) 前 3 次"盲赌"（不看线索随机选）→ 看罚款痛感
 * 2) 之后按横幅线索选 13 次 → 记录线索是否足够、选对率、反应时间
 * 3) 超时未选 / 选择期间点画布（模拟点歪）/ 截图
 */
import { writeFileSync } from "node:fs";
import { launch, sleep } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9832 });
const out = { sampledAt: new Date().toISOString(), ready: b.ready, trials: [], extras: {}, errors: b.errors };

const PANEL_OPEN = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
const READ_TELL = `(() => {
  const root = document.getElementById('boss-choice');
  if (!root || root.classList.contains('hidden')) return null;
  return {
    tell: document.getElementById('boss-tell')?.textContent ?? '',
    opts: [...document.querySelectorAll('#boss-opts button')].map(x => x.dataset.choice),
    timerWidth: document.querySelector('#boss-timer i')?.style.width ?? null,
  };
})()`;
// 玩家视角的线索 → 应对（只读横幅文字，不读内部状态）
function decideFromTell(tell) {
  if (tell.includes("急性子")) return "act-busy";
  if (tell.includes("多疑")) return "switch-screen";
  if (tell.includes("健忘")) return "keep-slacking";
  return null;
}
const ALL = ["act-busy", "switch-screen", "keep-slacking"];

async function triggerChoice() {
  await b.ev("(() => { try { window.__MOYU__.forceBoss('choice'); return 'ok'; } catch (e) { return String(e); } })()");
  const t0 = Date.now();
  const seen = await b.waitFor(PANEL_OPEN, 4000, 25);
  return { seen: !!seen, t0 };
}

async function readState() {
  return b.ev(
    "(() => { const s = window.__MOYU__.state; return { moyu: s.moyu, totalEarned: s.totalEarned, lifetime: s.lifetimeEarned, surviveStreak: s.surviveStreak, patrolSurvives: s.patrolSurvives }; })()",
  );
}

try {
  await sleep(2400);
  // 先选掉今日卡（避免遮挡）
  await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
  await sleep(300);
  await b.ev("window.__MOYU__.grant(1e9)");
  await sleep(300);

  let lastPersonalitySeen = {};
  // ---------- 16 次强制回合制老板 ----------
  for (let i = 1; i <= 16; i++) {
    const trig = await triggerChoice();
    if (!trig.seen) {
      out.trials.push({ i, error: "面板未出现", raw: trig });
      await sleep(600);
      continue;
    }
    const panel = await b.ev(READ_TELL);
    const clueAnswer = decideFromTell(panel.tell);
    const before = await readState();
    // 前 3 次：模拟"还不懂线索"的盲赌（随机），其余按线索
    const strategy = i <= 3 ? "blind" : "clue";
    let pick;
    if (strategy === "blind") pick = ALL[Math.floor(Math.random() * 3)];
    else pick = clueAnswer ?? ALL[Math.floor(Math.random() * 3)];
    const clickedAt = Date.now();
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${pick}"]').click()`);
    await sleep(320);
    const after = await readState();
    const toast = await b.ev("(() => { const el = document.getElementById('dom-toast'); return { text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false }; })()");
    const panelGone = !(await b.ev(PANEL_OPEN));
    const row = {
      i,
      strategy,
      tell: panel.tell,
      clueAnswer,
      clueInTell: clueAnswer !== null,
      picked: pick,
      reactionMs: clickedAt - trig.t0,
      correct: toast.text.includes("选对"),
      toast: toast.text,
      delta: Math.round(after.moyu - before.moyu),
      surviveStreakBefore: before.surviveStreak,
      surviveStreakAfter: after.surviveStreak,
      panelGone,
    };
    out.trials.push(row);
    if (panel.tell.includes("急性子")) lastPersonalitySeen.hasty = (lastPersonalitySeen.hasty ?? 0) + 1;
    if (panel.tell.includes("多疑")) lastPersonalitySeen.suspicious = (lastPersonalitySeen.suspicious ?? 0) + 1;
    if (panel.tell.includes("健忘")) lastPersonalitySeen.forgetful = (lastPersonalitySeen.forgetful ?? 0) + 1;
    if (i === 4) await b.shot("/tmp/r13-boss-choice.png");
    await sleep(450); // 等下一次可触发
  }
  out.extras.personalityDistribution = lastPersonalitySeen;

  // ---------- A) 故意选错一次：量罚款 ----------
  {
    const trig = await triggerChoice();
    const panel = await b.ev(READ_TELL);
    const correct = decideFromTell(panel.tell);
    const wrong = ALL.find((x) => x !== correct);
    const before = await readState();
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${wrong}"]').click()`);
    await sleep(320);
    const after = await readState();
    const toast = await b.ev("document.getElementById('dom-toast')?.textContent ?? ''");
    out.extras.deliberateWrong = { tell: panel.tell, correct, picked: wrong, toast, delta: Math.round(after.moyu - before.moyu), reactionMs: Date.now() - trig.t0 };
    await sleep(500);
  }

  // ---------- B) 超时未选：无操作等 5s ----------
  {
    const trig = await triggerChoice();
    const panel = await b.ev(READ_TELL);
    const before = await readState();
    const toastBefore = await b.ev("document.getElementById('dom-toast')?.textContent ?? ''");
    await sleep(5200);
    const after = await readState();
    const toastAfter = await b.ev("(() => { const el = document.getElementById('dom-toast'); return { text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false }; })()");
    out.extras.timeout = {
      tell: panel.tell,
      clueAnswer: decideFromTell(panel.tell),
      panelGone: !(await b.ev(PANEL_OPEN)),
      toastBefore,
      toastAfter,
      delta: Math.round(after.moyu - before.moyu),
      surviveStreakSame: before.surviveStreak === after.surviveStreak,
    };
  }

  // ---------- C) 选择期间点画布（模拟"想点装忙却点到场景"）：是否按偷点罚款 ----------
  {
    const trig = await triggerChoice();
    const panel = await b.ev(READ_TELL);
    const before = await readState();
    await sleep(1100); // 过 0.8s 宽限
    // 真实触摸事件点画布中部（老板选择框之外）
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 195, y: 260, button: "left", clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 195, y: 260, button: "left", clickCount: 1 });
    await sleep(350);
    const after = await readState();
    const toast = await b.ev("document.getElementById('dom-toast')?.textContent ?? ''");
    out.extras.canvasTapDuringChoice = {
      tell: panel.tell,
      delta: Math.round(after.moyu - before.moyu),
      toast,
      note: "若 delta 含罚款或出现'被抓'提示则说明点场景会被当偷点",
    };
    // 仍在选择窗口内，按线索完成它，避免状态悬挂
    const answer = decideFromTell(panel.tell);
    if (answer) {
      await b.ev(`document.querySelector('#boss-opts button[data-choice="${answer}"]').click()`);
      await sleep(300);
    }
  }

  out.summary = (() => {
    const t = out.trials.filter((x) => !x.error);
    const clue = t.filter((x) => x.strategy === "clue");
    const blind = t.filter((x) => x.strategy === "blind");
    return {
      trials: t.length,
      clueTrials: clue.length,
      clueCorrect: clue.filter((x) => x.correct).length,
      clueAccuracy: clue.length ? +(clue.filter((x) => x.correct).length / clue.length).toFixed(2) : null,
      blindTrials: blind.length,
      blindCorrect: blind.filter((x) => x.correct).length,
      clueAlwaysInTell: t.every((x) => x.clueInTell),
      reactionMs: t.map((x) => x.reactionMs),
      correctDeltaMedian: median(t.filter((x) => x.correct).map((x) => x.delta)),
      wrongDeltaMedian: median(t.filter((x) => !x.correct).map((x) => x.delta)),
    };
  })();
  function median(a) {
    const s = [...a].sort((x, y) => x - y);
    return s.length ? s[Math.floor(s.length / 2)] : null;
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}

writeFileSync("playtest/r13-boss.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ summary: out.summary, extras: out.extras, trials: out.trials.map(({ i, strategy, tell, clueAnswer, picked, correct, toast, delta, reactionMs, panelGone }) => ({ i, strategy, tell, clueAnswer, picked, correct, toast, delta, reactionMs, panelGone })), fatal: out.fatal, errors: out.errors }, null, 1));
b.close();
