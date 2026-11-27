/** R12 构筑党 live 探针：真实页面里点天赋页、点点看、重置、以及死天赋的运行时验证。
 *  只读 src/，只写 playtest/ 与 /tmp。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL_ = "http://127.0.0.1:5173/";
const PORT = Number(process.env.R12_PORT || 9517);
const b = await openBrowser({ port: PORT, tag: "r12bld" });
const out = { url: URL_, checks: {}, shots: [] };

const saveScriptId = { id: null };

async function setConfig(cfg) {
  if (saveScriptId.id) {
    await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: saveScriptId.id }).catch(() => {});
    saveScriptId.id = null;
  }
  const save = {
    v: 2,
    moyu: cfg.moyu ?? 5e7,
    totalEarned: cfg.totalEarned ?? 1e9,
    lifetimeEarned: cfg.lifetimeEarned ?? 1e9,
    levels: cfg.levels ?? {},
    levels_extra: undefined,
    savedAt: Date.now(),
    createdAt: Date.now() - 30 * 86400_000,
    totalClicks: cfg.totalClicks ?? 0,
    patrolSurvives: cfg.patrolSurvives ?? 0,
    prestige: cfg.prestige ?? 0,
    talents: { unlocked: cfg.unlocked ?? [], points: cfg.points ?? 0, rankGranted: cfg.rankGranted ?? 12 },
    collected: { quotes: [], flavors: [] },
    daily: null,
    visits: { date: "", count: 0 },
    team: { colleagues: {} },
  };
  delete save.levels_extra;
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`;
  const r = await b.send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  saveScriptId.id = r.identifier;
  await b.send("Page.navigate", { url: URL_ });
  await sleep(2200);
  return JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
}

async function shot(path) {
  await b.shot(path);
  out.shots.push(path);
}

async function tapCanvas(n, gapMs = 110) {
  const rect = JSON.parse(await b.ev(`JSON.stringify(document.getElementById('stage').getBoundingClientRect())`));
  const x = rect.x + rect.width / 2;
  const y = rect.y + Math.min(rect.height * 0.45, 320);
  for (let i = 0; i < n; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(gapMs);
  }
}

/** 从页面里用真实引擎函数算点击力/挂机率 */
async function engineOf(stateJson) {
  return JSON.parse(
    await b.ev(
      `(async()=>{const A=await import('/src/engine/actions.ts');const U=await import('/src/engine/upgrades.ts');const s=${stateJson};return JSON.stringify({click:A.clickPowerOf(s),idle:U.effectOf(s).idleRate,conv:U.conversionBonus(s)});})()`,
    ),
  );
}

await b.send("Page.enable");
await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const LEVELS = { coffee: 20, water: 20, chair: 20, phone: 40, toilet: 20 };

// ---------- 1) 打卡：天赋页 UI / 点数可见性 ----------
{
  const s = await setConfig({ levels: LEVELS, points: 15, unlocked: [] });
  out.checks.loaded = { talents: s.talents, hud: JSON.parse(await b.ev("JSON.stringify({click:document.getElementById('hud-click').textContent,idle:document.getElementById('hud-idle').textContent,btn:document.getElementById('btn-team').innerText,badge:!!document.querySelector('#btn-team .badge')})")) };
  await b.ev("document.getElementById('btn-team').click()");
  await sleep(300);
  await shot("/tmp/r12-bld-colleagues.png");
  await b.ev("document.getElementById('tab-talents').click()");
  await sleep(400);
  const panel = await b.ev("JSON.stringify({text:document.getElementById('team').innerText, points:document.getElementById('team-points').textContent, btns:[...document.querySelectorAll('#team-body button')].map(b=>({t:b.innerText,act:b.dataset.act,dis:b.disabled}))})");
  out.checks.talentPanel = JSON.parse(panel);
  await shot("/tmp/r12-bld-talents-15.png");

  // 点亮第一条（手速）
  await b.ev(`document.querySelector('#team-body button[data-id="click_1"]').click()`);
  await sleep(300);
  const after = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  out.checks.unlockClick1 = { talents: after, hudClick: await b.ev("document.getElementById('hud-click').textContent") };
  await shot("/tmp/r12-bld-talents-unlocked.png");

  // 重置：是否有二次确认？点一下就没了？
  const beforeReset = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  await b.ev(`document.querySelector('#team-body button[data-act="reset-talents"]').click()`);
  await sleep(400);
  const afterReset = JSON.parse(await b.ev("JSON.stringify({talents:window.__MOYU__.state.talents,toast:(document.querySelector('.toast')||{}).innerText||'',dialogs:document.querySelectorAll('[role=dialog]:not(.hidden)').length})"));
  out.checks.reset = { beforeReset, afterReset };
  await shot("/tmp/r12-bld-talents-reset.png");
}

