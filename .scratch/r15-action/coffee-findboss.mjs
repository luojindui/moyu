/**
 * R15 操作党探针 2/2：
 *  - C0 按钮/面板/判定区域尺寸（桌面 1280×800 + 移动 390×844）
 *  - C1 接咖啡：整局 30s 精确落点自动接（LCG 复现掉落序列）→ 判定/分数/视觉同步
 *  - C2 接咖啡：时间窗 & 横向窗实测（早按/晚按/偏差）
 *  - C3 接咖啡：不点外卖=漏接，分数变负数 + 无反馈
 *  - C4 接咖啡：掉落元素真实位置/存在时长（视觉同步 P0 证据）
 *  - C5 找老板：错点一轮 → 是否推进/惩罚/反馈；再连对 4 轮
 *  - C6 找老板：机器极速 5 连点 → 分数上限（时间奖励主导）
 *  - C7 找老板：不点等 30s 超时 → 结算 0 分
 *  - C8 每日 3 次锁定
 * 使用 playtest/lib/chrome.mjs
 */
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const OUT = ".scratch/r15-action";
mkdirSync(OUT, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: URL, head: "77019bc", phases: {} };

// ── 与 src/engine/minigames.ts genDrops 完全一致的复现（同一 LCG） ──
const LCG_SEED_1 = 12345;
const LCG_SEED_2 = 777;
const LCG_SEED_3 = 424242;
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function genDrops(duration, rng) {
  const out = [];
  let t = 0.8;
  let id = 0;
  while (t < duration - 0.5) {
    out.push({ id: id++, at: Number(t.toFixed(2)), x: Number((0.12 + rng() * 0.76).toFixed(2)) });
    t += 0.55 + rng() * 0.5;
  }
  return out;
}
const drops1 = genDrops(30, lcg(LCG_SEED_1));
const drops2 = genDrops(30, lcg(LCG_SEED_2));

// C2 测试点选择：避开相邻掉落（时间 0.36s、横向 0.16）以免误接
function pickSamples(drops, requests) {
  const used = new Set();
  const picked = [];
  for (const req of requests) {
    for (const d of drops) {
      if (used.has(d.id)) continue;
      const tapT = d.at + req.offsetMs / 1000;
      const tapX = d.x + (req.dx ?? 0);
      if (tapX < 0.05 || tapX > 0.95) continue;
      let confound = false;
      for (const o of drops) {
        if (o.id === d.id) continue;
        if (Math.abs(o.at - tapT) <= 0.36 && Math.abs(o.x - tapX) <= 0.16) { confound = true; break; }
      }
      if (confound) continue;
      used.add(d.id);
      picked.push({ id: d.id, at: d.at, x: d.x, offsetMs: req.offsetMs, dx: req.dx ?? 0, expected: req.expected, kind: req.kind });
      break;
    }
  }
  return picked;
}
const requests = [
  { offsetMs: -310, expected: true, kind: "early-310" },
  { offsetMs: -200, expected: true, kind: "early-200" },
  { offsetMs: -100, expected: true, kind: "early-100" },
  { offsetMs: -50, expected: true, kind: "early-50" },
  { offsetMs: 5, expected: null, kind: "late-5" },
  { offsetMs: 5, expected: null, kind: "late-5" },
  { offsetMs: 5, expected: null, kind: "late-5" },
  { offsetMs: 20, expected: false, kind: "late-20" },
  { offsetMs: 50, expected: false, kind: "late-50" },
  { offsetMs: 100, expected: false, kind: "late-100" },
  { offsetMs: 200, expected: false, kind: "late-200" },
  { offsetMs: 310, expected: false, kind: "late-310" },
  { offsetMs: 0, dx: 0.12, expected: true, kind: "x+120" },
  { offsetMs: 0, dx: -0.12, expected: true, kind: "x-120" },
  { offsetMs: 0, dx: 0.14, expected: false, kind: "x+140" },
  { offsetMs: 0, dx: -0.14, expected: false, kind: "x-140" },
  { offsetMs: -2, dx: 0, expected: true, kind: "control" },
  { offsetMs: -2, dx: 0, expected: true, kind: "control" },
];
const windowSamples = pickSamples(drops2, requests);
report.coffeeDrops = {
  seed1: { count: drops1.length, first3: drops1.slice(0, 3), intervalStats: (() => { const iv = []; for (let i = 1; i < drops1.length; i++) iv.push(+(drops1[i].at - drops1[i - 1].at).toFixed(2)); iv.sort((a, b) => a - b); return { min: iv[0], p50: iv[Math.floor(iv.length / 2)], max: iv[iv.length - 1] }; })() },
  seed2: { count: drops2.length },
  windowSamples: windowSamples.length,
};

