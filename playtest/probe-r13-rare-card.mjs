/**
 * R13：稀有卡「通宵摸鱼」实测——挂机 +60% 是否生效？
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, READ_CARDS, freshDay } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9835 });
const out = {};
try {
  await sleep(2500);
  let found = null;
  let tries = 0;
  for (let i = 0; i < 30; i++) {
    tries++;
    const r = i === 0 ? await b.ev(READ_CARDS) : await freshDay(b);
    if (r && r.cards.some((c) => c.name === "通宵摸鱼")) {
      found = r;
      break;
    }
  }
  out.tries = tries;
  out.found = found;
  if (found) {
    await b.shot("/tmp/r13-card-rare.png");
    const before = await b.ev(
      "(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,5000)); return {a, b: window.__MOYU__.state.moyu}; })()",
    );
    out.idleBefore = +(before.b - before.a).toFixed(3);
    const idx = found.cards.findIndex((c) => c.name === "通宵摸鱼");
    await b.ev(`document.querySelectorAll('#cards-body .card')[${idx}].click()`);
    await sleep(400);
    const after = await b.ev(
      "(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,5000)); return {a, b: window.__MOYU__.state.moyu}; })()",
    );
    out.idleAfter = +(after.b - after.a).toFixed(3);
    out.ratio = +(out.idleAfter / out.idleBefore).toFixed(3);
    out.hud = await b.ev("document.getElementById('hud')?.innerText");
    out.chosen = await b.ev("window.__MOYU__.state.cards.chosen");
    out.untilDeltaH = await b.ev("(() => { const s = window.__MOYU__.state; return (s.cards.until - Date.now()) / 3600000; })()");
    // 刷新后是否仍有卡（是否"24h 内持续"）
    await b.send("Page.reload", { ignoreCache: false });
    await sleep(300);
    await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
    await sleep(2200);
    out.afterReload = await b.ev("(() => { const s = window.__MOYU__.state; return { chosen: s.cards.chosen, modalOpen: !document.getElementById('cards').classList.contains('hidden') }; })()");
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 400);
}
writeFileSync("playtest/r13-rare-card.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
