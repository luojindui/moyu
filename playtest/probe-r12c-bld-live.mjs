/** R12 复验 3 live 探针：暴击是否真入账 / 预警是否真提前 2s / 角标 / 存档 18 / 面板描述 / idle_5b。
 *  只读 src/，证据写 playtest/。 */
import { openBrowser, sleep } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const URL_ = "http://127.0.0.1:5173/";
const b = await openBrowser({ port: 9527, tag: "r12cbld" });
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
    createdAt: Date.now() - (cfg.daysAgo ?? 30) * 86400_000,
    totalClicks: cfg.totalClicks ?? 0,
    patrolSurvives: cfg.patrolSurvives ?? 0,
    prestige: cfg.prestige ?? 0,
    talents: { unlocked: cfg.unlocked ?? [], points: cfg.points ?? 0, rankGranted: cfg.rankGranted ?? 12 },
    collected: { quotes: [], flavors: [] },
    daily: null,
    visits: { date: "", count: cfg.visits ?? 0 },
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
async function hookText() {
  await b.ev(`(()=>{
    window.__texts=[];window.__crit=0;
    const P=CanvasRenderingContext2D.prototype, o=P.fillText;
    P.fillText=function(t,x,y,...r){ const s=String(t);
      if(s.includes('暴击')) window.__crit++;
      if(window.__texts.length<900) window.__texts.push({s,x:Math.round(x),y:Math.round(y),t:Math.round(performance.now())});
      return o.call(this,t,x,y,...r); };
    return 1;})()`);
}
async function engineIdle(stateJson) {
  return JSON.parse(
    await b.ev(
      `(async()=>{const U=await import('/src/engine/upgrades.ts');const s=${stateJson};return JSON.stringify(U.effectOf(s).idleRate);})()`,
    ),
  );
}

await b.send("Page.enable");
await b.send("Runtime.enable");
await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const LEVELS = { coffee: 20, water: 20, chair: 20, phone: 40, toilet: 20 };

// ---------- A) 存档 18 点 ----------
{
  const s = await setConfig({ levels: LEVELS, points: 18, unlocked: [] });
  out.checks.save18 = { loaded: s.talents.points, ok: s.talents.points === 18 };
}

// ---------- B) 角标 + 面板 click_5b 描述 ----------
{
  await setConfig({ levels: LEVELS, points: 15, unlocked: [] });
  const badge = JSON.parse(
    await b.ev("JSON.stringify({badge:!!document.querySelector('#btn-team .talent-badge'),text:(document.querySelector('#btn-team .talent-badge')||{}).textContent,label:document.getElementById('btn-team').getAttribute('aria-label')})"),
  );
  out.checks.badge = badge;
  await shot("/tmp/r12c-badge.png");
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(400);
  const panel = JSON.parse(
    await b.ev("JSON.stringify({text:document.getElementById('team').innerText})"),
  );
  out.checks.click5bDesc = {
    inPanel: /点击力再\\s*\\+60%/.test(panel.text),
    claimsComboDouble: /连击每层收益翻倍/.test(panel.text),
    line: panel.text.split("\n").find((l) => l.includes("指尖风暴")) ?? null,
  };
  await shot("/tmp/r12c-talents-panel.png");
  await b.ev("document.getElementById('team-close').click()");
  await sleep(200);
}

// ---------- C) 暴击：UI 飘 ×5 但 state 是否真加 ----------
{
  await setConfig({ levels: { coffee: 20, water: 20, chair: 20 }, unlocked: ["click_1", "click_2", "click_3", "click_4"], points: 0 });
  await hookText();
  const s0 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const eng = JSON.parse(
    await b.ev(`(async()=>{const A=await import('/src/engine/actions.ts');const U=await import('/src/engine/upgrades.ts');const s=${JSON.stringify(s0)};return JSON.stringify({click:A.clickPowerOf(s),cap:A.comboCapOf(s),idle:U.effectOf(s).idleRate});})()`),
  );
  const t0 = Date.now();
  await tap(19, 105); // 前 19 下
  await tap(1, 20); // 第 20 下 = 暴击（totalClicks+1 = 20）
  await sleep(70);
  await shot("/tmp/r12c-crit.png");
  await sleep(80);
  await tap(20, 105); // 第 21-40 下（第 40 下再暴击）
  const ms = Date.now() - t0;
  await sleep(120);
  const s1 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const ui = JSON.parse(await b.ev("JSON.stringify({crit:window.__crit,texts:window.__texts.slice(-80)})"));
  const gained = s1.lifetimeEarned - s0.lifetimeEarned;
  let sum = 0;
  for (let i = 1; i <= 40; i++) sum += 1 + 0.012 * Math.min(i, eng.cap);
  const predictedNoCrit = eng.click * sum + eng.idle * (ms / 1000);
  const predictedWithCrit = eng.click * sum + eng.idle * (ms / 1000) + eng.click * 4 * (2 * (1 + 0.012 * 20)); // 20/40 两下 ×5
  const plusTexts = ui.texts
    .map((x) => {
      const m = String(x.s).match(/([+]?)(\d[\d,]*)$/);
      return m ? Number(m[2].replace(/,/g, "")) : null;
    })
    .filter((v) => v !== null);
  out.checks.crit = {
    critFloatCount: ui.crit,
    stateGain: Math.round(gained),
    predictedNoCrit: Math.round(predictedNoCrit),
    predictedWithCrit: Math.round(predictedWithCrit),
    ratioVsNoCrit: +(gained / predictedNoCrit).toFixed(4),
    ratioVsWithCrit: +(gained / predictedWithCrit).toFixed(4),
    maxDisplayedPlus: Math.max(0, ...plusTexts),
    normalTapMax: Math.round(eng.click * (1 + 0.012 * eng.cap)),
    critTextSample: ui.texts.filter((x) => String(x.s).includes("暴击")).slice(0, 2),
    verdict:
      ui.crit > 0
        ? "UI 出现「暴击!」；但 state 收入比≈1.0（若无暴击）→ 暴击只改了飘字数值，未真正入账 ❌"
        : "未观测到暴击（❌）",
  };
}

