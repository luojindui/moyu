// r14 最终复验·补：④ 8/8 庆祝 + 挂机 +10%（线上种子存档；含桌面/平板鱼缸可见性截图）
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(".scratch/r14-frag-final");
mkdirSync(OUT, { recursive: true });
const LIVE = "https://luojindui.github.io/moyu/";
const R = {};
let send, ev;
const js = (code) => ev(`(()=>{${code}})()`);
async function waitFor(expr, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = false; try { v = await ev(expr); } catch {}
    if (v) return { ok: true, ms: Date.now() - t0 };
    await sleep(100);
  }
  return { ok: false, ms: Date.now() - t0 };
}
async function shot(n) { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, "base64")); }
async function tapSel(sel) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {bad:true};const cx=b.left+b.width/2,cy=b.top+b.height/2;const h=document.elementFromPoint(cx,cy);return {x:cx,y:cy,w:+b.width.toFixed(1),h:+b.height.toFixed(1),text:(e.textContent||'').trim().slice(0,60),hit:h?(h.id||(typeof h.className==='string'?h.className:'')||h.tagName):null,hitSelf:!!h&&(h===e||e.contains(h))};})()`);
  if (!r || r.bad) return { ok: false };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(200); return { ok: true, rect: r };
}
async function tapPoint(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(320);
}
const snap = () => js(`
  const body = document.getElementById('team-body');
  const raw = body ? body.innerText : '';
  return {
    summary: document.querySelector('.team-summary')?.innerText ?? '',
    hudIdle: document.getElementById('hud-idle')?.textContent ?? null,
    hudMoyu: document.getElementById('hud-moyu')?.textContent ?? null,
    onCount: body ? body.querySelectorAll('.talent.on').length : 0,
    decorOwned: body ? [...body.querySelectorAll('.talent[data-act="decor"]')].filter(r => r.classList.contains('on')).length : 0,
    text: raw,
  };
`);
const toast = () => js(`const t=document.getElementById('dom-toast');const cs=getComputedStyle(t);return {text:t.textContent, visible:parseFloat(cs.opacity)>0.5};`);

await runChrome(async ({ port }) => {
  const c = await connect(port);
  send = c.send; ev = c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  // 1) 首屏装载后写入种子存档（3e9 余额 + deep Lv.1 放大挂机值便于测 +10%），并封住 pagehide 保存
  await send("Page.navigate", { url: LIVE });
  await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
  await sleep(700);
  R.seed = await js(`
    const today = new Date().toLocaleDateString('sv-SE');
    const blob = {
      v: 2, moyu: 3000000000, totalEarned: 3000000000, levels: { deep: 1 }, savedAt: Date.now(), createdAt: Date.now() - 86400000,
      collected: { quotes: [], flavors: [] }, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
      visits: { date: '', count: 0 }, lifetimeEarned: 3000000000, prestige: 0, decor: [],
      energy: { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
      team: { colleagues: {} }, talents: { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: '', overflow: 0 },
    };
    localStorage.setItem('moyu-save', JSON.stringify(blob));
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'moyu-save') return; return orig.call(this, k, v); };
    return { ok: true };
  `);
  await send("Page.navigate", { url: LIVE });
  await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
  await sleep(900);
  R.afterSeed = await snap();
  // 2) 进工位、买 8 件
  await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(200);
  await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
  if ((await js(`return !document.getElementById('cards').classList.contains('hidden');`))) {
    await tapSel("#cards-skip"); await sleep(250);
    await tapSel("#btn-team"); await sleep(300);
    await tapSel("#tab-decor"); await sleep(300);
  }
  R.before = await snap();
  R.buys = [];
  for (let i = 0; i < 8; i++) {
    const target = await js(`
      const rows = [...document.querySelectorAll('#team-body .talent[data-act="decor"]')];
      const el = rows.find((r) => { const b = r.querySelector('button'); return b && !b.disabled; });
      if (!el) return null;
      const info = el.querySelector('.talent-info').getBoundingClientRect();
      return { x: info.left + info.width/2, y: info.top + info.height/2, name: el.querySelector('.talent-name')?.textContent?.trim() };
    `);
    if (!target) { R.buys.push({ stop: 'no enabled' }); break; }
    const hudBefore = await snap();
    await tapPoint(target.x, target.y);
    const after = await snap();
    R.buys.push({ name: target.name, summaryBefore: hudBefore.summary, summaryAfter: after.summary, hudIdleBefore: hudBefore.hudIdle, hudIdleAfter: after.hudIdle, toast: await toast() });
    if (i === 6) { R.at7 = { summary: after.summary, hudIdle: after.hudIdle, toast: await toast() }; }
    if (i === 7) { R.at8 = { summary: after.summary, hudIdle: after.hudIdle, toast: await toast() }; await shot("C2-01-8of8"); }
  }
  R.final = await snap();
  await shot("C2-02-decor-all");
  // 3) 场景截图：手机 / 桌面 1280x800 / 平板 768x1024（鱼缸可见性）
  await tapSel("#team-close"); await waitFor(`document.getElementById('team').classList.contains('hidden')`, 2500);
  await sleep(800); await shot("C2-03-scene-390x844");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(900); await shot("C2-04-scene-desktop-1280x800");
  await send("Emulation.setDeviceMetricsOverride", { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await sleep(900); await shot("C2-05-scene-tablet-768x1024");
  c.close();
}, { timeoutMs: 150_000, port: 9989 });

writeFileSync(`${OUT}/evidence-C2.json`, JSON.stringify(R, null, 2));
console.log(JSON.stringify({
  seed: R.seed, afterSeed: R.afterSeed && { hudIdle: R.afterSeed.hudIdle, hudMoyu: R.afterSeed.hudMoyu, summary: R.afterSeed.summary },
  before: R.before && { summary: R.before.summary, hudIdle: R.before.hudIdle },
  buys: R.buys,
  at7: R.at7, at8: R.at8, final: R.final && { summary: R.final.summary, hudIdle: R.final.hudIdle, onCount: R.final.onCount, decorOwned: R.final.decorOwned },
}, null, 2));