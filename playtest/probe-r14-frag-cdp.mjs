// r14 碎片党试玩探针：工位 tab（第三个内页 tab）+ 每日精力 3 选
// 3 次打开：open1 = 首日首次（无钱，看信息密度/决策负担/弹窗打断）
//          open2 = 同日稍后 + dev grant 1e11（买 8 件家具 + 反馈 + 场景可见性 + 重绘滚动）
//          open3 = 同日再开（死页）+ 模拟次日（精力重置）+ 小屏 375x667
// 用 playtest/lib/chrome.mjs，保证 Chrome 必被杀掉。
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(".scratch/r14-frag");
mkdirSync(OUT, { recursive: true });
const URL = "http://127.0.0.1:5173/";
const R = { meta: { startedAt: new Date().toISOString(), url: URL, viewport: "390x844@2x" }, open1: {}, open2: {}, open3: {}, errors: [] };

let send;
let ev;

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
  return `${OUT}/${name}.png`;
}
async function tapSel(sel) {
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {bad:true};const cx=b.left+b.width/2,cy=b.top+b.height/2;const h=document.elementFromPoint(cx,cy);return {x:cx,y:cy,w:+b.width.toFixed(1),h:+b.height.toFixed(1),text:(e.textContent||'').trim().slice(0,40),hit:h?(h.id||(typeof h.className==='string'?h.className:'')||h.tagName):null,hitSelf:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true};})()`);
  if (!r || r.bad) return { ok: false, rect: r };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(150);
  return { ok: true, rect: r };
}
const stateSnap = () => js(`
  const s = __MOYU__.state;
  return {
    moyu: s.moyu, decor: s.decor, energy: s.energy,
    talentsPoints: s.talents?.points, teamIds: Object.keys(s.team?.colleagues ?? {}),
    totalClicks: s.totalClicks, lifetimeEarned: s.lifetimeEarned,
    cardsDate: s.cards?.chosenDate ?? null, cardsDismissed: s.cards?.dismissed ?? null,
  };
