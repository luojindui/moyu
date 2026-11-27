// 回合制老板专项探针：逐轮记录 面板可见性 / 结算金额 / 连胜 / toast，定位"点击是否生效"
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor, closeAllModals, modEval, state, text, visible } from "./lib.mjs";

const out = [];
await runChrome(async ({ port }) => {
  const c = await connect(port);
  await setViewport(c);
  await goto(c, DEV, `typeof window.__MOYU__ === "object"`);
  await ev(c, `window.confirm = () => true; true`);
  await closeAllModals(c);
  await ev(c, "window.__MOYU__.grant(1000)");
  await sleep(300);

  const snap = async () => {
    const s = await state(c);
    return {
      moyu: +s.moyu.toFixed(2),
      streak: s.surviveStreak,
      at: Date.now(),
      panel: await visible(c, "#boss-choice"),
      tell: await text(c, "#boss-tell"),
      toast: await text(c, "#dom-toast"),
      toastShown: await ev(c, `document.getElementById("dom-toast")?.classList.contains("show")`),
      sr: await text(c, "#sr-live"),
    };
  };

  for (let round = 1; round <= 6; round++) {
    const before = await snap();
    const forced = await ev(c, `window.__MOYU__.forceBoss("choice")`);
    const shown = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    await sleep(60);
    const afterShow = await snap();
    const choice = round % 2 === 1 ? "switch-screen" : "act-busy";
    const clickRes = await ev(c, `(() => {
      const b = document.querySelector('#boss-opts button[data-choice="${choice}"]');
      if (!b) return { ok: false };
      b.click();
      return { ok: true, text: b.textContent };
    })()`);
    await sleep(600);
    const afterClick = await snap();
    // 等本轮彻底结束（choice 窗口 5s）
    await sleep(600);
    const settled = await snap();
    out.push({ round, choice, forced, shown, before, afterShow, clickRes, afterClick, settled,
      deltaSettle: +(settled.moyu - before.moyu).toFixed(2),
      deltaAfterClick: +(afterClick.moyu - afterShow.moyu).toFixed(2) });
    await sleep(500);
  }

  // 超时一轮
  const beforeT = await snap();
  const forcedT = await ev(c, `window.__MOYU__.forceBoss("choice")`);
  const shownT = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
  const afterShowT = await snap();
  // 轮询 6 秒内 toast 变化
  const timeline = [];
  for (let i = 0; i < 60; i++) {
    const t = await text(c, "#dom-toast");
    const v = await ev(c, `document.getElementById("boss-choice").classList.contains("hidden")`);
    const to = await ev(c, `document.getElementById("dom-toast")?.classList.contains("show")`);
    if (i % 10 === 0 || t !== (timeline.at(-1)?.t ?? null)) timeline.push({ ms: i * 100, t, hidden: v, shown: to });
    await sleep(100);
  }
  const settledT = await snap();
  out.push({ timeout: true, forcedT, shownT, afterShowT, timeline: timeline.slice(-15), settledT, delta: +(settledT.moyu - beforeT.moyu).toFixed(2), streakBefore: beforeT.streak, streakAfter: settledT.streak });
  c.close();
}, { timeoutMs: 180_000 });

console.log(JSON.stringify(out, null, 2));