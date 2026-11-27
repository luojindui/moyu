/** R12 复验 live 探针：真实页面验证连击/暴击/终极/重置确认/角标/存档截断。只读 src/。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9523, tag: "r12bld" });
const out = { url: URL_, checks: {}, shots: [] };
let scriptId = null;

async function setConfig(cfg) {
  if (scriptId) {
    await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId }).catch(() => {});
    scriptId = null;
  }
  const save = {
    v: 2,
    moyu: cfg.moyu ?? 5e7,
    totalEarned: cfg.totalEarned ?? 1e9,
    lifetimeEarned: cfg.lifetimeEarned ?? 1e9,
    levels: cfg.levels ?? {},
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
  const r = await b.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try{localStorage.setItem('moyu-save',${JSON.stringify(JSON.stringify(save))});}catch(e){}`,
  });
  scriptId = r.identifier;
  await b.send("Page.navigate", { url: URL_ });
  await sleep(2300);
  return JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
}
async function shot(p) {
  await b.shot(p);
  out.shots.push(p);
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
await b.send("Page.enable");
await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const LEVELS = { coffee: 20, water: 20, chair: 20, phone: 40, toilet: 20 };

// ---------- A) 存档上限：points 18 → 读档后？ ----------
{
  const s = await setConfig({ levels: LEVELS, points: 18, unlocked: [] });
  out.checks.saveCap18 = { injectedPoints: 18, loadedPoints: s.talents.points, verdict: s.talents.points === 18 ? "OK" : "❌ 读档截断" };
  const s2 = await setConfig({ levels: LEVELS, points: 16, unlocked: [] });
  out.checks.saveCap16 = { injectedPoints: 16, loadedPoints: s2.talents.points };
}

// ---------- B) 天赋页（15 点可用）+ 终极互斥 + 引导/进度 ----------
{
  await setConfig({ levels: LEVELS, points: 15, unlocked: [], totalClicks: 6000, patrolSurvives: 12 });
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(400);
  const panel = JSON.parse(
    await b.ev(
      "JSON.stringify({text:document.getElementById('team').innerText,btns:[...document.querySelectorAll('#team-body button[data-act=talent]')].map(b=>({id:b.dataset.id,t:b.innerText,dis:b.disabled}))})",
    ),
  );
  out.checks.panel = {
    points: panel.text.match(/天赋点 (\d+)/)?.[1],
    hasUltLabel: /终极·2点/.test(panel.text),
    hasExclusiveHint: /互斥/.test(panel.text),
    hasProgress: /点击转化/.test(panel.text) && /安然转化/.test(panel.text),
    progressText: panel.text.split("\n").filter((l) => l.includes("转化")).slice(0, 3),
    ultButtons: panel.btns.filter((x) => x.id && x.id.includes("_5")),
    hintLine: panel.text.split("\n").slice(0, 3),
  };
  await shot("/tmp/r12b-talents-15.png");
  // 点亮点击流 1-4 + 5a，检查 5b 互斥禁用
  for (const id of ["click_1", "click_2", "click_3", "click_4", "click_5a"]) {
    await b.ev(`document.querySelector('#team-body button[data-id="${id}"]')?.click()`);
    await sleep(250);
  }
  const after = JSON.parse(
    await b.ev(
      "JSON.stringify({talents:window.__MOYU__.state.talents,btns:[...document.querySelectorAll('#team-body button[data-act=talent]')].map(b=>({id:b.dataset.id,t:b.innerText,dis:b.disabled,desc:b.closest('.talent')?.innerText}))})",
    ),
  );
  out.checks.exclusive = {
    unlocked: after.talents.unlocked,
    pointsLeft: after.talents.points,
    click_5b: after.btns.find((x) => x.id === "click_5b"),
  };
  await shot("/tmp/r12b-talents-exclusive.png");

  // 重置：先取消，再确认
  const beforeReset = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  const evalP = b.ev(`document.querySelector('#team-body button[data-act="reset-talents"]').click()`);
  await sleep(400);
  await b.send("Page.handleJavaScriptDialog", { accept: false });
  await sleep(300);
  await evalP.catch(() => {});
  const afterCancel = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  out.checks.resetCancel = { beforeReset, afterCancel, kept: JSON.stringify(beforeReset) === JSON.stringify(afterCancel) };
  const evalP2 = b.ev(`document.querySelector('#team-body button[data-act="reset-talents"]').click()`);
  await sleep(400);
  await b.send("Page.handleJavaScriptDialog", { accept: true });
  await sleep(400);
  await evalP2.catch(() => {});
  const afterAccept = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state.talents)"));
  out.checks.resetAccept = afterAccept;
  await shot("/tmp/r12b-talents-reset.png");
}

// ---------- C) 角标：有天赋点且无任务可领 ----------
{
  const s = await setConfig({ levels: LEVELS, points: 15, unlocked: [] });
  out.checks.badge = JSON.parse(
    await b.ev("JSON.stringify({points:window.__MOYU__.state.talents.points,badge:!!document.querySelector('#btn-team .badge'),label:document.getElementById('btn-team').getAttribute('aria-label')})"),
  );
  await shot("/tmp/r12b-hud-15points.png");
}

// ---------- D) 0 点引导 ----------
{
  await setConfig({ levels: LEVELS, points: 0, unlocked: [], lifetimeEarned: 5000, totalEarned: 5000, moyu: 1000, rankGranted: -1 });
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(400);
  out.checks.zeroPanel = JSON.parse(
    await b.ev("JSON.stringify({text:document.getElementById('team').innerText.slice(0,260),hasGuide:/还没有天赋点/.test(document.getElementById('team').innerText)})"),
  );
  await shot("/tmp/r12b-talents-0.png");
  await b.ev("document.getElementById('team-close').click()");
}

// ---------- E) 连击窗口/上限 live：40 连点 ----------
async function tapTest(label, unlocked) {
  await setConfig({ levels: { coffee: 20, water: 20, chair: 20 }, unlocked });
  const s0 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const eng = JSON.parse(
    await b.ev(`(async()=>{const A=await import('/src/engine/actions.ts');const U=await import('/src/engine/upgrades.ts');const s=${JSON.stringify(s0)};return JSON.stringify({click:A.clickPowerOf(s),cap:A.comboCapOf(s),win:A.comboWindowOf(s),idle:U.effectOf(s).idleRate});})()`),
  );
  const t0 = Date.now();
  await tapCanvas(40, 105);
  const ms = Date.now() - t0;
  await sleep(120);
  const s1 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const hudCombo = await b.ev("document.getElementById('hud-combo').textContent");
  const comboSeen = Number((hudCombo.match(/(\d+)/) || [0, 0])[1]);
  const gained = s1.lifetimeEarned - s0.lifetimeEarned;
  let sum = 0;
  for (let i = 1; i <= 40; i++) sum += 1 + 0.012 * Math.min(i, eng.cap);
  const predicted = eng.click * sum + eng.idle * (ms / 1000);
  return { label, ...eng, hudCombo, comboSeen, gained, predicted, ratio: gained / predicted, ratioIfCrit: gained / (predicted * 1.2) };
}
{
  const plain = await tapTest("无点击天赋", []);
  const cap30 = await tapTest("click_1/2/3（上限30+窗口0.65）", ["click_1", "click_2", "click_3"]);
  const crit = await tapTest("click_1/2/3/4（含暴击）", ["click_1", "click_2", "click_3", "click_4"]);
  out.checks.tap = {
    plain,
    cap30,
    crit,
    verdict: `连击：无天赋封顶 ${plain.comboSeen}，点 click_3 后 ${cap30.comboSeen}（应 30）；暴击：40 次点击收入比 ${crit.ratio.toFixed(3)}（若无暴击≈1.00，若有≈1.10），与无暴击的 ${cap30.ratio.toFixed(3)} 比较`,
  };
  await shot("/tmp/r12b-combo30.png");
}

writeFileSync("playtest/r12b-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close();
process.exit(0);
