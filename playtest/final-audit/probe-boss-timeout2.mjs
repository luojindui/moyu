// 验证"超时提示"是否只在"本会话从未作答过"时出现（怀疑 choicePickedThisRound 复位失效）
import { runChrome, connect } from "../lib/chrome.mjs";
import { DEV, sleep, setViewport, goto, ev, waitFor, closeAllModals, text, visible, tapCanvas } from "./lib.mjs";

async function bootFresh(port) {
  const c = await connect(port);
  await setViewport(c);
  await goto(c, DEV, `typeof window.__MOYU__ === "object"`);
  await ev(c, `window.confirm = () => true; true`);
  // 提前处理每日卡（点 10 下 + 跳过），避免 12s 后弹卡
  await tapCanvas(c, 10, 100);
  // 等每日卡弹窗真正出现（需停手 800ms），再跳过；否则它会在稍后弹出并挡住老板事件
  const cardsShown = await waitFor(c, `document.getElementById("cards").classList.contains("hidden") === false`, 6000);
  if (cardsShown) { await ev(c, `document.getElementById("cards-skip").click(); true`); await sleep(300); }
  await closeAllModals(c);
  await sleep(300);
  return { c, cardsShown, cardsNow: await visible(c, "#cards") };
}

/** 监听 toast 文本变化，返回记录函数 */
async function installToastObserver(c) {
  await ev(c, `(() => {
    window.__toastLog = [];
    const el = document.getElementById("dom-toast");
    new MutationObserver(() => {
      window.__toastLog.push({ t: Date.now(), text: el.textContent, show: el.classList.contains("show") });
    }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    return true;
  })()`);
}

async function timeoutRound(c, label) {
  await ev(c, "window.__toastLog = []; true");
  const t0 = Date.now();
  const forced = await ev(c, `window.__MOYU__.forceBoss("choice")`);
  const shown = await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
  await sleep(5600);
  const log = await ev(c, `window.__toastLog`);
  const panelHidden = !(await visible(c, "#boss-choice"));
  const modals = await ev(c, `({ cards: !document.getElementById("cards").classList.contains("hidden"), team: !document.getElementById("team").classList.contains("hidden"), journal: !document.getElementById("journal").classList.contains("hidden"), arcade: !document.getElementById("arcade").classList.contains("hidden"), welcome: !document.getElementById("welcome").classList.contains("hidden") })`);
  const hit = (log ?? []).some((x) => /没来得及选/.test(x.text ?? ""));
  return { label, forced, shown, panelHidden, modals, hit, log: (log ?? []).slice(-8), ms: Date.now() - t0 };
}

const out = {};
await runChrome(async ({ port }) => {
  // 场景 1：本会话第一次遇到 choice 就超时
  const b1 = await bootFresh(port);
  out.boot1 = { cardsShown: b1.cardsShown, cardsNow: b1.cardsNow };
  await installToastObserver(b1.c);
  out.firstTimeout = await timeoutRound(b1.c, "first");
  b1.c.close();
}, { timeoutMs: 120_000 });
await runChrome(async ({ port }) => {
  // 场景 2：先答对一次，再超时
  const b2 = await bootFresh(port);
  out.boot2 = { cardsShown: b2.cardsShown, cardsNow: b2.cardsNow };
  const c = b2.c;
  await installToastObserver(c);
  await ev(c, `window.__MOYU__.forceBoss("choice")`);
  await waitFor(c, `document.getElementById("boss-choice").classList.contains("hidden") === false`, 4000);
  await ev(c, `document.querySelector('#boss-opts button[data-choice="switch-screen"]').click(); true`);
  await sleep(800);
  out.answeredThenTimeout = await timeoutRound(c, "after-answer");
  c.close();
}, { timeoutMs: 120_000 });

console.log(JSON.stringify(out, null, 2));