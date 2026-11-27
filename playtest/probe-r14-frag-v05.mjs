// r14 碎片党终验（线上 v0.5.0，HEAD 658a610/0fe5862）
// A: 无同事门控（社交灰+文案、组合灰、刷新路径不回弹）+ 版本号 + 卡片 15s 门控
// B: 种子(1e6 + 昨天精力) → 跨日 toast → 招老周 → 省心组合可用 → 1 步耗尽 100
// C: 种子(3e9) → 买齐 8/8 仍庆祝 + 挂机 +10%
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(".scratch/r14-frag-v05");
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
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {bad:true};const cx=b.left+b.width/2,cy=b.top+b.height/2;const h=document.elementFromPoint(cx,cy);return {x:cx,y:cy,hit:h?(h.id||(typeof h.className==='string'?h.className:'')||h.tagName):null,hitSelf:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true,text:(e.textContent||'').trim().slice(0,50)};})()`);
  if (!r || r.bad) return { ok: false, rect: r };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(200);
  return { ok: true, rect: r };
}
async function tapPoint(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(40);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(350);
}
const hud = () => js(`
  const btn = document.getElementById('btn-team'); const eb = btn.querySelector('.energy-badge');
  return { badge: eb ? eb.textContent : null, aria: btn.getAttribute('aria-label'),
    overlays: { cards: !document.getElementById('cards').classList.contains('hidden'), team: !document.getElementById('team').classList.contains('hidden'), welcome: !document.getElementById('welcome').classList.contains('hidden') },
    hudIdle: document.getElementById('hud-idle')?.textContent ?? null, hudMoyu: document.getElementById('hud-moyu')?.textContent ?? null };
`);
const toast = () => js(`const t=document.getElementById('dom-toast');const cs=getComputedStyle(t);return {text:t.textContent, visible:parseFloat(cs.opacity)>0.5};`);
const decoSnap = () => js(`
  const body = document.getElementById('team-body');
  if (!body) return null;
  const rows = [...body.querySelectorAll('.talent')].map((el) => {
    const b = el.querySelector('button');
    return { name: (el.querySelector('.talent-name')?.textContent ?? '').trim(), desc: (el.querySelector('.talent-desc')?.textContent ?? '').trim(),
      dataDisabled: el.dataset.disabled, on: el.classList.contains('on'),
      btn: b ? { disabled: b.disabled, aria: b.getAttribute('aria-label') } : null };
  });
  const combo = document.querySelector('#team-body button[data-act="energy-all"]');
  const raw = body.innerText;
  return { energyLine: (raw.match(/今日精力[^\\n]*/) ?? [null])[0], summary: document.querySelector('.team-summary')?.innerText ?? '', rows,
    combo: combo ? { disabled: combo.disabled, text: combo.textContent.trim() } : null,
    onCount: rows.filter(r => r.on).length,
    energyUsed: [...body.querySelectorAll('.talent[data-act="energy"].on .talent-name')].map(e => e.textContent.trim()) };
