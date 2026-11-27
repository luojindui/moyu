/**
 * R13 最终复验·A：首次巡逻必为 choice（HEAD 0bc67b5）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, tapCanvas } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9871 });
const out = {};
const MODAL = "!document.getElementById('cards').classList.contains('hidden')";
const PANEL = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
const WELCOME = "!document.getElementById('welcome').classList.contains('hidden')";
try {
  await sleep(2600);
  let clicks = 0;
  while (clicks < 8) {
    await tapCanvas(b, 1);
    clicks = await b.ev("window.__MOYU__.state.totalClicks");
  }
  const modalAfterTaps = await b.waitFor(MODAL, 4000, 50); // 停手 800ms 后才弹
  out.modalAfterTaps = !!modalAfterTaps;
  await sleep(1500);
  // 选一张卡关掉弹窗；再关欢迎面板
  await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
  await sleep(400);
  if (await b.ev(WELCOME)) {
    await b.ev("document.querySelector('#welcome button')?.click()");
    await sleep(400);
  }
  out.hud = await b.ev("document.getElementById('hud-card')?.textContent");
  const t0 = Date.now();
  let first = null;
  for (let i = 0; i < 200 && !first; i++) {
    const open = await b.ev(PANEL);
    const sr = await b.ev("document.getElementById('sr-live')?.textContent ?? ''");
    if (open) first = { variant: "choice", tell: await b.ev("document.getElementById('boss-tell')?.textContent"), ms: Date.now() - t0 };
    else if (/王总巡逻|摸鱼冲刺|假装工作/.test(sr)) first = { variant: "non-choice", sr, ms: Date.now() - t0 };
    await sleep(220);
  }
  out.firstPatrol = first;
  await b.shot("/tmp/r13-final-first-patrol.png");
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 400);
}
writeFileSync("playtest/r13-final-firstpatrol.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
