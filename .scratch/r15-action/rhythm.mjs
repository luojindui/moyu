/**
 * R15 操作党探针 1/2：节奏点击（rhythm）判定窗口实测 + 反馈/视觉/音频/连打/误触/打断/日限
 * 使用 playtest/lib/chrome.mjs（保证 Chrome 无残留）
 * 输出：.scratch/r15-action/rhythm-report.json + 截图
 *
 * 关键方法：在页面内 patch performance.now()，用 capture-phase click 监听"武装"后，
 * 第一次 performance.now() 调用即游戏内部 startAt（精确到 <1ms）。
 * 然后用 setTimeout + 忙等把 PointerEvent 落在目标时刻（实测 actualMs 由页面时钟记录）。
 */
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const OUT = ".scratch/r15-action";
mkdirSync(OUT, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  url: URL,
  head: "77019bc",
  viewport: "390x844 mobile",
  phases: {},
};

// ─────────────────────────── 页面内通用 harness ───────────────────────────
const HARNESS = `(() => {
  if (window.__P) return "already";
  const orig = performance.now.bind(performance);
  const P = {
    origNow: orig, armed: false, armedAt: null, startAt: null,
    frameTimes: [], oscCount: 0,
  };
  window.__P = P;
  window.__oscCount = 0;
  performance.now = function () {
    const v = orig();
    if (P.armed && P.startAt == null) P.startAt = v;
    return v;
  };
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("button[data-game]")) { P.armed = true; P.armedAt = orig(); P.startAt = null; }
  }, true);
  return "ok";
})()`;

