// r14 碎片党最终复验（线上 HEAD 6be96e2）
// ① 工位页 15 秒不被摸鱼卡覆盖（关面板后卡应正常弹） ② 精力角标"还有可用项才显示" ③ 省心组合 1 步（重点排查可用条件） ④ 8/8 庆祝 + 挂机 +10%
// 全部线上 + 全新无痕 profile；④ 用 localStorage 种子存档（不依赖 dev 钩子）。
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(".scratch/r14-frag-final");
mkdirSync(OUT, { recursive: true });
const LIVE = "https://luojindui.github.io/moyu/";
const R = { meta: { at: new Date().toISOString(), head: "6be96e2", url: LIVE }, A: {}, B: {}, C: {} };
let send, ev;
const js = (code) => ev(`(()=>{${code}})()`);
async function waitFor(expr, timeoutMs = 20000) {
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
  const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const b=e.getBoundingClientRect();if(b.width<1||b.height<1)return {bad:true};const cx=b.left+b.width/2,cy=b.top+b.height/2;const h=document.elementFromPoint(cx,cy);return {x:cx,y:cy,w:+b.width.toFixed(1),h:+b.height.toFixed(1),text:(e.textContent||'').trim().slice(0,60),hit:h?(h.id||(typeof h.className==='string'?h.className:'')||h.tagName):null,hitSelf:!!h&&(h===e||e.contains(h)),disabled:e.disabled===true};})()`);
  if (!r || r.bad) return { ok: false, rect: r };
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(180);
  return { ok: true, rect: r };
}
async function tapPoint(x, y) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sleep(35);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(220);
}
const hudSnap = () => js(`
  const btn = document.getElementById('btn-team');
  const eb = btn.querySelector('.energy-badge');
  const tb = btn.querySelector('.talent-badge');
  const r = eb ? eb.getBoundingClientRect() : null;
  return {
    energyBadge: eb ? eb.textContent : null,
    badgeRect: r ? { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) } : null,
    aria: btn.getAttribute('aria-label'),
    talentBadge: tb ? tb.textContent : null,
    hudIdle: document.getElementById('hud-idle')?.textContent ?? null,
    hudMoyu: document.getElementById('hud-moyu')?.textContent ?? null,
    overlays: {
      cards: !document.getElementById('cards').classList.contains('hidden'),
      team: !document.getElementById('team').classList.contains('hidden'),
      welcome: !document.getElementById('welcome').classList.contains('hidden'),
      journal: !document.getElementById('journal').classList.contains('hidden'),
      boss: !document.getElementById('boss-choice').classList.contains('hidden'),
    },
  };
