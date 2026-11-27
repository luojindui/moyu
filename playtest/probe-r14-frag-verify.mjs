// r14 碎片党复验探针（HEAD 3580947）：验证 ① 精力角标 ② 一键全用 1 步 ③ 摸鱼卡是否仍覆盖工位 ④ 44px/整行可点
// 另含布局回归（一屏看得完吗）、家具整行购买、次日角标重现、375x667 小屏、线上 dist 同名验证。
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(".scratch/r14-frag-verify");
mkdirSync(OUT, { recursive: true });
const DEV = "http://127.0.0.1:5173/";
const LIVE = "https://luojindui.github.io/moyu/";
const R = { meta: { startedAt: new Date().toISOString(), head: "3580947", dev: DEV, live: LIVE, viewport: "390x844@2x" }, open1: {}, open2: {}, open3: {}, liveCheck: {}, errors: [] };

let send, ev;
const js = (code) => ev(`(()=>{${code}})()`);
async function waitFor(expr, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let v = false;
    try { v = await ev(expr); } catch { /* ignore */ }
    if (v) return { ok: true, ms: Date.now() - t0 };
    await sleep(100);
  }
  return { ok: false, ms: Date.now() - t0 };
}
async function shot(name) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
}
async function tapSel(sel) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {bad:true};const cx=b.left+b.width/2,cy=b.top+b.height/2;const h=document.elementFromPoint(cx,cy);return {x:cx,y:cy,w:+b.width.toFixed(1),h:+b.height.toFixed(1),text:(e.textContent||'').trim().slice(0,50),hit:h?(h.id||(typeof h.className==='string'?h.className:'')||h.tagName):null,hitSelf:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true};})()`);
  if (!r || r.bad) return { ok: false, rect: r };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(160);
  return { ok: true, rect: r };
}
/** 点任意坐标（整行可点验证用） */
async function tapPoint(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(200);
}
const stateSnap = () => js(`
  const s = __MOYU__.state;
  return { moyu: s.moyu, decor: s.decor, energy: s.energy, totalClicks: s.totalClicks, cards: s.cards ?? null };