`);
async function homeSnap() {
  return js(`
    const v = (id) => !document.getElementById(id).classList.contains('hidden');
    return {
      welcome: v('welcome'), cards: v('cards'), boss: v('boss-choice'), team: v('team'),
      hud: document.getElementById('hud').innerText.replace(/\\s+/g,' ').trim(),
      teamBadge: document.querySelector('#btn-team .badge')?.textContent ?? null,
      talentBadge: document.querySelector('#btn-team .talent-badge')?.textContent ?? null,
      bodyHasGongwei: document.body.innerText.includes('工位'),
      bodyHasJingli: document.body.innerText.includes('精力'),
    };
  `);
}
async function panelTopSnap() {
  return js(`
    return {
      teamVisible: !document.getElementById('team').classList.contains('hidden'),
      activeTab: document.querySelector('.team-tabs .tab.active')?.textContent ?? null,
      tabs: [...document.querySelectorAll('.team-tabs .tab')].map(b => {
        const r = b.getBoundingClientRect();
        return { text: b.textContent, w: +r.width.toFixed(0), h: +r.height.toFixed(0), badge: !!b.querySelector('.badge') };
      }),
      points: document.getElementById('team-points')?.textContent ?? null,
    };
  `);
}
/** 工位页全量度量：行/可见性/滚动/字数/数字负担/按钮尺寸 */
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
        top: +(r.top - br.top).toFixed(0), h: +r.height.toFixed(0),
        visible: r.top < br.bottom && r.bottom > br.top,
        fully: r.top >= br.top - 1 && r.bottom <= br.bottom + 1,
        on: el.classList.contains('on'),
        btn: bb ? { w: +bb.width.toFixed(0), h: +bb.height.toFixed(0), disabled: b.disabled, text: (b.textContent ?? '').trim() } : null,
      };
    });
    const btns = [...body.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { act: b.dataset.act, id: b.dataset.id ?? '', text: (b.textContent ?? '').trim(), w: +r.width.toFixed(0), h: +r.height.toFixed(0), disabled: b.disabled };
    });
    const raw = body.innerText || '';
    const noWs = raw.replace(/\\s+/g, '');
    return {
      rows, btns, rowCount: rows.length,
      names: rows.map((r) => r.name),
      onCount: rows.filter((r) => r.on).length,
      enabledBtns: btns.filter((b) => !b.disabled).length,
      visibleRows: rows.filter((r) => r.visible).length,
      fullyVisibleRows: rows.filter((r) => r.fully).length,
      scroll: { top: body.scrollTop, sh: body.scrollHeight, ch: body.clientHeight, overflow: body.scrollHeight - body.clientHeight },
      chars: noWs.length,
      numTokens: (raw.match(/\\d+(?:\\.\\d+)?/g) || []).length,
      pctTokens: (raw.match(/[+×][0-9.]+%?/g) || []).length,
      minBtnH: Math.min(...btns.map((b) => b.h)),
      minBtnW: Math.min(...btns.map((b) => b.w)),
      bodyRect: { x: +br.x.toFixed(0), y: +br.y.toFixed(0), w: +br.width.toFixed(0), h: +br.height.toFixed(0) },
      panelRect: (() => { const b = document.querySelector('.team-panel').getBoundingClientRect(); return { x: +b.x.toFixed(0), y: +b.y.toFixed(0), w: +b.width.toFixed(0), h: +b.height.toFixed(0) }; })(),
      hudCoveredBy: (() => { const h = document.elementFromPoint(innerWidth / 2, 40); return h ? ((h.id || '') + ' ' + (typeof h.className === 'string' ? h.className : '')).trim().slice(0, 40) : null; })(),
      overlayBg: getComputedStyle(document.getElementById('team')).backgroundColor,
      text: raw,
      vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio,
    };
  `);
}
/** 滚轮模拟拇指滑动，300px 一步，统计到底需要几次 */
async function scrollWheelMeasure(maxSteps = 12, deltaY = 300) {
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
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      text: t.textContent, class: t.className, opacity: cs.opacity, zIndex: cs.zIndex,
      rect: { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) },
      visible: parseFloat(cs.opacity) > 0.5,
      coveredBy: hit ? ((hit.id || '') + ' ' + (typeof hit.className === 'string' ? hit.className : '')).trim().slice(0, 40) : null,
    };
  `);
}
async function canvasSig() {
  try {
    return await js(`
      const c = document.getElementById('stage');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      const total = c.width * c.height;
      const step = Math.max(1, Math.floor(total / 5000));
      let sum = 0, bright = 0;
      for (let i = 0; i < total; i += step) {
        const o = i * 4;
        sum = (sum * 31 + d[o] + d[o + 1] * 3 + d[o + 2] * 7 + d[o + 3]) >>> 0;
        if (d[o] + d[o + 1] + d[o + 2] > 60) bright++;
      }
      return { sum, bright, w: c.width, h: c.height };
    `);
  } catch (e) {
    return { err: String(e).slice(0, 120) };
  }
}
/** 打开板并切到工位：记录步数与耗时 */
async function gotoDecoTab() {
  const t0 = Date.now();
  const team = await tapSel("#btn-team");
  const opened = await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2000);
  const afterTeam = await panelTopSnap();
  const deco = await tapSel("#tab-decor");
  const active = await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2000);
  await sleep(250);
  return {
    taps: 2,
    tapTeam: team, tapDeco: deco,
    opened, afterTeam, decoActive: active,
    ms: Date.now() - t0,
    tabState: await panelTopSnap(),
  };
}
async function reloadAndBoot(label) {
  await send("Page.navigate", { url: URL });
  const boot = await waitFor(`document.readyState === 'complete' && !!window.__MOYU__`, 20000);
  await sleep(1300);
  return boot;
}

async function main() {
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    send = c.send;
    ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    R.meta.chrome = { port };
    const tAll = Date.now();

    /* ================= OPEN 1：首日首次打开（新档，无钱） ================= */
    try {
      const o = R.open1;
      o.boot = await reloadAndBoot();
      o.home = await homeSnap();
      await shot("o1-01-home");
      o.before = await stateSnap();

      // 打开 👥 面板（默认落在同事页），先记录默认页的信息量
      const tPanel = Date.now();
      await tapSel("#btn-team");
      await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2000);
      await sleep(300);
      o.panelOpenedMs = Date.now() - tPanel;
      o.defaultTab = await panelTopSnap();
      o.defaultTabMetrics = await js(`
        const body = document.getElementById('team-body');
        const raw = body.innerText || '';
        return { chars: raw.replace(/\\s+/g,'').length, rows: body.querySelectorAll('.mate').length, text: raw.slice(0, 500) };
      `);
      await shot("o1-02-team-default-colleagues");

      // 切到工位
      const tDeco = Date.now();
      await tapSel("#tab-decor");
      await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2000);
      await sleep(300);
      o.toDecorTab = { taps: 2, ms: Date.now() - tDeco, tabState: await panelTopSnap() };
      o.decor0 = await decorMetrics();
      await shot("o1-03-decor-top");
      o.scrollToBottom = await scrollWheelMeasure();
      await shot("o1-04-decor-bottom");
      // 回顶
      await js(`document.getElementById('team-body').scrollTop = 0; return true;`);
      await sleep(150);

      // 首日事件卡打断：等它自己弹（首日 12s 门控）
      const cardWait = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 17000);
      o.cardsInterrupt = { appeared: cardWait.ok, afterMs: cardWait.ms };
      if (cardWait.ok) {
        o.cardsInterrupt.stack = await js(`
          const b = document.querySelector('#team-body .talent button');
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
          const team = !document.getElementById('team').classList.contains('hidden');
          const cardsZ = getComputedStyle(document.getElementById('cards')).zIndex;
          const teamZ = getComputedStyle(document.getElementById('team')).zIndex;
          return { teamStillOpen: team, cardsZ, teamZ, pointAboveBuyBtn: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null };
        `);
        await shot("o1-05-cards-over-decor");
        o.cardsInterrupt.skipTap = await tapSel("#cards-skip");
        const hidden = await waitFor(`document.getElementById('cards').classList.contains('hidden')`, 1500);
        o.cardsInterrupt.skipped = hidden.ok;
        await sleep(300);
        o.cardsInterrupt.afterSkip = await js(`
          return { decorStillOpen: document.querySelector('.team-tabs .tab.active')?.textContent, scrollTop: document.getElementById('team-body').scrollTop };
        `);
      }

      // 首日：点一个"买不起"的灰按钮，有没有解释/反馈（碎片党容易点空白）
      const tDis = Date.now();
      const disBefore = await stateSnap();
      const disTap = await tapSel(`#team-body button[data-act="decor"][data-id="plant"]`);
      await sleep(300);
      o.disabledBuyTap = {
        tap: disTap,
        ms: Date.now() - tDis,
        toast: await toastSnap(),
        stateChanged: (await stateSnap()).decor.length !== disBefore.decor.length,
        moyuChanged: (await stateSnap()).moyu !== disBefore.moyu,
        rect: disTap.rect,
      };

      // 精力决策：首日 3 条精力是否一次看清 + 使用步数/耗时
      o.energyBefore = (await stateSnap()).energy;
      const tE0 = Date.now();
      o.energyTaps = [];
      for (const id of ["slack", "fake-work", "social"]) {
        const before = (await stateSnap()).energy;
        const tap = await tapSel(`#team-body button[data-act="energy"][data-id="${id}"]`);
        await sleep(200);
        const after = (await stateSnap()).energy;
        o.energyTaps.push({
          id, tapOk: tap.ok, disabledInRect: tap.rect?.disabled,
          toast: await toastSnap(),
          energy: { left: after.left, used: after.used },
          btnGone: await ev(`!document.querySelector('#team-body button[data-act="energy"][data-id="${id}"]')`),
        });
        o.energyTaps[o.energyTaps.length - 1].msSinceTab = Date.now() - tE0;
        await sleep(120);
      }
      o.energyAfter = (await stateSnap()).energy;
      o.energyMath = { budget: 100, costs: [40, 35, 25], sum: 100, leftAfterAll: o.energyAfter.left };
      o.decorAfterEnergy = await decorMetrics();
      await shot("o1-06-energy-all-used");
      // 首日：钱不够时 8 件家具几个可点？
      o.decorButtonsDay1 = (await decorMetrics()).btns.filter((b) => b.act === "decor");
      o.day1EnabledDecor = o.decorButtonsDay1.filter((b) => !b.disabled).length;
      o.day1Moyu = (await stateSnap()).moyu;

      // 关面板，记录首日一次打开总耗时
      await tapSel("#team-close");
      const closed = await waitFor(`document.getElementById('team').classList.contains('hidden')`, 1500);
      o.closed = closed.ok;
      o.openMs = Date.now() - tPanel;
    } catch (e) {
      R.open1.err = String(e && e.stack || e).slice(0, 600);
    }

    /* ================= OPEN 2：同日稍后 + grant（买家具/反馈/场景/重绘） ================= */
    try {
      const o = R.open2;
      o.boot = await reloadAndBoot();
      o.home = await homeSnap();
      await shot("o2-01-home-before");
      o.canvasBefore = await canvasSig();
      await ev(`__MOYU__.grant(1e11)`);
      await sleep(350);
      o.afterGrant = { moyu: (await stateSnap()).moyu };
      o.gotoDeco = await gotoDecoTab();
      o.decor1 = await decorMetrics();
      await shot("o2-02-decor-rich");

      // 第一件家具：反馈取证
      const buy1Before = { summary: await js(`return document.querySelector('.team-summary')?.innerText ?? '';`), rows: (await decorMetrics()).rows };
      const buy1 = await tapSel(`#team-body button[data-act="decor"]:not([disabled])`);
      await sleep(260);
      o.buy1 = {
        tap: buy1,
        toast: await toastSnap(),
        summary: await js(`return document.querySelector('.team-summary')?.innerText ?? '';`),
        firstOn: (await decorMetrics()).rows.find((r) => r.on) ?? null,
        state: (await stateSnap()).decor,
        before: { summary: buy1Before.summary, onCount: 0 },
      };
      await shot("o2-03-buy1-toast");
      // 买完其余
      const buys = [];
      for (let i = 0; i < 9; i++) {
        const before = await stateSnap();
        const tap = await tapSel(`#team-body button[data-act="decor"]:not([disabled])`);
        await sleep(130);
        const after = await stateSnap();
        const changed = after.decor.length !== before.decor.length;
        buys.push({ ok: tap.ok, bought: changed, moyu: after.moyu, decor: after.decor.length });
        if (!tap.ok || !changed) break;
      }
      o.buys = buys;
      o.decorAll = await decorMetrics();
      await shot("o2-04-decor-all-bought");
      // 关面板看场景是否画出来
      await tapSel("#team-close");
      await waitFor(`document.getElementById('team').classList.contains('hidden')`, 1500);
      await sleep(500);
      o.canvasAfter = await canvasSig();
      await shot("o2-05-scene-all-decor");

      // 重开面板：同一次会话内再进工位要几次点击（tab 记忆）
      const tRe = Date.now();
      await tapSel("#btn-team");
      await sleep(350);
      o.reopen = { activeTab: (await panelTopSnap()).activeTab, taps: 1, ms: Date.now() - tRe };

      // 重绘测试：同事任务完成触发 refresh 重绘时，工位页滚动位置会不会跳
      await tapSel("#tab-colleagues");
      await sleep(300);
      const recruit = await tapSel(`#team-body button[data-act="recruit"]:not([disabled])`);
      await sleep(400);
      const dispatch = await tapSel(`#team-body button[data-act="dispatch"]:not([disabled])`);
      await sleep(400);
      o.recruitDispatch = { recruitOk: recruit.ok, dispatchOk: dispatch.ok };
      await tapSel("#tab-decor");
      await sleep(300);
      await js(`const b=document.getElementById('team-body'); b.scrollTop=b.scrollHeight; return b.scrollTop;`);
      await sleep(200);
      o.rerender = { scrollBefore: await js(`return document.getElementById('team-body').scrollTop;`) };
      await ev(`__MOYU__.endMissions()`);
      await sleep(1100);
      o.rerender.scrollAfter = await js(`return document.getElementById('team-body').scrollTop;`);
      o.rerender.flash = await js(`return [...document.querySelectorAll('.team-flash')].map(e => e.textContent);`);
      o.rerender.jumped = o.rerender.scrollAfter !== o.rerender.scrollBefore;
      await shot("o2-06-rerender-while-scrolled");
      await tapSel("#team-close");
      await waitFor(`document.getElementById('team').classList.contains('hidden')`, 1500);
      o.canvasEnd = await canvasSig();
      o.moyuEnd = (await stateSnap()).moyu;
    } catch (e) {
      R.open2.err = String(e && e.stack || e).slice(0, 600);
    }

    /* ================= OPEN 3：同日再开（死页）+ 模拟次日 + 小屏 ================= */
    try {
      const o = R.open3;
      o.boot = await reloadAndBoot();
      o.homeSameDay = await homeSnap();
      await shot("o3-01-home-same-day");
      o.gotoDeco = await gotoDecoTab();
      o.decorDead = await decorMetrics();
      o.deadState = {
        enabledBtns: o.decorDead.enabledBtns,
        onCount: o.decorDead.onCount,
        summary: await js(`return document.querySelector('.team-summary')?.innerText ?? '';`),
        energy: (await stateSnap()).energy,
      };
      await shot("o3-02-decor-same-day-dead");

      // 模拟次日：先 rewindSave 置 suppressSave（否则 pagehide 会把内存状态写回覆盖），再回拨 energy.date
      o.backdate = await js(`
        if (!window.__MOYU__ || !__MOYU__.rewindSave) return { ok: false, why: 'no hook' };
        __MOYU__.rewindSave(2);
        const raw = localStorage.getItem('moyu-save');
        if (!raw) return { ok: false, why: 'no save' };
        const b = JSON.parse(raw);
        const keys = Object.keys(b);
        if (b.energy) b.energy.date = '2020-01-01';
        b.savedAt = Date.now() - 2000;
        localStorage.setItem('moyu-save', JSON.stringify(b));
        return { ok: true, keys, energyDate: b.energy?.date, hasEnergy: !!b.energy, decor: b.decor, savedAt: b.savedAt };
      `);
      o.boot2 = await reloadAndBoot();
      o.homeNextDay = await homeSnap();
      await shot("o3-03-home-next-day");
      const tNext = Date.now();
      o.gotoDecoNextDay = await gotoDecoTab();
      o.decorNextDay = await decorMetrics();
      o.nextDayState = { energy: (await stateSnap()).energy, teamBadge: o.homeNextDay.teamBadge };
      // 整行可点吗？点"认真摸鱼"行的文字区域（不是右侧按钮）
      const rowHit = await js(`
        const rows = [...document.querySelectorAll('#team-body .talent')];
        const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '').includes('认真摸鱼'));
        if (!el) return null;
        const r = el.querySelector('.talent-info').getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: hit ? ((hit.id || '') + ' ' + (typeof hit.className === 'string' ? hit.className : '')).trim() : null };
      `);
      const energyBeforeRowTap = (await stateSnap()).energy;
      if (rowHit) {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rowHit.x, y: rowHit.y, button: "left", clickCount: 1 });
        await sleep(35);
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rowHit.x, y: rowHit.y, button: "left", clickCount: 1 });
        await sleep(250);
      }
      o.rowTap = {
        hit: rowHit?.hit ?? null,
        energyBefore: energyBeforeRowTap.left,
        energyAfter: (await stateSnap()).energy.left,
        toast: await toastSnap(),
        changed: (await stateSnap()).energy.left !== energyBeforeRowTap.left,
      };
      // 次日工位第一件事：用一次精力，测“打开→做完”的步数与耗时
      const energyTap1 = await tapSel(`#team-body button[data-act="energy"]:not([disabled])`);
      await sleep(250);
      o.nextDayFirstAction = { tapOk: energyTap1.ok, msFromPanelOpen: Date.now() - tNext, toast: await toastSnap(), energy: (await stateSnap()).energy };
      await shot("o3-04-next-day-energy-again");

      // 小屏 375x667：一次看得完吗
      await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
      await sleep(400);
      // 面板还开着，重渲染一次
      await js(`return document.querySelector('.team-tabs .tab.active')?.textContent;`);
      await sleep(200);
      o.small = { vp: "375x667", metrics: await decorMetrics() };
      await shot("o3-05-small-375x667");
      o.small.scroll = await scrollWheelMeasure(12, 250);
      o.small.after = await decorMetrics();
      await shot("o3-06-small-375x667-bottom");
    } catch (e) {
      R.open3.err = String(e && e.stack || e).slice(0, 600);
    }

    R.errors = c.errors.slice(0, 15);
    R.meta.ms = Date.now() - tAll;
    c.close();
  }, { timeoutMs: 240_000, port: 9973 });
  writeFileSync(`${OUT}/evidence.json`, JSON.stringify(R, null, 2));
  console.log("done", R.meta.ms, "ms");
  for (const k of ["open1", "open2", "open3"]) {
    if (R[k].err) console.log(k, "ERR", R[k].err.slice(0, 200));
  }
  console.log(JSON.stringify({
    o1: { home: R.open1.home, toDecor: R.open1.toDecorTab, decorRows: R.open1.decor0?.rowCount, visible: R.open1.decor0?.visibleRows, fully: R.open1.decor0?.fullyVisibleRows, overflow: R.open1.decor0?.scroll?.overflow, scrollSteps: R.open1.scrollToBottom?.steps, chars: R.open1.decor0?.chars, nums: R.open1.decor0?.numTokens, minBtnH: R.open1.decor0?.minBtnH, cardsInterrupt: R.open1.cardsInterrupt, energy: R.open1.energyAfter, day1EnabledDecor: R.open1.day1EnabledDecor, day1Moyu: R.open1.day1Moyu, defaultTabChars: R.open1.defaultTabMetrics?.chars, openMs: R.open1.openMs },
    o2: { buy1Toast: R.open2.buy1?.toast, buys: R.open2.buys, decorAll: { on: R.open2.decorAll?.onCount, enabled: R.open2.decorAll?.enabledBtns, summary: R.open2.buy1?.summary }, canvasChanged: R.open2.canvasBefore?.sum !== R.open2.canvasAfter?.sum, reopen: R.open2.reopen, rerender: R.open2.rerender },
    o3: { dead: R.open3.deadState, backdate: R.open3.backdate, nextDayEnergy: R.open3.nextDayState, firstAction: R.open3.nextDayFirstAction, small: { overflow: R.open3.small?.metrics?.scroll?.overflow, scrollSteps: R.open3.small?.scroll?.steps, visible: R.open3.small?.metrics?.visibleRows, rows: R.open3.small?.metrics?.rowCount } },
    errors: R.errors,
  }, null, 2));
}

await main();