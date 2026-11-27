/**
 * R15 复验精简版（HEAD b352a95，工作树干净）——只验 5 项修复 + 手感关键点，全部短阶段防 HMR reload
 *  A 节奏 8s：窗口/判定文字/音效振荡器/漏拍 -10/高亮提前量 + 早退 confirm 结算
 *  B 老板弹层不再打断摸鱼站（菜单中 / 对局中 forceBoss）+ 关闭后恢复 + 巡逻中开摸鱼站残留
 *  C 找老板实时分数（3 对 1 错）+ 早退折算（4.5s 退出奖励应很小）
 *  D 0/3 文案
 */
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const OUT = ".scratch/r15-action";
mkdirSync(OUT, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: URL, viewport: "390x844 mobile", phases: {} };

const BOOTSTRAP = `(() => {
  try {
    if (window.__BOOTED) return;
    window.__BOOTED = true;
    window.__oscCount = 0; window.__errs = []; window.__confirmCalls = [];
    addEventListener('error', e => window.__errs.push(String(e.message)));
    window.confirm = (msg) => { window.__confirmCalls.push(String(msg)); return true; };
    const orig = performance.now.bind(performance);
    const P = { origNow: orig, armed: false, armedAt: null, startAt: null };
    window.__P = P;
    performance.now = function () { const v = orig(); if (P.armed && P.startAt == null) P.startAt = v; return v; };
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('button[data-game]')) { P.armed = true; P.armedAt = orig(); P.startAt = null; }
    }, true);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC && AC.prototype) {
      const o = AC.prototype.createOscillator;
      AC.prototype.createOscillator = function (...a) { window.__oscCount++; return o.apply(this, a); };
      const bs = AC.prototype.createBufferSource;
      AC.prototype.createBufferSource = function (...a) { window.__oscCount++; return bs.apply(this, a); };
    }
  } catch (e) { window.__bootErr = String(e); }
})();`;