`);
async function boot(needHud = true) {
  await send("Page.navigate", { url: LIVE });
  const b = await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
  await sleep(needHud ? 900 : 300);
  return b;
}
async function seedSave(moyu, energyDate) {
  return js(`
    const today = new Date().toLocaleDateString('sv-SE');
    const blob = { v: 2, moyu: ${moyu}, totalEarned: ${moyu}, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 86400000,
      collected: { quotes: [], flavors: [] }, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0, visits: { date: '', count: 0 },
      lifetimeEarned: ${moyu}, prestige: 0, decor: [],
      energy: { date: ${JSON.stringify(energyDate ?? "TODAY")}, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
      team: { colleagues: {} }, talents: { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: '', overflow: 0 } };
    blob.energy.date = ${JSON.stringify(energyDate)} === 'TODAY' ? today : ${JSON.stringify(energyDate)};
    localStorage.setItem('moyu-save', JSON.stringify(blob));
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'moyu-save') return; return orig.call(this, k, v); };
    return { ok: true, moyu: blob.moyu, energyDate: blob.energy.date };
  `);
}
async function openDeco() {
  await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(200);
  const mid = await js(`return document.querySelector('.team-tabs .tab.active')?.textContent;`);
  await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
  return { middleTab: mid };
}

/* ===== RUN A：无同事门控 + 版本 + 卡片 15s ===== */
await runChrome(async ({ port }) => {
  const c = await connect(port); send = c.send; ev = c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  try {
    const o = R.A = {};
    // 版本号：📔 → 关于
    await boot();
    await tapSel("#btn-journal"); await waitFor(`!document.getElementById('journal').classList.contains('hidden')`, 2500); await sleep(300);
    o.version = await js(`return { aboutVersion: document.getElementById('about-version')?.textContent ?? null, aboutNotes: document.getElementById('about-notes')?.textContent ?? null, title: document.getElementById('journal-title')?.textContent ?? null };`);
    await shot("A-00-journal-version");
    await tapSel("#journal-close"); await waitFor(`document.getElementById('journal').classList.contains('hidden')`, 2000); await sleep(200);
    o.home = await hud();                       // 角标
    o.goto = await openDeco();
    o.noColleague = await decoSnap();           // 社交灰 + 文案 + 组合灰
    await shot("A-01-no-colleague");
    // 刷新路径不回弹：等 2.5s（跨多个 500ms 刷新周期）再看社交按钮是否仍 disabled
    await sleep(2500);
    o.afterRefresh = await decoSnap();
    // ③ 面板开着 15s 不弹卡
    const card = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 15000);
    o.cardsWhileOpen = { appeared: card.ok, waitedMs: card.ms };
    await shot("A-02-after-15s");
    // 关面板 → 卡应弹
    await tapSel("#team-close");
    const card2 = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 6000);
    o.cardsAfterClose = { appeared: card2.ok, ms: card2.ms };
    if (card2.ok) { await tapSel("#cards-skip"); }
  } catch (e) { R.A.err = String((e && e.stack) || e).slice(0, 500); }
  c.close();
}, { timeoutMs: 150_000, port: 9991 });

/* ===== RUN B：跨日 toast → 招老周 → 省心组合 1 步 ===== */
await runChrome(async ({ port }) => {
  const c = await connect(port); send = c.send; ev = c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  try {
    const o = R.B = {};
    await boot();
    o.seed = await seedSave(1000000, "2020-01-01");
    // reload 并抓跨日 toast
    await send("Page.navigate", { url: LIVE });
    const toastSeen = await waitFor(`/新的一天/.test(document.getElementById('dom-toast').textContent) && parseFloat(getComputedStyle(document.getElementById('dom-toast')).opacity) > 0.5`, 4000);
    o.crossDay = { toastSeen: toastSeen.ok, ms: toastSeen.ms, toast: await toast(), hud: await hud() };
    await sleep(400);
    // 招老周（同事页第一个招募按钮）
    await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(300);
    o.colleagueTab = await js(`
      const body = document.getElementById('team-body');
      return { recruitBtns: [...body.querySelectorAll('button[data-act="recruit"]')].map(b => ({ id: b.dataset.id, text: b.textContent.trim(), disabled: b.disabled })), mateCount: body.querySelectorAll('.mate').length, text: body.innerText.slice(0, 220) };
    `);
    const recruit = await tapSel(`#team-body button[data-act="recruit"]:not([disabled])`);
    await sleep(500);
    o.recruit = { tap: recruit, after: await js(`
      const body = document.getElementById('team-body');
      return { mateCount: body.querySelectorAll('.mate').length, hasZhou: /老周/.test(body.innerText), recruitBtns: [...body.querySelectorAll('button[data-act="recruit"]')].length, text: body.innerText.slice(0, 240) };
    `) };
    // 切工位
    const t = await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab-active, .team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
    o.enterWithColleague = await decoSnap();
    await shot("B-01-with-colleague");
    // 点省心组合：1 步
    const before = await decoSnap();
    const combo = await tapSel(`#team-body button[data-act="energy-all"]`);
    await sleep(450);
    o.combo = {
      before: { combo: before.combo, energyLine: before.energyLine, onCount: before.onCount },
      tap: combo,
      after: await decoSnap(),
      toast: await toast(),
      hud: await hud(),
    };
    await shot("B-02-after-combo");
    // 角标应消失（没有可负担项）
    await sleep(600);
    o.afterComboBadge = await hud();
  } catch (e) { R.B.err = String((e && e.stack) || e).slice(0, 500); }
  c.close();
}, { timeoutMs: 150_000, port: 9992 });

