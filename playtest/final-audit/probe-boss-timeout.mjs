// 回合制老板超时路径 + 决策期点击守卫专项探针
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor, closeAllModals, state, text, visible, modEval, tapCanvas } from "./lib.mjs";

const out = {};
await runChrome(async ({ port }) => {
  const c = await connect(port);
  await setViewport(c);
  await goto(c, DEV, `typeof window.__MOYU__ === "object"`);
  await ev(c, `window.confirm = () => true; true`);
  // 先点 10 下让"每日卡"弹窗条件成立，再跳过，避免 12s 后弹卡挡住老板
  await tapCanvas(c, 10, 100);
  await sleep(500);
  const cardsShown = await waitFor(c, `document.getElementById("cards").classList.contains("hidden") === false`, 5000);
  if (cardsShown) { await ev(c, `document.getElementById("cards-skip").click(); true`); await sleep(200); }
  await closeAllModals(c);
  await ev(c, "window.__MOYU__.grant(1000)");
  await sleep(300);
  out.cardsHandled = { cardsShown };

  const answer = async (choice) => {
    const shown = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
    if (!shown) return { shown, clicked: false };
    const res = await ev(c, `(() => { const b = document.querySelector('#boss-opts button[data-choice="${choice}"]'); if (!b) return { clicked: false, reason: "no-button" }; b.click(); return { clicked: true, text: b.textContent }; })()`);
    await sleep(600);
    return { shown, ...res, toast: await text(c, "#dom-toast"), streak: (await state(c)).surviveStreak };
  };


  // 1) 决策期点击守卫：向 canvas 元素直接派发 pointerdown（绕过遮罩命中测试），应被 bossPanel.isOpen 拦截
  await ev(c, `window.__MOYU__.forceBoss("choice")`);
  out.shown = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
  await sleep(200);
  const clicksBefore = (await state(c)).totalClicks;
  await ev(c, `(() => {
    const el = document.getElementById("stage");
    const r = el.getBoundingClientRect();
    for (let i = 0; i < 3; i++) el.dispatchEvent(new PointerEvent("pointerdown", { clientX: r.left + r.width/2, clientY: r.top + r.height/2, bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  out.guard = { clicksBefore, clicksAfter: (await state(c)).totalClicks, panelStill: await visible(c, "#boss-choice") };
  // 遮罩命中测试：canvas 中心的 elementFromPoint 应是弹层而非 canvas
  out.hitTest = await ev(c, `(() => { const el = document.getElementById("stage"); const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2); return { tag: top?.tagName, id: top?.id, inBoss: !!top?.closest("#boss-choice") }; })()`);
  // 正确作答，结束本轮
  out.round1 = await answer("switch-screen");

  // 2) 先把巡逻次数刷到 >3（新手宽限外），再测超时
  out.warmup = [];
  for (let i = 0; i < 3; i++) {
    const forced = await ev(c, `window.__MOYU__.forceBoss("choice")`);
    const r = await answer(i === 2 ? "act-busy" : "switch-screen");
    out.warmup.push({ i, forced, ...r, cardsVisible: await visible(c, "#cards") });
  }
  const beforeT = await state(c);
  const forcedT = await ev(c, `window.__MOYU__.forceBoss("choice")`);
  const shownT = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
  // 记录时间线：面板可见性 + toast
  const timeline = [];
  const t0 = Date.now();
  let lastKey = "";
  for (let i = 0; i < 80; i++) {
    const st = await ev(c, `({
      hidden: document.getElementById("boss-choice").classList.contains("hidden"),
      toast: document.getElementById("dom-toast")?.textContent ?? "",
      shown: document.getElementById("dom-toast")?.classList.contains("show") ?? false,
      cardsHidden: document.getElementById("cards").classList.contains("hidden"),
    })`);
    const key = `${st.hidden}|${st.toast}|${st.shown}|${st.cardsHidden}`;
    if (key !== lastKey) { timeline.push({ ms: Date.now() - t0, ...st }); lastKey = key; }
    await sleep(100);
  }
  const afterT = await state(c);
  out.timeout = {
    forcedT, shownT, timeline,
    streakBefore: beforeT.surviveStreak, streakAfter: afterT.surviveStreak,
    deltaMoney: +(afterT.moyu - beforeT.moyu).toFixed(2),
  };
  // 3) 超时后能否立刻开始下一轮（不被卡住）
  await ev(c, `window.__MOYU__.forceBoss("choice")`);
  out.nextRound = await answer("switch-screen");
  c.close();
}, { timeoutMs: 180_000 });

console.log(JSON.stringify(out, null, 2));