await runChrome(
  async ({ port }) => {
    const b = await connect(port);
    await b.send("Page.enable", {});
    await b.send("Runtime.enable", {});
    await b.send("Page.addScriptToEvaluateOnNewDocument", { source: BOOTSTRAP });

    const evaluate = async (expr) => {
      const r = await b.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };
    const evj = async (expr) => JSON.parse(await evaluate(`JSON.stringify((${expr}))`));
    const evjAsync = async (expr) => JSON.parse(await evaluate(`(async () => JSON.stringify(await (${expr})))()`));
    const shot = async (name) => {
      const r = await b.send("Page.captureScreenshot", { format: "png" });
      const f = `${OUT}/v3-${name}.png`;
      writeFileSync(f, Buffer.from(r.data, "base64"));
      return f;
    };
    const waitReady = async () => {
      for (let i = 0; i < 300; i++) { try { if ((await evaluate("!!window.__MOYU__")) === true) return; } catch {} await sleep(100); }
      throw new Error("not ready");
    };
    const waitFor = async (expr, ms = 12000, step = 60) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { if ((await evaluate(expr)) === true) return true; await sleep(step); }
      return false;
    };
    const origin = async () => { try { return await evaluate("performance.timeOrigin"); } catch { return null; } };
    const dismiss = async () => {
      await evaluate(`(() => {
        const w = document.getElementById('welcome'); if (w && !w.classList.contains('hidden')) { const b=document.getElementById('welcome-ok'); if(b) b.click(); }
        const c = document.getElementById('cards'); if (c && !c.classList.contains('hidden')) { const b=document.getElementById('cards-skip'); if(b) b.click(); }
        return 1; })()`);
      await sleep(220);
    };
    const reload = async () => { await b.send("Page.reload", {}); await sleep(1400); await waitReady(); await sleep(450); await dismiss(); };
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
        if (!arc.classList.contains('hidden')) { const back = document.getElementById('arcade-back'); if (back) back.click(); else document.getElementById('arcade-close').click(); }
        const bc = document.getElementById('boss-choice'); if (bc && !bc.classList.contains('hidden')) { const o=document.querySelector('#boss-opts button'); if(o) o.click(); }
        return 1; })()`);
      await sleep(220);
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if (arc.classList.contains('hidden')) document.getElementById('btn-arcade').click(); const back=document.getElementById('arcade-back'); if (back) back.click(); return 1; })()`);
      await sleep(220);
    };
    const closeArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')) document.getElementById('arcade-close').click(); return 1; })()`);
      await sleep(220);
    };
    const bossSnap = async () => evj(`(() => {
      const bc = document.getElementById('boss-choice'); const arc = document.getElementById('arcade'); const cards = document.getElementById('cards');
      const r = bc.getBoundingClientRect();
      return { bossHidden: bc.classList.contains('hidden'), bossRect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], arcadeOpen: !arc.classList.contains('hidden'), cardsHidden: cards.classList.contains('hidden'), bossZ: getComputedStyle(bc).zIndex, arcadeZ: getComputedStyle(arc).zIndex };
    })()`);

    await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send("Page.navigate", { url: URL });
    await waitReady(); await sleep(900); await dismiss();
    const t0 = await origin();

    try {
      // ── V0 ──
      report.phases.V0 = {
        served: await evjAsync(`(async () => {
          const t = await fetch('/src/ui/arcade.ts').then(r => r.text());
          const m = await fetch('/src/engine/minigames.ts').then(r => r.text());
          const n = await fetch('/src/main.ts').then(r => r.text());
          return {
            judgeText: t.includes('judge-text') && t.includes('PERFECT'),
            missPenalty10: t.includes('score - 10'),
            highlight30: t.includes('< 0.03'),
            audioWired: t.includes('playSuccess') && t.includes('playClick'),
            scoreBackfill: t.includes('局部更新分数'),
            recordBeforeBest: t.includes('先取旧纪录再结算'),
            missedBeatsCount: t.includes('missedBeats'),
            earlyExitScale: m.includes('timeRatio') && m.includes('playedSeconds < 2'),
            arcadeGate: n.includes('arcade.isOpen'),
            refreshCopy: t.includes('今天玩完了，明天再来'),
            replayBtn: t.includes('arcade-again'),
          };
        })()`),
        boot: await evj(`({ timeOrigin: performance.timeOrigin, bootErr: window.__bootErr || null })`),
      };

      // ── A：节奏 8s 全量手感点 ──
      await openMenu();
      const aSetup = await evj(`(() => {
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
        };
        const sampler = () => {
          const t = orig() - startAt;
          R.onSamples.push([+t.toFixed(0), [...row.querySelectorAll('.beat.on')].map(e => +e.dataset.b)]);
          if (t < 7200) requestAnimationFrame(sampler); else R.samplerDone = true;
        };
        requestAnimationFrame(sampler);
        const plan = [];
        const push = (t, fn) => plan.push({ t, fn });
        push(600, () => tap('b0-0'));
        push(1200, () => tap('b1+100'));
        push(1850, () => tap('offbeat1850'));
        push(1900, () => { R.missTimed = { judge: jEl() ? jEl().textContent : null, judgeCls: jEl() ? jEl().className : null, score: scoreEl.textContent, beat2Cls: row.querySelector('[data-b="2"]').className, t: +(orig() - startAt).toFixed(0) }; });
        push(2100, () => tap('b3-recover'));
        push(2520, () => tap('b4-80'));
        push(3179, () => tap('b5+79'));
        push(3519, () => tap('b6-81'));
        push(4180, () => tap('b7+80'));
        push(4440, () => tap('b8-160'));
        push(4939, () => tap('b9-161'));
        push(5759, () => tap('b10+159'));
        push(6600, () => tap('b11+160'));
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
      await sleep(2400);
      const aMidShot = await shot("rhythm-judgetext");
      await waitFor("window.__verify && window.__verify.planDone === true", 10000, 100);
      await sleep(350);
      const aData = await evj(`({ ops: window.__verify.ops, missTimed: window.__verify.missTimed, onSamples: window.__verify.onSamples, planDone: window.__verify.planDone, oscTotal: window.__oscCount })`);
      const aPlayedBefore = await evj("window.__MOYU__.state.arcade.played");
      await closeArcade(); // ~7.5s → confirm 弹窗(被 patch 为 true) → 结算并扣 1 次
      await sleep(300);
      const aAfter = await evj(`({ played: window.__MOYU__.state.arcade.played, best: window.__MOYU__.state.arcade.best, confirmCalls: window.__confirmCalls, toast: document.getElementById('dom-toast') ? document.getElementById('dom-toast').textContent : null, arcadeOpen: !document.getElementById('arcade').classList.contains('hidden') })`);
      const beatTime = (i) => 0.6 + i * 0.5;
      const onset = {};
      for (const [t, on] of aData.onSamples) for (const i of on) if (onset[i] === undefined) onset[i] = t;
      const onsetRows = Object.keys(onset).map((i) => ({ beat: +i, onsetMs: onset[i] - beatTime(+i) * 1000 })).filter((x) => x.beat <= 12);
      report.phases.A = { setup: aSetup, ops: aData.ops, missTimed: aData.missTimed, onsetRows, oscTotal: aData.oscTotal, playedBefore: aPlayedBefore, after: aAfter, shot: aMidShot };

      // ── B：老板弹层不再打断摸鱼站 ──
      await openMenu();
      await evaluate(`window.__MOYU__.forceBoss('choice')`);
      const bMenu = [];
      for (let i = 0; i < 28; i++) { bMenu.push(await bossSnap()); await sleep(90); }
      const bMenuOver = bMenu.filter((x) => !x.bossHidden).length;
      const bMenuCards = bMenu.filter((x) => !x.cardsHidden).length;
      await evaluate(`(() => { const P=window.__P; P.armed=false; P.startAt=null; document.querySelector('button[data-game="rhythm"]').click(); return 1; })()`);
      await sleep(300);
      await evaluate(`window.__MOYU__.forceBoss('choice')`);
      const bGame = [];
      let bGameShot = null;
      for (let i = 0; i < 28; i++) { const st = await bossSnap(); bGame.push(st); if (!st.bossHidden && !bGameShot) bGameShot = await shot("boss-over-arcade-UNEXPECTED"); await sleep(90); }
      const bGameOver = bGame.filter((x) => !x.bossHidden).length;
      await closeArcade(); // <2s → 退还次数，无 confirm
      const playedAfterEarlyClose = await evj("window.__MOYU__.state.arcade.played");
      const confirmAfterEarly = await evj("window.__confirmCalls.length");
      const bResumed = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 7000, 80);
      const bResumedInfo = await bossSnap();
      let bResidual = null, bResidualShot = null;
      if (bResumed) {
        await evaluate(`document.getElementById('btn-arcade').click()`);
        await sleep(450);
        bResidual = await bossSnap();
        if (!bResidual.bossHidden) bResidualShot = await shot("active-boss-over-arcade");
        await evaluate(`(() => { const b=document.querySelector('#boss-opts button'); if(b) b.click(); return 1; })()`);
        await sleep(600);
        await closeArcade();
      }
      report.phases.B = { menuOver: bMenuOver, menuCards: bMenuCards, menuSample: bMenu[0], gameOver: bGameOver, gameSample: bGame[0], playedAfterEarlyClose, confirmAfterEarly, resumed: bResumed, resumedInfo: bResumedInfo, residual: bResidual, shots: { game: bGameShot, residual: bResidualShot } };

      // ── C：找老板实时分数 + 早退折算 ──
      await openMenu();
      const cRun = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="findboss"]').click();
        const startAt = P.startAt;
        const scoreOf = () => { const el = document.getElementById('play-score'); return el ? Number(el.textContent) : null; };
        const clicks = [];
        const t0 = orig();
        for (let k = 0; k < 3; k++) {
          const boss = [...document.getElementById('play-grid').querySelectorAll('button.face')].find(f => f.classList.contains('boss'));
          boss.click();
          clicks.push({ k, t: +(orig() - t0).toFixed(0), score: scoreOf() });
        }
        const faces = [...document.getElementById('play-grid').querySelectorAll('button.face')];
        const beforeWrong = scoreOf();
        faces.find(f => !f.classList.contains('boss')).click();
        const afterWrong = scoreOf();
        return { startAt, clicks, beforeWrong, afterWrong };
      })()`);
      const cMidShot = await shot("findboss-live-score");
      await sleep(900);
      const cLater = await evj(`({ score: document.getElementById('play-score') ? document.getElementById('play-score').textContent : null, timer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null, hint: document.querySelector('.arcade-hint') ? document.querySelector('.arcade-hint').textContent : null })`);
      await sleep(1400); // 让本局 >2s 再退出 → 触发 confirm + 早退折算
      const cPlayedBeforeClose = await evj("window.__MOYU__.state.arcade.played");
      await closeArcade();
      await sleep(400);
      const cAfter = await evj(`({ played: window.__MOYU__.state.arcade.played, best: window.__MOYU__.state.arcade.best, confirmCalls: window.__confirmCalls.slice(-2), toast: document.getElementById('dom-toast') ? document.getElementById('dom-toast').textContent : null, open: !document.getElementById('arcade').classList.contains('hidden') })`);
      report.phases.C = { run: cRun, later: cLater, playedBeforeClose: cPlayedBeforeClose, after: cAfter, shot: cMidShot };

      // ── D：0/3 文案 ──
      await seedArcade(3);
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(1000);
      const d = await evj(`({ left: document.getElementById('arcade-left').textContent, played: window.__MOYU__.state.arcade.played, cardBtns: [...document.querySelectorAll('.arcade-card button')].map(b => ({ text: b.textContent, disabled: b.disabled })), badge: document.getElementById('btn-arcade').textContent })`);
      const dShot = await shot("menu-0of3");
      report.phases.D = { data: d, shot: dShot };

      report.originStart = t0;
      report.originEnd = await origin();
      report.errs = await evj("window.__errs || []");
      report.finishedAt = new Date().toISOString();
      writeFileSync(`${OUT}/v3-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote v3-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e).slice(0, 1200);
      try { report.originEnd = await origin(); } catch {}
      try { report.errs = await evj("window.__errs || []"); } catch {}
      writeFileSync(`${OUT}/v3-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 240000 },
);

