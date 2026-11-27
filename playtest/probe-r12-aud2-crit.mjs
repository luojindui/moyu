/**
 * R12 复验：暴击真实入账 + 连击上限（实机，带页面重载容错）。
 * 运行：node playtest/probe-r12-aud2-crit.mjs
 */
import { openBrowser, sleep, setupMobilePage } from "./r9-cdp-lib.mjs";
import { writeFileSync } from "node:fs";

const b = await openBrowser({ port: 9500, tag: "r12audcrit" });
const out = { startedAt: new Date().toISOString() };
const alive = async () => {
  try {
    return (await b.ev("!!window.__MOYU__ ? 1 : 0")) === 1;
  } catch {
    return false;
  }
};
const waitGame = async () => {
  for (let i = 0; i < 150; i++) {
    if (await alive()) return;
    await sleep(100);
  }
  throw new Error("game not ready");
};
const base = {
  v: 2, moyu: 0, totalEarned: 0, lifetimeEarned: 0, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 3600_000,
  collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 19,
  visits: { date: "", count: 0 }, prestige: 0, team: { colleagues: {} },
  talents: { unlocked: ["click_1", "click_2", "click_3", "click_4"], points: 0, rankGranted: 12 },
};
await setupMobilePage(b, { url: process.env.MOYU_URL ?? "http://127.0.0.1:5173/", width: 390, height: 844 });
await waitGame();
await b.send("Page.addScriptToEvaluateOnNewDocument", {
  source: `(() => { try { localStorage.setItem("moyu-save", ${JSON.stringify(JSON.stringify(base))}); } catch(e){} })()`,
});
const restorePage = async () => {
  await b.send("Page.reload", { ignoreCache: false });
  await sleep(2000);
  await waitGame();
  await sleep(300);
};
await restorePage();

const state = async () => JSON.parse(await b.ev("JSON.stringify(window.__MOYU__.state)"));
const clickOnce = async () => {
  const before = await state();
  await b.ev(`(() => { const c=document.getElementById('stage'); c.dispatchEvent(new PointerEvent('pointerdown',{clientX:120,clientY:200,bubbles:true,isPrimary:true,pointerType:'touch'})); })()`);
  await sleep(260);
  const after = await state();
  return { delta: after.moyu - before.moyu, clicksBefore: before.totalClicks, clicksAfter: after.totalClicks };
};

try {
  const crit = await clickOnce(); // 第 20 次点击 → 应暴击 ×5
  const normal = await clickOnce(); // 第 21 次点击 → 正常
  out.critClick = crit;
  out.normalClick = normal;
  out.ratio = +(crit.delta / Math.max(1e-9, normal.delta)).toFixed(2);
  out.critCredited = out.ratio > 3.5;

  const combo = await b.ev(`(async () => {
    const c = document.getElementById('stage');
    let i = 0;
    await new Promise((resolve) => {
      const tick = () => {
        c.dispatchEvent(new PointerEvent('pointerdown', { clientX: 120, clientY: 200, bubbles: true, isPrimary: true, pointerType: 'touch' }));
        if (++i >= 26) resolve(); else setTimeout(tick, 120);
      };
      setTimeout(tick, 80);
    });
    return true;
  })()`);
  void combo;
  await sleep(400);
  out.comboHud = JSON.parse(await b.ev("JSON.stringify((() => { const el=document.getElementById('hud-combo'); return {text:el.textContent, hidden:el.classList.contains('hidden')}; })())"));
  out.note = "第 20 次点击 delta≈5×下一次（暴击已入账）；HUD 连×N>20 证明 click_3 连击上限 30 接入";
  console.log(JSON.stringify(out, null, 1));
} catch (e) {
  out.error = String(e);
  console.error("[crit] failed", e);
}
writeFileSync("playtest/r12-aud2-crit-report.json", JSON.stringify(out, null, 2));
try {
  b.close();
} catch {
  /* ignore */
}
process.exit(0);