const planSet = [
  -200, -161, -160.5, -160, -158, -156, -84, -82, -81, -80, -79, -78, -76,
  0, 0.05,
  79, 80, 81, 82, 84, 156, 158, 159, 160, 161, 162, 164, 200,
];
// 交错排列（小→大交替），避免系统性漂移
const plan = [];
for (let i = 0; i < planSet.length; i++) {
  plan.push(planSet[i]);
  const j = planSet.length - 1 - i;
  if (j > i) plan.push(planSet[j]);
}
report.plan = plan;

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    await b.send("Log.enable", {});

    const evaluate = async (expr) => {
      const r = await b.send("Runtime.evaluate", {
        expression: expr,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
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
      for (let i = 0; i < 300; i++) {
        try {
          if ((await evaluate("!!window.__MOYU__")) === true) return;
        } catch {}
        await sleep(100);
      }
      throw new Error("not ready");
    };
    const waitFor = async (expr, ms = 15000, step = 50) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if ((await evaluate(expr)) === true) return true;
        await sleep(step);
      }
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
    const reload = async () => {
      await b.send("Page.reload", {});
      await sleep(1300);
      await waitReady();
      await sleep(600);
      await install();
      await dismiss();
    };
    const patchArcade = async (played) => {
      const r = await evaluate(`(() => {
        try {
          const raw = localStorage.getItem('moyu-save');
          const blob = raw ? JSON.parse(raw) : { v: 2 };
          const d = new Date();
          const today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          blob.arcade = { date: today, played: ${played}, best: (blob.arcade && blob.arcade.best) || {} };
          blob.savedAt = Date.now();
          localStorage.setItem('moyu-save', JSON.stringify(blob));
          return 'ok';
        } catch (e) { return 'err:' + e; }
      })()`);
      await reload();
      return r;
    };
    const openMenu = async () => {
      const r = await evaluate(`(() => {
        const arc = document.getElementById('arcade');
        if (arc.classList.contains('hidden')) { document.getElementById('btn-arcade').click(); }
        const back = document.getElementById('arcade-back'); if (back) back.click();
        return 1;
      })()`);
      await sleep(200);
      return r;
    };
    const closeArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')){ const c=document.getElementById('arcade-close'); if(c) c.click(); } return 1; })()`);
      await sleep(150);
    };
    const arcadeState = async () => evj(`(() => ({ cls: document.getElementById('arcade').className, left: document.getElementById('arcade-left').textContent, title: document.getElementById('arcade-title').textContent, body: document.getElementById('arcade-body').innerText.slice(0,300) }))()`);

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
    await waitReady();
    await sleep(900);
    await install();
    await dismiss();

    try {
      // ───────── R0：入口与菜单 ─────────
      const btnInfo = await evj(`(() => {
        const el = document.getElementById('btn-arcade');
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const top = document.elementFromPoint(cx, cy);
        const cs = getComputedStyle(el);
        return { rect: [r.left, r.top, r.width, r.height], visible: !!(r.width && r.height), covered: top && top !== el ? (top.id || top.className || top.tagName) : null, font: cs.fontSize };
      })()`);
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(250);
      const menu = await arcadeState();
      const menuMetrics = await evj(`(() => {
        const panel = document.querySelector('.arcade-panel'); const pr = panel.getBoundingClientRect();
        const btns = [...document.querySelectorAll('.arcade-card button')].map(x => { const r = x.getBoundingClientRect(); return { w: r.width, h: r.height, text: x.textContent }; });
        return { panel: [pr.width, pr.height], btns };
      })()`);
      const shotMenu = await shot("rhythm-01-menu");
      report.phases.R0 = { btnInfo, menu, menuMetrics, shot: shotMenu };
      await closeArcade();

      // ───────── R1：判定窗口实测（每次点击落在 startAt + beat + offset） ─────────
      await openMenu();
      const r1 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const btn = document.querySelector('button[data-game="rhythm"]');
        P.armed = false; P.startAt = null;
        btn.click();
        const startAt = P.startAt;
        if (!startAt) return { err: 'no-startAt' };
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
        const row = document.getElementById('beat-row');
        const scoreEl = document.getElementById('play-score');
        const plan = ${JSON.stringify(plan)};
        const results = [];
        window.__boundary = results;
        const fire = (k) => {
          const offset = plan[k];
          const beatIdx = 4 + k;
          const beatT = startAt + (0.6 + beatIdx * 0.5) * 1000;
          const target = beatT + offset;
          const spin = () => {
            const tBefore = orig();
            while (orig() < target) {}
            const tHit = orig();
            const prev = new Set([...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b));
            const beforeScore = scoreEl.textContent;
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1, button: 0 }));
            const afterScore = scoreEl.textContent;
            const marked = [...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b);
            const newly = marked.filter(i => !prev.has(i));
            const detail = newly.map(i => ({ idx: +i, cls: row.querySelector('[data-b="' + i + '"]').className, expected: +i === beatIdx }));
            results.push({ beatIdx, plannedMs: offset, actualMs: +(tHit - beatT).toFixed(2), spinMs: +(tHit - tBefore).toFixed(2), beforeScore, afterScore, hits: detail, miss: newly.length === 0 });
            if (k + 1 < plan.length) fire(k + 1); else window.__boundaryDone = true;
          };
          setTimeout(spin, Math.max(0, target - orig() - 10));
        };
        fire(0);
        return { ok: true, startAt, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, planN: plan.length, beats: (60 / 120) };
      })()`);
      const done1 = await waitFor("window.__boundaryDone === true", 45000, 100);
      const boundary = await evj("window.__boundary || []");
      await closeArcade();
      report.phases.R1 = { setup: r1, done: done1, samples: boundary };

      // ───────── R2：连打 100 次/10s 是否被判 perfect（无 miss 惩罚） ─────────
      await openMenu();
      const r2 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const btn = document.querySelector('button[data-game="rhythm"]');
        P.armed = false; P.startAt = null;
        btn.click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
        const row = document.getElementById('beat-row');
        const scoreEl = document.getElementById('play-score');
        const taps = [];
        const total = 100, interval = 100, t0 = 1000;
        let k = 0;
        const fire = () => {
          const target = startAt + t0 + k * interval;
          const tBefore = orig();
          while (orig() < target) {}
          const tHit = orig();
          const prev = new Set([...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b));
          area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          const newly = [...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b).filter(i => !prev.has(i));
          taps.push({ t: +(tHit - startAt).toFixed(1), newly });
          k++;
          if (k < total) setTimeout(fire, Math.max(0, target + interval - orig() - 6));
          else {
            window.__spam = {
              taps: taps.length,
              tapTimes: taps.slice(0, 8),
              perfect: row.querySelectorAll('.beat.perfect').length,
              good: row.querySelectorAll('.beat.good').length,
              used: row.querySelectorAll('.beat.perfect,.beat.good').length,
              score: scoreEl.textContent,
            };
            window.__spamDone = true;
          }
        };
        fire();
        return { ok: true, startAt };
      })()`);
      const done2 = await waitFor("window.__spamDone === true", 20000, 100);
      const spam = await evj("window.__spam || {}");
      const spamScore = await evaluate(`document.getElementById('play-score') ? document.getElementById('play-score').textContent : null`);
      await closeArcade();
      report.phases.R2 = { setup: r2, done: done2, spam, scoreAtClose: spamScore };

      // ───────── R3：不点 10.5s：漏拍是否毫无反馈 + 高亮时序 + FPS + 音频 ─────────
      // 先测空闲基线 fps
      await evaluate(`window.__oscCount = 0; window.__P.frameTimes = []`);
      const baseFps = await evj(`(async () => {
        const P = window.__P; const orig = P.origNow; const times = [];
        await new Promise((res) => { const f = () => { times.push(orig()); if (times.length < 130) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
        const d = []; for (let i = 1; i < times.length; i++) d.push(times[i]-times[i-1]);
        d.sort((a,b)=>a-b);
        return { n: d.length, mean: +(d.reduce((a,b)=>a+b,0)/d.length).toFixed(2), p95: +d[Math.floor(d.length*0.95)].toFixed(2), max: +d[d.length-1].toFixed(2) };
      })()`);
      await openMenu();
      const r3 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const btn = document.querySelector('button[data-game="rhythm"]');
        P.armed = false; P.startAt = null;
        window.__oscCount = 0;
        btn.click();
        const startAt = P.startAt;
        const row = document.getElementById('beat-row');
        const scoreEl = document.getElementById('play-score');
        const samples = []; const frames = [];
        window.__visSamples = samples;
        const frame = () => {
          const t = orig(); const rel = t - startAt;
          frames.push(rel);
          samples.push([+(rel/1000).toFixed(3), [...row.querySelectorAll('.beat.on')].map(e => +e.dataset.b)]);
          if (rel < 10500) requestAnimationFrame(frame);
          else {
            window.__vis = {
              samples,
              frames: frames.length,
              perfect: row.querySelectorAll('.beat.perfect').length,
              good: row.querySelectorAll('.beat.good').length,
              anyOnClass: row.querySelectorAll('.beat.on').length,
              score: scoreEl.textContent,
              oscCount: window.__oscCount,
              timerText: document.getElementById('play-timer').textContent,
              hint: document.querySelector('.arcade-hint') ? document.querySelector('.arcade-hint').textContent : null,
            };
            window.__visDone = true;
          }
        };
        requestAnimationFrame(frame);
        return { ok: true, startAt };
      })()`);
      const done3 = await waitFor("window.__visDone === true", 16000, 100);
      const vis = await evj("window.__vis || {}");
      await closeArcade();
      report.phases.R3 = { setup: r3, done: done3, baseFps, vis: { frames: vis.frames, perfect: vis.perfect, good: vis.good, score: vis.score, oscCount: vis.oscCount, timerText: vis.timerText, hint: vis.hint }, samples: vis.samples || [] };

      // ───────── R4：一局完整 30s（每拍 0ms 偏移）→ 结算/最高分/奖励/截图 ─────────
      await openMenu();
      const beats = [];
      for (let t = 0.6; t < 30; t += 0.5) beats.push(+t.toFixed(3));
      const r4 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const btn = document.querySelector('button[data-game="rhythm"]');
        P.armed = false; P.startAt = null;
        btn.click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
        const row = document.getElementById('beat-row');
        const beats = ${JSON.stringify(beats)};
        const res = [];
        const fire = (k) => {
          const target = startAt + beats[k] * 1000;
          const spin = () => {
            const tBefore = orig();
            while (orig() < target) {}
            const tHit = orig();
            const prev = new Set([...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b));
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            const newly = [...row.querySelectorAll('.beat.perfect,.beat.good')].map(e => e.dataset.b).filter(i => !prev.has(i));
            res.push({ i: k, d: +(tHit - target).toFixed(2), newly, kind: newly.length ? row.querySelector('[data-b="' + newly[0] + '"]').className : 'none' });
            if (k + 1 < beats.length) fire(k + 1); else window.__legitTaps = res;
          };
          setTimeout(spin, Math.max(0, target - orig() - 10));
        };
        fire(0);
        return { ok: true, startAt, beatCount: beats.length };
      })()`);
      // 中途截图（约 4.2s，能看到已命中色块）
      await sleep(4400);
      const shotRhythmMid = await shot("rhythm-02-midgame");
      const legitDone = await waitFor("!!window.__legitTaps", 40000, 150);
      const taps = await evj("window.__legitTaps || []");
      // 等结算面板
      await waitFor("!!document.getElementById('arcade-back')", 6000, 100);
      await sleep(200);
      const finish = await evj(`(() => ({
        title: document.getElementById('arcade-title').textContent,
        body: document.getElementById('arcade-body').innerText,
        left: document.getElementById('arcade-left').textContent,
        arcade: window.__MOYU__.state.arcade,
      }))()`);
      const shotFinish = await shot("rhythm-03-finish");
      const toast = await evj(`(() => { const els=[...document.querySelectorAll('div,span')].filter(e=>/摸鱼站/.test(e.textContent||'') && e.children.length===0); return els.slice(-2).map(e=>e.textContent.slice(0,80)); })()`);
      report.phases.R4 = {
        setup: r4, done: legitDone, tapCount: taps.length,
        perfect: taps.filter(t => /perfect/.test(t.kind)).length,
        good: taps.filter(t => /good/.test(t.kind)).length,
        none: taps.filter(t => t.kind === 'none').length,
        offsetStats: (() => { const d = taps.map(t => t.d).sort((a,b)=>a-b); return d.length ? { min: d[0], p50: d[Math.floor(d.length/2)], max: d[d.length-1] } : null; })(),
        finish, toast, shots: { mid: shotRhythmMid, finish: shotFinish },
      };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(200);
      await closeArcade();

      // ───────── R5：中途关闭是否消耗次数（可无限重开） ─────────
      const before5 = await evj("window.__MOYU__.state.arcade");
      const closeTests = [];
      for (let i = 0; i < 3; i++) {
        await openMenu();
        await evj(`(() => { const P=window.__P; P.armed=false; P.startAt=null; document.querySelector('button[data-game="rhythm"]').click(); return 1; })()`);
        await sleep(1500);
        await closeArcade();
        await sleep(120);
        const st = await evj("window.__MOYU__.state.arcade");
        closeTests.push({ i, played: st.played, best: st.best && st.best.rhythm, left: (await arcadeState()).left });
      }
      const after5 = await evj("window.__MOYU__.state.arcade");
      report.phases.R5 = { before: before5, after: after5, closeTests };

      // ───────── R6：误触面板外/ESC 是否直接关掉对局（无确认） ─────────
      await openMenu();
      const r6 = await evj(`(() => {
        const P=window.__P; P.armed=false; P.startAt=null;
        document.querySelector('button[data-game="rhythm"]').click();
        return { startAt: P.startAt, open: !document.getElementById('arcade').classList.contains('hidden'), panelW: document.querySelector('.arcade-panel').getBoundingClientRect().width, vw: innerWidth };
      })()`);
      await sleep(800);
      const edge = await evj(`(() => {
        const x = 4, y = Math.floor(innerHeight/2);
        const el = document.elementFromPoint(x, y);
        const info = { x, y, hitId: el && (el.id || el.className), hitTag: el && el.tagName, arcadeOpenBefore: !document.getElementById('arcade').classList.contains('hidden') };
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }));
        info.arcadeOpenAfter = !document.getElementById('arcade').classList.contains('hidden');
        info.inGameBefore = !!document.getElementById('play-area');
        return info;
      })()`);
      report.phases.R6 = { start: r6, edgeClick: edge };
      // ESC 关闭
      await openMenu();
      await evj(`(() => { const P=window.__P; P.armed=false; P.startAt=null; document.querySelector('button[data-game="rhythm"]').click(); return 1; })()`);
      await sleep(700);
      const esc = await evj(`(() => {
        const before = !document.getElementById('arcade').classList.contains('hidden');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { before, after: !document.getElementById('arcade').classList.contains('hidden'), played: window.__MOYU__.state.arcade.played };
      })()`);
      report.phases.R6.esc = esc;
      await closeArcade();

      // ───────── R7：真实 CDP 鼠标输入延迟（headless 下界） ─────────
      await openMenu();
      const r7 = await evj(`(() => {
        const P=window.__P; P.armed=false; P.startAt=null;
        window.__handlerTimes = [];
        const body = document.getElementById('arcade-body');
        body.addEventListener('pointerdown', () => window.__handlerTimes.push(P.origNow()), true);
        document.querySelector('button[data-game="rhythm"]').click();
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        return { startAt: P.startAt, cx: r.left + r.width/2, cy: r.top + r.height/2, rect: [r.left, r.top, r.width, r.height] };
      })()`);
      await sleep(900);
      const lat = [];
      for (let i = 0; i < 5; i++) {
        const t0 = await evaluate("window.__P.origNow()");
        const n0 = await evaluate("window.__handlerTimes.length");
        await b.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r7.cx, y: r7.cy, button: "left", clickCount: 1 });
        await b.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r7.cx, y: r7.cy, button: "left", clickCount: 1 });
        await sleep(110);
        const n1 = await evaluate("window.__handlerTimes.length");
        if (n1 > n0) {
          const ht = await evaluate("window.__handlerTimes[window.__handlerTimes.length-1]");
          lat.push(+(ht - t0).toFixed(2));
        } else lat.push(null);
      }
      report.phases.R7 = { setup: r7, latenciesMs: lat, note: "latency = 页面时钟(发送命令前) → pointerdown 捕获监听触发；含 CDP 命令往返，headless 下界" };
      await closeArcade();

      // ───────── R8：小游戏进行中老板巡逻（choice 变体 z18 > arcade z17） ─────────
      await openMenu();
      const r8 = await evj(`(() => {
        const P=window.__P; P.armed=false; P.startAt=null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        window.__MOYU__.forceBoss('choice');
        return { startAt };
      })()`);
      await sleep(1500);
      const bossOver = await evj(`(() => {
        const bc = document.getElementById('boss-choice');
        const arc = document.getElementById('arcade');
        const bcs = getComputedStyle(bc), arcs = getComputedStyle(arc);
        const r = bc.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const top = document.elementFromPoint(Math.max(1, Math.min(innerWidth-1, cx)), Math.max(1, Math.min(innerHeight-1, cy)));
        return {
          bossHidden: bc.classList.contains('hidden'),
          bossRect: [r.left, r.top, r.width, r.height],
          bossZ: bcs.zIndex, arcadeZ: arcs.zIndex,
          arcadeOpen: !arc.classList.contains('hidden'),
          playAreaExists: !!document.getElementById('play-area'),
          topElAtBossCenter: top ? (top.id || top.className || top.tagName) : null,
          bossText: bc.innerText.slice(0, 120),
          arcadeInAnyModal: null,
        };
      })()`);
      await shot("rhythm-04-boss-over-arcade");
      report.phases.R8 = { setup: r8, bossOver };
      // 关掉 arcade 看是否还能回到主场景（不处理 boss 也行）
      await closeArcade();

      // ───────── R9：每日 3 次锁定 UI ─────────
      await patchArcade(3);
      await openMenu();
      const lockedMenu = await evj(`(() => ({
        left: document.getElementById('arcade-left').textContent,
        cards: [...document.querySelectorAll('.arcade-card')].map(c => ({ name: c.querySelector('.arcade-name').textContent, locked: c.classList.contains('locked'), disabled: c.querySelector('button').disabled })),
      }))()`);
      await shot("rhythm-05-locked");
      report.phases.R9 = { lockedMenu };
      await closeArcade();

      // ───────── R10：触摸（Emulation touch）是否能触发判定 + 双击缩放 ─────────
      await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await openMenu();
      const r10 = await evj(`(() => {
        const P=window.__P; P.armed=false; P.startAt=null;
        window.__touchHits = [];
        document.getElementById('arcade-body').addEventListener('pointerdown', (e) => window.__touchHits.push(e.pointerType), true);
        document.querySelector('button[data-game="rhythm"]').click();
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        return { startAt: P.startAt, cx: r.left + r.width/2, cy: r.top + r.height/2, vvScale: window.visualViewport ? window.visualViewport.scale : null };
      })()`);
      await sleep(1000);
      const touch = [];
      for (let i = 0; i < 4; i++) {
        const before = await evaluate("document.getElementById('play-score').textContent + '|' + window.visualViewport.scale");
        await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r10.cx, y: r10.cy, id: 1 }] });
        await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(120);
        const after = await evaluate("document.getElementById('play-score').textContent + '|' + window.visualViewport.scale");
        touch.push({ before, after });
      }
      // 快速双击（100ms 内)看是否触发缩放
      const dblBefore = await evaluate("window.visualViewport.scale");
      await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r10.cx, y: r10.cy, id: 2 }] });
      await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(90);
      await b.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r10.cx, y: r10.cy, id: 3 }] });
      await b.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(400);
      const dblAfter = await evaluate("window.visualViewport.scale");
      const touchScore = await evaluate("document.getElementById('play-score') ? document.getElementById('play-score').textContent : null");
      const touchHits = await evj("window.__touchHits || []");
      report.phases.R10 = { setup: r10, touch, dblBefore, dblAfter, touchScore, touchHits };
      await closeArcade();

      report.errs = await evj("window.__errs || []");
      report.finishedAt = new Date().toISOString();
      writeFileSync(`${OUT}/rhythm-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote rhythm-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      report.errs = await evj("window.__errs || []").catch(() => []);
      writeFileSync(`${OUT}/rhythm-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 300000 },
);

