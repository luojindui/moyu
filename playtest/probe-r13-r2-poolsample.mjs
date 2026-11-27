/**
 * R13 R2：卡池 16 张的"开箱分布"再抽样 40 天（对比引擎 10000 天模拟）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, READ_CARDS, freshDay } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9853 });
const out = { rolls: [], stats: {} };
try {
  for (let i = 0; i < 40; i++) {
    const r = await freshDay(b);
    const dom = r ? r.cards.map((c) => `${c.name}|${c.rarity}`) : null;
    const stateOffers = await b.ev("window.__MOYU__.state.cards?.offers");
    out.rolls.push({ dom, stateOffers });
  }
  const rarityOf = { 普通: "common", 稀有: "rare", 剧情: "event" };
  const counts = { common: 0, rare: 0, event: 0 };
  let allCommon = 0;
  let anyNonCommon = 0;
  let mismatch = 0;
  for (const r of out.rolls) {
    if (!r.dom) continue;
    const rs = r.dom.map((x) => rarityOf[x.split("|")[1]] ?? "?");
    rs.forEach((x) => (counts[x] = (counts[x] ?? 0) + 1));
    if (rs.every((x) => x === "common")) allCommon++;
    if (rs.some((x) => x !== "common")) anyNonCommon++;
    if (r.dom.length !== 3) mismatch++;
  }
  out.stats = { days: out.rolls.length, counts, allCommon, anyNonCommon, mismatch };
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 400);
}
writeFileSync("playtest/r13-r2-poolsample.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.stats, null, 1));
b.close();
