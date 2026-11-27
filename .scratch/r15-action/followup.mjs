/**
 * R15 操作党探针 3：补充实测
 *  F1 连打 160ms 间隔（6.25/s，人类双指可及）→ 能否全 perfect
 *  F2 连打 60ms 间隔（16.7/s）→ 是否直接满分
 *  F3 隐藏分：一次 perfect 屏幕分 +25？good +10？
 *  F4 完全打偏（0.2s 外）→ 有无任何 miss 反馈
 *  F5 开局预备：click→首拍/首个高亮 的间隔（无倒数/无音）
 *  F6 老板 choice 弹层是否盖在小游戏上（先测主场景对照）
 *  F7 每日 3 次锁定（race-free 注入存档）
 */
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.MOYU_URL ?? "http://127.0.0.1:5173/";
const OUT = ".scratch/r15-action";
mkdirSync(OUT, { recursive: true });
const report = { startedAt: new Date().toISOString(), url: URL, head: "77019bc", phases: {} };

const HARNESS = `(() => {
  if (window.__P) return "already";
  const orig = performance.now.bind(performance);
  const P = { origNow: orig, armed: false, armedAt: null, startAt: null, clickAt: null };
  window.__P = P;
  performance.now = function () { const v = orig(); if (P.armed && P.startAt == null) P.startAt = v; return v; };
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest && (t.closest("button[data-game]") || t.closest("#btn-arcade"))) { P.armed = true; P.armedAt = orig(); P.startAt = null; }
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

    await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await b.send("Page.navigate", { url: URL });
    await waitReady(); await sleep(800); await evaluate(HARNESS); await dismiss();

    try {
      const openMenu = async () => {
        await evaluate(`(() => {
          const arc = document.getElementById('arcade');
          if (arc.classList.contains('hidden')) document.getElementById('btn-arcade').click();
          const back = document.getElementById('arcade-back'); if (back) back.click();
          return 1;
        })()`);
        await sleep(200);
      };
      const closeArcade = async () => {
        await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')){ const c=document.getElementById('arcade-close'); if(c) c.click(); } return 1; })()`);
        await sleep(150);
      };
      const startRhythm = async () => evj(`(() => {
        const P = window.__P;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        return { startAt: P.startAt };
      })()`);

      // ── F1：160ms 连打 ──
      await openMenu();
      const f1 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const row = document.getElementById('beat-row'); const scoreEl = document.getElementById('play-score');
        let k = 0; const total = 75; const T = 160;
        const fire = () => {
          const target = startAt + 1000 + k * T;
          while (orig() < target) {}
          area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          k++;
          if (k < total) setTimeout(fire, Math.max(0, target + T - orig() - 6));
          else { window.__f1 = { taps: total, perfect: row.querySelectorAll('.beat.perfect').length, good: row.querySelectorAll('.beat.good').length, used: row.querySelectorAll('.beat.perfect,.beat.good').length, score: scoreEl.textContent, when: +(orig()-startAt).toFixed(0) }; window.__f1done = true; }
        };
        setTimeout(fire, Math.max(0, (startAt + 1000) - orig() - 6));
        return { startAt };
      })()`);
      await waitFor("window.__f1done === true", 25000, 100);
      const f1res = await evj("window.__f1 || {}");
      await closeArcade();
      report.phases.F1 = { setup: f1, res: f1res };

      // ── F2：60ms 连打 ──
      await openMenu();
      const f2 = await startRhythm();
      const f2res = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const startAt = ${f2.startAt};
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const row = document.getElementById('beat-row'); const scoreEl = document.getElementById('play-score');
        let k = 0; const total = 150; const T = 60;
        const fire = () => {
          const target = startAt + 1000 + k * T;
          while (orig() < target) {}
          area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
          k++;
          if (k < total) setTimeout(fire, Math.max(0, target + T - orig() - 4));
          else { window.__f2 = { taps: total, perfect: row.querySelectorAll('.beat.perfect').length, good: row.querySelectorAll('.beat.good').length, used: row.querySelectorAll('.beat.perfect,.beat.good').length, score: scoreEl.textContent, when: +(orig()-startAt).toFixed(0) }; window.__f2done = true; }
        };
        setTimeout(fire, Math.max(0, (startAt + 1000) - orig() - 6));
        return 1;
      })()`);
      await waitFor("window.__f2done === true", 25000, 100);
      const f2res2 = await evj("window.__f2 || {}");
      await closeArcade();
      report.phases.F2 = { setup: f2, res: f2res2 };

      // ── F3/F4：单拍 perfect 屏幕分、good 加分、完全打偏反馈 ──
      await openMenu();
      const f3 = await startRhythm();
      await sleep(300);
      const f3probe = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const startAt = ${f3.startAt};
        const area = document.getElementById('play-area'); const r = area.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        const row = document.getElementById('beat-row'); const scoreEl = document.getElementById('play-score');
        const toastEl = () => { const t = document.getElementById('dom-toast'); return t ? t.textContent : null; };
        const tapAt = (t) => { while (orig() < t) {} area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true })); return +orig().toFixed(1); };
        const out = {};
        tapAt(startAt + 600);
        out.afterPerfectBeat0 = { score: scoreEl.textContent, cls: row.querySelector('[data-b="0"]').className };
        tapAt(startAt + 1200);
        out.afterGoodBeat1 = { score: scoreEl.textContent, cls: row.querySelector('[data-b="1"]').className };
        const snap = () => ({ score: scoreEl.textContent, classes: [...document.querySelectorAll('.beat')].map(e => e.className).join('|'), hint: document.querySelector('.arcade-hint').textContent, toast: toastEl(), timer: document.getElementById('play-timer').textContent });
        const before = snap();
        tapAt(startAt + 1850);
        const after = snap();
        out.missTapAt1850 = { before, after, scoreSame: before.score === after.score, classesSame: before.classes === after.classes, hintSame: before.hint === after.hint, toastSame: before.toast === after.toast, beat2: row.querySelector('[data-b="2"]').className, beat3: row.querySelector('[data-b="3"]').className };
        tapAt(startAt + 2100);
        out.afterPerfectBeat3 = { score: scoreEl.textContent, cls: row.querySelector('[data-b="3"]').className };
        window.__f3 = out;
        window.__f3done = true;
        return out;
      })()`);
      await closeArcade();
      report.phases.F3 = { setup: f3, out: f3probe };

      // ── F5：开局预备（click→首拍/首个高亮），无音无倒数 ──
      await openMenu();
      const f5 = await evj(`(() => {
        const P = window.__P, orig = P.origNow;
        const clickAt = orig();
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="rhythm"]').click();
        const startAt = P.startAt;
        window.__oscCount = 0;
        const row = document.getElementById('beat-row');
        const firstOn = [];
        const f = () => {
          const rel = orig() - startAt;
          for (const el of row.querySelectorAll('.beat.on')) firstOn.push({ i: +el.dataset.b, rel: +(rel/1000).toFixed(3) });
          if (rel < 1300) requestAnimationFrame(f);
          else window.__f5 = { startAt, clickToStart: +(startAt - clickAt).toFixed(2), firstOn, osc: window.__oscCount, body: document.querySelector('.arcade-play') ? document.querySelector('.arcade-play').innerText.slice(0,80) : null, timer: document.getElementById('play-timer').textContent, hint: document.querySelector('.arcade-hint').textContent };
        };
        requestAnimationFrame(f);
        return { clickAt, startAt };
      })()`);
      await waitFor("!!window.__f5", 4000, 50);
      const f5res = await evj("window.__f5 || {}");
      await shot("rhythm-06-start-no-countdown");
      await closeArcade();
      report.phases.F5 = { setup: f5, res: f5res };

      // ── F6：老板 choice 弹层 vs 小游戏 ──
      // 对照 A：主场景（arcade 关闭）
      await evaluate(`window.__MOYU__.forceBoss('choice')`);
      const ctrlShown = await waitFor("!document.getElementById('boss-choice').classList.contains('hidden')", 4000, 50);
      const ctrlInfo = await evj(`(() => {
        const bc = document.getElementById('boss-choice'); const r = bc.getBoundingClientRect();
        return { hidden: bc.classList.contains('hidden'), rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], z: getComputedStyle(bc).zIndex, bodyHasChoiceOpen: document.body.classList.contains('choice-open') };
      })()`);
      if (!ctrlInfo.hidden) { await evaluate(`document.querySelector('#boss-opts button')?.click()`); await sleep(500); }
      report.phases.F6control = { shown: ctrlShown, info: ctrlInfo };
      // 对照 B：arcade 打开 + 节奏局
      await openMenu();
      const f6 = await startRhythm();
      await evaluate(`window.__MOYU__.forceBoss('choice')`);
      const seen = [];
      let f6shot = null;
      for (let i = 0; i < 70; i++) {
        const st = await evj(`(() => { const bc=document.getElementById('boss-choice'); const arc=document.getElementById('arcade'); const r=bc.getBoundingClientRect(); return { t: +window.__P.origNow().toFixed(0), hidden: bc.classList.contains('hidden'), rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], arcadeOpen: !arc.classList.contains('hidden'), bodyChoiceOpen: document.body.classList.contains('choice-open'), topAtCenter: (() => { const cx=r.left+r.width/2, cy=r.top+r.height/2; if (cx<0||cy<0||cx>innerWidth||cy>innerHeight) return null; const el=document.elementFromPoint(cx,cy); return el ? (el.id||el.className||el.tagName) : null; })() }; })()`);
        seen.push({ i, ...st });
        if (!st.hidden && !f6shot) f6shot = await shot("rhythm-05-boss-choice-over-arcade");
        await sleep(80);
      }
      const visibleSeen = seen.filter((s) => !s.hidden);
      const arcadeStillOpen = seen.length ? seen[seen.length - 1].arcadeOpen : null;
      report.phases.F6arcade = { setup: f6, visibleSamples: visibleSeen.slice(0, 6), visibleCount: visibleSeen.length, arcadeStillOpen, sample: seen.slice(0, 3), shot: f6shot };
      await closeArcade();
      await sleep(300);

      // ── F8：找老板 30s 超时（含 reload 检测）──
      const bootMark = await evaluate("performance.timeOrigin");
      await openMenu();
      const f8 = await evj(`(() => {
        const P = window.__P;
        P.armed = false; P.startAt = null;
        document.querySelector('button[data-game="findboss"]').click();
        window.__f8 = { startAt: P.startAt };
        return window.__f8;
      })()`);
      await sleep(6000);
      const f8mid = await evj(`({ timer: document.getElementById('play-timer') ? document.getElementById('play-timer').textContent : null, body: document.getElementById('arcade-body').innerText.slice(0,140), left: document.getElementById('arcade-left').textContent, t: +(window.__P.origNow() - ${f8.startAt}).toFixed(0), timeOrigin: performance.timeOrigin, arcadeBodyExists: !!document.getElementById('arcade-body') })`);
      const f8shot = await shot("findboss-05-idle-6s");
      const f8done = await waitFor("!!document.getElementById('arcade-back')", 36000, 250);
      const f8after = await evj(`({ t: window.__P ? +(window.__P.origNow() - ${f8.startAt}).toFixed(0) : null, timeOrigin: performance.timeOrigin, backExists: !!document.getElementById('arcade-back'), body: document.getElementById('arcade-body').innerText, left: document.getElementById('arcade-left').textContent, arcade: window.__MOYU__.state.arcade, arcadeOpen: !document.getElementById('arcade').classList.contains('hidden') })`);
      const reloaded = f8after.timeOrigin !== bootMark;
      const f8finishShot = await shot("findboss-06-idle-timeout");
      report.phases.F8 = { start: f8, mid6s: f8mid, done: f8done, after: f8after, reloaded, shots: [f8shot, f8finishShot] };
      if (f8done) await evaluate(`(() => { const b=document.getElementById('arcade-back'); if(b) b.click(); return 1; })()`);
      await sleep(150);
      await evaluate(`(() => { const arc=document.getElementById('arcade'); if(!arc.classList.contains('hidden')) document.getElementById('arcade-close').click(); return 1; })()`);
      await sleep(150);

      // ── F7：每日 3 次锁定（race-free 注入）──
      const inj = await b.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(() => { try {
          const raw = localStorage.getItem('moyu-save'); const blob = raw ? JSON.parse(raw) : { v: 2 };
          const d = new Date(); const today = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
          blob.arcade = { date: today, played: 3, best: (blob.arcade && blob.arcade.best) || { rhythm: 1475 } };
          blob.savedAt = Date.now(); localStorage.setItem('moyu-save', JSON.stringify(blob));
        } catch (e) {} })()`,
      });
      await b.send("Page.reload", {});
      await sleep(1400); await waitReady(); await sleep(500);
      await b.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: inj.identifier });
      await evaluate(HARNESS); await dismiss();
      await evaluate(`document.getElementById('btn-arcade').click()`);
      await sleep(250);
      const locked = await evj(`({ left: document.getElementById('arcade-left').textContent, played: window.__MOYU__.state.arcade.played, cards: [...document.querySelectorAll('.arcade-card')].map(c => ({ name: c.querySelector('.arcade-name').textContent, locked: c.classList.contains('locked'), disabled: c.querySelector('button').disabled, label: c.querySelector('button').textContent })) })`);
      const lockedShot = await shot("layout-04-locked-3plays");
      report.phases.F7 = { locked, shot: lockedShot };

      writeFileSync(`${OUT}/followup-report.json`, JSON.stringify(report, null, 2));
      console.log("wrote followup-report.json");
    } catch (e) {
      report.error = String(e && e.stack ? e.stack : e);
      writeFileSync(`${OUT}/followup-report-error.json`, JSON.stringify(report, null, 2));
      throw e;
    }
  },
  { timeoutMs: 180000 },
);