const p = report.phases;
console.log("=== V0 ===", JSON.stringify(p.V0));
console.log("=== A rhythm 8s ===");
for (const o of p.A?.ops || []) console.log(`  ${String(o.label).padEnd(13)} delta ${String(o.delta).padStart(4)} judge ${String(o.judge).padEnd(8)} cls ${String(o.judgeCls).padEnd(22)} osc ${o.osc}`);
console.log("  missTimed", JSON.stringify(p.A?.missTimed));
console.log("  onsetRows", JSON.stringify(p.A?.onsetRows), "oscTotal", p.A?.oscTotal);
console.log("  playedBefore", p.A?.playedBefore, "after", JSON.stringify(p.A?.after));
console.log("=== B boss gating ===", JSON.stringify({ menuOver: p.B?.menuOver, menuCards: p.B?.menuCards, gameOver: p.B?.gameOver, gameSample: p.B?.gameSample, playedAfterEarlyClose: p.B?.playedAfterEarlyClose, confirmAfterEarly: p.B?.confirmAfterEarly, resumed: p.B?.resumed, resumedInfo: p.B?.resumedInfo, residual: p.B?.residual, shots: p.B?.shots }));
console.log("=== C findboss ===", JSON.stringify(p.C));
console.log("=== D 0/3 ===", JSON.stringify(p.D?.data));
console.log("reload?", report.originStart !== report.originEnd, "errs", JSON.stringify(report.errs));