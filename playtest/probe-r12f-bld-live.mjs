/** R12 复验 6 live：overflow 生效/不可见、idle 终极新数值、存档上限 30。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";
const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9541, tag: "r12f" });
const out = { url: URL_, checks: {}, shots: [] };
let sid = null;
async function setConfig(cfg) {
  if (sid) { await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sid }).catch(() => {}); sid = null; }
  const today = new Date().toLocaleDateString("sv-SE");
  const save = {
    v: 2, moyu: 5e7, totalEarned: 1e9, lifetimeEarned: 1e9, levels: cfg.levels ?? {},
    savedAt: Date.now(), createdAt: Date.now() - 30 * 86400_000,
    totalClicks: cfg.totalClicks ?? 20000, patrolSurvives: cfg.patrolSurvives ?? 30, prestige: 20,
    talents: { unlocked: cfg.unlocked ?? [], points: cfg.points ?? 0, rankGranted: 12, dailyGiftDate: today, overflow: cfg.overflow ?? 0 },
    collected: { quotes: [], flavors: [] }, daily: null,
    visits: { date: today, count: cfg.visits ?? 3 },
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
const idleOf = async () =>
  Number(await b.ev("(async()=>{const U=await import('/src/engine/upgrades.ts');return U.effectOf(window.__MOYU__.state).idleRate;})()"));
const effOf = async () =>
  JSON.parse(await b.ev("(async()=>{const T=await import('/src/engine/talents.ts');return JSON.stringify(T.talentEffects(window.__MOYU__.state.talents));})()"));

// A) overflow 30：挂机 ×1.15？
{
  const s0 = await setConfig({ levels: LEVELS, overflow: 0, team: { colleagues: team } });
  const i0 = await idleOf();
  const s1 = await setConfig({ levels: LEVELS, overflow: 30, team: { colleagues: team } });
  const i1 = await idleOf();
  const eff = await effOf();
  out.checks.overflow = {
    loadedOverflow: s1.talents.overflow,
    idleWithout: Math.round(i0),
    idleWith30: Math.round(i1),
    mul: +(i1 / i0).toFixed(3),
    effectOverflowBonus: eff.overflowIdleBonus,
    ok: Math.abs(i1 / i0 - 1.15) < 0.005,
  };
  // UI 可见性
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(400);
  const panelText = await b.ev("document.getElementById('team').innerText");
  const hudText = await b.ev("document.getElementById('hud').innerText");
  out.checks.overflowUI = {
    panelMentions: /溢出|overflow/.test(panelText),
    hudMentions: /溢出|overflow/.test(hudText),
    idleHint: hudText.split("\n").find((l) => l.includes("不点也")),
    note: "overflow 生效但没有任何 UI 说明来源",
  };
  // idle 终极文案
  out.checks.idleUltText = panelText.split("\n").filter((l) => /最稳|带队摸鱼/.test(l));
  await shot("/tmp/r12f-overflow.png");
  await b.ev("document.getElementById('team-close').click()");
}

// B) 存档 overflow 上限 30
{
  const s = await setConfig({ levels: LEVELS, overflow: 99, team: { colleagues: {} } });
  out.checks.saveOverflowCap = { injected: 99, loaded: s.talents.overflow, ok: s.talents.overflow === 30 };
}
writeFileSync("playtest/r12f-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close(); process.exit(0);