const HARNESS = `(() => {
  if (window.__P) return "already";
  const orig = performance.now.bind(performance);
  const P = { origNow: orig, armed: false, armedAt: null, startAt: null };
  window.__P = P;
  window.__oscCount = 0;
  performance.now = function () { const v = orig(); if (P.armed && P.startAt == null) P.startAt = v; return v; };
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("button[data-game]")) { P.armed = true; P.armedAt = orig(); P.startAt = null; }
  }, true);
  return "ok";
})()`;

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    const evaluate = async (expr) => {
      const r = await b.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const evj = async (expr) => JSON.parse(await evaluate(`JSON.stringify((${expr}))`));
    const shot = async (name) => {
      const r = await b.send("Page.captureScreenshot", { format: "png" });
      const f = `${OUT}/r15-action-${name}.png`;
      writeFileSync(f, Buffer.from(r.data, "base64"));
      return f;
    };
    const waitReady = async () => {
      for (let i = 0; i < 300; i++) { try { if ((await evaluate("!!window.__MOYU__")) === true) return; } catch {} await sleep(100); }
      throw new Error("not ready");
    };
    const waitFor = async (expr, ms = 15000, step = 50) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if ((await evaluate(expr)) === true) return true; await sleep(step); }
      return false;
    };
    const dismiss = async () => {
      await evaluate(`(() => {
        const w = document.getElementById('welcome'); if (w && !w.classList.contains('hidden')) { const b=document.getElementById('welcome-ok'); if(b) b.click(); }
        const c = document.getElementById('cards'); if (c && !c.classList.contains('hidden')) { const b=document.getElementById('cards-skip'); if(b) b.click(); }
        return 1;
      })()`);
      await sleep(250);
    };
    const install = async () => { await evaluate(HARNESS); };
    const reload = async () => { await b.send("Page.reload", {}); await sleep(1300); await waitReady(); await sleep(500); await install(); await dismiss(); };
    const seedArcade = async (played) => {
      const r = await b.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { try {
          const raw = localStorage.getItem('moyu-save');
          const blob = raw ? JSON.parse(raw) : { v: 2 };
          const d = new Date();
          const today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          blob.arcade = { date: today, played: ${played}, best: (blob.arcade && blob.arcade.best) || {} };
          blob.savedAt = Date.now();
          localStorage.setItem('moyu-save', JSON.stringify(blob));
        } catch (e) {} })()`,
      });
      await reload();
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
      await sleep(200);
      return true;
    };
    const openMenu = async () => {
      await evaluate(`(() => {
        const arc = document.getElementById('arcade');
        if (arc.classList.contains('hidden')) document.getElementById('btn-arcade').click();
        const back = document.getElementById('arcade-back'); if (back) back.click();
        return 1;
      })()`);
      await sleep(180);
    };
    const closeArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')){ const c=document.getElementById('arcade-close'); if(c) c.click(); } return 1; })()`);
      await sleep(150);
    };
    const arcadeState = async () => evj(`({ cls: document.getElementById('arcade').className, left: document.getElementById('arcade-left').textContent, title: document.getElementById('arcade-title').textContent, body: document.getElementById('arcade-body').innerText.slice(0,400) })`);
    const btnInfo = async () => evj(`(() => {
      const el = document.getElementById('btn-arcade'); const r = el.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      const top = document.elementFromPoint(cx, cy);
      const cs = getComputedStyle(el);
      return { rect: [r.left, r.top, r.width, r.height], area: r.width*r.height, covered: top && top !== el ? (top.id || top.className || top.tagName) : null, z: cs.zIndex, display: cs.display, vw: innerWidth, vh: innerHeight };
    })()`);

    await b.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        window.__oscCount = 0; window.__errs = [];
        addEventListener('error', e => window.__errs.push(String(e.message)));
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && AC.prototype) {
          const o = AC.prototype.createOscillator;
          AC.prototype.createOscillator = function (...a) { window.__oscCount++; return o.apply(this, a); };
          const bs = AC.prototype.createBufferSource;
          AC.prototype.createBufferSource = function (...a) { window.__oscCount++; return bs.apply(this, a); };
        }
      })();`,
    });

    try {
      // ───────── C0：桌面 1280×800 入口/菜单尺寸 ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await b.send("Page.navigate", { url: URL });
      await waitReady(); await sleep(800); await install(); await dismiss();
      const dMainShot = await shot("layout-01-desktop-main");
      const dBtn = await btnInfo();
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(250);
      const dMenu = await evj(`(() => {
        const p = document.querySelector('.arcade-panel').getBoundingClientRect();
        return { panel: [p.width, p.height], cards: [...document.querySelectorAll('.arcade-card button')].map(x => { const r=x.getBoundingClientRect(); return { w: r.width, h: r.height, text: x.textContent.trim() }; }) };
      })()`);
      const dMenuShot = await shot("layout-02-desktop-menu");
      report.phases.C0desktop = { btn: dBtn, menu: dMenu, shots: [dMainShot, dMenuShot] };
      await closeArcade();

      // ───────── C0b：移动 390×844 入口尺寸 ─────────
      await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
      await reload();
      const mBtn = await btnInfo();
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(250);
      const mMenu = await evj(`(() => {
        const p = document.querySelector('.arcade-panel'); const pr = p.getBoundingClientRect();
        const close = document.getElementById('arcade-close').getBoundingClientRect();
        return { panel: [pr.width, pr.height], panelMargins: [pr.left, innerWidth - pr.right], close: [close.width, close.height],
          cards: [...document.querySelectorAll('.arcade-card button')].map(x => { const r=x.getBoundingClientRect(); return { w: r.width, h: r.height, text: x.textContent.trim() }; }) };
      })()`);
      const mMenuShot = await shot("layout-03-mobile-menu");
      report.phases.C0mobile = { btn: mBtn, menu: mMenu, shot: mMenuShot };
      await closeArcade();

      // ───────── C1：接咖啡 整局 30s 自动精确接（LCG 种子 12345） ─────────
      await openMenu();
      const c1start = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const btn = document.querySelector('button[data-game="coffee"]');
        const origRandom = Math.random;
        let s = ${LCG_SEED_1} >>> 0;
        Math.random = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
        P.armed = false; P.startAt = null;
        window.__oscCount = 0;
        btn.click();
        Math.random = origRandom;
        const startAt = P.startAt;
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const dropsEl = document.getElementById('play-drops');
        window.__dropLog = [];
        const obs = new MutationObserver((muts) => {
          for (const m of muts) {
            for (const n of m.addedNodes) if (n.nodeType === 1) {
              const r = n.getBoundingClientRect();
              window.__dropLog.push({ k: 'add', t: +(orig() - startAt).toFixed(1), top: n.style.top, left: n.style.left, rect: [+r.left.toFixed(1), +r.top.toFixed(1), r.width, r.height], inViewport: r.top < innerHeight && r.bottom > 0 });
            }
            for (const n of m.removedNodes) if (n.nodeType === 1) window.__dropLog.push({ k: 'remove', t: +(orig() - startAt).toFixed(1) });
          }
        });
        obs.observe(dropsEl, { childList: true });
        window.__c1 = { startAt, now: orig(), rect: [rect.left, rect.top, rect.width, rect.height], osc: window.__oscCount };
        return window.__c1;
      })()`);
      // 立刻调度全部落点（必须在第一次落点 0.8s 前）
      const r1schedule = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const startAt = ${c1start.startAt};
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const scoreEl = document.getElementById('play-score');
        const drops = ${JSON.stringify(drops1.map((d) => ({ id: d.id, at: d.at, x: d.x })))};
        const results = [];
        window.__coffeeTaps = results;
        drops.forEach((d) => {
          const target = startAt + d.at * 1000 - 2;
          setTimeout(() => {
            const tBefore = orig(); while (orig() < target) {} const tHit = orig();
            const before = Number(scoreEl.textContent);
            const dropCount = document.querySelectorAll('.drop').length;
            const cx = rect.left + d.x * rect.width, cy = rect.top + rect.height / 2;
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, button: 0 }));
            const after = Number(scoreEl.textContent);
            results.push({ id: d.id, at: d.at, deltaMs: +((tHit - (startAt + d.at * 1000))).toFixed(2), before, after, hit: after > before, dropCount });
            if (results.length === drops.length) window.__coffeeDone = true;
          }, Math.max(0, target - orig() - 10));
        });
        return { scheduled: drops.length, now: orig() - startAt };
      })()`);
      // 掉落元素视觉采样（开局即有元素：首帧创建 at-3s 内的所有掉落）
      let dropSample = null, dropShot = null, dropSampleT = null;
      for (let i = 0; i < 40; i++) {
        const d = await evj(`(() => ({ t: +(window.__P.origNow() - ${c1start.startAt}).toFixed(0), drops: [...document.querySelectorAll('.drop')].map(e => { const r=e.getBoundingClientRect(); const cs=getComputedStyle(e); const pa=document.getElementById('play-area').getBoundingClientRect(); const pp=document.querySelector('.arcade-panel').getBoundingClientRect(); return { top: e.style.top, left: e.style.left, rect: [+r.left.toFixed(1), +r.top.toFixed(1), r.width, r.height], playAreaBottom: +pa.bottom.toFixed(1), panelBottom: +pp.bottom.toFixed(1), opacity: cs.opacity, animation: cs.animationName, inViewport: r.top < innerHeight && r.bottom > 0 }; }) }))()`);
        if (d.drops.length) { dropSample = d.drops; dropSampleT = d.t; dropShot = await shot("coffee-01-drop-visible"); break; }
        await sleep(40);
      }
      // 第一次落点时刻：应无任何咖啡元素 + 截图
      const c1now = await evaluate("window.__P.origNow()");
      const waitMs = (c1start.startAt + drops1[0].at * 1000) - c1now;
      if (waitMs > 0) await sleep(waitMs);
      const atFirstCatch = await evj(`({ t: +(window.__P.origNow() - ${c1start.startAt}).toFixed(0), drops: document.querySelectorAll('.drop').length, score: document.getElementById('play-score').textContent, timer: document.getElementById('play-timer').textContent })`);
      const catchShot = await shot("coffee-02-at-catch-moment");
      const c1done = await waitFor("window.__coffeeDone === true", 40000, 150);
      const coffeeTaps = await evj("window.__coffeeTaps || []");
      await waitFor("!!document.getElementById('arcade-back')", 8000, 100);
      await sleep(250);
      const c1finish = await evj(`({ title: document.getElementById('arcade-title').textContent, body: document.getElementById('arcade-body').innerText, left: document.getElementById('arcade-left').textContent, arcade: window.__MOYU__.state.arcade })`);
      const c1shot = await shot("coffee-03-finish");
      const dropLog = await evj("window.__dropLog || []");
      report.phases.C1 = {
        start: c1start, schedule: r1schedule, done: c1done,
        taps: coffeeTaps.length,
        hits: coffeeTaps.filter((t) => t.hit).length,
        misses: coffeeTaps.filter((t) => !t.hit).length,
        deltaStats: (() => { const d = coffeeTaps.map((t) => t.deltaMs).sort((a, b) => a - b); return d.length ? { min: d[0], p50: d[Math.floor(d.length / 2)], max: d[d.length - 1] } : null; })(),
        tapSamples: coffeeTaps.slice(0, 6),
        finish: c1finish, dropSample, dropSampleT, atFirstCatch,
        dropLogSummary: { total: dropLog.length, sample: dropLog.slice(0, 10), addCount: dropLog.filter((x) => x.k === "add").length, removeCount: dropLog.filter((x) => x.k === "remove").length, tops: [...new Set(dropLog.filter((x) => x.k === "add").map((x) => x.top))], lefts: dropLog.filter((x) => x.k === "add").slice(0, 6).map((x) => x.left) },
        shots: { drop: dropShot, catch: catchShot, finish: c1shot },
      };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ───────── C2：接咖啡 时间窗/横向窗实测（种子 777，用完即关，不消耗次数） ─────────
      await openMenu();
      const c2start = await evj(`(() => {
        const P = window.__P;
        const btn = document.querySelector('button[data-game="coffee"]');
        const origRandom = Math.random;
        let s = ${LCG_SEED_2} >>> 0;
        Math.random = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
        P.armed = false; P.startAt = null;
        btn.click();
        Math.random = origRandom;
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        window.__c2 = { startAt: P.startAt, rect: [r.left, r.top, r.width, r.height] };
        return window.__c2;
      })()`);
      const samples = JSON.parse(JSON.stringify(windowSamples));
      const r2 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const startAt = ${c2start.startAt};
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const scoreEl = document.getElementById('play-score');
        const samples = ${JSON.stringify(samples)};
        const results = [];
        window.__coffeeWindow = results;
        samples.forEach((s) => {
          const target = startAt + s.at * 1000 + s.offsetMs;
          setTimeout(() => {
            while (orig() < target) {}
            const tHit = orig();
            const before = Number(scoreEl.textContent);
            const cx = rect.left + (s.x + s.dx) * rect.width, cy = rect.top + rect.height / 2;
            const dropCount = document.querySelectorAll('.drop').length;
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, button: 0 }));
            const after = Number(scoreEl.textContent);
            results.push({ kind: s.kind, at: s.at, offsetMs: s.offsetMs, dx: s.dx, expected: s.expected, actualMs: +(tHit - (startAt + s.at * 1000)).toFixed(2), before, after, hit: after > before, dropCount });
            if (results.length === samples.length) window.__coffeeWindowDone = true;
          }, Math.max(0, target - orig() - 10));
        });
        return { n: samples.length };
      })()`);
      const c2done = await waitFor("window.__coffeeWindowDone === true", 40000, 150);
      const windowResults = await evj("window.__coffeeWindow || []");
      await closeArcade();
      report.phases.C2 = { start: c2start, schedule: r2, done: c2done, samples: windowSamples, results: windowResults };

      // ───────── C3：接咖啡 不点 4s → 分数负数 + 无任何漏接反馈 ─────────
      await openMenu();
      const c3 = await evj(`(() => {
        const P = window.__P;
        const btn = document.querySelector('button[data-game="coffee"]');
        const origRandom = Math.random;
        let s = ${LCG_SEED_3} >>> 0;
        Math.random = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
        P.armed = false; P.startAt = null;
        window.__oscCount = 0;
        btn.click();
        Math.random = origRandom;
        window.__c3 = { startAt: P.startAt };
        return window.__c3;
      })()`);
      const negSamples = [];
      for (let i = 0; i < 9; i++) {
        await sleep(480);
        negSamples.push(await evj(`({ t: +(window.__P.origNow() - ${c3.startAt}).toFixed(0), score: document.getElementById('play-score') ? document.getElementById('play-score').textContent : null, drops: document.querySelectorAll('.drop').length, hint: document.querySelector('.arcade-hint') ? document.querySelector('.arcade-hint').textContent : null, osc: window.__oscCount })`));
      }
      const negShot = await shot("coffee-04-negative-score");
      await closeArcade();
      report.phases.C3 = { start: c3, samples: negSamples, shot: negShot };

      // ───────── C5：找老板 错点 1 轮 + 连对 4 轮 ─────────
      await openMenu();
      const f5start = await evj(`(() => {
        const P = window.__P;
        const btn = document.querySelector('button[data-game="findboss"]');
        P.armed = false; P.startAt = null;
        window.__oscCount = 0;
        btn.click();
        window.__f5 = { startAt: P.startAt };
        return window.__f5;
      })()`);
      await sleep(150);
      const fGrid = await evj(`(() => {
        const faces = [...document.querySelectorAll('#play-grid button.face')];
        return { n: faces.length, rects: faces.map(f => { const r=f.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }), timer: document.getElementById('play-timer').textContent, bossTexts: faces.filter(f=>f.classList.contains('boss')).map(f=>f.textContent), normalText: faces.find(f=>!f.classList.contains('boss')).textContent };
      })()`);
      const gridShot = await shot("findboss-01-grid");
      const f5 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const t0 = orig();
        const res = [];
        const body = document.getElementById('arcade-body');
        const round = (k) => {
          const faces = [...document.querySelectorAll('#play-grid button.face')];
          const boss = faces.find(f => f.classList.contains('boss'));
          const timer = document.getElementById('play-timer').textContent;
          const beforeBody = body.innerText;
          const pick = k === 0 ? faces.find(f => !f.classList.contains('boss')) : boss;
          const tClick = orig();
          pick.click();
          const tAfter = orig();
          res.push({ k, timer, bossAt: faces.indexOf(boss), picked: faces.indexOf(pick), wrong: k === 0, dt: +(tAfter - tClick).toFixed(2), afterTimer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null, afterBodySame: body.innerText === beforeBody, score: document.getElementById('play-score') ? document.getElementById('play-score').textContent : null });
          if (k + 1 < 5) round(k + 1); else window.__f5res = { res, totalMs: +(orig() - t0).toFixed(2), osc: window.__oscCount };
        };
        round(0);
        return { armed: true };
      })()`);
      await waitFor("!!window.__f5res", 8000, 50);
      const f5res = await evj("window.__f5res || {}");
      await waitFor("!!document.getElementById('arcade-back')", 5000, 100);
      await sleep(200);
      const f5finish = await evj(`({ title: document.getElementById('arcade-title').textContent, body: document.getElementById('arcade-body').innerText, left: document.getElementById('arcade-left').textContent, arcade: window.__MOYU__.state.arcade })`);
      const f5shot = await shot("findboss-02-finish-wrong");
      report.phases.C5 = { start: f5start, grid: fGrid, run: f5res, finish: f5finish, shots: { grid: gridShot, finish: f5shot } };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ───────── C6：找老板 机器极速 5 连点（重置次数后测分数上限） ─────────
      await seedArcade(0);
      await openMenu();
      const f6 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const btn = document.querySelector('button[data-game="findboss"]');
        P.armed = false; P.startAt = null;
        btn.click();
        const startAt = P.startAt;
        const t0 = orig();
        const per = [];
        for (let k = 0; k < 5; k++) {
          const faces = [...document.querySelectorAll('#play-grid button.face')];
          const boss = faces.find(f => f.classList.contains('boss'));
          const tClk = orig();
          boss.click();
          per.push(+(orig() - tClk).toFixed(3));
        }
        const body = document.getElementById('arcade-body').innerText;
        return { startAt, totalMs: +(orig() - t0).toFixed(3), perClick: per, body, arcade: window.__MOYU__.state.arcade };
      })()`);
      await sleep(150);
      const f6finish = await evj(`({ body: document.getElementById('arcade-body').innerText, left: document.getElementById('arcade-left').textContent, arcade: window.__MOYU__.state.arcade })`);
      report.phases.C6 = { run: f6, finish: f6finish };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ───────── C7：找老板 不点等 30s 超时 ─────────
      await openMenu();
      const f7 = await evj(`(() => {
        const P = window.__P;
        const btn = document.querySelector('button[data-game="findboss"]');
        P.armed = false; P.startAt = null;
        btn.click();
        window.__f7 = { startAt: P.startAt };
        return window.__f7;
      })()`);
      await sleep(5000);
      const f7mid = await evj(`({ timer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null, body: document.getElementById('arcade-body').innerText.slice(0,120), left: document.getElementById('arcade-left').textContent })`);
      const f7midShot = await shot("findboss-03-idle-5s");
      const f7done = await waitFor("!!document.getElementById('arcade-back')", 34000, 250);
      const f7finish = await evj(`({ body: document.getElementById('arcade-body').innerText, arcade: window.__MOYU__.state.arcade, left: document.getElementById('arcade-left').textContent })`);
      const f7shot = await shot("findboss-04-idle-finish");
      report.phases.C7 = { start: f7, mid5s: f7mid, done: f7done, finish: f7finish, shots: [f7midShot, f7shot] };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ───────── C8：每日 3 次锁定 ─────────
      await seedArcade(3);
      await openMenu();
      const locked = await evj(`({ left: document.getElementById('arcade-left').textContent, cards: [...document.querySelectorAll('.arcade-card')].map(c => ({ name: c.querySelector('.arcade-name').textContent, locked: c.classList.contains('locked'), disabled: c.querySelector('button').disabled })) })`);
      const lockedShot = await shot("layout-04-locked");
      report.phases.C8 = { locked, shot: lockedShot };
      await closeArcade();

      report.errs = await evj("window.__errs || []");
      report.finishedAt = new Date().toISOString();
      writeFileSync(`${OUT}/coffee-findboss-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote coffee-findboss-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      try { report.errs = await evj("window.__errs || []"); } catch {}
      writeFileSync(`${OUT}/coffee-findboss-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 300000 },
);