`);
async function hudSnap() {
  return js(`
    const btn = document.getElementById('btn-team');
    const badge = btn.querySelector('.badge');
    const eb = btn.querySelector('.energy-badge');
    const br = btn.getBoundingClientRect();
    const ebR = eb ? eb.getBoundingClientRect() : null;
    const tb = btn.querySelector('.talent-badge');
    const tbR = tb ? tb.getBoundingClientRect() : null;
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) }; };
    const overlap = (a, b) => !!a && !!b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const hudAt = (x, y) => { const el = document.elementFromPoint(x, y); return el ? ((el.id || '') + ' ' + (typeof el.className === 'string' ? el.className : '')).trim().slice(0, 40) : null; };
    return {
      teamBtn: rect(btn), btnAriaLabel: btn.getAttribute('aria-label'),
      taskBadge: badge ? { text: badge.textContent, rect: rect(badge) } : null,
      energyBadge: eb ? { text: eb.textContent, rect: rect(eb) } : null,
      talentBadge: tb ? { text: tb.textContent, rect: rect(tb) } : null,
      overlaps: {
        energyVsTalent: overlap(ebR, tbR),
        energyVsTeamBtn: overlap(ebR, br),
      },
      hudText: document.getElementById('hud').innerText.replace(/\\s+/g, ' ').trim(),
      centers: {
        atEnergyBadge: ebR ? hudAt(ebR.x + ebR.width / 2, ebR.y + ebR.height / 2) : null,
        atTeamBtn: hudAt(br.x + br.width / 2, br.y + br.height / 2),
      },
      overlays: { welcome: !document.getElementById('welcome').classList.contains('hidden'), cards: !document.getElementById('cards').classList.contains('hidden'), team: !document.getElementById('team').classList.contains('hidden'), boss: !document.getElementById('boss-choice').classList.contains('hidden') },
    };
  `);
}
/** 工位页度量（复验版：含一键全用、家具标题、44px、aria） */
async function decorMetrics() {
  return js(`
    const body = document.getElementById('team-body');
    const br = body.getBoundingClientRect();
    const rows = [...body.querySelectorAll('.talent')].map((el) => {
      const r = el.getBoundingClientRect();
      const b = el.querySelector('button');
      const bb = b ? b.getBoundingClientRect() : null;
      return {
        name: (el.querySelector('.talent-name')?.textContent ?? '').trim(),
        desc: (el.querySelector('.talent-desc')?.textContent ?? '').trim(),
        dot: (el.querySelector('.talent-dot')?.textContent ?? '').trim(),
        rowTap: el.classList.contains('row-tap'), dataDisabled: el.dataset.disabled ?? null,
        top: +(r.top - br.top).toFixed(0), h: +r.height.toFixed(0),
        visible: r.top < br.bottom && r.bottom > br.top,
        fully: r.top >= br.top - 1 && r.bottom <= br.bottom + 1,
        on: el.classList.contains('on'),
        btn: bb ? { w: +bb.width.toFixed(0), h: +bb.height.toFixed(0), disabled: b.disabled, text: (b.textContent ?? '').trim(), aria: b.getAttribute('aria-label') } : null,
      };
    });
    const btns = [...body.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { act: b.dataset.act, id: b.dataset.id ?? '', text: (b.textContent ?? '').trim(), aria: b.getAttribute('aria-label'), w: +r.width.toFixed(0), h: +r.height.toFixed(0), disabled: b.disabled, top: +(r.top - br.top).toFixed(0) };
    });
    const raw = body.innerText || '';
    const noWs = raw.replace(/\\s+/g, '');
    const headings = [...body.querySelectorAll('h3')].map((h) => h.innerText.replace(/\\s+/g, ' ').trim());
    const tabs = [...document.querySelectorAll('.team-tabs .tab')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent, w: +r.width.toFixed(0), h: +r.height.toFixed(0), ariaSelected: b.getAttribute('aria-selected') }; });
    return {
      rows, btns, rowCount: rows.length, names: rows.map((r) => r.name), headings,
      onCount: rows.filter((r) => r.on).length,
      enabledBtns: btns.filter((b) => !b.disabled).length,
      visibleRows: rows.filter((r) => r.visible).length,
      fullyVisibleRows: rows.filter((r) => r.fully).length,
      scroll: { top: body.scrollTop, sh: body.scrollHeight, ch: body.clientHeight, overflow: body.scrollHeight - body.clientHeight },
      chars: noWs.length, numTokens: (raw.match(/\\d+(?:\\.\\d+)?/g) || []).length,
      minBtnH: Math.min(...btns.map((b) => b.h)), minRowH: Math.min(...rows.map((r) => r.h)),
      tabs, bodyRect: { x: +br.x.toFixed(0), y: +br.y.toFixed(0), w: +br.width.toFixed(0), h: +br.height.toFixed(0) },
      panelRect: (() => { const b = document.querySelector('.team-panel').getBoundingClientRect(); return { x: +b.x.toFixed(0), y: +b.y.toFixed(0), w: +b.width.toFixed(0), h: +b.height.toFixed(0) }; })(),
      text: raw, vw: innerWidth, vh: innerHeight,
    };
  `);
}
async function scrollWheelMeasure(maxSteps = 10, deltaY = 300) {
  const before = await js(`const b=document.getElementById('team-body'); return {top:b.scrollTop, sh:b.scrollHeight, ch:b.clientHeight};`);
  const tops = [];
  let reached = false;
  for (let i = 0; i < maxSteps && !reached; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 195, y: 520, deltaX: 0, deltaY });
    await sleep(200);
    const s = await js(`const b=document.getElementById('team-body'); return b.scrollTop;`);
    tops.push(s);
    if (s >= before.sh - before.ch - 2) reached = true;
  }
  return { steps: tops.length, tops, deltaY, overflow: before.sh - before.ch, reachedBottom: reached };
}
async function toastSnap() {
  return js(`
    const t = document.getElementById('dom-toast');
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return { text: t.textContent, opacity: cs.opacity, visible: parseFloat(cs.opacity) > 0.5, rect: { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) }, zIndex: cs.zIndex };
  `);
}
async function canvasSig() {
  try {
    return await js(`
      const c = document.getElementById('stage'); const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data; const total = c.width * c.height;
      const step = Math.max(1, Math.floor(total / 5000)); let sum = 0, bright = 0;
      for (let i = 0; i < total; i += step) { const o = i * 4; sum = (sum * 31 + d[o] + d[o+1] * 3 + d[o+2] * 7 + d[o+3]) >>> 0; if (d[o] + d[o+1] + d[o+2] > 60) bright++; }
      return { sum, bright, w: c.width, h: c.height };
    `);
  } catch (e) { return { err: String(e).slice(0, 120) }; }
}
async function reloadAndBoot(url, needHook = true) {
  await send("Page.navigate", { url });
  const cond = needHook ? `document.readyState === 'complete' && !!window.__MOYU__` : `document.readyState === 'complete' && !!document.getElementById('hud-moyu')`;
  const boot = await waitFor(cond, 25000);
  await sleep(1300);
  return boot;
}
async function openTeamThen(deco) {
  const t0 = Date.now();
  const team = await tapSel("#btn-team");
  await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2000);
  await sleep(250);
  const afterOpen = await hudSnap();
  let decoTap = null;
  if (deco) {
    decoTap = await tapSel("#tab-decor");
    await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2000);
    await sleep(300);
  }
  return { taps: deco ? 2 : 1, ms: Date.now() - t0, team: team.ok, decoTap, afterOpen };
}

async function main() {
  /* ---------------- DEV 主流程 ---------------- */
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    send = c.send; ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });

    /* ===== OPEN 1：首日新档（重点 ① 角标 / ③ 摸鱼卡 / ② 一键全用） ===== */
    try {
      const o = R.open1;
      o.boot = await reloadAndBoot(DEV);
      o.hudBefore = await hudSnap();     // ① 打开面板前能看到「精力」角标吗
      await shot("o1-01-home-badge");
      o.before = await stateSnap();
      // 进工位
      o.goto = await openTeamThen(true);
      o.decor0 = await decorMetrics();
      await shot("o1-02-decor-top");
      o.scroll = await scrollWheelMeasure();
      await js(`document.getElementById('team-body').scrollTop = 0; return true;`);
      await sleep(150);
      // ③ 开面板等摸鱼卡：应该不再覆盖
      const cardWait = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 16000);
      o.cardsWhilePanel = {
        covered: cardWait.ok, waitedMs: cardWait.ms,
        stack: await js(`
          const team = !document.getElementById('team').classList.contains('hidden');
          const buy = document.querySelector('#team-body .talent button');
          const r = buy ? buy.getBoundingClientRect() : null;
          const hit = r ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;
          return { teamStillOpen: team, cardsZ: getComputedStyle(document.getElementById('cards')).zIndex, teamZ: getComputedStyle(document.getElementById('team')).zIndex, hitAtBuyBtn: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null };
        `),
      };
      await shot("o1-03-cards-check");
      // 关面板 → 卡应该这时才弹（确认卡功能没被弄坏）
      await tapSel("#team-close");
      const cardAfterClose = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 6000);
      o.cardsAfterClose = { appeared: cardAfterClose.ok, ms: cardAfterClose.ms, shotNeeded: true };
      await sleep(200);
      await shot("o1-04-cards-after-close");
      if (cardAfterClose.ok) {
        await tapSel("#cards-skip");
        await waitFor(`document.getElementById('cards').classList.contains('hidden')`, 1500);
      }
      o.cardsAfterClose.skipped = cardAfterClose.ok;
      // 重新进工位 → ② 一键全用
      o.reopen = await openTeamThen(true);
      o.decorBeforeAll = await decorMetrics();
      o.oneClick = {
        btn: await js(`
          const b = document.querySelector('#team-body button[data-act="energy-all"]');
          if (!b) return null;
          const r = b.getBoundingClientRect();
          const br = document.getElementById('team-body').getBoundingClientRect();
          return { text: b.textContent.trim(), disabled: b.disabled, w: +r.width.toFixed(0), h: +r.height.toFixed(0), topInBody: +(r.top - br.top).toFixed(0), inBodyViewport: r.top >= br.top && r.bottom <= br.bottom };
        `),
      };
      const eBefore = (await stateSnap()).energy;
      const tapAll = await tapSel(`#team-body button[data-act="energy-all"]`);
      await sleep(300);
      const eAfter = (await stateSnap()).energy;
      o.oneClick.tap = tapAll;
      o.oneClick.energy = { before: { left: eBefore.left, used: eBefore.used }, after: { left: eAfter.left, used: eAfter.used } };
      o.oneClick.toast = await toastSnap();
      o.oneClick.steps = 1; // 一键全用本身 1 步
      o.oneClick.badgeAfter = (await hudSnap()).energyBadge;
      o.decorAfterAll = await decorMetrics();
      await shot("o1-05-oneclick-done");
      // 按钮禁用态：再用一次能不能点（应该 disabled/无按钮）
      o.oneClick.btnAfter = await js(`
        const b = document.querySelector('#team-body button[data-act="energy-all"]');
        return b ? { disabled: b.disabled, text: b.textContent.trim() } : null;
      `);
      await tapSel("#team-close");
      o.totalMs = Date.now() - o.goto.ms;
    } catch (e) { R.open1.err = String((e && e.stack) || e).slice(0, 800); }

    /* ===== OPEN 2：grant 后整行点买家具（④）+ 反馈 + 场景 ===== */
    try {
      const o = R.open2;
      o.boot = await reloadAndBoot(DEV);
      o.hudBefore = await hudSnap();      // 精力已用完 → 角标应消失
      await shot("o2-01-home-no-energy-badge");
      o.canvasBefore = await canvasSig();
      await ev(`__MOYU__.grant(1e11)`);
      await sleep(300);
      o.goto = await openTeamThen(true);
      o.decor1 = await decorMetrics();
      await shot("o2-02-decor-rich");
      // ④ 整行点：点"绿萝"行的文字区（不是按钮）
      const rowPoint = await js(`
        const rows = [...document.querySelectorAll('#team-body .talent')];
        const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '') === '绿萝');
        if (!el) return null;
        const info = el.querySelector('.talent-info').getBoundingClientRect();
        const btn = el.querySelector('button').getBoundingClientRect();
        const hit = document.elementFromPoint(info.left + info.width/2, info.top + info.height/2);
        return { x: info.left + info.width/2, y: info.top + info.height/2, hit: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null, rowH: +el.getBoundingClientRect().height.toFixed(0), btnH: +btn.height.toFixed(0), aria: el.querySelector('button').getAttribute('aria-label') };
      `);
      const decorBeforeRow = (await stateSnap()).decor.length;
      if (rowPoint) await tapPoint(rowPoint.x, rowPoint.y);
      o.rowTapBuy = {
        point: rowPoint,
        decorBefore: decorBeforeRow, decorAfter: (await stateSnap()).decor.length,
        toast: await toastSnap(),
        summary: await js(`return document.querySelector('.team-summary')?.innerText ?? '';`),
      };
      await shot("o2-03-rowtap-buy-toast");
      // 其余 7 件用按钮点（顺便量按钮 44px）
      const buys = [];
      for (let i = 0; i < 9; i++) {
        const before = await stateSnap();
        const tap = await tapSel(`#team-body button[data-act="decor"]:not([disabled])`);
        await sleep(120);
        const after = await stateSnap();
        const changed = after.decor.length !== before.decor.length;
        buys.push({ ok: tap.ok, btnH: tap.rect?.h, bought: changed, decor: after.decor.length });
        if (!tap.ok || !changed) break;
      }
      o.buys = buys;
      o.decorAll = await decorMetrics();
      await shot("o2-04-decor-all-bought");
      await tapSel("#team-close");
      await waitFor(`document.getElementById('team').classList.contains('hidden')`, 1500);
      await sleep(500);
      o.canvasAfter = await canvasSig();
      await shot("o2-05-scene-all-decor");
      o.moyuEnd = (await stateSnap()).moyu;
    } catch (e) { R.open2.err = String((e && e.stack) || e).slice(0, 800); }

    /* ===== OPEN 3：同日再开（死页）→ 模拟次日（角标重现+整行用精力）→ 小屏 ===== */
    try {
      const o = R.open3;
      o.boot = await reloadAndBoot(DEV);
      o.hudSameDay = await hudSnap();      // energy 0 → 无角标
      await shot("o3-01-home-same-day");
      o.goto = await openTeamThen(true);
      o.decorDead = await decorMetrics();
      o.dead = { onCount: o.decorDead.onCount, enabledBtns: o.decorDead.enabledBtns, energy: (await stateSnap()).energy, summary: await js(`return document.querySelector('.team-summary')?.innerText ?? '';`) };
      await shot("o3-02-decor-same-day-dead");
      // 模拟次日
      o.backdate = await js(`
        if (!__MOYU__.rewindSave) return { ok: false };
        __MOYU__.rewindSave(2);
        const raw = localStorage.getItem('moyu-save'); if (!raw) return { ok: false, why: 'no save' };
        const b = JSON.parse(raw);
        if (b.energy) b.energy.date = '2020-01-01';
        b.savedAt = Date.now() - 2000;
        localStorage.setItem('moyu-save', JSON.stringify(b));
        return { ok: true, energyDate: b.energy?.date };
      `);
      o.boot2 = await reloadAndBoot(DEV);
      o.hudNextDay = await hudSnap();      // ① 次日打开面板前：精力角标应出现
      await shot("o3-03-home-nextday-badge");
      o.gotoNext = await openTeamThen(true);
      o.decorNextDay = await decorMetrics();
      // ④ 整行点精力（点行的文字区，验证只触发一次：100 → 60，不是 20）
      const eRow = await js(`
        const rows = [...document.querySelectorAll('#team-body .talent')];
        const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '') === '认真摸鱼');
        if (!el) return null;
        const info = el.querySelector('.talent-info').getBoundingClientRect();
        const hit = document.elementFromPoint(info.left + info.width/2, info.top + info.height/2);
        return { x: info.left + info.width/2, y: info.top + info.height/2, hit: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null, rowH: +el.getBoundingClientRect().height.toFixed(0) };
      `);
      const eBeforeRow = (await stateSnap()).energy;
      if (eRow) await tapPoint(eRow.x, eRow.y);
      const eAfterRow = (await stateSnap()).energy;
      o.rowTapEnergy = {
        point: eRow, before: { left: eBeforeRow.left, used: eBeforeRow.used }, after: { left: eAfterRow.left, used: eAfterRow.used },
        singleTrigger: eBeforeRow.left - eAfterRow.left === 40,
        toast: await toastSnap(),
        badgeWhileOpen: (await hudSnap()).energyBadge,
        allBtnDisabled: await js(`const b=document.querySelector('#team-body button[data-act="energy-all"]'); return b ? b.disabled : null;`),
      };
      await shot("o3-04-rowtap-energy");
      // 小屏布局回归
      await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
      await sleep(450);
      o.small = { metrics: await decorMetrics() };
      await shot("o3-05-small-375x667");
      o.small.scroll = await scrollWheelMeasure(12, 250);
      await shot("o3-06-small-bottom");
    } catch (e) { R.open3.err = String((e && e.stack) || e).slice(0, 800); }

    R.errors = c.errors.slice(0, 15);
    c.close();
  }, { timeoutMs: 240_000, port: 9981 });

  /* ---------------- 线上 dist 验证（无 dev hook）：摸鱼卡是否仍覆盖工位 ---------------- */
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    send = c.send; ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    try {
      const o = R.liveCheck;
      o.boot = await reloadAndBoot(LIVE, false);
      o.hud = await js(`
        const btn = document.getElementById('btn-team');
        const eb = btn.querySelector('.energy-badge');
        return { hudText: document.getElementById('hud').innerText.replace(/\\s+/g,' ').trim(), energyBadge: eb ? eb.textContent : null, aria: btn.getAttribute('aria-label') };
      `);
      await shot("live-01-home");
      // 进面板 → 工位
      await tapSel("#btn-team");
      await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500);
      await sleep(300);
      const decoTap = await tapSel("#tab-decor");
      await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2000);
      await sleep(400);
      o.decor = await js(`
        const body = document.getElementById('team-body');
        const raw = body.innerText || '';
        return { activeTab: document.querySelector('.team-tabs .tab.active')?.textContent, hasOneClick: !!document.querySelector('#team-body button[data-act="energy-all"]'), oneClickText: document.querySelector('#team-body button[data-act="energy-all"]')?.textContent?.trim() ?? null, rowTapCount: body.querySelectorAll('.row-tap').length, minBtnH: Math.min(...[...body.querySelectorAll('button')].map(b=>b.getBoundingClientRect().height)), hasFurnitureTitle: raw.includes('工位家具'), text: raw.slice(0, 260) };
      `);
      await shot("live-02-decor");
      // ④ 线上同样等摸鱼卡（12s 门控；无 click 需等 sessionStorage boot）
      const cardWait = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 18000);
      o.cardsWhilePanel = {
        covered: cardWait.ok, waitedMs: cardWait.ms,
        stack: await js(`
          const team = !document.getElementById('team').classList.contains('hidden');
          const buy = document.querySelector('#team-body .talent button');
          const r = buy ? buy.getBoundingClientRect() : null;
          const hit = r ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;
          return { teamStillOpen: team, cardsZ: getComputedStyle(document.getElementById('cards')).zIndex, teamZ: getComputedStyle(document.getElementById('team')).zIndex, hitAtBuyBtn: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null };
        `),
      };
      await shot("live-03-cards-check");
    } catch (e) { R.liveCheck.err = String((e && e.stack) || e).slice(0, 800); }
    c.close();
  }, { timeoutMs: 120_000, port: 9982 });

  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(R, null, 2));
  const pick = {
    o1: {
      hudBefore: R.open1.hudBefore,
      goto: { taps: R.open1.goto?.taps, ms: R.open1.goto?.ms },
      decor0: R.open1.decor0 && { rows: R.open1.decor0.rowCount, visible: R.open1.decor0.visibleRows, fully: R.open1.decor0.fullyVisibleRows, overflow: R.open1.decor0.scroll?.overflow, chars: R.open1.decor0.chars, minBtnH: R.open1.decor0.minBtnH, minRowH: R.open1.decor0.minRowH, headings: R.open1.decor0.headings, tabs: R.open1.decor0.tabs },
      scroll: R.open1.scroll,
      cardsWhilePanel: R.open1.cardsWhilePanel,
      cardsAfterClose: R.open1.cardsAfterClose,
      oneClick: R.open1.oneClick,
      decorAfterAll: R.open1.decorAfterAll && { rows: R.open1.decorAfterAll.rowCount, on: R.open1.decorAfterAll.onCount, enabled: R.open1.decorAfterAll.enabledBtns, overflow: R.open1.decorAfterAll.scroll?.overflow, text: R.open1.decorAfterAll.text?.slice(0,200) },
    },
    o2: {
      hudBefore: R.open2.hudBefore && { energyBadge: R.open2.hudBefore.energyBadge, aria: R.open2.hudBefore.btnAriaLabel },
      rowTapBuy: R.open2.rowTapBuy,
      buys: R.open2.buys,
      decorAll: R.open2.decorAll && { on: R.open2.decorAll.onCount, enabled: R.open2.decorAll.enabledBtns, overflow: R.open2.decorAll.scroll?.overflow, minBtnH: R.open2.decorAll.minBtnH, headings: R.open2.decorAll.headings },
      canvasChanged: R.open2.canvasBefore?.sum !== R.open2.canvasAfter?.sum,
    },
    o3: {
      hudSameDay: R.open3.hudSameDay && { energyBadge: R.open3.hudSameDay.energyBadge, badges: { task: R.open3.hudSameDay.taskBadge, energy: R.open3.hudSameDay.energyBadge, talent: R.open3.hudSameDay.talentBadge } },
      dead: R.open3.dead,
      hudNextDay: R.open3.hudNextDay,
      rowTapEnergy: R.open3.rowTapEnergy,
      small: R.open3.small && { rows: R.open3.small.metrics?.rowCount, visible: R.open3.small.metrics?.visibleRows, fully: R.open3.small.metrics?.fullyVisibleRows, overflow: R.open3.small.metrics?.scroll?.overflow, minBtnH: R.open3.small.metrics?.minBtnH, scrollSteps: R.open3.small.scroll?.steps },
    },
    liveCheck: R.liveCheck,
    errors: R.errors,
  };
  for (const k of ["open1", "open2", "open3", "liveCheck"]) if (R[k].err) console.log(k, "ERR", R[k].err.slice(0, 300));
  console.log(JSON.stringify(pick, null, 2));
}

await main();