/* ===== RUN C：8/8 庆祝 + 挂机 +10% 复验 ===== */
await runChrome(async ({ port }) => {
  const c = await connect(port); send = c.send; ev = c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  try {
    const o = R.C = {};
    await boot();
    o.seed = await seedSave(3000000000, "TODAY");
    await send("Page.navigate", { url: LIVE });
    await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
    await sleep(900);
    await tapSel("#btn-team"); await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500); await sleep(200);
    await tapSel("#tab-decor"); await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500); await sleep(350);
    if ((await hud()).overlays.cards) { await tapSel("#cards-skip"); await sleep(250); if (await js(`return document.getElementById('team').classList.contains('hidden');`)) { await tapSel("#btn-team"); await sleep(200); } await tapSel("#tab-decor"); await sleep(300); }
    o.before = await decoSnap();
    o.buys = [];
    for (let i = 0; i < 8; i++) {
      const p = await js(`
        const rows = [...document.querySelectorAll('#team-body .talent[data-act="decor"]')];
        const el = rows.find((r) => { const b = r.querySelector('button'); return b && !b.disabled; });
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const info = el.querySelector('.talent-info').getBoundingClientRect();
        return { x: info.left + info.width/2, y: info.top + info.height/2, name: el.querySelector('.talent-name')?.textContent?.trim() };
      `);
      if (!p) break;
      await sleep(120);
      const p2 = await js(`
        const rows = [...document.querySelectorAll('#team-body .talent[data-act="decor"]')];
        const el = rows.find((r) => { const b = r.querySelector('button'); return b && !b.disabled; });
        if (!el) return null;
        const info = el.querySelector('.talent-info').getBoundingClientRect();
        return { x: info.left + info.width/2, y: info.top + info.height/2 };
      `);
      const b4 = await hud(); const beforeSnap = await decoSnap();
      if (p2) await tapPoint(p2.x, p2.y);
      const afterSnap = await decoSnap();
      const t = await toast();
      o.buys.push({ name: p.name, summary: afterSnap.summary, idleB: b4.hudIdle, idleA: (await hud()).hudIdle, toast: t.text, toastVisible: t.visible });
      if (i === 6) o.at7 = { summary: afterSnap.summary, idle: (await hud()).hudIdle };
      if (i === 7) { o.at8 = { summary: afterSnap.summary, idle: (await hud()).hudIdle, toast: t }; await shot("C-01-8of8"); }
    }
    o.final = { snap: await decoSnap(), hud: await hud() };
    await shot("C-02-decor-all");
  } catch (e) { R.C.err = String((e && e.stack) || e).slice(0, 500); }
  c.close();
}, { timeoutMs: 150_000, port: 9993 });

writeFileSync(`${OUT}/evidence.json`, JSON.stringify(R, null, 2));
const brief = {
  A: {
    version: R.A.version,
    home: R.A.home && { badge: R.A.home.badge, aria: R.A.home.aria },
    goto: R.A.goto,
    noColleague: R.A.noColleague && { energyLine: R.A.noColleague.energyLine, combo: R.A.noColleague.combo, social: R.A.noColleague.rows?.find(r => r.name === '跟同事聊天'), otherEnergy: R.A.noColleague.rows?.filter(r => r.name !== '跟同事聊天' && r.btn).map(r => ({ n: r.name, d: r.dataDisabled, btnDisabled: r.btn?.disabled })) },
    afterRefresh: R.A.afterRefresh && { social: R.A.afterRefresh.rows?.find(r => r.name === '跟同事聊天'), combo: R.A.afterRefresh.combo },
    cardsWhileOpen: R.A.cardsWhileOpen,
    cardsAfterClose: R.A.cardsAfterClose,
  },
  B: {
    seed: R.B.seed,
    crossDay: R.B.crossDay,
    colleagueTab: R.B.colleagueTab,
    recruit: R.B.recruit,
    enterWithColleague: R.B.enterWithColleague && { energyLine: R.B.enterWithColleague.energyLine, combo: R.B.enterWithColleague.combo, social: R.B.enterWithColleague.rows?.find(r => r.name === '跟同事聊天') },
    combo: R.B.combo && { before: R.B.combo.before, tap: R.B.combo.tap?.rect, after: { energyLine: R.B.combo.after?.energyLine, combo: R.B.combo.after?.combo, onCount: R.B.combo.after?.onCount, used: R.B.combo.after?.energyUsed }, toast: R.B.combo.toast, hud: R.B.combo.hud },
    afterComboBadge: R.B.afterComboBadge,
  },
  C: {
    at7: R.C.at7, at8: R.C.at8,
    final: R.C.final && { summary: R.C.final.snap?.summary, hudIdle: R.C.final.hud?.hudIdle, onCount: R.C.final.snap?.onCount },
    buys: R.C.buys,
  },
  errs: { A: R.A.err, B: R.B.err, C: R.C.err },
};
console.log(JSON.stringify(brief, null, 2));