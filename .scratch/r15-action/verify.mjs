/**
 * R15 操作党复验（HEAD f5b1d7b）：
 *  S1 节奏一局 30s：判定窗口复核 + PERFECT/GOOD/MISS 文字 + 音效振荡器计数 + 漏拍 -10 + 高亮提前量(30ms) + 首局破纪录庆祝
 *  S2 老板/卡片弹层不再打断摸鱼站：菜单中 forceBoss('choice')、游戏中 forceBoss('choice')、关闭后是否恢复触发；以及"先开巡逻再进摸鱼站"的残留边角
 *  S3 找老板实时分数：连对 3 轮 → 分数递增；点错 -20 可见；中途关闭结算分 vs 屏幕分
 *  S4 0/3 文案保持「今天玩完了，明天再来」
 * 使用 playtest/lib/chrome.mjs
 */
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const OUT = ".scratch/r15-action";
mkdirSync(OUT, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: URL, viewport: "390x844 mobile", phases: {} };

const HARNESS = `(() => {
  if (window.__P) return "already";
  const orig = performance.now.bind(performance);
  const P = { origNow: orig, armed: false, armedAt: null, startAt: null };
  window.__P = P;
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
    const evjAsync = async (expr) => JSON.parse(await evaluate(`(async () => JSON.stringify((${expr})))()`));
    const shot = async (name) => {
      const r = await b.send("Page.captureScreenshot", { format: "png" });
      const f = `${OUT}/verify-${name}.png`;
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
    const seedArcade = async (played, bestObj = null) => {
      const inj = await b.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { try {
          const raw = localStorage.getItem('moyu-save'); const blob = raw ? JSON.parse(raw) : { v: 2 };
          const d = new Date(); const today = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
          blob.arcade = { date: today, played: ${played}, best: ${bestObj ? JSON.stringify(bestObj) : "((blob.arcade && blob.arcade.best) || {})"} };
          blob.savedAt = Date.now(); localStorage.setItem('moyu-save', JSON.stringify(blob));
        } catch (e) {} })()`,
      });
      await reload();
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: inj.identifier });
      await sleep(120);
    };
    const openArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if (arc.classList.contains('hidden')) document.getElementById('btn-arcade').click(); const back=document.getElementById('arcade-back'); if (back) back.click(); return 1; })()`);
      await sleep(180);
    };
    const closeArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')){ document.getElementById('arcade-close').click(); } return 1; })()`);
      await sleep(160);
    };
    const bossOverArcade = async () => evj(`(() => {
      const bc = document.getElementById('boss-choice'); const arc = document.getElementById('arcade'); const cards = document.getElementById('cards');
      const r = bc.getBoundingClientRect();
      return { bossHidden: bc.classList.contains('hidden'), bossRect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], arcadeOpen: !arc.classList.contains('hidden'), cardsHidden: cards.classList.contains('hidden'), bodyChoiceOpen: document.body.classList.contains('choice-open'), bossZ: getComputedStyle(bc).zIndex, arcadeZ: getComputedStyle(arc).zIndex };
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

    await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send("Page.navigate", { url: URL });
    await waitReady(); await sleep(800); await evaluate(HARNESS); await dismiss();

    try {
      // ── V0：服务端代码确认（async fetch）──
      const served = await evjAsync(`(async () => {
        const t = await fetch('/src/ui/arcade.ts').then(r => r.text());
        const m = await fetch('/src/engine/minigames.ts').then(r => r.text());
        const n = await fetch('/src/main.ts').then(r => r.text());
        return {
          judgeText: t.includes('judge-text') && t.includes('PERFECT'),
          missPenalty: t.includes('漏拍惩罚') && t.includes('score - 10'),
          beatHighlight30: t.includes('< 0.03'),
          audioWired: t.includes('playSuccess') && t.includes('playClick'),
          scoreBackfill: t.includes('局部更新分数'),
          recordBeforeBest: t.includes('先取旧纪录再结算'),
          maxScore8000: m.includes('MAX_SCORE = 8000'),
          arcadeGateInMain: n.includes('arcade.isOpen') && n.includes('"arcade"') ,
        };
      })()`);
      report.phases.V0 = { served };

      // ── S1：节奏一局 30s（判定/音效/判定文字/漏拍/高亮/首局破纪录）──
      await openArcade();
      const s1start = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        window.__oscCount = 0;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const rect = area.getBoundingClientRect();
        const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
        const row = document.getElementById('beat-row');
        const scoreEl = document.getElementById('play-score');
        const jEl = () => document.getElementById('judge-text');
        const R = { ops: [], missTimed: null, onSamples: [] };
        window.__verify = R;
        const tap = (label) => {
          const jt = jEl();
          const osc0 = window.__oscCount;
          const before = Number(scoreEl.textContent);
          area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          const after = Number(scoreEl.textContent);
          const entry = { label, delta: after - before, judge: jt ? jt.textContent : null, judgeCls: jt ? jt.className : null, t: +(orig() - startAt).toFixed(0) };
          R.ops.push(entry);
          setTimeout(() => { entry.osc = window.__oscCount - osc0; }, 170);
          return entry;
        };
        const sampler = () => {
          const t = orig() - startAt;
          R.onSamples.push([+t.toFixed(0), [...row.querySelectorAll('.beat.on')].map(e => +e.dataset.b)]);
          if (t < 8200) requestAnimationFrame(sampler); else R.samplerDone = true;
        };
        requestAnimationFrame(sampler);
        const plan = [];
        const push = (t, fn) => plan.push({ t, fn });
        push(600, () => tap('b0-0-perfect'));
        push(1200, () => tap('b1+100-good'));
        push(1850, () => tap('offbeat-1850-miss'));
        push(1900, () => { R.missTimed = { judge: jEl() ? jEl().textContent : null, judgeCls: jEl() ? jEl().className : null, score: scoreEl.textContent, beat2Cls: row.querySelector('[data-b="2"]').className, t: +(orig() - startAt).toFixed(0) }; });
        push(2100, () => tap('b3-recover-perfect'));
        push(2520, () => tap('b4-80-perfect'));
        push(3179, () => tap('b5+79-perfect'));
        push(3519, () => tap('b6-81-good'));
        push(4180, () => tap('b7+80-good'));
        push(4440, () => tap('b8-160-good'));
        push(4939, () => tap('b9-161-miss'));
        push(5759, () => tap('b10+159-good'));
        push(6260, () => tap('b11+160-miss'));
        for (let k = 12; k <= 58; k++) push(600 + k * 500, () => tap('auto' + k));
        let i = 0;
        const run = () => {
          if (i >= plan.length) { R.planDone = true; return; }
          const { t, fn } = plan[i++];
          const target = startAt + t;
          setTimeout(() => { while (orig() < target) {} fn(); run(); }, Math.max(0, target - orig() - 10));
        };
        run();
        return { startAt, rect: [rect.left, rect.top, rect.width, rect.height] };
      })()`);
      await sleep(2600);
      const s1midShot = await shot("rhythm-judgetext-sound-mid");
      const s1done = await waitFor("!!document.getElementById('arcade-back')", 40000, 200);
      await sleep(250);
      const s1finish = await evj(`({
        body: document.getElementById('arcade-body').innerText,
        recordText: (document.querySelector('.arcade-record') || {}).textContent || null,
        rewardText: (document.querySelector('.arcade-reward') || {}).textContent || null,
        arcade: window.__MOYU__.state.arcade,
      })`);
      const s1shot = await shot("rhythm-finish-record");
      const s1data = await evj(`({ ops: window.__verify.ops, missTimed: window.__verify.missTimed, onSamples: window.__verify.onSamples, planDone: window.__verify.planDone, oscTotal: window.__oscCount })`);
      // 分析高亮提前量
      const beatTime = (i) => 0.6 + i * 0.5;
      const onset = {};
      for (const [t, on] of s1data.onSamples) {
        for (const i of on) if (onset[i] === undefined) onset[i] = t;
      }
      const onsetRows = Object.keys(onset).map((i) => ({ beat: +i, onsetMs: onset[i] - beatTime(+i) * 1000 })).filter((x) => x.beat <= 12);
      report.phases.S1 = {
        setup: s1start, done: s1done, finish: s1finish,
        ops: s1data.ops, missTimed: s1data.missTimed,
        onsetRows, oscTotal: s1data.oscTotal,
        shots: { mid: s1midShot, finish: s1shot },
      };
      await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await closeArcade();

      // ── S2pre：清掉 S1 期间被 gating 推迟、刚触发的巡逻 ──
      await sleep(600);
      const preShown = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 6000, 80);
      if (preShown) {
        await evaluate(`(() => { const b=document.querySelector('#boss-opts button'); if(b) b.click(); return 1; })()`);
        await sleep(600);
      }
      report.phases.S2pre = { delayedPatrolShown: preShown };

      // ── S2：老板/卡片弹层不再打断摸鱼站 ──
      // (a) 菜单打开时 forceBoss('choice')
      await openArcade();
      const s2a_force = await evaluate(`window.__MOYU__.forceBoss('choice')`);
      const s2a_seen = [];
      for (let i = 0; i < 40; i++) { s2a_seen.push(await evj(`({ hidden: document.getElementById('boss-choice').classList.contains('hidden'), cardsHidden: document.getElementById('cards').classList.contains('hidden'), arcadeOpen: !document.getElementById('arcade').classList.contains('hidden') })`)); await sleep(90); }
      const s2aOver = s2a_seen.filter((x) => !x.hidden).length;
      // (b) 节奏局中 forceBoss('choice')
      await evaluate(`(() => { const P=window.__P; P.armed=false; P.startAt=null; document.querySelector('button[data-game="rhythm"]').click(); return 1; })()`);
      await sleep(300);
      await evaluate(`window.__MOYU__.forceBoss('choice')`);
      const s2b_seen = [];
      let s2bshot = null;
      for (let i = 0; i < 35; i++) { const st = await bossOverArcade(); s2b_seen.push(st); if (!st.bossHidden && !s2bshot) s2bshot = await shot("boss-over-arcade"); await sleep(90); }
      const s2bOver = s2b_seen.filter((x) => !x.bossHidden).length;
      const playedBeforeClose = await evj(`window.__MOYU__.state.arcade.played`);
      await closeArcade();
      const playedAfterClose = await evj(`window.__MOYU__.state.arcade.played`);
      // (c) 关闭摸鱼站后，被推迟的老板巡逻是否恢复触发
      const s2cShown = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 7000, 80);
      const s2cInfo = await bossOverArcade();
      // (d) 残留边角：巡逻进行中打开摸鱼站，弹层是否还盖在上面
      let s2d = null, s2dshot = null;
      if (s2cShown) {
        await evaluate(`document.getElementById('btn-arcade').click()`);
        await sleep(400);
        s2d = await bossOverArcade();
        if (!s2d.bossHidden) s2dshot = await shot("active-boss-over-arcade");
        // 收掉巡逻
        await evaluate(`(() => { const b=document.querySelector('#boss-opts button'); if(b) b.click(); return 1; })()`);
        await sleep(500);
        await closeArcade();
      }
      report.phases.S2 = { forceA: s2a_force, menuOverCount: s2aOver, menuSamples: s2a_seen.slice(0, 3), gameOver: s2bOver, gameSamples: s2b_seen.slice(0, 3), playedBeforeClose, playedAfterClose, resumedAfterClose: s2cShown, resumedInfo: s2cInfo, residualOpenDuringChoice: s2d, shots: { bs: s2bshot, residual: s2dshot } };

      // ── S3：找老板实时分数 ──
      await seedArcade(0);
      await openArcade();
      const s3 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="findboss"]').click();
        const startAt = P.startAt;
        const scoreOf = () => { const el = document.getElementById('play-score'); return el ? Number(el.textContent) : null; };
        const clicks = [];
        const t0 = orig();
        for (let k = 0; k < 3; k++) {
          const grid = document.getElementById('play-grid');
          const boss = [...grid.querySelectorAll('button.face')].find(f => f.classList.contains('boss'));
          boss.click();
          clicks.push({ k, t: +(orig() - t0).toFixed(0), score: scoreOf(), wantMin: 50 * (k + 1) });
        }
        // 点错一次
        const grid2 = document.getElementById('play-grid');
        const faces = [...grid2.querySelectorAll('button.face')];
        const wrong = faces.find(f => !f.classList.contains('boss'));
        const scoreBeforeWrong = scoreOf();
        wrong.click();
        const scoreAfterWrong = scoreOf();
        // 等 1s 看分数是否随时间项变化
        return { startAt, clicks, scoreBeforeWrong, scoreAfterWrong, tAfterWrong: +(orig() - t0).toFixed(0), displayedAtWrong: scoreAfterWrong };
      })()`);
      await sleep(1100);
      const s3later = await evj(`({ score: document.getElementById('play-score') ? document.getElementById('play-score').textContent : null, timer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null })`);
      await sleep(300);
      const s3finishState = await evj(`({ played: window.__MOYU__.state.arcade.played })`);
      await closeArcade();
      await sleep(250);
      const s3after = await evj(`({ arcade: window.__MOYU__.state.arcade, body: document.getElementById('arcade-body').innerText.slice(0,300), open: !document.getElementById('arcade').classList.contains('hidden') })`);
      report.phases.S3 = { setup: s3, later: s3later, finishState: s3finishState, after: s3after };

      // ── S4：0/3 文案保持 ──
      await seedArcade(3);
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(900); // 让 refresh 跑若干帧
      const s4 = await evj(`({ left: document.getElementById('arcade-left').textContent, played: window.__MOYU__.state.arcade.played, cardBtns: [...document.querySelectorAll('.arcade-card button')].map(b => ({ text: b.textContent, disabled: b.disabled })), cardsLocked: [...document.querySelectorAll('.arcade-card')].map(c => c.classList.contains('locked')) })`);
      const s4shot = await shot("menu-locked-persist");
      report.phases.S4 = { data: s4, shot: s4shot };

      report.errs = await evj("window.__errs || []");
      report.finishedAt = new Date().toISOString();
      writeFileSync(`${OUT}/verify-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote verify-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      try { report.errs = await evj("window.__errs || []"); } catch {}
      writeFileSync(`${OUT}/verify-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 300000 },
);

const p = report.phases;
console.log("=== V0 served ===", JSON.stringify(p.V0?.served));
console.log("=== S1 rhythm 30s ===");
for (const o of p.S1?.ops || []) console.log(`  ${String(o.label).padEnd(20)} delta ${String(o.delta).padStart(4)} judge ${String(o.judge).padEnd(8)} cls ${String(o.judgeCls)} osc ${o.osc} t=${o.t}`);
console.log("  missTimed", JSON.stringify(p.S1?.missTimed));
console.log("  onsetRows", JSON.stringify(p.S1?.onsetRows));
console.log("  finish", JSON.stringify(p.S1?.finish));
console.log("  oscTotal", p.S1?.oscTotal, "shots", JSON.stringify(p.S1?.shots));
console.log("=== S2pre ===", JSON.stringify(p.S2pre));
console.log("=== S2 boss gating ===", JSON.stringify({ menuOverCount: p.S2?.menuOverCount, gameOver: p.S2?.gameOver, gameSamples: p.S2?.gameSamples, playedBeforeClose: p.S2?.playedBeforeClose, playedAfterClose: p.S2?.playedAfterClose, resumedAfterClose: p.S2?.resumedAfterClose, resumedInfo: p.S2?.resumedInfo, residual: p.S2?.residualOpenDuringChoice }));
console.log("=== S3 findboss score ===", JSON.stringify(p.S3));
console.log("=== S4 0/3 copy ===", JSON.stringify(p.S4?.data));