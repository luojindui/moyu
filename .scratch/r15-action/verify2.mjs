/**
 * R15 操作党复验 v2（HEAD cd1bcea + docs bfbfc46；工作树干净）
 *  - harness / 音频计数 / 错误收集 通过 addScriptToEvaluateOnNewDocument 注入（抗 HMR reload）
 *  - 每个阶段检测 performance.timeOrigin 是否变化（reload），长阶段失败自动重试一次
 *  S1b 节奏整局 30s：首局破纪录庆祝、结算明细（perfect/漏拍）、满分 1180
 *  S1a 节奏 7s：判定窗口复核、PERFECT/GOOD/MISS 文字、音效振荡器、漏拍 -10、高亮提前量
 *  S2 老板弹层不再打断摸鱼站（菜单/对局中 forceBoss）、关闭后恢复触发、以及"巡逻进行中打开摸鱼站"残留边角
 *  S3 找老板实时分数（3 连对 + 点错）
 *  S4 0/3 文案
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
    window.__oscCount = 0; window.__errs = [];
    addEventListener('error', e => window.__errs.push(String(e.message)));
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
      const f = `${OUT}/verify2-${name}.png`;
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
    const origin = async () => { try { return await evaluate("performance.timeOrigin"); } catch { return null; } };
    const dismiss = async () => {
      await evaluate(`(() => {
        const w = document.getElementById('welcome'); if (w && !w.classList.contains('hidden')) { const b=document.getElementById('welcome-ok'); if(b) b.click(); }
        const c = document.getElementById('cards'); if (c && !c.classList.contains('hidden')) { const b=document.getElementById('cards-skip'); if(b) b.click(); }
        const bc = document.getElementById('boss-choice'); if (bc && !bc.classList.contains('hidden')) { const o=document.querySelector('#boss-opts button'); if(o) o.click(); }
        return 1;
      })()`);
      await sleep(250);
    };
    const reload = async () => { await b.send("Page.reload", {}); await sleep(1400); await waitReady(); await sleep(500); await dismiss(); };
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
    const ensureMenu = async () => {
      await evaluate(`(() => {
        const arc = document.getElementById('arcade');
        if (!arc.classList.contains('hidden')) {
          const back = document.getElementById('arcade-back'); if (back) back.click();
          if (!document.getElementById('arcade-back')) document.getElementById('arcade-close').click();
        }
        const bc = document.getElementById('boss-choice'); if (bc && !bc.classList.contains('hidden')) { const o=document.querySelector('#boss-opts button'); if(o) o.click(); }
        return 1;
      })()`);
      await sleep(250);
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if (arc.classList.contains('hidden')) document.getElementById('btn-arcade').click(); const back=document.getElementById('arcade-back'); if (back) back.click(); return 1; })()`);
      await sleep(200);
    };
    const closeArcade = async () => {
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')) document.getElementById('arcade-close').click(); return 1; })()`);
      await sleep(180);
    };
    const bossSnapshot = async () => evj(`(() => {
      const bc = document.getElementById('boss-choice'); const arc = document.getElementById('arcade'); const cards = document.getElementById('cards');
      const r = bc.getBoundingClientRect();
      return { bossHidden: bc.classList.contains('hidden'), bossRect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], arcadeOpen: !arc.classList.contains('hidden'), cardsHidden: cards.classList.contains('hidden'), bodyChoiceOpen: document.body.classList.contains('choice-open'), bossZ: getComputedStyle(bc).zIndex, arcadeZ: getComputedStyle(arc).zIndex, timeOrigin: performance.timeOrigin };
    })()`);

    await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send("Page.navigate", { url: URL });
    await waitReady(); await sleep(900); await dismiss();

    try {
      // ── V0：服务端代码确认 ──
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
          missedBeats: t.includes('missedBeats'),
          maxScore8000: m.includes('MAX_SCORE = 8000'),
          arcadeGateInMain: n.includes('arcade.isOpen') && n.includes('!document.getElementById("arcade")!.classList.contains("hidden")'),
          refreshCopy: t.includes('今天玩完了，明天再来'),
        };
      })()`);
      report.phases.V0 = { served, boot: await evj(`({ timeOrigin: performance.timeOrigin, errs: window.__errs || [], bootErr: window.__bootErr || null })`) };

      // 工具：带 reload 检测的重试
      const withRetry = async (name, fn, tries = 2) => {
        for (let i = 0; i < tries; i++) {
          const o0 = await origin();
          try {
            const r = await fn(i);
            const o1 = await origin();
            if (o0 === o1) return { ok: true, attempt: i, data: r };
            report.phases[name + "_reloads"] = (report.phases[name + "_reloads"] || 0) + 1;
          } catch (e) {
            report.phases[name + "_err" + i] = String(e).slice(0, 300);
          }
          await waitReady().catch(() => {});
          await sleep(400);
          await dismiss();
        }
        return { ok: false };
      };

      // ── S1b：节奏整局 30s（首局破纪录 + 明细 + 满分）──
      const s1bRes = await withRetry("S1b", async () => {
        await ensureMenu();
        const setup = await evj(`(() => {
          const P = window.__P, orig = P.origNow;
          P.armed = false; P.startAt = null;
          window.__oscCount = 0;
          document.querySelector('button[data-game="rhythm"]').click();
          const startAt = P.startAt;
          const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
          const scoreEl = document.getElementById('play-score');
          const beats = []; for (let t = 0.6; t < 30; t += 0.5) beats.push(+t.toFixed(3));
          const logs = []; window.__s1b = logs;
          let k = 0;
          const fire = () => {
            const target = startAt + beats[k] * 1000;
            while (orig() < target) {}
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
            if (k === 4) logs.push({ k, scoreAt4: scoreEl.textContent, judge: (document.getElementById('judge-text') || {}).textContent });
            k++;
            if (k < beats.length) setTimeout(fire, Math.max(0, target + 500 - orig() - 10));
            else window.__s1bDone = true;
          };
          fire();
          return { startAt, beatCount: beats.length };
        })()`);
        await sleep(2200);
        const mid = await evj(`({ score: document.getElementById('play-score') ? document.getElementById('play-score').textContent : null, judge: document.getElementById('judge-text') ? document.getElementById('judge-text').textContent : null, timer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null })`);
        const done = await waitFor("!!document.getElementById('arcade-back')", 40000, 200);
        await sleep(250);
        const finish = await evj(`({ body: document.getElementById('arcade-body').innerText, recordText: (document.querySelector('.arcade-record') || {}).textContent || null, rewardText: (document.querySelector('.arcade-reward') || {}).textContent || null, detail: [...document.querySelectorAll('#arcade-body .arcade-hint')].map(e => e.textContent), arcade: window.__MOYU__.state.arcade })`);
        const shotFinish = await shot("rhythm-finish-30s-record");
        const logs = await evj("window.__s1b || []");
        await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
        await sleep(150);
        await closeArcade();
        return { setup, mid, done, finish, logs, shot: shotFinish };
      });
      report.phases.S1b = s1bRes;

      // ── S1a：节奏 7s（窗口/判定文字/音效/漏拍/高亮）──
      const s1aRes = await withRetry("S1a", async () => {
        await ensureMenu();
        const setup = await evj(`(() => {
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
          push(6260, () => tap('b11+160'));
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
        await sleep(2300);
        const midShot = await shot("rhythm-judgetext-audio");
        const planDone = await waitFor("window.__verify && window.__verify.planDone === true", 12000, 100);
        await sleep(400);
        const data = await evj(`({ ops: window.__verify.ops, missTimed: window.__verify.missTimed, onSamples: window.__verify.onSamples, planDone: window.__verify.planDone, oscTotal: window.__oscCount })`);
        const playedBefore = await evj("window.__MOYU__.state.arcade.played");
        await closeArcade();
        const stateAfter = await evj("window.__MOYU__.state.arcade");
        const beatTime = (i) => 0.6 + i * 0.5;
        const onset = {};
        for (const [t, on] of data.onSamples) for (const i of on) if (onset[i] === undefined) onset[i] = t;
        const onsetRows = Object.keys(onset).map((i) => ({ beat: +i, onsetMs: onset[i] - beatTime(+i) * 1000 })).filter((x) => x.beat <= 12);
        return { setup, planDone, data, playedBefore, stateAfter, onsetRows, shot: midShot };
      });
      report.phases.S1a = s1aRes;

      // ── S2：老板弹层不再打断摸鱼站 ──
      const s2Res = await withRetry("S2", async () => {
        // 先清掉长阶段里被推迟、刚触发的巡逻
        await sleep(400);
        const preShown = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 6000, 80);
        if (preShown) { await evaluate(`(() => { const b=document.querySelector('#boss-opts button'); if(b) b.click(); return 1; })()`); await sleep(600); }
        // (a) 菜单打开时 forceBoss
        await ensureMenu();
        await evaluate(`window.__MOYU__.forceBoss('choice')`);
        const aSeen = [];
        for (let i = 0; i < 34; i++) { aSeen.push(await bossSnapshot()); await sleep(90); }
        const aOver = aSeen.filter((x) => !x.bossHidden).length;
        const aCards = aSeen.filter((x) => !x.cardsHidden).length;
        // (b) 对局中 forceBoss
        const started = await evj(`(() => { const P=window.__P; P.armed=false; P.startAt=null; document.querySelector('button[data-game="rhythm"]').click(); return { startAt: P.startAt }; })()`);
        await sleep(300);
        await evaluate(`window.__MOYU__.forceBoss('choice')`);
        const bSeen = [];
        let bShot = null;
        for (let i = 0; i < 32; i++) { const st = await bossSnapshot(); bSeen.push(st); if (!st.bossHidden && !bShot) bShot = await shot("boss-over-arcade-should-not"); await sleep(90); }
        const bOver = bSeen.filter((x) => !x.bossHidden).length;
        const playedBeforeClose = await evj("window.__MOYU__.state.arcade.played");
        await closeArcade();
        const playedAfterClose = await evj("window.__MOYU__.state.arcade.played");
        // (c) 关闭后延迟巡逻是否恢复
        const resumed = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 7000, 80);
        const resumedInfo = await bossSnapshot();
        // (d) 残留边角：巡逻进行中打开摸鱼站
        let residual = null, residualShot = null;
        if (resumed) {
          await evaluate(`document.getElementById('btn-arcade').click()`);
          await sleep(450);
          residual = await bossSnapshot();
          if (!residual.bossHidden) residualShot = await shot("active-boss-over-arcade");
          await evaluate(`(() => { const b=document.querySelector('#boss-opts button'); if(b) b.click(); return 1; })()`);
          await sleep(600);
          await closeArcade();
        }
        return { preShown, aOver, aCards, aSample: aSeen[0], started, bOver, bSample: bSeen[0], playedBeforeClose, playedAfterClose, resumed, resumedInfo, residual, shots: { b: bShot, residual: residualShot } };
      });
      report.phases.S2 = s2Res;

      // ── S3：找老板实时分数 ──
      await seedArcade(0);
      const s3Res = await withRetry("S3", async () => {
        await ensureMenu();
        const run = await evj(`(() => {
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
            clicks.push({ k, t: +(orig() - t0).toFixed(0), score: scoreOf() });
          }
          const faces = [...document.getElementById('play-grid').querySelectorAll('button.face')];
          const wrong = faces.find(f => !f.classList.contains('boss'));
          const beforeWrong = scoreOf();
          wrong.click();
          const afterWrong = scoreOf();
          return { startAt, clicks, beforeWrong, afterWrong, tAfterWrong: +(orig() - t0).toFixed(0) };
        })()`);
        await sleep(1000);
        const later = await evj(`({ score: document.getElementById('play-score') ? document.getElementById('play-score').textContent : null, timer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null })`);
        const displayed = later.score;
        await closeArcade();
        await sleep(250);
        const after = await evj(`({ arcade: window.__MOYU__.state.arcade, body: document.getElementById('arcade-body').innerText.slice(0,240), open: !document.getElementById('arcade').classList.contains('hidden') })`);
        return { run, later, displayed, after };
      });
      report.phases.S3 = s3Res;

      // ── S4：0/3 文案 ──
      await seedArcade(3);
      const s4Res = await withRetry("S4", async () => {
        await evaluate(`document.getElementById('btn-arcade').click()`);
        await sleep(1000);
        const data = await evj(`({ left: document.getElementById('arcade-left').textContent, played: window.__MOYU__.state.arcade.played, cardBtns: [...document.querySelectorAll('.arcade-card button')].map(b => ({ text: b.textContent, disabled: b.disabled })), cardsLocked: [...document.querySelectorAll('.arcade-card')].map(c => c.classList.contains('locked')) })`);
        const s4shot = await shot("menu-locked-0of3");
        return { data, shot: s4shot };
      });
      report.phases.S4 = s4Res;

      report.errs = await evj("window.__errs || []");
      report.finishedAt = new Date().toISOString();
      writeFileSync(`${OUT}/verify2-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote verify2-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e).slice(0, 1500);
      try { report.errs = await evj("window.__errs || []"); } catch {}
      writeFileSync(`${OUT}/verify2-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 300000 },
);

const p = report.phases;
console.log("=== V0 ===", JSON.stringify(p.V0));
console.log("=== S1b rhythm 30s ===", JSON.stringify({ ok: p.S1b?.ok, mid: p.S1b?.data?.mid, done: p.S1b?.data?.done, finish: p.S1b?.data?.finish, logs: p.S1b?.data?.logs }));
console.log("=== S1a rhythm 7s ===");
for (const o of p.S1a?.data?.ops || []) console.log(`  ${String(o.label).padEnd(14)} delta ${String(o.delta).padStart(4)} judge ${String(o.judge).padEnd(8)} cls ${String(o.judgeCls).padEnd(20)} osc ${o.osc}`);
console.log("  missTimed", JSON.stringify(p.S1a?.data?.missTimed));
console.log("  onsetRows", JSON.stringify(p.S1a?.data?.onsetRows), "oscTotal", p.S1a?.data?.oscTotal);
console.log("  planDone", p.S1a?.data?.planDone, "playedBefore", p.S1a?.data?.playedBefore, "stateAfter", JSON.stringify(p.S1a?.data?.stateAfter));
console.log("=== S2 ===", JSON.stringify(p.S2?.data));
console.log("=== S3 ===", JSON.stringify(p.S3?.data));
console.log("=== S4 ===", JSON.stringify(p.S4?.data));
console.log("reloads", JSON.stringify({ s1b: p.S1b_reloads, s1a: p.S1a_reloads, s2: p.S2_reloads, s3: p.S3_reloads, s4: p.S4_reloads }));