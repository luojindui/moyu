/**
 * R13 R2：自然首次巡逻的变体（验证 lead 所说"首次巡逻优先 choice"是否生效）
 * 用 #sr-live 读屏播报识别变体；每个新档只看第一次巡逻。
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, tapCanvas } from "./probe-r13-lib.mjs";

const runs = [];
for (const port of [9855]) {
  const b = await launch({ port });
  try {
    await sleep(2600);
    let clicks = 0;
    while (clicks < 8) {
      await tapCanvas(b, 1);
      clicks = await b.ev("window.__MOYU__.state.totalClicks");
    }
    await sleep(1500);
    // 跳过今日卡，关闭模态（模态打开时事件会被延后）
    await b.ev("document.getElementById('cards-skip').click()");
    await sleep(400);
    const t0 = Date.now();
    let first = null;
    for (let i = 0; i < 180 && !first; i++) {
      const txt = await b.ev("document.getElementById('sr-live')?.textContent ?? ''");
      if (/王总巡逻|摸鱼冲刺|假装工作|回合制老板/.test(txt)) first = { text: txt, ms: Date.now() - t0 };
      // 如果是 choice，弹层会出现
      const choiceOpen = await b.ev("!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')");
      if (choiceOpen) first = { text: `choice-panel:${await b.ev("document.getElementById('boss-tell')?.textContent")}`, ms: Date.now() - t0 };
      await sleep(250);
    }
    runs.push({ port, first, clicks, skipped: await b.ev("window.__MOYU__.state.cards.dismissed") });
  } catch (e) {
    runs.push({ port, error: String(e?.stack ?? e).slice(0, 300) });
  }
  b.close(false);
}
writeFileSync("playtest/r13-r2-natural-first.json", JSON.stringify(runs, null, 1));
console.log(JSON.stringify(runs, null, 1));
