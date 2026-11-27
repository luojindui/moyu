/**
 * R13 赌徒党：每日摸鱼卡 开箱采样 + 选卡/关闭/生效验证（CDP，390x844）
 * 只读 src/，输出 playtest/r13-cards.json
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, READ_CARDS, freshDay } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9831 });
const out = { sampledAt: new Date().toISOString(), ready: b.ready, rolls: [], stats: {}, choose: {}, close: {}, duration: {}, errors: b.errors };

try {
  await sleep(2600); // 等首页加载出卡片弹窗
  // ---------- 1) 首次打开：抽样 20 天"开箱" ----------
  for (let i = 0; i < 20; i++) {
    const cards = i === 0 ? await b.ev(READ_CARDS) : await freshDay(b);
    out.rolls.push(cards);
  }
  const rarityOf = { 普通: "common", 稀有: "rare", 剧情: "event" };
  const counts = { common: 0, rare: 0, event: 0 };
  let allCommonDays = 0;
  let atLeastRareDays = 0;
  let eventDays = 0;
  const nameFreq = {};
  for (const r of out.rolls) {
    if (!r) {
      out.stats.nullRolls = (out.stats.nullRolls ?? 0) + 1;
      continue;
    }
    const rarities = r.cards.map((c) => rarityOf[c.rarity] ?? "?");
    rarities.forEach((x) => (counts[x] = (counts[x] ?? 0) + 1));
    if (rarities.every((x) => x === "common")) allCommonDays++;
    if (rarities.some((x) => x === "rare" || x === "event")) atLeastRareDays++;
    if (rarities.some((x) => x === "event")) eventDays++;
    r.cards.forEach((c) => (nameFreq[c.name] = (nameFreq[c.name] ?? 0) + 1));
  }
  out.stats = {
    ...out.stats,
    days: out.rolls.filter(Boolean).length,
    cardsShown: counts,
    allCommonDays,
    atLeastRareDays,
    eventDays,
    nameFreq,
  };

  // ---------- 2) 重抽到含稀有/剧情卡的那天 → 选它，量挂机收益变化 ----------
  let rareDay = null;
  for (let i = 0; i < 30 && !rareDay; i++) {
    const r = i === 0 ? out.rolls.find((x) => x && x.cards.some((c) => c.rarity !== "普通")) : await freshDay(b);
    if (r && r.cards.some((c) => c.rarity !== "普通")) rareDay = r;
  }
  out.choose.rareDay = rareDay;
  if (rareDay) {
    const before = await b.ev(
      "(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,4000)); return {a, b: window.__MOYU__.state.moyu}; })()",
    );
    out.choose.idleBefore = { moyuA: before.a, moyuB: before.b, rate: (before.b - before.a) / 4 };
    // 选稀有度最高的一张（剧情>稀有>普通），同等取第一张
    const rank = { 剧情: 3, 稀有: 2, 普通: 1 };
    const idx = rareDay.cards.reduce((best, c, i) => (rank[c.rarity] > rank[rareDay.cards[best].rarity] ? i : best), 0);
    out.choose.picked = rareDay.cards[idx];
    out.choose.reason = "赌徒：稀有度优先（剧情>稀有>普通），不看清具体数值";
    await b.ev(`document.querySelectorAll('#cards-body .card')[${idx}].click()`);
    await sleep(500);
    out.choose.stateAfter = await b.ev(
      "(() => { const s = window.__MOYU__.state; return { chosen: s.cards.chosen, until: s.cards.until, now: Date.now() }; })()",
    );
    out.choose.modalHidden = await b.ev("document.getElementById('cards').classList.contains('hidden')");
    out.choose.hudShowsCard = await b.ev(
      "(() => { const t = document.body.innerText; return { hasOvertime: t.includes('通宵摸鱼'), hasCardWord: t.includes('今日卡'), hud: document.getElementById('hud')?.innerText ?? '' }; })()",
    );
    const after = await b.ev(
      "(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,4000)); return {a, b: window.__MOYU__.state.moyu}; })()",
    );
    out.choose.idleAfter = { moyuA: after.a, moyuB: after.b, rate: (after.b - after.a) / 4 };
    await b.shot("/tmp/r13-card-chosen.png");
  }

  // ---------- 3) 关闭弹窗（点背景）→ 会不会自动重弹？ ----------
  await freshDay(b);
  out.close.beforeClose = await b.ev("document.getElementById('cards').classList.contains('hidden') ? 'hidden' : 'open'");
  await b.ev("document.getElementById('cards').click()"); // 点背景
  await sleep(500);
  out.close.afterClose = await b.ev("document.getElementById('cards').classList.contains('hidden') ? 'hidden' : 'open'");
  await sleep(1500);
  out.close.after1500ms = await b.ev("document.getElementById('cards').classList.contains('hidden') ? 'hidden' : 'open'");
  out.close.chosen = await b.ev("window.__MOYU__.state.cards.chosen");

  // ---------- 4) "生效 24h" vs 跨日重置：把存档的卡日期改成昨天后重载 ----------
  await freshDay(b);
  await b.ev("document.querySelectorAll('#cards-body .card')[0].click()"); // 先选一张
  await sleep(300);
  await b.ev("window.__MOYU__.saveNow()");
  const persist = await b.ev(
    "(() => { const raw = localStorage.getItem('moyu-save'); const s = JSON.parse(raw); return { date: s.cards?.date, chosen: s.cards?.chosen, until: s.cards?.until }; })()",
  );
  out.duration.persist = persist;
  await b.ev("window.__MOYU__.rewindSave(60)"); // 关键：suppressSave=true，防 pagehide 用内存状态覆盖
  await b.ev(
    "(() => { const s = JSON.parse(localStorage.getItem('moyu-save')); if (s.cards) s.cards.date = '2000-01-01'; localStorage.setItem('moyu-save', JSON.stringify(s)); })()",
  );
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(400);
  await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
  await sleep(2500);
  out.duration.afterDayRoll = await b.ev(
    "(() => { const s = window.__MOYU__.state; return { date: s.cards.date, chosen: s.cards.chosen, offers: s.cards.offers, until: s.cards.until, now: Date.now() }; })()",
  );
  out.duration.modalShown = await b.ev("!document.getElementById('cards').classList.contains('hidden')");
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 500);
}

writeFileSync("playtest/r13-cards.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify({ stats: out.stats, choose: out.choose && { picked: out.choose.picked, idleBefore: out.choose.idleBefore, idleAfter: out.choose.idleAfter, stateAfter: out.choose.stateAfter, hudShowsCard: out.choose.hudShowsCard }, close: out.close, duration: out.duration, fatal: out.fatal, errors: out.errors }, null, 1));
b.close();
