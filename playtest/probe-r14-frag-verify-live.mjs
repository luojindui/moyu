// r14 碎片党复验（线上 dist = HEAD 3580947）：① 精力角标 ② 一键全用 1 步 ③ 摸鱼卡是否覆盖工位 ④ 44px/整行可点
// 说明：复验时 dev 工作区有并发未提交改动（energy 4 项/145 点），故以线上已部署版本为准；两段独立 Chrome（各自新存档）。
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(".scratch/r14-frag-verify");
mkdirSync(OUT, { recursive: true });
const LIVE = "https://luojindui.github.io/moyu/";
const R = { meta: { startedAt: new Date().toISOString(), target: "live (HEAD 3580947)", url: LIVE }, runA: {}, runB: {}, errors: [] };

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
  await sleep(170);
  return { ok: true, rect: r };
}
async function tapPoint(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(220);
}
async function hudSnap() {
  return js(`
    const btn = document.getElementById('btn-team');
    const eb = btn.querySelector('.energy-badge');
    const tb = btn.querySelector('.talent-badge');
    const badge = btn.querySelector('.badge');
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) }; };
    return {
      energyBadge: eb ? { text: eb.textContent, rect: rect(eb) } : null,
      taskBadge: badge ? badge.textContent : null,
      talentBadge: tb ? tb.textContent : null,
      aria: btn.getAttribute('aria-label'),
      hudText: document.getElementById('hud').innerText.replace(/\\s+/g, ' ').trim(),
      overlays: { cards: !document.getElementById('cards').classList.contains('hidden'), team: !document.getElementById('team').classList.contains('hidden'), welcome: !document.getElementById('welcome').classList.contains('hidden'), boss: !document.getElementById('boss-choice').classList.contains('hidden') },
    };
  `);
}
const energyText = () => js(`
  const body = document.getElementById('team-body');
  const raw = body.innerText || '';
  const m = raw.match(/今日精力[^\\n]*/);
  const st = document.querySelector('.team-summary')?.innerText ?? '';
  return { energyLine: m ? m[0] : null, summary: st, bodyText: raw };
`);
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
    const tabs = [...document.querySelectorAll('.team-tabs .tab')].map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent, w: +r.width.toFixed(0), h: +r.height.toFixed(0), ariaSelected: b.getAttribute('aria-selected'), role: b.getAttribute('role') }; });
    const oc = document.querySelector('#team-body button[data-act="energy-all"]');
    const ocR = oc ? oc.getBoundingClientRect() : null;
    return {
      rows, btns, rowCount: rows.length, names: rows.map((r) => r.name),
      onCount: rows.filter((r) => r.on).length,
      visibleRows: rows.filter((r) => r.visible).length,
      fullyVisibleRows: rows.filter((r) => r.fully).length,
      scroll: { top: body.scrollTop, sh: body.scrollHeight, ch: body.clientHeight, overflow: body.scrollHeight - body.clientHeight },
      oneClick: oc ? { text: oc.textContent.trim(), disabled: oc.disabled, w: +ocR.width.toFixed(0), h: +ocR.height.toFixed(0), topInBody: +(ocR.top - br.top).toFixed(0) } : null,
      headings: [...body.querySelectorAll('h3')].map((h) => h.innerText.replace(/\\s+/g, ' ').trim()),
      tabs, chars: raw.replace(/\\s+/g, '').length, numTokens: (raw.match(/\\d+(?:\\.\\d+)?/g) || []).length,
      minBtnH: Math.min(...btns.map((b) => b.h)), minRowH: Math.min(...rows.map((r) => r.h)),
      rowTapCount: body.querySelectorAll('.row-tap').length,
      bodyRect: { x: +br.x.toFixed(0), y: +br.y.toFixed(0), w: +br.width.toFixed(0), h: +br.height.toFixed(0) },
      panelRect: (() => { const b = document.querySelector('.team-panel').getBoundingClientRect(); return { x: +b.x.toFixed(0), y: +b.y.toFixed(0), w: +b.width.toFixed(0), h: +b.height.toFixed(0) }; })(),
      text: raw, vw: innerWidth, vh: innerHeight,
    };
  `);
}
async function scrollMeasure(maxSteps = 8, deltaY = 300) {
  const before = await js(`const b=document.getElementById('team-body'); return {top:b.scrollTop, sh:b.scrollHeight, ch:b.clientHeight};`);
  const tops = [];
  let reached = false;
  for (let i = 0; i < maxSteps && !reached; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 195, y: 500, deltaX: 0, deltaY });
    await sleep(200);
    const s = await js(`const b=document.getElementById('team-body'); return b.scrollTop;`);
    tops.push(s);
    if (s >= before.sh - before.ch - 2) reached = true;
  }
  return { steps: tops.length, overflow: before.sh - before.ch, deltaY, reachedBottom: reached };
}
async function toastSnap() {
  return js(`
    const t = document.getElementById('dom-toast');
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return { text: t.textContent, visible: parseFloat(cs.opacity) > 0.5, rect: { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) }, zIndex: cs.zIndex };
  `);
}
async function boot(url) {
  await send("Page.navigate", { url });
  const b = await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
  await sleep(900);
  return b;
}
async function openPanelToDeco() {
  const t0 = Date.now();
  const t1 = await tapSel("#btn-team");
  await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500);
  await sleep(250);
  const middleTab = await js(`return { active: document.querySelector('.team-tabs .tab.active')?.textContent, tabCount: document.querySelectorAll('.team-tabs .tab').length };`);
  const t2 = await tapSel("#tab-decor");
  await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500);
  await sleep(350);
  return { taps: 2, ms: Date.now() - t0, middleTab, decoTapOk: t2.ok, decoTapRect: t2.rect };
}

async function main() {
  /* ========== RUN A：① 角标 → ② 一键全用 → ③ 摸鱼卡覆盖 + 布局 ========== */
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    send = c.send; ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    try {
      const o = R.runA;
      o.boot = await boot(LIVE);
      o.hudBefore = await hudSnap();
      await shot("vA-01-home-badge");
      o.goto = await openPanelToDeco();
      o.decor = await decorMetrics();
      o.energy = await energyText();
      await shot("vA-02-decor-top");
      o.scroll = await scrollMeasure();
      await shot("vA-03-decor-bottom");
      await js(`document.getElementById('team-body').scrollTop = 0; return true;`);
      await sleep(200);
      // ③ 摸鱼卡是否覆盖工位（面板开着等它弹）
      const cardWait = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 20000);
      o.cards = {
        appearedWhilePanelOpen: cardWait.ok, waitedMs: cardWait.ms,
        stack: await js(`
          const team = !document.getElementById('team').classList.contains('hidden');
          const buy = document.querySelector('#team-body .talent button');
          const r = buy ? buy.getBoundingClientRect() : null;
          const hit = r ? document.elementFromPoint(r.left + r.width/2, r.top + r.height/2) : null;
          return { teamStillOpen: team, cardsZ: getComputedStyle(document.getElementById('cards')).zIndex, teamZ: getComputedStyle(document.getElementById('team')).zIndex, hitAtDecorBtn: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null };
        `),
      };
      await shot("vA-04-cards-over-decor");
      if (cardWait.ok) {
        await tapSel("#cards-skip");
        await waitFor(`document.getElementById('cards').classList.contains('hidden')`, 2000);
      }
      o.cards.skipped = true;
      // ② 一键全用：1 步完成
      await sleep(300);
      const eBefore = await js(`return __e = null;`).catch(() => null); // no-op
      o.oneClick = { label: o.decor.oneClick };
      const btnRect = o.decor.oneClick;
      const tapAll = await tapSel(`#team-body button[data-act="energy-all"]`);
      await sleep(400);
      o.oneClick.tap = tapAll;
      o.oneClick.after = await js(`
        const body = document.getElementById('team-body');
        const raw = body.innerText || '';
        const m = raw.match(/今日精力[^\\n]*/);
        const used = [...body.querySelectorAll('.talent.on')].length;
        const btns = [...body.querySelectorAll('button[data-act="energy"]')].map(b => ({ id: b.dataset.id, disabled: b.disabled }));
        const oc = document.querySelector('#team-body button[data-act="energy-all"]');
        return { energyLine: m ? m[0] : null, onCount: used, energyButtons: btns, oneClickAfter: oc ? { disabled: oc.disabled, text: oc.textContent.trim() } : null, text: raw.slice(0, 420) };
      `);
      o.oneClick.toast = await toastSnap();
      o.oneClick.badgeAfter = (await hudSnap()).energyBadge;
      o.oneClick.steps = 3; // 👥 + 工位 + 一键全用
      await shot("vA-05-oneclick-done");
      // 小屏 375x667 回归
      await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 2, mobile: false });
      await sleep(450);
      o.small = { metrics: await decorMetrics() };
      await shot("vA-06-small-375x667");
      o.small.scroll = await scrollMeasure(10, 250);
    } catch (e) { R.runA.err = String((e && e.stack) || e).slice(0, 700); }
    c.close();
  }, { timeoutMs: 150_000, port: 9983 });

  /* ========== RUN B：④ 整行可点 / 44px / 单次触发 / 角标随用随变 ========== */
  await runChrome(async ({ port }) => {
    const c = await connect(port);
    send = c.send; ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    try {
      const o = R.runB;
      o.boot = await boot(LIVE);
      o.hudBefore = await hudSnap();
      o.goto = await openPanelToDeco();
      o.decor = await decorMetrics();
      // 点「认真摸鱼」行文字区（不是按钮）：验证整行可点 + 只触发一次
      const rowPoint = await js(`
        const rows = [...document.querySelectorAll('#team-body .talent')];
        const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '') === '认真摸鱼');
        if (!el) return null;
        const info = el.querySelector('.talent-info').getBoundingClientRect();
        const hit = document.elementFromPoint(info.left + info.width/2, info.top + info.height/2);
        return { x: info.left + info.width/2, y: info.top + info.height/2, hit: hit ? ((hit.id||'')+' '+(typeof hit.className==='string'?hit.className:'')).trim().slice(0,50) : null, rowH: +el.getBoundingClientRect().height.toFixed(0) };
      `);
      const beforeEach = await energyText();
      if (rowPoint) await tapPoint(rowPoint.x, rowPoint.y);
      o.rowTap = {
        point: rowPoint,
        before: beforeEach.energyLine,
        after: (await energyText()).energyLine,
        singleTrigger: /剩 60\/100/.test((await energyText()).energyLine ?? ""),
        toast: await toastSnap(),
        badge: (await hudSnap()).energyBadge,
        oneClickDisabled: await js(`const b=document.querySelector('#team-body button[data-act="energy-all"]'); return b ? b.disabled : null;`),
      };
      await shot("vB-01-rowtap-energy");
      // 再用整行方式点掉剩下两项
      for (const name of ["假装工作", "跟同事聊天"]) {
        const p = await js(`
          const rows = [...document.querySelectorAll('#team-body .talent')];
          const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '') === ${JSON.stringify(name)});
          if (!el) return null;
          const info = el.querySelector('.talent-info').getBoundingClientRect();
          return { x: info.left + info.width/2, y: info.top + info.height/2 };
        `);
        if (p) await tapPoint(p.x, p.y);
        await sleep(150);
      }
      o.allUsed = { energy: await energyText(), badge: (await hudSnap()).energyBadge, onCount: await js(`return document.querySelectorAll('#team-body .talent.on').length;`) };
      await shot("vB-02-all-used-by-rows");
      // 44px / aria 汇总
      o.a11y = await js(`
        const body = document.getElementById('team-body');
        const btns = [...body.querySelectorAll('button')].map(b => ({ act: b.dataset.act, h: +b.getBoundingClientRect().height.toFixed(0), aria: b.getAttribute('aria-label') }));
        const rows = [...body.querySelectorAll('.talent')].map(r => +r.getBoundingClientRect().height.toFixed(0));
        const tabs = [...document.querySelectorAll('.team-tabs .tab')].map(b => ({ t: b.textContent, h: +b.getBoundingClientRect().height.toFixed(0), role: b.getAttribute('role'), sel: b.getAttribute('aria-selected') }));
        const sr = [...body.querySelectorAll('.sr-only')].map(e => e.textContent);
        return { btnHeights: btns.map(b => b.h), minBtnH: Math.min(...btns.map(b => b.h)), rowHeights: rows, minRowH: Math.min(...rows), tabHeights: tabs.map(t => t.h), tabRoles: tabs, decorAriaSample: btns.filter(b => b.act === 'decor').slice(0,2), srOnly: sr, oneClickDisabledAfterUse: document.querySelector('#team-body button[data-act="energy-all"]')?.disabled ?? null };
      `);
    } catch (e) { R.runB.err = String((e && e.stack) || e).slice(0, 700); }
    c.close();
  }, { timeoutMs: 120_000, port: 9984 });

  R.errors = [];
  writeFileSync(`${OUT}/evidence-live.json`, JSON.stringify(R, null, 2));
  const brief = {
    runA: {
      hudBefore: R.runA.hudBefore,
      goto: R.runA.goto && { taps: R.runA.goto.taps, ms: R.runA.goto.ms, middleTab: R.runA.goto.middleTab },
      decor: R.runA.decor && { rows: R.runA.decor.rowCount, names: R.runA.decor.names, visible: R.runA.decor.visibleRows, fully: R.runA.decor.fullyVisibleRows, overflow: R.runA.decor.scroll?.overflow, chars: R.runA.decor.chars, nums: R.runA.decor.numTokens, minBtnH: R.runA.decor.minBtnH, minRowH: R.runA.decor.minRowH, rowTapCount: R.runA.decor.rowTapCount, headings: R.runA.decor.headings, tabs: R.runA.decor.tabs, oneClick: R.runA.decor.oneClick, energyBtns: R.runA.decor.btns?.filter(b => b.act === 'energy') },
      energyLine: R.runA.energy?.energyLine,
      scroll: R.runA.scroll,
      cards: R.runA.cards,
      oneClickAfter: R.runA.oneClick?.after,
      oneClickToast: R.runA.oneClick?.toast,
      badgeAfter: R.runA.oneClick?.badgeAfter,
      small: R.runA.small && { rows: R.runA.small.metrics?.rowCount, visible: R.runA.small.metrics?.visibleRows, fully: R.runA.small.metrics?.fullyVisibleRows, overflow: R.runA.small.metrics?.scroll?.overflow, minBtnH: R.runA.small.metrics?.minBtnH, scrollSteps: R.runA.small.scroll?.steps },
    },
    runB: {
      hudBefore: R.runB.hudBefore,
      rowTap: R.runB.rowTap,
      allUsed: R.runB.allUsed,
      a11y: R.runB.a11y,
    },
    errs: { A: R.runA.err, B: R.runB.err },
  };
  console.log(JSON.stringify(brief, null, 2));
}

await main();