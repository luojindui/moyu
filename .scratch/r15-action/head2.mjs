/**
 * R15 操作党探针 4（HEAD c96dc43 复测）：
 *  P1 节奏判定窗口（新 HEAD 复核）+ miss 扣 5 是否生效/无提示
 *  P2 节奏 160ms 连打（乱点惩罚后是否还刷分）
 *  P3 接咖啡：整局 30s（前 15 颗精确接，其余放掉）→ 逐帧轨迹/杯口对齐/连击/漏接/结算面板
 *  P4 接咖啡：时间窗 ±320ms 与横向窗 ±0.13 实测（同时记录点击瞬间咖啡在屏幕上的高度%）
 *  P5 找老板：31s 实玩（250ms/次）→ 快节奏手感、实时分/结算分是否一致、分数与 REF 偏离
 *  P6 找老板：盲点 9 宫格 20 连点 → 是否被 -20 罚到 0
 *  P7 中途关闭：是否按当前分结算并消耗次数 + 记最高分
 *  P8 小游戏进行中 forceBoss('choice') 是否弹层遮挡
 *  P9 每日 3 次锁定
 */
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const OUT = ".scratch/r15-action";
mkdirSync(OUT, { recursive: true });
const HEAD = process.env.MOYU_HEAD ?? "c96dc43";
const report = { startedAt: new Date().toISOString(), url: URL, head: HEAD, viewport: "390x844 mobile", phases: {} };

// genDrops（新 HEAD：间隔 0.8+rng*0.55）
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; }; }
function genDrops(duration, rng) {
  const out = []; let t = 0.8, id = 0;
  while (t < duration - 0.5) { out.push({ id: id++, at: Number(t.toFixed(2)), x: Number((0.12 + rng() * 0.76).toFixed(2)) }); t += 0.8 + rng() * 0.55; }
  return out;
}
const drops1 = genDrops(30, lcg(12345)); // P3
const drops2 = genDrops(30, lcg(777)); // P4
report.dropSchedules = { seed12345: drops1.map((d) => [d.at, d.x]), seed777: drops2.map((d) => [d.at, d.x]) };

// P1 判定窗口采样（含 miss 扣分观察）
const planSet = [-200, -161, -160.5, -160, -158, -156, -84, -82, -81, -80, -79, -78, -76, 0, 0.05, 79, 80, 81, 82, 84, 156, 158, 159, 160, 161, 162, 164, 200];
const plan = [];
for (let i = 0; i < planSet.length; i++) { plan.push(planSet[i]); const j = planSet.length - 1 - i; if (j > i) plan.push(planSet[j]); }
report.boundaryPlan = plan;