const p = report.phases;
console.log("=== C0 ===", JSON.stringify({ desktopBtn: p.C0desktop?.btn, mobileBtn: p.C0mobile?.btn, mobileMenu: p.C0mobile?.menu }));
console.log("=== C1 coffee full ===", JSON.stringify({ taps: p.C1 && { hits: p.C1.hits, misses: p.C1.misses, delta: p.C1.deltaStats }, finish: p.C1?.finish, dropSample: p.C1?.dropSample, atFirstCatch: p.C1?.atFirstCatch, dropLog: p.C1?.dropLogSummary }));
console.log("=== C2 coffee window ===");
for (const r of p.C2?.results || []) console.log(`  ${r.kind.padEnd(10)} offset ${String(r.offsetMs).padStart(5)} dx ${String(r.dx).padStart(6)} actual ${String(r.actualMs).padStart(8)} -> ${r.hit ? "HIT" : "no"} (expect ${r.expected})`);
console.log("=== C3 negative ===", JSON.stringify(p.C3?.samples?.map((s) => s.score)));
console.log("=== C5 findboss ===", JSON.stringify({ grid: p.C5?.grid, run: p.C5?.run, finish: p.C5?.finish }));
console.log("=== C6 fast ===", JSON.stringify({ totalMs: p.C6?.run?.totalMs, body: p.C6?.run?.body, finish: p.C6?.finish }));
console.log("=== C7 idle ===", JSON.stringify({ mid: p.C7?.mid5s, finish: p.C7?.finish }));
console.log("=== C8 locked ===", JSON.stringify(p.C8?.locked));