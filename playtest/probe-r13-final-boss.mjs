/**
 * R13 最终复验·B：答题反馈 / 键盘 Enter / 超时提示 / 连点不弹卡（HEAD 0bc67b5）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, tapCanvas } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9872 });
const out = { rounds: {}, cardTap: {}, errors: b.errors };
const MODAL = "!document.getElementById('cards').classList.contains('hidden')";
const PANEL = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
const WELCOME = "!document.getElementById('welcome').classList.contains('hidden')";
const infer = (t) => (t.includes("盯着") ? "switch-screen" : t.includes("脚步声") ? "act-busy" : "keep-slacking");
const snap = async (label) => ({
  label,
  panelOpen: await b.ev(PANEL),
  result: await b.ev("(() => { const el=document.querySelector('.boss-result'); if(!el) return null; const r=el.getBoundingClientRect(); return { text: el.textContent, w: Math.round(r.width), h: Math.round(r.height), panelHidden: document.getElementById('boss-choice').classList.contains('hidden') }; })()"),
  toast: await b.ev("(() => { const el=document.getElementById('dom-toast'); return { text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false }; })()"),
});

async function prepare() {
  await sleep(2500);
  if (await b.ev(WELCOME)) {
    await b.ev("document.querySelector('#welcome button')?.click()");
    await sleep(400);
  }
  await b.ev("sessionStorage.setItem('moyu-boot-ms', String(Date.now() - 20000))");
  await sleep(1400);
  await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
  await sleep(400);
  await b.ev("window.__MOYU__.grant(1e9)");
}

async function trigger() {
  await b.ev("window.__MOYU__.forceBoss('choice')");
  await b.waitFor(PANEL, 5000, 20);
  await sleep(300);
  return b.ev("document.getElementById('boss-tell')?.textContent");
}
const anchor = () => b.ev("window.__MOYU__.state.moyu");

try {
  await prepare();

  // R1：pointerdown 答对 → 面板内结果可见 + 之后顶部兜底台词，且没有"没来得及选"
  {
    const tell = await trigger();
    const before = await anchor();
    const ans = infer(tell);
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${ans}"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
    await sleep(90);
    const s1 = await snap("90ms");
    await b.shot("/tmp/r13-final-result-visible.png");
    await sleep(320);
    const s2 = await snap("410ms");
    const after = await anchor();
    const toasts = await b.ev("document.getElementById('dom-toast')?.textContent");
    out.rounds.correct = { tell, delta: Math.round(after - before), s1, s2, finalToast: toasts, showsTimeoutToast: /没来得及选/.test(s1.toast.text + s2.toast.text) };
    await sleep(700);
  }

  // R2：pointerdown 答错（golden 宽限内 0，只验证反馈） → 结果应显示错误台词/金额
  {
    const tell = await trigger();
    const before = await anchor();
    const ans = infer(tell);
    const wrong = ["act-busy", "switch-screen", "keep-slacking"].find((x) => x !== ans);
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${wrong}"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
    await sleep(90);
    const s1 = await snap("90ms");
    await sleep(320);
    const s2 = await snap("410ms");
    const after = await anchor();
    out.rounds.wrong = { tell, delta: Math.round(after - before), s1, s2, showsTimeoutToast: /没来得及选/.test(s1.toast.text + s2.toast.text) };
    await sleep(700);
  }

  // R3：键盘 Enter 作答
  {
    const tell = await trigger();
    const before = await anchor();
    const ans = infer(tell);
    await b.ev(`(() => { const btn=document.querySelector('#boss-opts button[data-choice="${ans}"]'); btn.focus(); return document.activeElement?.dataset?.choice; })()`);
    await b.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(120);
    const s1 = await snap("120ms");
    await sleep(320);
    const after = await anchor();
    out.rounds.keyboard = { tell, delta: Math.round(after - before), s1, settled: Math.abs(after - before) > 5, panelAfter: await b.ev(PANEL) };
    await sleep(700);
  }

  // R4：先答对一次，再故意超时 → 检验"已作答后下一次超时是否漏提示"（上一版 flag 从不复位的边界）
  {
    const t1 = await trigger();
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${infer(t1)}"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
    await sleep(900);
    const tell = await trigger();
    await sleep(5300); // 超时
    await sleep(150);
    const st = await b.ev("(() => { const el=document.getElementById('dom-toast'); return { text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false, panelOpen: !!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden') }; })()");
    out.rounds.timeoutAfterAnswer = { tell, ...st, showsTimeoutToast: /没来得及选/.test(st.text) };
    await sleep(600);
  }

  // R5：连点期间卡弹窗是否插进来（P2-4）
  {
    await b.ev("window.__MOYU__.reset()");
    await b.send("Page.reload", { ignoreCache: false });
    await sleep(400);
    await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
    await sleep(2400);
    // 连续快点点 4 秒（模拟玩家无脑连点），期间不应弹卡
    let openedWhileTapping = false;
    const t0 = Date.now();
    for (let i = 0; i < 44; i++) {
      await tapCanvas(b, 1, { gap: 40 });
      if (await b.ev(MODAL)) {
        openedWhileTapping = true;
        break;
      }
    }
    const tapMs = Date.now() - t0;
    out.cardTap.duringTapping = { openedWhileTapping, tapMs };
    // 停手后应在 ~800ms 内弹出，且不应误选
    const opened = await b.waitFor(MODAL, 4000, 50);
    out.cardTap.afterStop = { opened: !!opened, delayMs: Date.now() - (t0 + tapMs), chosen: await b.ev("window.__MOYU__.state.cards.chosen") };
    await b.shot("/tmp/r13-final-card-after-tap.png");
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}
writeFileSync("playtest/r13-final-boss.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