const p = report.phases;
console.log("=== F1 160ms spam ===", JSON.stringify(p.F1));
console.log("=== F2 60ms spam ===", JSON.stringify(p.F2));
console.log("=== F3 hidden bonus/miss ===", JSON.stringify(p.F3?.out));
console.log("=== F5 lead-in ===", JSON.stringify({ clickToStart: p.F5?.res?.clickToStart, firstOn: (p.F5?.res?.firstOn || []).slice(0, 2), osc: p.F5?.res?.osc, timer: p.F5?.res?.timer, hint: p.F5?.res?.hint, body: p.F5?.res?.body }));
console.log("=== F6 control ===", JSON.stringify(p.F6control));
console.log("=== F6 arcade ===", JSON.stringify({ visibleCount: p.F6arcade?.visibleCount, visibleSamples: p.F6arcade?.visibleSamples, arcadeStillOpen: p.F6arcade?.arcadeStillOpen, shot: p.F6arcade?.shot }));
console.log("=== F7 locked ===", JSON.stringify(p.F7?.locked));
console.log("=== F8 findboss idle ===", JSON.stringify({ mid6s: p.F8?.mid6s, done: p.F8?.done, reloaded: p.F8?.reloaded, after: p.F8?.after && { t: p.F8.after.t, backExists: p.F8.after.backExists, body: p.F8.after.body, arcade: p.F8.after.arcade } }));