`);
async function decorSnap() {
  return js(`
    const body = document.getElementById('team-body');
    if (!body) return null;
    const raw = body.innerText || '';
    const rows = [...body.querySelectorAll('.talent')].map((el) => {
      const b = el.querySelector('button');
      return {
        name: (el.querySelector('.talent-name')?.textContent ?? '').trim(),
        desc: (el.querySelector('.talent-desc')?.textContent ?? '').trim(),
        dot: (el.querySelector('.talent-dot')?.textContent ?? '').trim(),
        on: el.classList.contains('on'), dataDisabled: el.dataset.disabled,
        btn: b ? { text: b.textContent.trim(), disabled: b.disabled, h: +b.getBoundingClientRect().height.toFixed(0), aria: b.getAttribute('aria-label') } : null,
        h: +el.getBoundingClientRect().height.toFixed(0),
      };
    });
    const combo = document.querySelector('#team-body button[data-act="energy-all"]');
    const cr = combo ? combo.getBoundingClientRect() : null;
    return {
      activeTab: document.querySelector('.team-tabs .tab.active')?.textContent,
      energyLine: (raw.match(/今日精力[^\\n]*/) ?? [null])[0],
      summary: document.querySelector('.team-summary')?.innerText ?? '',
      rows, onCount: rows.filter((r) => r.on).length,
      combo: combo ? { text: combo.textContent.trim(), disabled: combo.disabled, h: +cr.height.toFixed(0), w: +cr.width.toFixed(0), top: +(cr.top - body.getBoundingClientRect().top).toFixed(0) } : null,
      footer: (raw.match(/每天 100 点[^\\n]*/) ?? [null])[0],
      text: raw,
    };
  `);
}
async function toastSnap() {
  return js(`
    const t = document.getElementById('dom-toast');
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return { text: t.textContent, visible: parseFloat(cs.opacity) > 0.5, rect: { x: +r.x.toFixed(0), y: +r.y.toFixed(0), w: +r.width.toFixed(0), h: +r.height.toFixed(0) } };
  `);
}
async function boot() {
  const t0 = Date.now();
  await send("Page.navigate", { url: LIVE });
  const b = await waitFor(`document.readyState === 'complete' && !!document.getElementById('hud-moyu')`, 25000);
  await sleep(800);
  return { boot: b, ms: Date.now() - t0 };
}
async function openDeco() {
  const t0 = Date.now();
  await tapSel("#btn-team");
  await waitFor(`!document.getElementById('team').classList.contains('hidden')`, 2500);
  await sleep(200);
  const t = await tapSel("#tab-decor");
  await waitFor(`document.querySelector('.team-tabs .tab.active')?.textContent === '工位'`, 2500);
  await sleep(350);
  return { taps: 2, ms: Date.now() - t0, decoTapOk: t.ok, decoTapRect: t.rect };
}
async function bootChrome(port, fn) {
  await runChrome(async ({ port: p }) => {
    const c = await connect(p);
    send = c.send; ev = c.ev;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
    try { await fn(c); } catch (e) { R.__err = String((e && e.stack) || e).slice(0, 600); }
    c.close();
  }, { timeoutMs: 180_000, port });
}

/* ===== RUN A：① 摸鱼卡门控 + ③ 省心组合可用性（同时拿到 ② 基础角标与 4 项列表） ===== */
await bootChrome(9986, async () => {
  const o = R.A;
  o.boot = await boot();
  o.home = await hudSnap();                       // ② 打开前面板：角标应显示「精力 100」
  await shot("A-01-home");
  o.goto = await openDeco();
  o.enter = await decorSnap();                    // 4 项精力 + 省心组合初始态（disabled?）
  await shot("A-02-decor");
  // ① 面板开着 15 秒：摸鱼卡不应出现
  const cardWhileOpen = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 15000);
  o.cardsWhileOpen = { appeared: cardWhileOpen.ok, waitedMs: cardWhileOpen.ms };
  o.panelStillOpen = (await hudSnap()).overlays.team;
  await shot("A-03-after-15s");
  // 关面板：卡应此时才弹（确认功能没被弄坏）
  await tapSel("#team-close");
  await waitFor(`document.getElementById('team').classList.contains('hidden')`, 2500);
  const cardAfterClose = await waitFor(`!document.getElementById('cards').classList.contains('hidden')`, 6000);
  o.cardsAfterClose = { appeared: cardAfterClose.ok, ms: cardAfterClose.ms };
  await shot("A-04-cards-after-close");
  if (cardAfterClose.ok) await tapSel("#cards-skip");
  // 重新进工位：③ 省心组合按钮（满精力 100 时）是否可用 / 1 步能否完成
  o.reopen = await openDeco();
  o.beforeCombo = await decorSnap();
  const comboPre = await js(`
    const b = document.querySelector('#team-body button[data-act="energy-all"]');
    return b ? { disabled: b.disabled, text: b.textContent.trim(), ariaDisabled: b.getAttribute('aria-disabled') } : null;
  `);
  const tapCombo = await tapSel(`#team-body button[data-act="energy-all"]`);
  await sleep(400);
  o.combo = {
    pre: comboPre,
    tap: tapCombo,
    after: await decorSnap(),
    toast: await toastSnap(),
    badge: (await hudSnap()).energyBadge,
    energyLeftAfter: (await decorSnap()).energyLine,
  };
  await shot("A-05-combo-tap");
  // 若省心组合没生效（预期发现 bug），改用整行逐个点，验证"放弃 1 项"路径仍可完成
  const left0 = (await decorSnap()).energyLine;
  if (/剩 100\/100/.test(left0 ?? "")) {
    for (const name of ["跟同事聊天", "假装工作", "认真摸鱼"]) {
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
  }
  o.byRows = { after: await decorSnap(), badge: (await hudSnap()).energyBadge };
  await shot("A-06-by-rows-done");
});