// ---------- 2) 死天赋运行时验证：连击上限 / 暴击 ----------
async function tapTest(label, unlocked) {
  await setConfig({ levels: { coffee: 20, water: 20, chair: 20 }, unlocked });
  const s0 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const eng = await engineOf(JSON.stringify(s0));
  const t0 = Date.now();
  await tapCanvas(30, 115);
  const ms = Date.now() - t0;
  await sleep(150);
  const s1 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const hudCombo = await b.ev("document.getElementById('hud-combo').textContent");
  const gained = s1.lifetimeEarned - s0.lifetimeEarned;
  // 预期（无暴击、连击 1..20 封顶）：Σ(1+0.012*min(i,20))
  let sumMult = 0;
  for (let i = 1; i <= 30; i++) sumMult += 1 + 0.012 * Math.min(i, 20);
  const predicted = eng.click * sumMult + eng.idle * (ms / 1000);
  return { label, clickPower: eng.click, idle: eng.idle, gained, predicted, ratio: gained / predicted, ratioWithCrit: gained / (predicted * 1.2), hudCombo, taps: s1.totalClicks - s0.totalClicks };
}
{
  const a = await tapTest("无点击天赋", []);
  const c = await tapTest("点击流1-4（含连击上限/暴击）", ["click_1", "click_2", "click_3", "click_4"]);
  out.checks.tap = { noTalent: a, withDeadTalents: c, verdict: `收入比值 ${a.ratio.toFixed(3)} vs ${c.ratio.toFixed(3)}（暴击若生效应≈1.2 且两者明显分叉）；连击显示上限 ${a.hudCombo}/${c.hudCombo}（连击上限天赋应到 30）` };
  await shot("/tmp/r12-bld-combo.png");
}

// ---------- 3) 三流派"体感"：同一存档下 HUD 数值变化 ----------
async function hudWith(label, cfg) {
  const s = await setConfig({ levels: { ...LEVELS, ...cfg.levels }, unlocked: cfg.unlocked ?? [], totalClicks: cfg.totalClicks ?? 0, patrolSurvives: cfg.patrolSurvives ?? 0 });
  const hud = JSON.parse(await b.ev("JSON.stringify({click:document.getElementById('hud-click').textContent,idle:document.getElementById('hud-idle').textContent})"));
  const eng = await engineOf(JSON.stringify(s));
  return { label, hud, click: eng.click, idle: eng.idle, conv: eng.conv };
}
{
  const rows = [];
  rows.push(await hudWith("基线", {}));
  rows.push(await hudWith("点击流满级", { unlocked: ["click_1", "click_2", "click_3", "click_4", "click_5"], totalClicks: 10500 }));
  rows.push(await hudWith("挂机流满级", { unlocked: ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5"] }));
  rows.push(await hudWith("事件流满级(未攒安然)", { unlocked: ["event_1", "event_2", "event_3", "event_4", "event_5"] }));
  rows.push(await hudWith("事件流满级(30安然)", { unlocked: ["event_1", "event_2", "event_3", "event_4", "event_5"], patrolSurvives: 30 }));
  rows.push(await hudWith("满树15点", { unlocked: ["click_1","click_2","click_3","click_4","click_5","idle_1","idle_2","idle_3","idle_4","idle_5","event_1","event_2","event_3","event_4","event_5"], totalClicks: 10500, patrolSurvives: 30 }));
  const base = rows[0];
  out.checks.branchHud = rows.map((r) => ({ label: r.label, hudClick: r.hud.click, hudIdle: r.hud.idle, clickMul: +(r.click / base.click).toFixed(3), idleMul: +(r.idle / base.idle).toFixed(3) }));
}

// ---------- 4) 转生/段位发点是否在页面上有感知 ----------
{
  // 低段位+1 点：看是否弹 toast / badge
  const s = await setConfig({ levels: LEVELS, points: 0, unlocked: [], lifetimeEarned: 2e5, totalEarned: 2e5, moyu: 1e5, rankGranted: -1 });
  await sleep(500);
  const st = JSON.parse(await b.ev("JSON.stringify({talents:window.__MOYU__.state.talents, badge:!!document.querySelector('#btn-team .badge'), hudAll:document.querySelector('#hud')?.innerText})"));
  out.checks.rankGrant = st;
  await shot("/tmp/r12-bld-hud-points.png");
}

writeFileSync("playtest/r12-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close();
process.exit(0);
