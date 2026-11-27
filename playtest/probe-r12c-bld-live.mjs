/** R12 复验 3 live（HEAD 96117f2）：暴击真入账 / 预警提前 2s / 角标 / 存档 18 / idle_4 超 100% / idle_5b。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9529, tag: "r12c2" });
const out = { url: URL_, head: "96117f2", checks: {}, shots: [] };
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
    createdAt: Date.now() - (cfg.daysAgo ?? 30) * 86400_000,
    totalClicks: cfg.totalClicks ?? 0,
    patrolSurvives: cfg.patrolSurvives ?? 0,
    prestige: cfg.prestige ?? 0,
    talents: { unlocked: cfg.unlocked ?? [], points: cfg.points ?? 0, rankGranted: cfg.rankGranted ?? 12 },
    collected: { quotes: [], flavors: [] },
    daily: null,
    visits: { date: cfg.visitsDate ?? "", count: cfg.visits ?? 0 },
    team: cfg.team ?? { colleagues: {} },
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
async function tap(n, gap = 105) {
  const rect = JSON.parse(await b.ev(`JSON.stringify(document.getElementById('stage').getBoundingClientRect())`));
  const x = rect.x + rect.width / 2;
  const y = rect.y + Math.min(rect.height * 0.45, 320);
  for (let i = 0; i < n; i++) {
    await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(gap);
  }
}
const HOOK = `(function(){try{
  window.__texts=[];window.__crit=0;
  window.__loads=(Number(sessionStorage.getItem('__loads'))||0)+1;sessionStorage.setItem('__loads',String(window.__loads));
  const P=CanvasRenderingContext2D.prototype,o=P.fillText;
  if(!P.__hooked){P.__hooked=1;P.fillText=function(t,x,y,...r){const s=String(t);if(s.includes('暴击'))window.__crit++;
    if(window.__texts&&window.__texts.length<1200)window.__texts.push({s,t:Math.round(performance.now())});return o.call(this,t,x,y,...r);};}
}catch(e){}})();`;
async function hookText() {
  await b.ev(HOOK);
}
async function ev(js) {
  return JSON.parse(await b.ev(`JSON.stringify(${js})`));
}

await b.send("Page.enable");
await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await b.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
const LEVELS = { coffee: 20, water: 20, chair: 20, phone: 40, toilet: 20 };
const TODAY = new Date().toLocaleDateString("sv-SE");

// A) 存档 18 / 角标
{
  const s = await setConfig({ levels: LEVELS, points: 18, unlocked: [] });
  out.checks.save18 = { loaded: s.talents.points, ok: s.talents.points === 18 };
  const badge = await ev("({badge:!!document.querySelector('#btn-team .talent-badge'),text:(document.querySelector('#btn-team .talent-badge')||{}).textContent})");
  out.checks.badge = badge;
  await shot("/tmp/r12c2-badge.png");
}

// B) 暴击（40 下，第 20/40 下必暴击）：state 是否 ×5 入账
{
  await setConfig({ levels: { coffee: 20, water: 20, chair: 20 }, unlocked: ["click_1", "click_2", "click_3", "click_4"], points: 0 });
  await b.ev("window.__texts=[];window.__crit=0;1");
  const s0 = await ev("window.__MOYU__.state");
  const eng = await ev(`(async()=>{const A=await import('/src/engine/actions.ts');const U=await import('/src/engine/upgrades.ts');const s=${JSON.stringify(s0)};return {click:A.clickPowerOf(s),cap:A.comboCapOf(s),idle:U.effectOf(s).idleRate};})()`);
  const t0 = Date.now();
  await tap(19, 105);
  await tap(1, 20);
  await sleep(80);
  await shot("/tmp/r12c2-crit.png");
  await tap(20, 105);
  const ms = Date.now() - t0;
  await sleep(120);
  const s1 = await ev("window.__MOYU__.state");
  const ui = await ev("({crit:window.__crit||0,loads:window.__loads||0,texts:(window.__texts||[]).slice(-80)})");
  const gained = s1.lifetimeEarned - s0.lifetimeEarned;
  let sum = 0;
  for (let i = 1; i <= 40; i++) sum += 1 + 0.012 * Math.min(i, eng.cap);
  const noCrit = eng.click * sum + eng.idle * (ms / 1000);
  const critTapVal = (combo) => eng.click * (1 + 0.012 * Math.min(combo, eng.cap));
  const withCrit = noCrit + 4 * critTapVal(20) + 4 * critTapVal(30);
  const plus = ui.texts
    .map((x) => {
      const m = String(x.s).match(/(\d[\d,]*)$/);
      return m ? Number(m[1].replace(/,/g, "")) : null;
    })
    .filter((v) => v !== null);
  out.checks.crit = {
    critFloatCount: ui.crit,
    pageLoadsDuringCrit: ui.loads,
    stateGain: Math.round(gained),
    predictedNoCrit: Math.round(noCrit),
    predictedWithCrit: Math.round(withCrit),
    ratioVsWithCrit: +(gained / withCrit).toFixed(4),
    ratioVsNoCrit: +(gained / noCrit).toFixed(4),
    maxDisplayedPlus: Math.max(0, ...plus),
    normalTapMax: Math.round(eng.click * (1 + 0.012 * eng.cap)),
    ok: Math.abs(gained / withCrit - 1) < 0.03,
  };
}

// C) event_4 提前 2s 预警：DOM toast(show) 与 sr-live 巡逻播报的时间差
async function warnRun(unlocked, label) {
  await setConfig({ levels: { coffee: 5 }, unlocked, points: 0 });
  const t0 = Date.now();
  let warnAt = null,
    bossAt = null,
    warned = false,
    bossAnnounced = false;
  for (let i = 0; i < 800 && !(warnAt && bossAt); i++) {
    const r = await ev(
      "({shown:document.getElementById('dom-toast')?.classList.contains('show')||false,toast:document.getElementById('dom-toast')?.textContent||'',sr:document.getElementById('sr-live')?.textContent||''})",
    );
    if (!warnAt && r.shown && String(r.toast).includes("王总快来了")) {
      warnAt = Date.now() - t0;
      warned = true;
      await shot(`/tmp/r12c2-warn-${label}.png`);
    }
    if (!bossAt && /王总巡逻|摸鱼冲刺|假装工作/.test(String(r.sr))) bossAt = Date.now() - t0;
    await sleep(55);
  }
  return { label, warnMs: warnAt, bossMs: bossAt, gapMs: warnAt !== null && bossAt !== null ? bossAt - warnAt : null };
}
{
  const withT = await warnRun(["event_1", "event_2", "event_3", "event_4"], "with");
  const without = await warnRun(["event_1", "event_2", "event_3"], "without");
  out.checks.warn = {
    withEvent4: withT,
    withoutEvent4: without,
    ok: withT.gapMs !== null && Math.abs(withT.gapMs - 2000) < 400 && without.warnMs === null,
    verdict: `点 event_4：预警在巡逻前 ${withT.gapMs}ms（期望≈2000）；未点：${without.warnMs === null ? "无预警 ✅" : "也出现预警 ❌"}`,
  };
}

// D) idle_4：3 次回访/天，离线效率应 >100%
{
  await setConfig({ levels: { phone: 60 }, unlocked: ["idle_1", "idle_2", "idle_3", "idle_4"], points: 0, visits: 3, visitsDate: TODAY });
  const eff = await ev(
    "(async()=>{const P=await import('/src/engine/progression.ts');const s=window.__MOYU__.state;const now=Date.now();return P.offlineEfficiency(s, now-30*86400000, now);})()",
  );
  out.checks.idle4 = { visitsCount: 3, eff: +Number(eff).toFixed(3), over100: eff > 1 };
}

// E) idle_5b live：老周满级，点 5b 前后总挂机
{
  const team = { colleagues: { zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } };
  await setConfig({ levels: { phone: 60 }, unlocked: ["idle_1", "idle_2", "idle_3", "idle_4"], points: 2, team });
  const idleOf = async () =>
    Number(
      await b.ev(
        "(async()=>{const U=await import('/src/engine/upgrades.ts');return U.effectOf(window.__MOYU__.state).idleRate;})()",
      ),
    );
  const before = await idleOf();
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(300);
  await b.ev(`document.querySelector('#team-body button[data-id="idle_5b"]').click()`);
  await sleep(400);
  const after = await idleOf();
  const st1 = await ev("window.__MOYU__.state.talents");
  out.checks.idle5b = { before: Math.round(before), after: Math.round(after), mul: +(after / before).toFixed(3), unlocked: st1.unlocked, ok: after > before };
  await shot("/tmp/r12c2-idle5b.png");
}

writeFileSync("playtest/r12c2-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close();
process.exit(0);
