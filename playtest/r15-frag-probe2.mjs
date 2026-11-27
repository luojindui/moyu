// r15-frag 探针 v2（稳健版）：node playtest/r15-frag-probe2.mjs <s2|s4|s3b>
// 所有 CDP 调用 8s 超时（避免 Chrome 失联时永久挂起）；每次独立 Chrome，不残留。
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PHASE = process.argv[2] || "s2";
const BASE = "http://127.0.0.1:5173/";
const OUT = "playtest/r15-frag-shots";
mkdirSync(OUT, { recursive: true });
const WATCH = ["src/ui/arcade.ts", "src/engine/minigames.ts", "src/style.css", "src/main.ts", "index.html"];
const hashFiles = () =>
  Object.fromEntries(WATCH.map((f) => [f, createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 12)]));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { phase: PHASE, meta: { startedAt: new Date().toISOString(), url: BASE }, hashesBefore: hashFiles(), errors: [], steps: [] };
const step = (s) => {
  R.steps.push({ t: +((Date.now() - t0) / 1000).toFixed(1), s });
  log("step", s);
};
const write = () => {
  R.meta.finishedAt = new Date().toISOString();
  R.hashesAfter = hashFiles();
  writeFileSync(`playtest/r15-frag-${PHASE}.json`, JSON.stringify(R, null, 2));
  log("evidence ->", `playtest/r15-frag-${PHASE}.json`);
};

