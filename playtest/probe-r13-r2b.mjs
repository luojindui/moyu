/**
 * R13 R2b：HEAD fa9ad17 复验（跨天再选 UI / 老板结算展示 / 键盘 / 跳过 / 首巡）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, freshDay, READ_CARDS, tapCanvas } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9861 });
const out = { sampledAt: new Date().toISOString(), errors: b.errors };
const OPEN = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
const MODAL_OPEN = "!document.getElementById('cards').classList.contains('hidden')";

async function openAndPickCard(port) {
  await sleep(2400);
  await b.ev("sessionStorage.setItem('moyu-boot-ms', String(Date.now() - 20000))");
  await sleep(800);
  const cards = await b.ev(READ_CARDS);
  await sleep(1400); // 过 1.2s 防误触
  await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
  await sleep(300);
  return cards;
}

try {
  // ---------- 1) 跨天再选：旧 buff 保留 + 今天能出新弹窗并再选 ----------
  const first = await openAndPickCard();
  out.crossDay = { firstOffers: first && first.cards.map((c) => c.name), chosen: await b.ev("window.__MOYU__.state.cards.chosen") };
  await b.ev("window.__MOYU__.saveNow()");
  await b.ev("window.__MOYU__.rewindSave(60)");
  await b.ev("(() => { const s=JSON.parse(localStorage.getItem('moyu-save')); s.cards.date='2026-11-26'; s.cards.chosenDate='2026-11-26'; localStorage.setItem('moyu-save', JSON.stringify(s)); })()");
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(400);
  await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
  await sleep(600);
  // 12s 门槛：把 boot-ms 拨老（同一天内 reload）
  await b.ev("sessionStorage.setItem('moyu-boot-ms', String(Date.now() - 20000))");
  await sleep(900);
  out.crossDay.afterReload = await b.ev("(() => { const s=window.__MOYU__.state; return { date:s.cards.date, chosen:s.cards.chosen, chosenDate:s.cards.chosenDate, offers:s.cards.offers, modalOpen:!document.getElementById('cards').classList.contains('hidden'), hud:document.getElementById('hud-card')?.textContent }; })()");
  out.crossDay.promptCards = await b.ev(READ_CARDS);
  if (out.crossDay.promptCards) {
    await sleep(1400);
    await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
    await sleep(400);
    out.crossDay.canPickAgain = await b.ev("(() => { const s=window.__MOYU__.state; return { chosen:s.cards.chosen, chosenDate:s.cards.chosenDate, hud:document.getElementById('hud-card')?.textContent, remainH:+((s.cards.until-Date.now())/3600000).toFixed(2) }; })()");
  }

  // ---------- 2) 老板：结算展示是否可见 / 键盘可达 ----------
  await b.ev("window.__MOYU__.grant(1e9)");
  await b.ev("window.__MOYU__.forceBoss('choice')");
  await b.waitFor(OPEN, 5000, 20);
  await sleep(300);
  const tell = await b.ev("document.getElementById('boss-tell')?.textContent");
  const answer = tell.includes("盯着") ? "switch-screen" : tell.includes("脚步声") ? "act-busy" : "keep-slacking";
  const before = await b.ev("window.__MOYU__.state.moyu");
  await b.ev(`document.querySelector('#boss-opts button[data-choice="${answer}"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
  await sleep(40);
  out.result = {
    tell,
    panelOpenAt40ms: await b.ev(OPEN),
    resultElAt40ms: await b.ev("(() => { const el=document.querySelector('.boss-result'); return el ? { text: el.textContent, opacity: getComputedStyle(el).opacity } : null; })()"),
    toastAt40ms: await b.ev("document.getElementById('dom-toast')?.textContent"),
  };
  await b.shot("/tmp/r13-r2b-boss-result.png");
  await sleep(500);
  out.result.panelOpenAt540ms = await b.ev(OPEN);
  out.result.resultElAt540ms = await b.ev("!!document.querySelector('.boss-result')");
  out.result.delta = Math.round((await b.ev("window.__MOYU__.state.moyu")) - before);

  // 键盘：Enter 能否作答
  await sleep(400);
  await b.ev("window.__MOYU__.forceBoss('choice')");
  await b.waitFor(OPEN, 5000, 20);
  await sleep(300);
  const tell2 = await b.ev("document.getElementById('boss-tell')?.textContent");
  const before2 = await b.ev("window.__MOYU__.state.moyu");
  await b.ev("document.querySelector('#boss-opts button')?.focus()");
  await b.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await b.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await sleep(400);
  out.keyboard = {
    tell: tell2,
    enterDelta: Math.round((await b.ev("window.__MOYU__.state.moyu")) - before2),
    panelStillOpen: await b.ev(OPEN),
    focused: await b.ev("document.activeElement?.tagName + ':' + (document.activeElement?.dataset?.choice ?? '')"),
  };
  const ans2 = tell2.includes("盯着") ? "switch-screen" : tell2.includes("脚步声") ? "act-busy" : "keep-slacking";
  if (await b.ev(OPEN)) {
    await b.ev(`document.querySelector('#boss-opts button[data-choice="${ans2}"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}))`);
    await sleep(500);
  }

  // ---------- 3) 跳过（仍应即关） ----------
  await b.ev("window.__MOYU__.reset()");
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(400);
  await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
  await b.ev("sessionStorage.setItem('moyu-boot-ms', String(Date.now() - 20000))");
  await sleep(900);
  out.skip = { before: await b.ev(MODAL_OPEN) };
  await b.ev("document.getElementById('cards-skip').click()");
  await sleep(150);
  out.skip.after = await b.ev("(() => ({ hidden: document.getElementById('cards').classList.contains('hidden'), dismissed: window.__MOYU__.state.cards.dismissed }))()");
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}
writeFileSync("playtest/r13-r2b.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
