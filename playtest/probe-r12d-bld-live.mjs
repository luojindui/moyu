/** R12 复验 4 live：UI 花费标签一致性 / 27 点存档 / event_5b 离线 cap / 天赋角标新逻辑 / click_5b 描述。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";
const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9533, tag: "r12d" });
const out = { url: URL_, checks: {}, shots: [] };
let sid = null;
async function setConfig(cfg) {
  if (sid) { await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sid }).catch(() => {}); sid = null; }
  const save = {
    v: 2, moyu: 5e7, totalEarned: 1e9, lifetimeEarned: 1e9, levels: cfg.levels ?? {},
    savedAt: Date.now(), createdAt: Date.now() - 30 * 86400_000,
    totalClicks: cfg.totalClicks ?? 20000, patrolSurvives: cfg.patrolSurvives ?? 30, prestige: 20,
    talents: { unlocked: cfg.unlocked ?? [], points: cfg.points ?? 0, rankGranted: 12, dailyGiftDate: cfg.gift ?? "2026-11-27" },
    collected: { quotes: [], flavors: [] }, daily: null,
    visits: { date: cfg.visitsDate ?? "2026-11-27", count: cfg.visits ?? 3 },
    team: cfg.team ?? { colleagues: {} },
  };
  const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('moyu-save',${JSON.stringify(JSON.stringify(save))});}catch(e){}` });
  sid = r.identifier;
  await b.send("Page.navigate", { url: URL_ });
  await sleep(2200);
  return JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
}
async function shot(p) { await b.shot(p); out.shots.push(p); }
await b.send("Page.enable"); await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const LEVELS = { coffee: 20, water: 20, chair: 20, phone: 60, toilet: 50 };
const team = {};
for (const id of ["zhou", "mei", "qiang", "li", "wang"]) team[id] = { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 };

// A) 27 点存档 + 面板花费标签
{
  const s = await setConfig({ levels: LEVELS, points: 27, team: { colleagues: team } });
  out.checks.save27 = { loaded: s.talents.points, ok: s.talents.points === 27 };
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(400);
  const panel = JSON.parse(await b.ev("JSON.stringify({text:document.getElementById('team').innerText,btns:[...document.querySelectorAll('#team-body button[data-act=talent]')].map(b=>({id:b.dataset.id,t:b.innerText,dis:b.disabled}))})"));
  out.checks.panelLabels = {
    click_3: panel.btns.find((x) => x.id === "click_3"),
    click_5a: panel.btns.find((x) => x.id === "click_5a"),
    bottomLine: panel.text.split("\n").filter((l) => l.includes("上限")),
    click5bDesc: panel.text.split("\n").find((l) => l.includes("指尖风暴")),
    costNote: "实装花费：t1/t2=1，t3/t4=2，终极=3；面板按钮标签若仍写 1/2 即为不一致",
  };
  // 实际扣点验证：点 t1..t4 + 5a 应花 9 点
  for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5a"]) {
    await b.ev(`document.querySelector('#team-body button[data-id="${id}"]')?.click()`);
    await sleep(250);
  }
  const after = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  out.checks.spendCheck = { unlocked: after.unlocked, pointsLeft: after.points, spent: 27 - after.points, expect: 9 };
  await shot("/tmp/r12d-talents-27.png");
  await b.ev("document.getElementById('team-close').click()");
}

// B) event_5b 离线 +20%：3 次/天是否存在
{
  const mk = async (unlocked) => {
    const s = await setConfig({ levels: LEVELS, points: 0, unlocked, team: { colleagues: {} } });
    return s;
  };
  const s0 = await mk(["event_1", "event_2", "event_3", "event_4"]);
  const e0 = await b.ev("(async()=>{const P=await import('/src/engine/progression.ts');const s=window.__MOYU__.state;return P.offlineEfficiency(s, Date.now()-30*86400000, Date.now());})()");
  const s1 = await mk(["event_1", "event_2", "event_3", "event_4", "event_5b"]);
  const e1 = await b.ev("(async()=>{const P=await import('/src/engine/progression.ts');const s=window.__MOYU__.state;return P.offlineEfficiency(s, Date.now()-30*86400000, Date.now());})()");
  out.checks.event5bOffline = { visits: s0.visits?.count ?? 3, effWithout: e0, effWith: e1, gain: e1 === e0 ? "0%（被 cap 吃掉）" : `${(((e1 / e0) - 1) * 100).toFixed(1)}%` };
}

// C) 天赋角标新逻辑：新手未开过👥时是否显示
{
  const s = await setConfig({ levels: { coffee: 3 }, points: 0, gift: "", visits: 0, visitsDate: "", totalClicks: 0, patrolSurvives: 0, team: { colleagues: {} }, lifetimeEarned: 5000, totalEarned: 5000, moyu: 1000 });
  await sleep(500);
  const r = await b.ev("JSON.stringify({points:window.__MOYU__.state.talents.points,badge:!!document.querySelector('#btn-team .talent-badge'),seen:localStorage.getItem('moyu-team-seen'),toast:(document.getElementById('dom-toast')||{}).textContent||''})");
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click();document.getElementById('team-close').click()");
  await sleep(400);
  const r2 = await b.ev("JSON.stringify({badgeAfterOpen:!!document.querySelector('#btn-team .talent-badge'),seen:localStorage.getItem('moyu-team-seen')})");
  out.checks.newbieBadge = { ...JSON.parse(r), ...JSON.parse(r2), note: "新手首次打开：每日点 +1，角标要开过 👥 才出现（有 toast 引导）" };
  await shot("/tmp/r12d-newbie.png");
}
writeFileSync("playtest/r12d-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close(); process.exit(0);