/* ===== RUN B：② 角标边界——还剩精力但没有任何一项买得起时应隐藏 ===== */
await bootChrome(9987, async () => {
  const o = R.B;
  o.boot = await boot();
  o.home = await hudSnap();
  o.goto = await openDeco();
  o.enter = await decorSnap();
  // 用 认真摸鱼 40 → 剩 60，可买：假装工作 35 / 跟同事聊天 25 → 角标应显示
  await tapPoint(...(await js(`
    const rows = [...document.querySelectorAll('#team-body .talent')];
    const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '') === '认真摸鱼');
    const info = el.querySelector('.talent-info').getBoundingClientRect();
    return [info.left + info.width/2, info.top + info.height/2];
  `)));
  await sleep(250);
  o.afterSlack = { energyLine: (await decorSnap()).energyLine, badge: (await hudSnap()).energyBadge, badgeAria: (await hudSnap()).aria };
  // 再用 专注点击 45 → 剩 15；最便宜 25 > 15 → 角标应消失（"还有任意一项可负担"才显示）
  await tapPoint(...(await js(`
    const rows = [...document.querySelectorAll('#team-body .talent')];
    const el = rows.find((r) => (r.querySelector('.talent-name')?.textContent ?? '') === '专注点击');
    const info = el.querySelector('.talent-info').getBoundingClientRect();
    return [info.left + info.width/2, info.top + info.height/2];
  `)));
  await sleep(300);
  o.afterFocus15 = { energyLine: (await decorSnap()).energyLine, badge: (await hudSnap()).energyBadge, badgeAria: (await hudSnap()).aria, comboDisabled: (await decorSnap()).combo?.disabled };
  await shot("B-01-badge-edge-15");
});