// P4 窗口采样（新间隔 ≥0.81s，相邻掉落不会落入 ±0.32 窗）
const wReq = [
  { kind: "early-310", offsetMs: -310, dx: 0, expected: true },
  { kind: "early-320", offsetMs: -320, dx: 0, expected: true },
  { kind: "early-321", offsetMs: -321, dx: 0, expected: false },
  { kind: "late+310", offsetMs: 310, dx: 0, expected: true },
  { kind: "late+320", offsetMs: 320, dx: 0, expected: true },
  { kind: "late+321", offsetMs: 321, dx: 0, expected: false },
  { kind: "x+120", offsetMs: 0, dx: 0.12, expected: true },
  { kind: "x-120", offsetMs: 0, dx: -0.12, expected: true },
  { kind: "x+135", offsetMs: 0, dx: 0.135, expected: false },
  { kind: "x-140", offsetMs: 0, dx: -0.14, expected: false },
  { kind: "control", offsetMs: -2, dx: 0, expected: true },
  { kind: "control2", offsetMs: -2, dx: 0, expected: true },
];
const wSamples = [];
for (let i = 0; i < wReq.length; i++) {
  const d = drops2[3 + i];
  if (!d) break;
  wSamples.push({ ...wReq[i], id: d.id, at: d.at, x: d.x });
}
report.windowSamples = wSamples;

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
      const f = `${OUT}/head2-${name}.png`;
      writeFileSync(f, Buffer.from(r.data, "base64"));
      return f;
    };
    const waitReady = async () => {
      for (let i = 0; i < 300; i++) { try { if ((await evaluate("!!window.__MOYU__")) === true) return; } catch {} await sleep(100); }
      throw new Error("not ready");
    };
    const waitFor = async (expr, ms = 15000, step = 60) => {
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
      await sleep(220);
    };
    const reload = async () => { await b.send("Page.reload", {}); await sleep(1300); await waitReady(); await sleep(450); await evaluate(HARNESS); await dismiss(); };
    const seedArcade = async (played) => {
      const inj = await b.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { try {
          const raw = localStorage.getItem('moyu-save'); const blob = raw ? JSON.parse(raw) : { v: 2 };
          const d = new Date(); const today = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
          blob.arcade = { date: today, played: ${played}, best: (blob.arcade && blob.arcade.best) || {} };
          blob.savedAt = Date.now(); localStorage.setItem('moyu-save', JSON.stringify(blob));
        } catch (e) {} })()`,
      });
      await reload();
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: inj.identifier });
      await sleep(120);
    };
    const openMenu = async () => {
      await evaluate(`(() => {
        const arc = document.getElementById('arcade');
        if (arc.classList.contains('hidden')) document.getElementById('btn-arcade').click();
        const back = document.getElementById('arcade-back'); if (back) back.click();
        return 1;
      })()`);
      await sleep(160);
    };
    const closeArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')){ const c=document.getElementById('arcade-close'); if(c) c.click(); } return 1; })()`);
      await sleep(160);
    };
    const stateArcade = async () => evj(`window.__MOYU__.state.arcade`);
    const bodyText = async () => evj(`({ body: document.getElementById('arcade-body').innerText.slice(0,400), left: document.getElementById('arcade-left').textContent, open: !document.getElementById('arcade').classList.contains('hidden') })`);

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

    await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send("Page.navigate", { url: URL });
    await waitReady(); await sleep(800); await evaluate(HARNESS); await dismiss();

    try {
      // ── P0：确认服务端代码 = 新 HEAD ──
      const served = await evj(`(async () => {
        const t = await fetch('/src/ui/arcade.ts').then(r => r.text());
        const m = await fetch('/src/engine/minigames.ts').then(r => r.text());
        return {
          arcadeHasPerFrame: t.includes('逐帧更新所有掉落位置'),
          arcadeHasCupLine: t.includes('cup-line'),
          arcadeHasMissPenalty: t.includes('乱点惩罚'),
          arcadeHasCloseSettle: t.includes('中途退出：按当前分数结算'),
          minigamesHasRef: m.includes('REF_SCORE'),
          minigamesHasFloor: m.includes('Math.max(0, Math.floor(base * comboBonus'),
          minigamesJudgeWindow: /bestD <= 0\\.08/.test(m) && /bestD <= 0\\.16/.test(m),
        };
      })()`);
      const st0 = await evj(`window.__MOYU__.state.arcade`);
      report.phases.P0 = { served, arcadeState: st0 };

      // ── P1：节奏判定窗口 + miss 提示/扣分 ──
      await openMenu();
      await evaluate("window.__oscCount = 0");
      const p1 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const rect = area.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const row = document.getElementById('beat-row'); const scoreEl = document.getElementById('play-score');
        const plan = ${JSON.stringify(plan)};
        const results = [];
        window.__p1 = results;
        const fire = (k) => {
          const offset = plan[k]; const beatIdx = 4 + k;
          const beatT = startAt + (0.6 + beatIdx * 0.5) * 1000; const target = beatT + offset;
          setTimeout(() => {
            const tBefore = orig(); while (orig() < target) {} const tHit = orig();
            const prev = new Set([...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b));
            const beforeScore = Number(scoreEl.textContent);
            const toastBefore = (document.getElementById('dom-toast') || {}).textContent || '';
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            const afterScore = Number(scoreEl.textContent);
            const newly = [...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b).filter(i => !prev.has(i));
            results.push({ beatIdx, plannedMs: offset, actualMs: +(tHit - beatT).toFixed(2), beforeScore, afterScore, delta: afterScore - beforeScore, hits: newly.map(i => ({ idx: +i, cls: row.querySelector('[data-b="' + i + '"]').className })), toastChanged: ((document.getElementById('dom-toast') || {}).textContent || '') !== toastBefore });
            if (k + 1 < plan.length) fire(k + 1); else window.__p1done = true;
          }, Math.max(0, target - orig() - 10));
        };
        fire(0);
        return { startAt, rect: [rect.left, rect.top, rect.width, rect.height] };
      })()`);
      await waitFor("window.__p1done === true", 45000, 100);
      const p1data = await evj("window.__p1 || []");
      const p1extra = await evj(`({ osc: window.__oscCount, silent: window.__oscCount === 0 })`);
      await closeArcade();
      const p1state = await stateArcade();
      report.phases.P1 = { setup: p1, samples: p1data, extra: p1extra, stateAfterClose: p1state };

      // ── P2：节奏 160ms 连打（乱点惩罚） ──
      await seedArcade(0);
      await openMenu();
      const p2 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const row = document.getElementById('beat-row'); const scoreEl = document.getElementById('play-score');
        const samples = [];
        let k = 0; const total = 50; const T = 160;
        const fire = () => {
          const target = startAt + 1000 + k * T;
          while (orig() < target) {}
          area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          if (k % 10 === 0) samples.push({ k, score: scoreEl.textContent, perfect: row.querySelectorAll('.beat.perfect').length, good: row.querySelectorAll('.beat.good').length });
          k++;
          if (k < total) setTimeout(fire, Math.max(0, target + T - orig() - 5));
          else { window.__p2 = { taps: total, perfect: row.querySelectorAll('.beat.perfect').length, good: row.querySelectorAll('.beat.good').length, used: row.querySelectorAll('.beat.perfect,.beat.good').length, score: scoreEl.textContent, samples }; window.__p2done = true; }
        };
        setTimeout(fire, Math.max(0, (startAt + 1000) - orig() - 6));
        return { startAt };
      })()`);
      await waitFor("window.__p2done === true", 30000, 100);
      const p2data = await evj("window.__p2 || {}");
      await closeArcade();
      report.phases.P2 = { setup: p2, res: p2data };

      // ── P3：接咖啡整局（前 15 颗精确接，其余放掉）→ 轨迹 & 结算 ──
      await seedArcade(0);
      await openMenu();
      const p3 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const origRandom = Math.random;
        let s = 12345 >>> 0;
        Math.random = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="coffee"]').click();
        Math.random = origRandom;
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const rect = area.getBoundingClientRect();
        const drops = ${JSON.stringify(drops1.map((d) => ({ at: d.at, x: d.x })))};
        const scoreEl = document.getElementById('play-score');
        const taps = []; window.__p3taps = taps;
        drops.forEach((d, k) => {
          if (k >= 15) return;
          const target = startAt + d.at * 1000 - 2;
          setTimeout(() => {
            while (orig() < target) {}
            const tHit = orig();
            const cx = rect.left + d.x * rect.width, cy = rect.top + rect.height / 2;
            const elsNow = [...document.querySelectorAll('.drop')].map(e => ({ top: e.style.top, left: e.style.left, cls: e.className, rect: (r => [+r.left.toFixed(0), +r.top.toFixed(0), r.width, r.height])(e.getBoundingClientRect()) }));
            const targetEl = elsNow.filter(e => Math.abs(Number(e.left.replace('%','')) - d.x * 100) < 2).sort((a,b)=>Math.abs(Number(b.top.replace('%',''))-88)-Math.abs(Number(a.top.replace('%',''))-88));
            const before = Number(scoreEl.textContent);
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            const after = Number(scoreEl.textContent);
            taps.push({ k, at: d.at, deltaMs: +(tHit - (startAt + d.at * 1000)).toFixed(2), before, after, hit: after > before, visualTopPct: targetEl.length ? targetEl[0].top : null, visualCls: targetEl.length ? targetEl[0].cls : null, dropsOnScreen: elsNow.length });
          }, Math.max(0, target - orig() - 10));
        });
        // 轨迹采样（前 6.5s，每 ~60ms）
        const traj = []; window.__p3traj = traj;
        const sample = () => {
          const t = orig() - startAt;
          traj.push({ t: +t.toFixed(0), drops: [...document.querySelectorAll('.drop')].map(e => ({ top: e.style.top, left: e.style.left, cls: e.className })) });
          if (t < 6500) setTimeout(sample, 60); else window.__p3trajDone = true;
        };
        setTimeout(sample, 80);
        return { startAt, rect: [rect.left, rect.top, rect.width, rect.height] };
      })()`);
      // 中途截图（咖啡下落中）
      await sleep(2500);
      const p3midShot = await shot("coffee-falling-mid");
      await waitFor("window.__p3trajDone === true", 12000, 100);
      const traj = await evj("window.__p3traj || []");
      const taps3 = await evj("window.__p3taps || []");
      const p3done = await waitFor("!!document.getElementById('arcade-back')", 40000, 200);
      await sleep(250);
      const p3finish = await evj(`({
        body: document.getElementById('arcade-body').innerText,
        rewardText: (document.querySelector('.arcade-reward') || {}).textContent || null,
        recordText: (document.querySelector('.arcade-record') || {}).textContent || null,
        detailText: [...document.querySelectorAll('#arcade-body .arcade-hint')].map(e => e.textContent),
        arcade: window.__MOYU__.state.arcade,
        fps: window.__MOYU__.fps,
      })`);
      const p3shot = await shot("coffee-finish-partial");
      report.phases.P3 = { setup: p3, done: p3done, taps: taps3, tapHits: taps3.filter(t => t.hit).length, tapSample: taps3.slice(0, 6), trajSample: traj.slice(0, 24), trajLen: traj.length, finish: p3finish, shots: { mid: p3midShot, finish: p3shot } };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ── P4：接咖啡 时间窗/横向窗 + 点击瞬间视觉高度 ──
      await seedArcade(0);
      await openMenu();
      const p4 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const origRandom = Math.random;
        let s = 777 >>> 0;
        Math.random = () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 4294967296; };
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="coffee"]').click();
        Math.random = origRandom;
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const rect = area.getBoundingClientRect();
        const samples = ${JSON.stringify(wSamples)};
        const scoreEl = document.getElementById('play-score');
        const out = []; window.__p4 = out;
        let i = 0;
        const fire = () => {
          const sm = samples[i];
          const target = startAt + sm.at * 1000 + sm.offsetMs;
          while (orig() < target) {}
          const tHit = orig();
          const cx = rect.left + (sm.x + sm.dx) * rect.width, cy = rect.top + rect.height / 2;
          const before = Number(scoreEl.textContent);
          const visuals = [...document.querySelectorAll('.drop')].map(e => ({ top: e.style.top, left: e.style.left, cls: e.className }));
          area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          const after = Number(scoreEl.textContent);
          const wanted = visuals.filter(v => Math.abs(Number(v.left.replace('%','')) - sm.x * 100) < 2);
          out.push({ kind: sm.kind, offsetMs: sm.offsetMs, dx: sm.dx, expected: sm.expected, actualMs: +(tHit - (startAt + sm.at * 1000)).toFixed(2), before, after, hit: after > before, targetVisual: wanted.map(w => ({ top: w.top, cls: w.cls })), dropsOnScreen: visuals.length });
          i++;
          if (i < samples.length) setTimeout(fire, Math.max(0, target - orig() - 10)); else window.__p4done = true;
        };
        return (() => { setTimeout(fire, Math.max(0, (startAt + samples[0].at * 1000 + samples[0].offsetMs) - orig() - 10)); return { startAt }; })();
      })()`);
      await waitFor("window.__p4done === true", 30000, 100);
      const p4data = await evj("window.__p4 || []");
      await closeArcade();
      report.phases.P4 = { setup: p4, samples: p4data };

      // ── P5：找老板 31s（每 250ms 找王总点一次）→ 实时分 vs 结算分 ──
      await seedArcade(0);
      await openMenu();
      const p5 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="findboss"]').click();
        const startAt = P.startAt;
        const samples = []; window.__p5s = samples;
        let rounds = 0; let wrongClicks = 0;
        const fire = () => {
          const grid = document.getElementById('play-grid');
          const scoreEl = document.getElementById('play-score');
          const timerEl = document.getElementById('play-timer');
          if (!grid) { window.__p5 = { rounds, wrongClicks, samples, endT: +(orig() - startAt).toFixed(0) }; window.__p5done = true; return; }
          const faces = [...grid.querySelectorAll('button.face')];
          const boss = faces.find(f => f.classList.contains('boss'));
          const t = +(orig() - startAt).toFixed(0);
          if (samples.length === 0 || t - samples[samples.length-1].t >= 1000) samples.push({ t, score: scoreEl ? scoreEl.textContent : null, timer: timerEl ? timerEl.textContent : null, hint: (document.getElementById('arcade-body').innerText.match(/已找\\s*(\\d+)/) || [])[1] || '0' });
          boss.click(); rounds++;
          setTimeout(fire, 250);
        };
        setTimeout(fire, 100);
        return { startAt };
      })()`);
      const p5done = await waitFor("window.__p5done === true", 40000, 150);
      await sleep(300);
      const p5finish = await evj(`({
        body: document.getElementById('arcade-body').innerText,
        rewardText: (document.querySelector('.arcade-reward') || {}).textContent || null,
        recordText: (document.querySelector('.arcade-record') || {}).textContent || null,
        arcade: window.__MOYU__.state.arcade,
      })`);
      const p5data = await evj("window.__p5 || {}");
      const p5shot = await shot("findboss-30s-finish");
      report.phases.P5 = { setup: p5, done: p5done, data: p5data, finish: p5finish, shot: p5shot };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ── P6：找老板 盲点 20 连点 ──
      await seedArcade(0);
      await openMenu();
      const p6 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="findboss"]').click();
        const startAt = P.startAt;
        const out = [];
        let k = 0;
        const fire = () => {
          const grid = document.getElementById('play-grid');
          if (!grid || k >= 20) { window.__p6 = { clicks: k, body: document.getElementById('arcade-body').innerText.slice(0,200) }; window.__p6done = true; return; }
          const faces = [...grid.querySelectorAll('button.face')];
          faces[Math.floor(Math.random() * faces.length)].click();
          k++;
          setTimeout(fire, 45);
        };
        fire();
        return { startAt };
      })()`);
      await waitFor("window.__p6done === true", 10000, 60);
      const p6data = await evj("window.__p6 || {}");
      const p6shot = await shot("findboss-blind-spam");
      await closeArcade();
      report.phases.P6 = { setup: p6, res: p6data, shot: p6shot };

      // ── P7：中途关闭 → 结算消耗次数 + 记最高分 ──
      await seedArcade(0);
      await openMenu();
      const p7 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        // 打 3 个 perfect（+60 分）
        [0, 1, 2].forEach((k) => {
          const target = startAt + (0.6 + k * 0.5) * 1000;
          setTimeout(() => { while (orig() < target) {} area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerId: 1, pointerType: 'mouse', isPrimary: true })); }, Math.max(0, target - orig() - 10));
        });
        return { startAt };
      })()`);
      await sleep(2200);
      const p7pre = await evj(`({ score: document.getElementById('play-score').textContent, played: window.__MOYU__.state.arcade.played })`);
      await closeArcade();
      await sleep(300);
      const p7post = await evj(`({ arcade: window.__MOYU__.state.arcade, body: document.getElementById('arcade-body').innerText.slice(0,200), arcadeOpen: !document.getElementById('arcade').classList.contains('hidden') })`);
      report.phases.P7 = { setup: p7, pre: p7pre, post: p7post };

      // ── P8：小游戏进行中老板 choice 弹层 ──
      await seedArcade(0);
      await openMenu();
      const p8 = await evj(`(() => {
        const P = window.__P;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        window.__MOYU__.forceBoss('choice');
        return { startAt };
      })()`);
      const p8seen = [];
      let p8shot = null;
      for (let i = 0; i < 60; i++) {
        const st = await evj(`(() => {
          const bc = document.getElementById('boss-choice'); const arc = document.getElementById('arcade');
          const r = bc.getBoundingClientRect();
          const cx = r.left + r.width/2, cy = r.top + r.height/2;
          const top = (cx > 0 && cy > 0 && cx < innerWidth && cy < innerHeight) ? document.elementFromPoint(cx, cy) : null;
          return { hidden: bc.classList.contains('hidden'), rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], arcadeOpen: !arc.classList.contains('hidden'), bodyChoiceOpen: document.body.classList.contains('choice-open'), topAtBossCenter: top ? (top.id || top.className || top.tagName) : null, arcadeZ: getComputedStyle(arc).zIndex, bossZ: getComputedStyle(bc).zIndex };
        })()`);
        p8seen.push(st);
        if (!st.hidden && !p8shot) p8shot = await shot("boss-choice-over-arcade");
        await sleep(70);
      }
      const p8visible = p8seen.filter((s) => !s.hidden);
      await closeArcade();
      report.phases.P8 = { setup: p8, visibleCount: p8visible.length, firstVisible: p8visible[0] || null, sample: p8seen[0], shot: p8shot };

      // ── P9：每日 3 次锁定 ──
      await seedArcade(3);
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(250);
      const p9 = await evj(`({ left: document.getElementById('arcade-left').textContent, played: window.__MOYU__.state.arcade.played, cards: [...document.querySelectorAll('.arcade-card')].map(c => ({ name: c.querySelector('.arcade-name').textContent, locked: c.classList.contains('locked'), disabled: c.querySelector('button').disabled })) })`);
      const p9shot = await shot("menu-locked");
      report.phases.P9 = { data: p9, shot: p9shot };

      report.errs = await evj("window.__errs || []");
      report.finishedAt = new Date().toISOString();
      writeFileSync(`${OUT}/head2-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote head2-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      try { report.errs = await evj("window.__errs || []"); } catch {}
      writeFileSync(`${OUT}/head2-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 300000 },
);

const p = report.phases;
console.log("=== P0 served ===", JSON.stringify(p.P0?.served), "state", JSON.stringify(p.P0?.arcadeState));
console.log("=== P1 boundary ===");
for (const s of p.P1?.samples || []) {
  const k = s.hits.length ? s.hits.map((h) => `${h.cls.replace("beat ", "")}#${h.idx}`).join(",") : "MISS";
  console.log(`  ${String(s.plannedMs).padStart(7)}ms actual ${String(s.actualMs).padStart(8)} -> ${k.padEnd(12)} dScore ${String(s.delta).padStart(4)} toastChanged=${s.toastChanged}`);
}
console.log("=== P1 extra ===", JSON.stringify(p.P1?.extra), "stateAfterClose", JSON.stringify(p.P1?.stateAfterClose));
console.log("=== P2 spam160 ===", JSON.stringify(p.P2?.res));
console.log("=== P3 coffee full ===", JSON.stringify({ taps: p.P3?.taps?.length, hits: p.P3?.tapHits, tapSample: p.P3?.tapSample?.slice(0,4), trajLen: p.P3?.trajLen, finish: p.P3?.finish, shots: p.P3?.shots }));
console.log("  traj0", JSON.stringify(p.P3?.trajSample?.slice(0, 6)));
console.log("=== P4 windows ===");
for (const s of p.P4?.samples || []) console.log(`  ${String(s.kind).padEnd(9)} actual ${String(s.actualMs).padStart(7)} -> ${s.hit ? "HIT" : "no "} (expect ${s.expected}) visual=${JSON.stringify(s.targetVisual)} drops=${s.dropsOnScreen}`);
console.log("=== P5 findboss ===", JSON.stringify({ done: p.P5?.done, samples: p.P5?.data?.samples, rounds: p.P5?.data?.rounds, endT: p.P5?.data?.endT, finish: p.P5?.finish }));
console.log("=== P6 blind spam ===", JSON.stringify(p.P6?.res));
console.log("=== P7 close-settle ===", JSON.stringify(p.P7));
console.log("=== P8 boss ===", JSON.stringify({ visibleCount: p.P8?.visibleCount, firstVisible: p.P8?.firstVisible, sample: p.P8?.sample }));
console.log("=== P9 locked ===", JSON.stringify(p.P9?.data));