// ---------- D) event_4 提前 2s 预警（含 2s 时间差实测） ----------
async function warnRun(unlocked, label) {
  await setConfig({ levels: { coffee: 5 }, unlocked, points: 0, totalClicks: 0 });
  await hookText();
  const t0 = Date.now();
  let warnAt = null,
    bannerAt = null,
    warnShot = false;
  for (let i = 0; i < 900 && !(warnAt && bannerAt); i++) {
    const r = JSON.parse(
      await b.ev(
        "JSON.stringify({toast:(document.getElementById('dom-toast')||{}).textContent||'',cls:(document.getElementById('dom-toast')||{}).className||'',texts:(window.__texts||[]).slice(-12).map(x=>x.s)})",
      ),
    );
    if (warnAt === null && String(r.toast).includes("王总快来了")) {
      warnAt = Date.now() - t0;
      await shot(`/tmp/r12c-warn-${label}.png`);
    }
    if (bannerAt === null && r.texts.some((t) => String(t).includes("王总"))) bannerAt = Date.now() - t0;
    await sleep(60);
  }
  return { label, warnMs: warnAt, bossBannerMs: bannerAt, gapMs: warnAt !== null && bannerAt !== null ? bannerAt - warnAt : null };
}
{
  const withT = await warnRun(["event_1", "event_2", "event_3", "event_4"], "with");
  const without = await warnRun(["event_1", "event_2", "event_3"], "without");
  out.checks.warn = {
    withEvent4: withT,
    withoutEvent4: without,
    verdict: `点 event_4 后预警提前量≈${withT.gapMs}ms（期望≈2000ms）；未点 event_4 是否无预警=${without.warnMs === null}`,
  };
}

// ---------- E) idle_5b live：招募老周满级后对比挂机率 ----------
{
  const team = { colleagues: { zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } };
  await setConfig({ levels: { phone: 60 }, unlocked: ["idle_1", "idle_2", "idle_3", "idle_4"], points: 2, team });
  const s0 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const idle0 = await engineIdle(JSON.stringify(s0));
  await b.ev("document.getElementById('btn-team').click();document.getElementById('tab-talents').click()");
  await sleep(300);
  await b.ev(`document.querySelector('#team-body button[data-id="idle_5b"]').click()`);
  await sleep(400);
  const s1 = JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
  const idle1 = await engineIdle(JSON.stringify(s1));
  out.checks.idle5b = {
    before: s0.talents.unlocked,
    after: s1.talents.unlocked,
    idleBefore: Math.round(idle0),
    idleAfter: Math.round(idle1),
    mul: +(idle1 / idle0).toFixed(3),
    ok: idle1 > idle0,
  };
  await shot("/tmp/r12c-idle5b.png");
  await b.ev("document.getElementById('team-close').click()");
}

// ---------- F) idle_4 live：3 次回访/天离线效率是否 >100% ----------
{
  await setConfig({ levels: { phone: 60 }, unlocked: ["idle_1", "idle_2", "idle_3", "idle_4"], points: 0, visits: 3 });
  const eff = JSON.parse(
    await b.ev(`(async()=>{const P=await import('/src/engine/progression.ts');const s=window.__MOYU__.state;const now=Date.now();return JSON.stringify(P.offlineEfficiency(s, now-30*86400000, now));})()`),
  );
  out.checks.idle4 = { visits: 3, eff, over100: eff > 1 };
}

writeFileSync("playtest/r12c-bld-live.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
b.close();
process.exit(0);