// 打印摘要
const p = report.phases;
console.log("=== R1 boundary ===");
for (const s of p.R1?.samples || []) {
  const kinds = s.hits.map((h) => `${h.cls.replace("beat ", "")}#${h.idx}${h.expected ? "" : "(≠target)"}`).join(",") || "MISS";
  console.log(`offset ${String(s.plannedMs).padStart(6)}ms actual ${String(s.actualMs).padStart(8)}ms -> ${kinds}`);
}
console.log("=== R2 spam ===", JSON.stringify(p.R2?.spam));
console.log("=== R3 vis ===", JSON.stringify(p.R3 && { frames: p.R3.vis.frames, perfect: p.R3.vis.perfect, good: p.R3.vis.good, score: p.R3.vis.score, osc: p.R3.vis.oscCount, baseFps: p.R3.baseFps }));
console.log("=== R4 legit ===", JSON.stringify(p.R4 && { taps: p.R4.tapCount, perfect: p.R4.perfect, good: p.R4.good, none: p.R4.none, offset: p.R4.offsetStats, finish: p.R4.finish }));
console.log("=== R5 close exploit ===", JSON.stringify(p.R5));
console.log("=== R6 accidental close ===", JSON.stringify(p.R6));
console.log("=== R7 latency ===", JSON.stringify(p.R7?.latenciesMs));
console.log("=== R8 boss ===", JSON.stringify(p.R8?.bossOver));
console.log("=== R9 locked ===", JSON.stringify(p.R9?.lockedMenu));
console.log("=== R10 touch ===", JSON.stringify(p.R10 && { touch: p.R10.touch, dbl: [p.R10.dblBefore, p.R10.dblAfter], touchScore: p.R10.touchScore }));