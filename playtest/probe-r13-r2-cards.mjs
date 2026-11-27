/**
 * R13 赌徒党 · 第二轮复验 · 每日卡（当前 HEAD f4b2c08）
 * 重点：跳过即关 / 连点误触 1.2s / 16 张卡池抽样 / 稀有卡 / 跨天再选
 */
import { writeFileSync } from "node:fs";
import { launch, sleep, READ_CARDS, freshDay, tapCanvas } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9851 });
const out = { sampledAt: new Date().toISOString(), rolls: [], stats: {}, onboarding: {}, skip: {}, misclick: {}, rare: {}, crossDay: {}, errors: b.errors };

try {
  // ---------- 0) 首日门槛 ----------
  await sleep(2600);
  out.onboarding.at2_6s = await b.ev("!document.getElementById('cards').classList.contains('hidden')");
  let clicks = 0;
  while (clicks < 8) {
    await tapCanvas(b, 1);
    clicks = await b.ev("window.__MOYU__.state.totalClicks");
  }
  await sleep(1500); // 过 1.2s 防误触，方便读卡
  out.onboarding.modalAfter8Taps = await b.ev(READ_CARDS);
  out.onboarding.clicks = clicks;

  // ---------- 1) 抽样 20 天 ----------
  for (let i = 0; i < 20; i++) out.rolls.push(await freshDay(b));
  const rarityOf = { 普通: "common", 稀有: "rare", 剧情: "event" };
  const counts = { common: 0, rare: 0, event: 0 };
  let allCommon = 0;
  let atLeastOne = 0;
  let missing = 0;
  const names = {};
  for (const r of out.rolls) {
    if (!r) {
      missing++;
      continue;
    }
    const rs = r.cards.map((c) => rarityOf[c.rarity] ?? "?");
    rs.forEach((x) => (counts[x] = (counts[x] ?? 0) + 1));
    if (rs.every((x) => x === "common")) allCommon++;
    if (rs.some((x) => x !== "common")) atLeastOne++;
    r.cards.forEach((c) => (names[c.name] = (names[c.name] ?? 0) + 1));
  }
  out.stats = { days: out.rolls.filter(Boolean).length, missing, counts, allCommon, atLeastOne, nameFreq: names };

  // ---------- 2) 跳过即关 ----------
  await freshDay(b);
  await sleep(1500); // 过防误触
  out.skip.beforeOpen = await b.ev("!document.getElementById('cards').classList.contains('hidden')");
  await b.ev("document.getElementById('cards-skip').click()");
  await sleep(120);
  out.skip.after120ms = await b.ev("(() => ({ hidden: document.getElementById('cards').classList.contains('hidden'), dismissed: window.__MOYU__.state.cards.dismissed }))()");
  await sleep(2000);
  out.skip.after2s = await b.ev("document.getElementById('cards').classList.contains('hidden')");
  await b.shot("/tmp/r13-r2-skip.png");

  // ---------- 3) 连点误触（1.2s 防误触） ----------
  // 3a) 弹窗出现后只连点 ~0.7s 就停手 → 不应误选
  await freshDay(b);
  await sleep(1000); // 确保弹窗已出现一段时间
  await tapCanvas(b, 6, { gap: 110 });
  await sleep(900);
  out.misclick.stopBefore1200 = {
    chosen: await b.ev("window.__MOYU__.state.cards.chosen"),
    hidden: await b.ev("document.getElementById('cards').classList.contains('hidden')"),
  };
  // 3b) 一直连点（超过 1.2s）→ 记录被"自动选中"的耗时
  await freshDay(b);
  const t0 = Date.now();
  await sleep(80);
  const seq = [];
  let picked = null;
  for (let i = 0; i < 30 && !picked; i++) {
    await tapCanvas(b, 1, { gap: 40 });
    picked = await b.ev("window.__MOYU__.state.cards.chosen");
    seq.push({ ms: Date.now() - t0, chosen: picked });
  }
  out.misclick.keepTapping = { pickedAtMs: picked ? seq[seq.length - 1].ms : null, chosen: picked, taps: seq.length };

  // ---------- 4) 稀有卡「通宵摸鱼」 ----------
  let rareDay = null;
  for (let i = 0; i < 30 && !rareDay; i++) {
    const r = await freshDay(b);
    if (r && r.cards.some((c) => c.name === "通宵摸鱼")) rareDay = r;
  }
  out.rare.tries = 30;
  out.rare.found = !!rareDay;
  if (rareDay) {
    await sleep(1400);
    const before = await b.ev("(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,4000)); return {a, b: window.__MOYU__.state.moyu}; })()");
    out.rare.idleBefore = +(((before.b - before.a) / 4).toFixed(3));
    const idx = rareDay.cards.findIndex((c) => c.name === "通宵摸鱼");
    await b.ev(`document.querySelectorAll('#cards-body .card')[${idx}].click()`);
    await sleep(500);
    const after = await b.ev("(async () => { const a = window.__MOYU__.state.moyu; await new Promise(r=>setTimeout(r,4000)); return {a, b: window.__MOYU__.state.moyu}; })()");
    out.rare.idleAfter = +(((after.b - after.a) / 4).toFixed(3));
    out.rare.ratio = +(out.rare.idleAfter / out.rare.idleBefore).toFixed(2);
    out.rare.hud = await b.ev("document.getElementById('hud-card')?.textContent");
    out.rare.remainH = await b.ev("(() => { const s = window.__MOYU__.state; return +((s.cards.until - Date.now()) / 3600000).toFixed(2); })()");
    await b.shot("/tmp/r13-r2-hud-card.png");

    // ---------- 5) 跨天：旧 buff 保留 + 新 offers + 今天可再选 ----------
    await b.ev("window.__MOYU__.saveNow()");
    await b.ev("window.__MOYU__.rewindSave(60)");
    out.crossDay.before = await b.ev("(() => { const s=JSON.parse(localStorage.getItem('moyu-save')); return {date:s.cards.date, chosen:s.cards.chosen, chosenDate:s.cards.chosenDate, offers:s.cards.offers}; })()");
    // 把卡日期改成"昨天"，模拟第二天打开
    await b.ev("(() => { const s=JSON.parse(localStorage.getItem('moyu-save')); s.cards.date='2026-11-26'; s.cards.chosenDate='2026-11-26'; localStorage.setItem('moyu-save', JSON.stringify(s)); })()");
    await b.send("Page.reload", { ignoreCache: false });
    await sleep(400);
    await b.waitFor("!!window.__MOYU__ && !!window.__MOYU__.state", 12000);
    await sleep(2600);
    out.crossDay.afterReload = await b.ev("(() => { const s=window.__MOYU__.state; return {date:s.cards.date, chosen:s.cards.chosen, chosenDate:s.cards.chosenDate, offers:s.cards.offers, dismissed:s.cards.dismissed, hud:document.getElementById('hud-card')?.textContent, modalOpen:!document.getElementById('cards').classList.contains('hidden')}; })()");
    // 今天再选一张（若弹窗未开则等 12s 门槛）
    if (!out.crossDay.afterReload.modalOpen) {
      await b.ev("sessionStorage.setItem('moyu-boot-ms', String(Date.now() - 20000))");
      await sleep(700);
      out.crossDay.afterReload.modalOpen = await b.ev("!document.getElementById('cards').classList.contains('hidden')");
    }
    await sleep(1400);
    await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
    await sleep(400);
    out.crossDay.afterPickToday = await b.ev("(() => { const s=window.__MOYU__.state; return {chosen:s.cards.chosen, chosenDate:s.cards.chosenDate, hud:document.getElementById('hud-card')?.textContent, remainH:+((s.cards.until-Date.now())/3600000).toFixed(2)}; })()");
  }
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 600);
}
writeFileSync("playtest/r13-r2-cards.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
