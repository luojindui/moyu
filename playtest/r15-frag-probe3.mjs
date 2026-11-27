// r15-frag 探针 v3：node playtest/r15-frag-probe3.mjs <s5|s3b>
// 用 in-page 合成 click 为主（避开 Input 偶发挂起），关键点击同时尝试真实触摸；所有 CDP 8s 超时。
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PHASE = process.argv[2] || "s5";
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
      const rawSend = c.send.bind(c);
      c.send = (method, params) =>
        Promise.race([rawSend(method, params), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout: " + method)), 8000))]);
      await c.send("Page.enable");
      await c.send("Runtime.enable");
      const J = (v) => JSON.stringify(v);
      const shot = async (name) => {
        try {
          const r = await c.send("Page.captureScreenshot", { format: "png" });
          writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, "base64"));
          log("shot", name);
        } catch (e) {
          log("shot FAILED", name, String(e).slice(0, 80));
        }
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
      };
      // 合成点击（与真实点击走同一 click 监听）
      const clickSel = (sel) => safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return 'no-el'; e.click(); return 'ok';})()`);
      const tapTry = async (x, y) => {
        try {
          await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
          await sleep(35);
          await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await sleep(120);
          return "touch";
        } catch (e) {
          return "touch-fail:" + String(e).slice(0, 60);
        }
      };
      const rectOf = async (sel) =>
        safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,text:(e.textContent||'').slice(0,120),vis:b.width>0&&b.height>0};})()`);
      const snap = () =>
        safeEv(`(()=>{
          try {
            const s = __MOYU__.state; const $ = (id) => document.getElementById(id);
            const toast = $('dom-toast');
            return {
              moyu: s.moyu, arcade: s.arcade, hudIdle: $('hud-idle').textContent,
              leftText: $('arcade-left').textContent, open: !$('arcade').classList.contains('hidden'),
              title: $('arcade-title').textContent, body: ($('arcade-body').innerText || '').slice(0, 700),
              resultShown: !!$('arcade-back'), bossOpen: !$('boss-choice').classList.contains('hidden'),
              toast: { text: (toast?.textContent || '').slice(0, 200), show: !!toast?.classList.contains('show') },
            };
          } catch (e) { return { __err: String(e).slice(0, 200) }; }
        })()`);
      const openArcade = async () => {
        await clickSel("#btn-arcade");
        await sleep(300);
        return snap();
      };

      /* ======== s5：误触背景 / 节奏乱点 / 老板弹窗冲突 / 锁死态 ======== */
      if (PHASE === "s5") {
        log("s5: 移动端 390x844 误触+老板冲突+锁死");
        await load(390, 844, true);
        await shot("s5-01-first-screen");
        const m = await openArcade();
        R.entry = { open: m.open, left: m.leftText, body: m.body };
        await shot("s5-02-menu");

        // A. 节奏点击：先跟拍 2.5s，再乱点 2.5s
        step("rhythm on-beat then mash");
        await clickSel('#arcade-body button[data-game="rhythm"]');
        await sleep(350);
        await shot("s5-03-rhythm-start");
        await safeEv(`(()=>{
          window.__autoBeat = setInterval(() => {
            const area = document.getElementById('play-area'); if (!area) return;
            if (!document.querySelector('#beat-row .beat.on')) return;
            const r = area.getBoundingClientRect();
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerType: 'touch' }));
          }, 30);
          return 1;
        })()`);
        await sleep(2500);
        await safeEv(`clearInterval(window.__autoBeat)`);
        const beatScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await shot("s5-04-rhythm-onbeat");
        await safeEv(`(()=>{
          const a=document.getElementById('play-area'); const r=a.getBoundingClientRect();
          window.__mash=setInterval(()=>{a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch'}));},50);
          return 1;
        })()`);
        await sleep(2500);
        await safeEv(`clearInterval(window.__mash)`);
        const mashScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await shot("s5-05-rhythm-mash");
        R.rhythm = { onBeat2500ms: beatScore, mashExtra2500ms: mashScore };

        // B. 小游戏进行中触发老板「回合制」弹窗
        step("forceBoss choice during rhythm");
        const beforeBoss = await snap();
        const timerBefore = await safeEv(`document.getElementById('play-timer')?.textContent`);
        await safeEv(`__MOYU__.forceBoss("choice")`);
        const appeared = await waitFor(`!document.getElementById('boss-choice').classList.contains('hidden')`, 9000);
        const during = await snap();
        const timerDuring = await safeEv(`document.getElementById('play-timer')?.textContent`);
        R.bossConflict = {
          appeared: !!appeared, bossOpen: during.bossOpen, arcadeOpen: during.open, titleDuring: during.title,
          timerBefore, timerDuring,
          bossRect: await rectOf(".boss-box"),
          playRect: await rectOf("#play-area"),
          overlap: await safeEv(`(()=>{
            const b=document.querySelector('.boss-box'), p=document.getElementById('play-area');
            if(!b||!p) return null;
            const A=b.getBoundingClientRect(), B=p.getBoundingClientRect();
            const w=Math.max(0,Math.min(A.right,B.right)-Math.max(A.left,B.left));
            const h=Math.max(0,Math.min(A.bottom,B.bottom)-Math.max(A.top,B.top));
            return {w:Math.round(w),h:Math.round(h),areaRatio:+(w*h/(B.width*B.height||1)).toFixed(3)};
          })()`),
          zIndex: await safeEv(`(()=>{const b=document.getElementById('boss-choice'), a=document.getElementById('arcade'); return {boss:getComputedStyle(b).zIndex, arcade:getComputedStyle(a).zIndex};})()`),
          gameText: during.body,
        };
        await shot("s5-06-boss-over-minigame");
        // 自动答题（避免它继续打断）
        await safeEv(`(()=>{window.__bossAuto=setInterval(()=>{const p=document.getElementById('boss-choice'); if(!p||p.classList.contains('hidden'))return; const b=document.querySelector('#boss-opts button'); if(b)b.click();},250); return 1;})()`);
        await sleep(1800);
        const afterBoss = await snap();
        R.bossConflict.after = { bossOpen: afterBoss.bossOpen, arcadeOpen: afterBoss.open, title: afterBoss.title, timer: await safeEv(`document.getElementById('play-timer')?.textContent`), body: afterBoss.body, toast: afterBoss.toast };
        await shot("s5-07-after-boss");
        await safeEv(`clearInterval(window.__bossAuto)`);

        // C. 误触背景（局内点面板外）：现版本会结算并扣次数
        step("backdrop mistap mid-game");
        const panel = await rectOf(".arcade-panel");
        const playedBefore = afterBoss.arcade.played;
        const tapPt = { x: 8, y: panel && !panel.__err ? Math.round(panel.y + panel.h / 2) : 300 };
        const how = await tapTry(tapPt.x, tapPt.y);
        await sleep(400);
        let afterTap = await snap();
        if (afterTap.open) {
          // 触摸没生效 → 合成 click 到根节点（等价于背景点击）
          await safeEv(`document.getElementById('arcade').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
          await sleep(400);
          afterTap = await snap();
        }
        R.mistap = { playedBefore, tapAt: tapPt, how, closed: !afterTap.open, playedAfter: afterTap.arcade.played, toast: afterTap.toast, resultShown: afterTap.resultShown, left: afterTap.leftText };
        await shot("s5-08-after-backdrop-mistap");

        // D. 快速消耗剩余次数 → 锁死态
        step("burn remaining attempts");
        R.burn = [];
        for (let i = 0; i < 4; i++) {
          const s = await openArcade();
          if (!s.open) break;
          const b = await snap();
          if (!b.body.includes("开始（")) { R.burn.push({ i, locked: true, left: b.leftText, body: b.body }); break; }
          await clickSel('#arcade-body button[data-game="coffee"]');
          await sleep(1300);
          await clickSel("#arcade-close");
          await sleep(350);
          const q = await snap();
          R.burn.push({ i, left: q.leftText, played: q.arcade.played, toast: q.toast });
        }
        await shot("s5-09-burned");
        // 锁死态：打开后等 800ms 让 refresh 循环覆盖 left 文案，再读
        step("locked state");
        const lockOpen = await openArcade();
        await sleep(800);
        R.locked = {
          open: lockOpen.open,
          info: await safeEv(`(()=>{
            const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
            const el=document.getElementById('arcade-left');
            return {
              leftTextLiveAfter800ms: el.textContent,
              panelText: document.getElementById('arcade').innerText.slice(0,900),
              cards: cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText, locked:c.classList.contains('locked'), disabled:!!c.querySelector('button')?.disabled, btnText:c.querySelector('button')?.innerText})),
              showsResetHint: /明天|次日|重置|跨日|恢复/.test(document.getElementById('arcade').innerText),
            };
          })()`),
        };
        await shot("s5-10-locked");
        await clickSel("#arcade-body .arcade-card button");
        await sleep(400);
        const lockAfter = await snap();
        R.locked.afterClickDisabled = { title: lockAfter.title, played: lockAfter.arcade.played, open: lockAfter.open };
        await shot("s5-11-tap-disabled");
        // 顺带：锁死后 🎮 入口是否有"已用完"提示（看按钮 aria/角标）
        R.locked.entryButton = await safeEv(`(()=>{const b=document.getElementById('btn-arcade'); return {aria:b.getAttribute('aria-label'), text:b.textContent.trim(), cls:b.className};})()`);
        // 尝试切到别的场景看 refresh 覆盖（开一次面板内 → 关闭 → 再开，比较文案）
        await clickSel("#arcade-close");
        await sleep(250);
        const again = await openArcade();
        await sleep(700);
        R.locked.reopenLeftText = await safeEv(`document.getElementById('arcade-left').textContent`);
        R.locked.reopenBody = (await snap()).body;
        await clickSel("#arcade-close");
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ======== s3b：富态奖励实测 ======== */
      if (PHASE === "s3b") {
        log("s3b: 桌面 1280x800 富态奖励实测");
        await load(1280, 800, false);
        await shot("s3b-01-first-screen");
        step("reset + grant + upgrades");
        await safeEv(`__MOYU__.reset()`);
        await sleep(700);
        await safeEv(`__MOYU__.grant(1e9)`);
        await sleep(500);
        R.upgrades = await safeEv(`(()=>{
          const ids=['phone','toilet','group','meeting','deep','retire']; let bought=0;
          for (let round=0; round<6; round++) for (const id of ids) {
            const el=document.querySelector('.shop-card[data-upgrade="'+id+'"]');
            if (el && !el.disabled) { el.click(); bought++; }
          }
          return {bought, idle:document.getElementById('hud-idle').textContent, click:document.getElementById('hud-click').textContent, moyu:document.getElementById('hud-moyu').textContent};
        })()`);
        await sleep(700);
        await shot("s3b-02-rich");
        const before = await snap();
        // 富态下必须躲开老板弹窗：自动答题 + 自动点王总
        step("rich findboss full run");
        const menu = await openArcade();
        R.arcadeLeft = menu.leftText;
        await clickSel('#arcade-body button[data-game="findboss"]');
        await sleep(400);
        const start = await snap();
        R.run = { hudIdleStart: start.hudIdle, title: start.title, body: start.body };
        await safeEv(`(()=>{
          window.__autoBoss = setInterval(() => {
            const p=document.getElementById('boss-choice');
            if (p && !p.classList.contains('hidden')) { const b=document.querySelector('#boss-opts button'); if (b) b.click(); return; }
            const b=document.querySelector('#play-grid .face.boss'); if (b) b.click();
          }, 90);
          return 1;
        })()`);
        await waitFor("!!document.getElementById('arcade-back')", 40000);
        await safeEv(`clearInterval(window.__autoBoss)`);
        const end = await snap();
        await shot("s3b-03-rich-result");
        R.result = {
          hudIdleEnd: end.hudIdle, body: end.body, toast: end.toast, played: end.arcade.played,
          best: end.arcade.best, left: end.leftText, moyu: end.moyu, bossOpen: end.bossOpen,
          moyuDelta: +(end.moyu - before.moyu).toFixed(2),
        };
        R.rewardParsed = /\+([0-9.]+[^（]*)/.exec(end.toast.text)?.[1] ?? null;
        R.gotRewardInPanel = /本局奖励 \+([0-9.]+)/.exec(end.body)?.[1] ?? null;
        await clickSel("#arcade-back");
        await sleep(300);
        R.menuAfter = (await snap()).body;
        await clickSel("#arcade-close");
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      R.errors = c.errors.slice(0, 20);
      c.close();
    },
    { timeoutMs: 170_000 },
  );
} catch (e) {
  R.crash = String(e?.stack || e).slice(0, 2000);
  log("CRASH", R.crash.slice(0, 400));
}
write();
console.log("DONE", PHASE);