/**
 * R13 赌徒党 · 第二轮复验 · 回合制老板（HEAD f4b2c08：线索去名 / 1.8:1.0 / 竖排按钮 / pointerdown）
 * 操作：真实 pointerdown 派发（当前版本只监听 pointerdown，DOM .click() 不再结算）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, tapCanvas, READ_CARDS } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9852 });
const out = { sampledAt: new Date().toISOString(), trials: [], extras: {}, errors: b.errors };
const PANEL_OPEN = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
const NAMES = ["安总", "王总", "老李"];
const ALL = ["act-busy", "switch-screen", "keep-slacking"];

// 玩家视角：只读行为线索推断（不给名字）
function inferFromTell(tell) {
  if (tell.includes("盯着") && tell.includes("屏幕")) return "switch-screen";
  if (tell.includes("脚步声") || tell.includes("两三步")) return "act-busy";
  if (tell.includes("看手机") || tell.includes("眼神是散")) return "keep-slacking";
  return null;
}
async function trigger() {
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const t0 = Date.now();
  const seen = await b.waitFor(PANEL_OPEN, 5000, 20);
  if (!seen) return { seen: false, t0 };
  await sleep(300); // 过 250ms 开局防误触
  return { seen: true, t0 };
}
const readState = () => b.ev("(() => { const s=window.__MOYU__.state; return { moyu:s.moyu, surviveStreak:s.surviveStreak, patrolSurvives:s.patrolSurvives }; })()");
const settle = async (choice) => {
  const r = await b.ev(`(() => { const el=document.querySelector('#boss-opts button[data-choice="${choice}"]'); if(!el) return 'NO_BUTTON'; el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, cancelable:true})); return 'dispatched'; })()`);
  await sleep(330);
  const st = await readState();
  const toast = await b.ev("(() => { const el=document.getElementById('dom-toast'); return {text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false}; })()");
  return { r, st, toast };
};

try {
  await sleep(2400);
  let clicks = 0;
  while (clicks < 8) {
    await tapCanvas(b, 1);
    clicks = await b.ev("window.__MOYU__.state.totalClicks");
  }
  await sleep(1500);
  const firstCards = await b.ev(READ_CARDS);
  out.extras.firstCards = firstCards && firstCards.cards.map((c) => `${c.name}/${c.rarity}`);
  // 优先选不带巡逻倍率的卡，保持 base≈50，便于比对赔率
  const pickIdx = (() => {
    const names = (firstCards?.cards ?? []).map((c) => c.name);
    const bad = ["老板出差", "全员大会", "部门搬家"];
    const i = names.findIndex((n) => !bad.includes(n));
    return i >= 0 ? i : 0;
  })();
  await b.ev(`document.querySelectorAll('#cards-body .card')[${pickIdx}]?.click()`);
  await sleep(300);
  await b.ev("window.__MOYU__.grant(1e9)");
  await sleep(200);
  out.extras.baseCard = await b.ev("window.__MOYU__.state.cards.chosen");
  await b.shot("/tmp/r13-r2-popup.png".replace("popup", "card-initial"));

  for (let i = 1; i <= 14; i++) {
    const t = await trigger();
    if (!t.seen) {
      out.trials.push({ i, error: "面板未出现" });
      await sleep(500);
      continue;
    }
    const panel = await b.ev("(() => ({ tell: document.getElementById('boss-tell')?.textContent ?? '', buttons: [...document.querySelectorAll('#boss-opts button')].map(x=>({c:x.dataset.choice,t:x.textContent,rect:x.getBoundingClientRect().height})) }))()");
    const hasName = NAMES.some((n) => panel.tell.includes(n));
    const inferred = inferFromTell(panel.tell);
    const strategy = i <= 3 ? "blind" : i <= 6 ? "blind-ungraced" : "infer";
    const pick = strategy === "infer" ? inferred ?? ALL[Math.floor(Math.random() * 3)] : ALL[Math.floor(Math.random() * 3)];
    const before = await readState();
    const clickedAt = Date.now();
    const r = await settle(pick);
    const after = r.st;
    const correct = /忙你的|屏幕挺干净|要说什么/.test(r.toast.text) ? true : /表格昨天|切得真快|是不是在摸鱼/.test(r.toast.text) ? false : null;
    out.trials.push({
      i,
      strategy,
      tell: panel.tell,
      tellHasPersonalityName: hasName,
      inferred,
      picked: pick,
      reactionMs: clickedAt - t.t0,
      correct,
      toast: r.toast.text,
      delta: Math.round(after.moyu - before.moyu),
      streak: after.surviveStreak,
      panelGone: !(await b.ev(PANEL_OPEN)),
      buttonHeights: panel.buttons.map((x) => Math.round(x.rect)),
    });
    if (i === 7) await b.shot("/tmp/r13-r2-boss-popup.png");
    await sleep(430);
  }

  // A) 超时：0 罚 + 提示
  {
    const t = await trigger();
    const tell = await b.ev("document.getElementById('boss-tell')?.textContent");
    const before = await readState();
    const t0 = Date.now();
    const hidden = await b.ev("new Promise(res=>{ const root=document.getElementById('boss-choice'); const t=setInterval(()=>{ if(root.classList.contains('hidden')){clearInterval(t);res(1);} },20); setTimeout(()=>{clearInterval(t);res(0);},8000); })");
    const hideMs = Date.now() - t0;
    await sleep(150);
    const after = await readState();
    out.extras.timeout = {
      tell,
      panelHidden: !!hidden,
      hideMs,
      toast: await b.ev("(() => { const el=document.getElementById('dom-toast'); return {text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false}; })()"),
      delta: +(after.moyu - before.moyu).toFixed(2),
      streakSame: before.surviveStreak === after.surviveStreak,
    };
  }

  // B) 窗口内点画布：现在应显示"先选应对"飘字、不扣钱
  {
    const t = await trigger();
    const tell = await b.ev("document.getElementById('boss-tell')?.textContent");
    const before = await readState();
    await tapCanvas(b, 1, { x: 195, y: 260 });
    await sleep(250);
    const fx = await b.ev("window.__MOYU__.fxTexts()");
    const after = await readState();
    out.extras.canvasTap = {
      tell,
      delta: +(after.moyu - before.moyu).toFixed(2),
      fx: fx && fx.slice(0, 3),
      panelStillOpen: await b.ev(PANEL_OPEN),
    };
    const answer = inferFromTell(tell);
    if (answer) await settle(answer);
    await sleep(300);
  }

  // C) 键盘可达性：DOM click() / Enter 是否还能结算（当前只监听 pointerdown）
  {
    const t = await trigger();
    const tell = await b.ev("document.getElementById('boss-tell')?.textContent");
    const before = await readState();
    const clickResult = await b.ev("(() => { const el=document.querySelector('#boss-opts button'); el?.focus(); el?.click(); return 'clicked'; })()");
    await sleep(300);
    const afterClick = await readState();
    const panelAfterClick = await b.ev(PANEL_OPEN);
    // 再试 Enter
    await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(300);
    const afterEnter = await readState();
    out.extras.keyboard = {
      tell,
      clickResolved: Math.abs(afterClick.moyu - before.moyu) > 5 || !panelAfterClick,
      panelAfterClick,
      enterResolved: Math.abs(afterEnter.moyu - before.moyu) > 5,
      note: "click/Enter 若不结算 → 键盘/读屏用户无法作答",
    };
    // 清理：用 pointerdown 作答
    const answer = inferFromTell(tell);
    if (answer && (await b.ev(PANEL_OPEN))) await settle(answer);
    await sleep(300);
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}

out.summary = (() => {
  const t = out.trials.filter((x) => !x.error);
  const infer = t.filter((x) => x.strategy === "infer");
  return {
    trials: t.length,
    inferCorrect: `${infer.filter((x) => x.correct).length}/${infer.length}`,
    inferAllCorrect: infer.length > 0 && infer.every((x) => x.correct),
    tellNeverHasName: t.every((x) => !x.tellHasPersonalityName),
    tellSamples: [...new Set(t.map((x) => x.tell))],
    blindRookieDeltas: t.filter((x) => x.strategy === "blind").map((x) => x.delta),
    blindUngracedDeltas: t.filter((x) => x.strategy === "blind-ungraced").map((x) => x.delta),
    inferDeltas: infer.map((x) => x.delta),
    reactionRange: [Math.min(...t.map((x) => x.reactionMs)), Math.max(...t.map((x) => x.reactionMs))],
    buttonHeights: t[0]?.buttonHeights,
  };
})();

writeFileSync("playtest/r13-r2-boss.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ summary: out.summary, extras: out.extras, trials: out.trials.map((x) => ({ i: x.i, strategy: x.strategy, tell: x.tell, picked: x.picked, correct: x.correct, toast: x.toast, delta: x.delta, reactionMs: x.reactionMs })), fatal: out.fatal, errors: out.errors }, null, 1));
b.close();
