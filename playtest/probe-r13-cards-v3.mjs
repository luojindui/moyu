/**
 * R13 赌徒党：每日摸鱼卡 v3（针对 17:56 后的当前工作区）——首日门槛 / 抽样 / 跳过 / 稀有卡 / 24h 保留
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, READ_CARDS, freshDay, tapCanvas } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9841 });
const out = { sampledAt: new Date().toISOString(), ready: b.ready, rolls: [], stats: {}, onboarding: {}, skip: {}, rare: {}, errors: b.errors };

try {
  // ---------- 0) 首日不拦：真实首次打开不弹卡，戳 8 下后弹 ----------
  await sleep(2500);
  out.onboarding.at2_5s = await b.ev("!document.getElementById('cards').classList.contains('hidden')");
  await b.shot("/tmp/r13-v3-start.png");
  await tapCanvas(b, 8);
  await sleep(700);
  out.onboarding.after8Taps = await b.ev(READ_CARDS);
  out.onboarding.stateClicks = await b.ev("window.__MOYU__.state.totalClicks");
  await b.shot("/tmp/r13-v3-cards.png");

  // ---------- 1) 抽样 15 天"开箱" ----------
  for (let i = 0; i < 15; i++) {
    const cards = i === 0 ? await b.ev(READ_CARDS) : await freshDay(b);
    out.rolls.push(cards);
  }
  const rarityOf = { 普通: "common", 稀有: "rare", 剧情: "event" };
  const counts = { common: 0, rare: 0, event: 0 };
  let allCommonDays = 0;
  let atLeastOne = 0;
  let modalMissing = 0;
  for (const r of out.rolls) {
    if (!r) {
      modalMissing++;
      continue;
    }
    const rs = r.cards.map((c) => rarityOf[c.rarity] ?? "?");
    rs.forEach((x) => (counts[x] = (counts[x] ?? 0) + 1));
    if (rs.every((x) => x === "common")) allCommonDays++;
    if (rs.some((x) => x !== "common")) atLeastOne++;
  }
  out.stats = { days: out.rolls.filter(Boolean).length, modalMissing, counts, allCommonDays, atLeastOne };

  // ---------- 2) 跳过：『今天先不选』 ----------
  await freshDay(b);
  out.skip.beforeOpen = await b.ev("!document.getElementById('cards').classList.contains('hidden')");
  out.skip.hasSkipButton = await b.ev("!!document.getElementById('cards-skip')");
  await b.ev("document.getElementById('cards-skip').click()");
  await sleep(600);
  out.skip.afterSkip = {
    hidden: await b.ev("document.getElementById('cards').classList.contains('hidden')"),
    dismissed: await b.ev("window.__MOYU__.state.cards.dismissed"),
    chosen: await b.ev("window.__MOYU__.state.cards.chosen"),
  };
  await sleep(1500);
  out.skip.stillHidden1_5s = await b.ev("document.getElementById('cards').classList.contains('hidden')");
  // 刷新后是否还允许再选
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(400);
  await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
  await sleep(2200);
  out.skip.afterReload = {
    hidden: await b.ev("document.getElementById('cards').classList.contains('hidden')"),
    dismissed: await b.ev("window.__MOYU__.state.cards?.dismissed"),
  };
  out.skip.reopenEntry = await b.ev(
    "(() => { const btns=[...document.querySelectorAll('button')].map(x=>x.textContent?.trim()).filter(Boolean); return btns.filter(t=>t.includes('卡')); })()",
  );

  // ---------- 3) 稀有卡实测（抽到通宵摸鱼为止） ----------
  let rareDay = null;
  for (let i = 0; i < 25 && !rareDay; i++) {
    const r = await freshDay(b, { waitMs: 400 });
    if (r && r.cards.some((c) => c.name === "通宵摸鱼")) rareDay = r;
  }
  out.rare.tries = 25;
  out.rare.found = !!rareDay;
  if (rareDay) {
    await b.shot("/tmp/r13-v3-rare.png");
    const before = await b.ev(
      "(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,4000)); return {a, b: window.__MOYU__.state.moyu}; })()",
    );
    out.rare.idlePerSecBefore = +(((before.b - before.a) / 4).toFixed(3));
    const idx = rareDay.cards.findIndex((c) => c.name === "通宵摸鱼");
    await b.ev(`document.querySelectorAll('#cards-body .card')[${idx}].click()`);
    await sleep(500);
    const after = await b.ev(
      "(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,4000)); return {a, b: window.__MOYU__.state.moyu}; })()",
    );
    out.rare.idlePerSecAfter = +(((after.b - after.a) / 4).toFixed(3));
    out.rare.ratio = +(out.rare.idlePerSecAfter / out.rare.idlePerSecBefore).toFixed(2);
    out.rare.chosen = await b.ev("window.__MOYU__.state.cards.chosen");
    out.rare.hudCard = await b.ev("document.getElementById('hud-card')?.textContent");
    out.rare.hudVisible = await b.ev("!document.getElementById('hud-card').classList.contains('hidden')");
    out.rare.remainH = await b.ev("(() => { const s = window.__MOYU__.state; return +((s.cards.until - Date.now()) / 3600000).toFixed(2); })()");
    await b.shot("/tmp/r13-v3-hud-card.png");
    // 刷新：24h 内应保留
    await b.send("Page.reload", { ignoreCache: false });
    await sleep(400);
    await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
    await sleep(2200);
    out.rare.afterReload = {
      chosen: await b.ev("window.__MOYU__.state.cards?.chosen"),
      modalHidden: await b.ev("document.getElementById('cards').classList.contains('hidden')"),
      hudCard: await b.ev("document.getElementById('hud-card')?.textContent"),
    };
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}
writeFileSync("playtest/r13-cards-v3.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ onboarding: out.onboarding, stats: out.stats, skip: out.skip, rare: out.rare, fatal: out.fatal, errors: out.errors }, null, 1));
b.close();