try {
  await runChrome(
    async ({ port }) => {
      const c = await connect(port);
      // 所有 CDP 调用加超时，防止失联挂死
      const rawSend = c.send.bind(c);
      c.send = (method, params) =>
        Promise.race([
          rawSend(method, params),
          new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout: " + method)), 8000)),
        ]);
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      const J = (v) => JSON.stringify(v);
      const shot = async (name) => {
        const r = await c.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
        log("shot", name);
      };
      const safeEv = async (expr) => {
        try {
          return await c.ev(expr);
        } catch (e) {
          return { __err: String(e).slice(0, 200) };
        }
      };
      const waitFor = async (expr, ms = 8000) => {
        const st = Date.now();
        while (Date.now() - st < ms) {
          const v = await safeEv(expr);
          if (v) return v;
          await sleep(120);
        }
        return null;
      };
      const load = async (w, h, mobile) => {
        await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
        await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await c.send("Page.navigate", { url: BASE });
        await sleep(400);
        await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 15000);
        await sleep(900);
        R.pageOrigin = await safeEv("performance.timeOrigin");
      };
      const tap = async (x, y) => {
        await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
        await sleep(35);
        await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(110);
      };
      const rectOf = async (sel) =>
        safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,text:(e.textContent||'').slice(0,100),vis:b.width>0&&b.height>0};})()`);
      const tapSel = async (sel) => {
        const r = await rectOf(sel);
        if (!r || r.__err) return { error: "no el " + sel };
        await tap(r.x + r.w / 2, r.y + r.h / 2);
        return r;
      };
      const esc = async () => {
        for (const type of ["keyDown", "keyUp"])
          await c.send("Input.dispatchKeyEvent", { type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
        await sleep(180);
      };
      const stopTimers = () => safeEv(`(()=>{for (const k of ['__autoCatch','__autoBoss','__autoBeat','__mash','__bossAuto']) { if (window[k]) clearInterval(window[k]); } return 1;})()`);
      const snap = () =>
        safeEv(`(()=>{
          try {
            const s = __MOYU__.state; const $ = (id) => document.getElementById(id);
            const toast = $('dom-toast');
            return {
              moyu: s.moyu, arcade: s.arcade, levels: s.levels,
              hudMoyu: $('hud-moyu').textContent, hudIdle: $('hud-idle').textContent, hudClick: $('hud-click').textContent,
              leftText: $('arcade-left').textContent, open: !$('arcade').classList.contains('hidden'),
              title: $('arcade-title').textContent, body: ($('arcade-body').innerText || '').slice(0, 700),
              resultShown: !!$('arcade-back'),
              bossOpen: !$('boss-choice').classList.contains('hidden'),
              toast: { text: (toast?.textContent || '').slice(0, 200), show: !!toast?.classList.contains('show') },
            };
          } catch (e) { return { __err: String(e).slice(0, 200) }; }
        })()`);
      const openArcade = async () => {
        await tapSel("#btn-arcade");
        await sleep(280);
        const s = await snap();
        return { open: s.open, left: s.leftText, body: s.body, bossOpen: s.bossOpen };
      };

      /* ============ s2：中途退出 / 次数扣减 / 误触 / 锁死态 ============ */
      if (PHASE === "s2") {
        log("s2: 移动端 390x844 中途退出实测");
        await load(390, 844, true);
        await shot("s2-01-first-screen");
        step("open menu");
        R.entry = await openArcade();
        await shot("s2-02-menu");

        // 0) 打开菜单就关：不扣次数
        const s0 = await snap();
        await tapSel("#arcade-close");
        await sleep(300);
        const s0b = await snap();
        R.menuCloseNoCost = { before: s0.arcade.played, after: s0b.arcade.played, open: s0b.open };

        // 1) 局内点 ✕（接咖啡 2.5s）
        step("coffee 2.5s then X");
        const q1a = await snap();
        await tapSel("#btn-arcade");
        await sleep(250);
        await tapSel('#arcade-body button[data-game="coffee"]');
        await sleep(2500);
        const mid1 = await snap();
        await shot("s2-03-coffee-mid-before-quit");
        await tapSel("#arcade-close");
        await sleep(400);
        const q1b = await snap();
        await shot("s2-04-after-quit-x");
        R.quitX = {
          midTitle: mid1.title, midBody: mid1.body, playedBefore: q1a.arcade.played,
          closed: !q1b.open, playedAfter: q1b.arcade.played, bestAfter: q1b.arcade.best,
          moyuDelta: +(q1b.moyu - q1a.moyu).toFixed(2), toast: q1b.toast, leftText: q1b.leftText,
          resultShown: q1b.resultShown,
        };
        step("reopen after quit");
        await tapSel("#btn-arcade");
        await sleep(280);
        const q1c = await snap();
        R.quitX.afterReopen = { left: q1c.leftText, played: q1c.arcade.played, body: q1c.body };
        await shot("s2-05-reopen-after-quit");

        // 2) 局内 Esc 退出（找老板 3s）
        step("findboss 3s then Esc");
        const q2a = await snap();
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(3000);
        await shot("s2-06-findboss-mid");
        await esc();
        const q2b = await snap();
        await shot("s2-07-after-quit-esc");
        R.quitEsc = {
          closed: !q2b.open, playedBefore: q2a.arcade.played, playedAfter: q2b.arcade.played,
          moyuDelta: +(q2b.moyu - q2a.moyu).toFixed(2), toast: q2b.toast, leftText: q2b.leftText,
        };
        // 等 31s：不应该有幽灵结算
        step("wait 31s zombie check");
        const w0 = await snap();
        await sleep(31000);
        const w1 = await snap();
        R.zombieCheck = {
          playedAtStart: w0.arcade.played, playedAfter31s: w1.arcade.played,
          bestUnchanged: JSON.stringify(w0.arcade.best) === JSON.stringify(w1.arcade.best),
          open: w1.open, bossOpen: w1.bossOpen, toast: w1.toast,
          moyuDeltaIdle: +(w1.moyu - w0.moyu).toFixed(2),
        };
        await shot("s2-08-after-zombie-wait");

        // 重新加载（清掉可能残留的弹窗干扰），再测误触背景
        step("reload");
        R.reloadedBeforeMistap = (await safeEv("performance.timeOrigin")) !== R.pageOrigin;
        await load(390, 844, true);
        await shot("s2-09-reload-first-screen");
        step("open + rhythm 2s then backdrop tap");
        const abefore = await snap();
        await tapSel("#btn-arcade");
        await sleep(280);
        await tapSel('#arcade-body button[data-game="rhythm"]');
        await sleep(2000);
        const rMid = await snap();
        await shot("s2-10-rhythm-mid");
        const panel = await rectOf(".arcade-panel");
        const tapPt = { x: 8, y: panel && !panel.__err ? Math.round(panel.y + panel.h / 2) : 300 };
        R.mistap = { midTitle: rMid.title, midBody: rMid.body, playedBefore: rMid.arcade.played, bossOpen: rMid.bossOpen, panelRect: panel, tapAt: tapPt };
        await tap(tapPt.x, tapPt.y);
        await sleep(400);
        const ab = await snap();
        await shot("s2-11-after-backdrop-mistap");
        R.mistap.closed = !ab.open;
        R.mistap.playedAfter = ab.arcade.played;
        R.mistap.toast = ab.toast;
        R.mistap.moyuDelta = +(ab.moyu - abefore.moyu).toFixed(2);

        // 3) 用完 3 次后的锁死态（此前已消耗 2 次，再玩 1 次找老板）
        step("third play then locked");
        await tapSel("#btn-arcade");
        await sleep(280);
        const b3 = await snap();
        R.beforeThird = { left: b3.leftText, played: b3.arcade.played, body: b3.body };
        // 用 Esc 再消耗一次（快速）
        await tapSel('#arcade-body button[data-game="coffee"]');
        await sleep(1500);
        await esc();
        await sleep(400);
        const afterThird = await snap();
        R.thirdQuit = { played: afterThird.arcade.played, left: afterThird.leftText, toast: afterThird.toast };
        await tapSel("#btn-arcade");
        await sleep(320);
        R.locked = {
          snap: await snap(),
          info: await safeEv(`(()=>{
            const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
            return {
              leftText: document.getElementById('arcade-left').textContent,
              panelText: document.getElementById('arcade').innerText.slice(0,800),
              cards: cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText, desc:c.querySelector('.arcade-desc')?.innerText, locked:c.classList.contains('locked'), disabled:!!c.querySelector('button')?.disabled, btnText:c.querySelector('button')?.innerText})),
              showsResetHint: /明天|次日|重置|跨日|恢复/.test(document.getElementById('arcade').innerText),
              refreshLeftTextLive: (()=>{ const el=document.getElementById('arcade-left'); return el.textContent; })(),
            };
          })()`),
        };
        await shot("s2-12-locked");
        const dis = await rectOf("#arcade-body .arcade-card button");
        if (dis && !dis.__err) await tap(dis.x + dis.w / 2, dis.y + dis.h / 2);
        await sleep(300);
        const disAfter = await snap();
        R.locked.tapDisabled = { title: disAfter.title, played: disAfter.arcade.played, open: disAfter.open };
        await shot("s2-13-tap-disabled");
        await tapSel("#arcade-close");
        await sleep(200);
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ============ s4：节奏点击（跟拍 vs 乱点）+ 老板弹窗冲突 ============ */
      if (PHASE === "s4") {
        log("s4: 移动端 390x844 节奏点击 + 老板弹窗冲突");
        await load(390, 844, true);
        R.entry = await openArcade();
        await shot("s4-01-menu");
        step("start rhythm");
        await tapSel('#arcade-body button[data-game="rhythm"]');
        await sleep(400);
        await shot("s4-02-rhythm-start");
        // 跟拍 3s
        await safeEv(`(()=>{
          window.__autoBeat = setInterval(() => {
            const area = document.getElementById('play-area'); if (!area) return;
            if (!document.querySelector('#beat-row .beat.on')) return;
            const r = area.getBoundingClientRect();
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerType: 'touch' }));
          }, 30);
          return 1;
        })()`);
        await sleep(3000);
        await stopTimers();
        const beatScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await shot("s4-03-rhythm-onbeat");
        step("boss-choice conflict test");
        // 强制回合制老板（验证小游戏进行中弹出，z-index 18 盖住 arcade 17）
        const gameBefore = await snap();
        await safeEv(`__MOYU__.forceBoss("choice")`);
        const bossAppeared = await waitFor(`!document.getElementById('boss-choice').classList.contains('hidden')`, 8000);
        const duringBoss = await snap();
        R.bossConflict = {
          gameBefore: { title: gameBefore.title, midBody: gameBefore.body, timer: await safeEv(`document.getElementById('play-timer')?.textContent`) },
          bossAppeared: !!bossAppeared,
          bossOpen: duringBoss.bossOpen,
          bossRect: await rectOf(".boss-box"),
          playRect: await rectOf("#play-area"),
          timerDuringBoss: await safeEv(`document.getElementById('play-timer')?.textContent`),
          arcadeOpen: duringBoss.open,
          feedback: await safeEv(`(()=>{const a=document.querySelector('.arcade-play'); if(!a) return null; return {text:a.innerText.slice(0,200)};})()`),
        };
        await shot("s4-04-boss-over-minigame");
        // 自动作答，避免持续干扰
        await safeEv(`(()=>{
          window.__bossAuto = setInterval(() => {
            const p = document.getElementById('boss-choice');
            if (!p || p.classList.contains('hidden')) return;
            const b = document.querySelector('#boss-opts button');
            if (b) b.click();
          }, 250);
          return 1;
        })()`);
        await sleep(1500);
        const afterBoss = await snap();
        R.bossConflict.afterAnswer = { bossOpen: afterBoss.bossOpen, arcadeOpen: afterBoss.open, timer: await safeEv(`document.getElementById('play-timer')?.textContent`), title: afterBoss.title, body: afterBoss.body };
        await shot("s4-05-after-boss-answer");
        step("mash 3s");
        // 乱点 3s
        await safeEv(`(()=>{
          const a = document.getElementById('play-area'); if(!a) return {ok:false};
          const r = a.getBoundingClientRect();
          window.__mash = setInterval(() => { a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch'})); }, 50);
          return {ok:true};
        })()`);
        await sleep(3000);
        await stopTimers();
        const mashScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await shot("s4-06-rhythm-mash");
        R.rhythm = { onBeat3sScore: beatScore, mashExtra3sScore: mashScore };
        step("quit mid-rhythm");
        await tapSel("#arcade-close");
        await sleep(400);
        const q = await snap();
        R.rhythm.quit = { closed: !q.open, played: q.arcade.played, best: q.arcade.best, toast: q.toast, left: q.leftText };
        await shot("s4-07-rhythm-quit");
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ============ s3b：富态奖励实测（reset+grant+升级） ============ */
      if (PHASE === "s3b") {
        log("s3b: 桌面 1280x800 富态奖励");
        await load(1280, 800, false);
        R.entry = await openArcade();
        await shot("s3b-01-menu");
        // 先记录低收益基准：满分局（自动点王总）
        step("low-state findboss full run");
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(400);
        const lowStart = await snap();
        await safeEv(`(()=>{
          window.__autoBoss = setInterval(() => { const b=document.querySelector('#play-grid .face.boss'); if(!b) return; b.click(); }, 90);
          return 1;
        })()`);
        await waitFor("!!document.getElementById('arcade-back')", 40000);
        await stopTimers();
        const lowEnd = await snap();
        await shot("s3b-02-low-result");
        R.low = {
          hudIdle: lowStart.hudIdle, body: lowEnd.body, toast: lowEnd.toast, played: lowEnd.arcade.played,
          best: lowEnd.arcade.best, left: lowEnd.leftText, moyuDelta: +(lowEnd.moyu - lowStart.moyu).toFixed(2),
        };
        await tapSel("#arcade-back");
        await sleep(300);
        await tapSel("#arcade-close");
        await sleep(200);
        // 富态
        step("reset + grant + upgrades");
        await safeEv(`__MOYU__.reset()`);
        await sleep(700);
        await safeEv(`__MOYU__.grant(1e9)`);
        await sleep(600);
        R.richUpgrades = await safeEv(`(()=>{
          const ids=['phone','toilet','group','meeting','deep','retire']; let bought=0;
          for (let round=0; round<6; round++) for (const id of ids) {
            const el=document.querySelector('.shop-card[data-upgrade="'+id+'"]');
            if (el && !el.disabled) { el.click(); bought++; }
          }
          return {bought, idle:document.getElementById('hud-idle').textContent, click:document.getElementById('hud-click').textContent, moyu:document.getElementById('hud-moyu').textContent};
        })()`);
        await sleep(600);
        await shot("s3b-03-rich");
        const rb = await snap();
        R.rich = { before: { hudIdle: rb.hudIdle, hudClick: rb.hudClick, moyu: rb.moyu } };
        step("rich-state findboss full run");
        const richOpen = await openArcade();
        R.rich.arcadeLeft = richOpen.left;
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(400);
        const richStart = await snap();
        await safeEv(`(()=>{
          window.__autoBoss = setInterval(() => {
            const p=document.getElementById('boss-choice');
            if (p && !p.classList.contains('hidden')) { const b=document.querySelector('#boss-opts button'); if (b) b.click(); return; }
            const b=document.querySelector('#play-grid .face.boss'); if (b) b.click();
          }, 90);
          return 1;
        })()`);
        await waitFor("!!document.getElementById('arcade-back')", 40000);
        await stopTimers();
        const richEnd = await snap();
        await shot("s3b-04-rich-result");
        R.rich.after = {
          hudIdle: richStart.hudIdle, body: richEnd.body, toast: richEnd.toast, played: richEnd.arcade.played,
          best: richEnd.arcade.best, left: richEnd.leftText, moyu: richEnd.moyu,
          moyuDelta: +(richEnd.moyu - rb.moyu).toFixed(2), bossOpen: richEnd.bossOpen,
        };
        R.rich.rewardParsed = /\+([0-9.]+[^（]*)/.exec(richEnd.toast.text)?.[1] ?? null;
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      R.errors = c.errors.slice(0, 20);
      c.close();
    },
    { timeoutMs: 170_000 },
  );
} catch (e) {
  R.crash = String(e?.stack || e).slice(0, 2000);
  log("CRASH", R.crash.slice(0, 600));
}
write();
console.log("DONE", PHASE);