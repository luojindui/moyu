/** R12 复验 5 live：面板花费标签/上限 24、实际扣点、event_5b 离线 +20%、存档 24。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";
const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9537, tag: "r12e" });
const out = { url: URL_, checks: {}, shots: [] };
let sid = null;
async function setConfig(cfg) {
  if (sid) { await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: sid }).catch(() => {}); sid = null; }
  const today = new Date().toLocaleDateString("sv-SE");
  const save = {
    v: 2, moyu: 5e7, totalEarned: 1e9, lifetimeEarned: 1e9, levels: cfg.levels ?? {},
    savedAt: Date.now(), createdAt: Date.now() - 30 * 86400_000,
    totalClicks: cfg.totalClicks ?? 20000, patrolSurvives: cfg.patrolSurvives ?? 30, prestige: 20,
    talents: { unlocked: cfg.unlocked ?? [], points: cfg.points ?? 0, rankGranted: 12, dailyGiftDate: today },
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

// A) 面板标签 + 扣点验证
{
  const s = await setConfig({ levels: LEVELS, points: 24, team: { colleagues: team } });
  out.checks.save24 = { loaded: s.talents.points, ok: s.talents.points === 24 };
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(400);
  const panel = JSON.parse(await b.ev("JSON.stringify({text:document.getElementById('team').innerText,btns:[...document.querySelectorAll('#team-body button[data-act=talent]')].map(b=>({id:b.dataset.id,t:b.innerText,dis:b.disabled}))})"));
  const pick = (id) => panel.btns.find((x) => x.id === id);
  out.checks.panel = {
    click_1: pick("click_1"),
    click_3: pick("click_3"),
    click_5a: pick("click_5a"),
    nameLines: panel.text.split("\n").filter((l) => /（\d点）|终极·\d点/.test(l)).slice(0, 6),
    capLine: panel.text.split("\n").filter((l) => l.includes("上限 24")),
  };
  // 实测扣点：t1(1)+t2(1)+t3(2)+t4(2)+终极(3)=9
  for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5a"]) {
    await b.ev(`document.querySelector('#team-body button[data-id="${id}"]')?.click()`);
    await sleep(220);
  }
  const after = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  out.checks.spend = { spent: 24 - after.points, expect: 9, unlocked: after.unlocked, ok: 24 - after.points === 9 };
  await shot("/tmp/r12e-talents-24.png");
  await b.ev("document.getElementById('team-close').click()");
}

// B) event_5b 离线 +20%（3 次/天）
{
  const eff = async () =>
    Number(await b.ev("(async()=>{const P=await import('/src/engine/progression.ts');const s=window.__MOYU__.state;return P.offlineEfficiency(s, Date.now()-30*86400000, Date.now());})()"));
  const s0 = await setConfig({ levels: LEVELS, points: 0, unlocked: ["event_1", "event_2", "event_3", "event_4"], visits: 3, team: { colleagues: {} } });
  const e0 = await eff();
  const s1 = await setConfig({ levels: LEVELS, points: 0, unlocked: ["event_1", "event_2", "event_3", "event_4", "event_5b"], visits: 3, team: { colleagues: {} } });
  const e1 = await eff();
  out.checks.event5b = { visits: s1.visits?.count ?? 4, effWithout: +e0.toFixed(3), effWith: +e1.toFixed(3), gainPct: +(((e1 / e0) - 1) * 100).toFixed(1), ok: e1 > e0 };
}
writeFileSync("playtest/r12e-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close(); process.exit(0);
