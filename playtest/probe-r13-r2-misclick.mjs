/**
 * R13 R2：1.2s 防误触的精确测量（从"弹窗出现"时刻起算）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, tapCanvas, READ_CARDS } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9854 });
const out = {};
const MODAL_OPEN = "!document.getElementById('cards').classList.contains('hidden')";

async function tapToOpenModal() {
  // 每点一下后立刻轮询弹窗状态（弹窗会在第 8 下后由下一帧打开）
  for (let i = 0; i < 30; i++) {
    await tapCanvas(b, 1, { gap: 60 });
    const open = await b.ev(MODAL_OPEN);
    if (open) return { clicks: i + 1, openedAt: Date.now() };
  }
  return null;
}

try {
  // A) 弹窗出现后继续连点 → 记录从"出现"到"被选中"的毫秒
  await sleep(2600);
  const a0 = await tapToOpenModal();
  out.A_open = a0;
  const seq = [];
  let chosen = null;
  for (let i = 0; i < 30 && !chosen; i++) {
    await tapCanvas(b, 1, { gap: 50 });
    chosen = await b.ev("window.__MOYU__.state.cards.chosen");
    seq.push({ ms: Date.now() - a0.openedAt, chosen });
  }
  out.A_pickMs = chosen ? seq[seq.length - 1].ms : null;
  out.A_chosen = chosen;
  out.A_cards = await b.ev(READ_CARDS);

  // B) 弹窗出现后立刻停手 → 不应被选中
  await sleep(400);
  await b.ev("window.__MOYU__.reset()");
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(400);
  await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
  await sleep(2400);
  const b0 = await tapToOpenModal();
  out.B_open = b0;
  await sleep(2000); // 停手 2 秒
  out.B_chosenAfterStop = await b.ev("window.__MOYU__.state.cards.chosen");
  out.B_hidden = await b.ev("document.getElementById('cards').classList.contains('hidden')");
  await b.shot("/tmp/r13-r2-cards-open.png");
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 400);
}
writeFileSync("playtest/r13-r2-misclick.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