/* ===== RUN C：④ 8/8 庆祝 + 挂机 +10%（种子存档） ===== */
await bootChrome(9988, async () => {
  const o = R.C;
  o.boot = await boot();
  // 种子存档：3e9 余额（够买全部 8 件 2.23e9）、家具 0、精力满
  o.seed = await js(`
    const today = new Date().toLocaleDateString('sv-SE');
    const blob = {
      v: 2, moyu: 3000000000, totalEarned: 3000000000, levels: {}, savedAt: Date.now(), createdAt: Date.now() - 86400000,
      collected: { quotes: [], flavors: [] }, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
      visits: { date: '', count: 0 }, lifetimeEarned: 3000000000, prestige: 0, decor: [],
      energy: { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
      team: { colleagues: {} }, talents: { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: '', overflow: 0 },
    };
    localStorage.setItem('moyu-save', JSON.stringify(blob));
    // 阻止 pagehide/定时保存把种子覆盖掉
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'moyu-save') return; return orig.call(this, k, v); };
    return { ok: true, key: 'moyu-save', len: JSON.stringify(blob).length };
  `);
  await boot();                       // 重载读种子
  o.hudAfterSeed = await hudSnap();
  await shot("C-01-seeded-home");
  // 若摸鱼卡已弹，先跳过（新门控：面板未开时会弹）
  if ((await hudSnap()).overlays.cards) {
    await tapSel("#cards-skip");
    await sleep(200);
  }
  o.goto = await openDeco();
  o.before = { snap: await decorSnap(), hud: await hudSnap() };
  // 逐个整行点买 8 件；记录第 7 件后（=7/8）与第 8 件后的挂机值
  o.buys = [];
  for (let i = 0; i < 9; i++) {
    const before = await decorSnap();
    const target = await js(`
      const rows = [...document.querySelectorAll('#team-body .talent')].filter((r) => r.dataset.act === 'decor' && r.dataset.disabled === '0');
      if (!rows.length) return null;
      const el = rows[0];
      const info = el.querySelector('.talent-info').getBoundingClientRect();
      return { x: info.left + info.width/2, y: info.top + info.height/2, name: el.querySelector('.talent-name')?.textContent?.trim() };
    `);
    if (!target) { o.buys.push({ stop: 'no enabled decor' }); break; }
    const hudBefore = await hudSnap();
    await tapPoint(target.x, target.y);
    await sleep(320);
    const after = await decorSnap();
    const hudAfter = await hudSnap();
    o.buys.push({ name: target.name, summaryBefore: before.summary, summaryAfter: after.summary, idleBefore: hudBefore.hudIdle, idleAfter: hudAfter.hudIdle, toast: await toastSnap() });
    if (i === 6) { o.at7 = { summary: after.summary, hud: hudAfter, toast: await toastSnap() }; }
    if (i === 7) { o.at8 = { summary: after.summary, hud: hudAfter, toast: await toastSnap() }; await shot("C-02-8of8-toast"); }
  }
  o.final = { snap: await decorSnap(), hud: await hudSnap() };
  await shot("C-03-decor-all");
  // 场景截图（关面板）
  await tapSel("#team-close");
  await waitFor(`document.getElementById('team').classList.contains('hidden')`, 2500);
  await sleep(700);
  await shot("C-04-scene-390");
  // 桌面 / 平板：鱼缸是否可见
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  await shot("C-05-scene-desktop-1280x800");
  await send("Emulation.setDeviceMetricsOverride", { width: 768, height: 1024, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  await shot("C-06-scene-tablet-768x1024");
});

writeFileSync(`${OUT}/evidence.json`, JSON.stringify(R, null, 2));
const brief = {
  A: {
    home: R.A.home,
    enter: R.A.enter && { energyLine: R.A.enter.energyLine, combo: R.A.enter.combo, footer: R.A.enter.footer, rows: R.A.enter.rows?.map(r => ({ n: r.name, dot: r.dot, desc: r.desc, on: r.on, btn: r.btn && { d: r.btn.disabled, h: r.btn.h } })) },
    cardsWhileOpen: R.A.cardsWhileOpen,
    panelStillOpen: R.A.panelStillOpen,
    cardsAfterClose: R.A.cardsAfterClose,
    combo: R.A.combo && { pre: R.A.combo.pre, tapOk: R.A.combo.tap?.ok, tapDisabled: R.A.combo.tap?.rect?.disabled, energyLineAfter: R.A.combo.energyLeftAfter, onCountAfter: R.A.combo.after?.onCount, toast: R.A.combo.toast, badge: R.A.combo.badge },
    byRows: R.A.byRows && { energyLine: R.A.byRows.after?.energyLine, onCount: R.A.byRows.after?.onCount, badge: R.A.byRows.badge, focus: R.A.byRows.after?.rows?.find(r => r.name === '专注点击') },
  },
  B: {
    home: R.B.home,
    enter: R.B.enter && { energyLine: R.B.enter.energyLine, badge: R.B.enter.combo },
    afterSlack: R.B.afterSlack,
    afterFocus15: R.B.afterFocus15,
  },
  C: {
    hudAfterSeed: R.C.hudAfterSeed,
    before: R.C.before && { summary: R.C.before.snap?.summary, hudIdle: R.C.before.hud?.hudIdle, energy: R.C.before.snap?.energyLine },
    buys: R.C.buys?.map(b => ({ n: b.name, idleB: b.idleBefore, idleA: b.idleAfter, toast: b.toast?.text })) ,
    at7: R.C.at7 && { summary: R.C.at7.summary, hudIdle: R.C.at7.hud?.hudIdle },
    at8: R.C.at8 && { summary: R.C.at8.summary, hudIdle: R.C.at8.hud?.hudIdle, toast: R.C.at8.toast },
    final: R.C.final && { summary: R.C.final.snap?.summary, hudIdle: R.C.final.hud?.hudIdle, onCount: R.C.final.snap?.onCount },
  },
  err: R.__err,
};
console.log(JSON.stringify(brief, null, 2));