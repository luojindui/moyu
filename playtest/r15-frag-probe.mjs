// r15-frag 探针（针对 c96dc43 修复版）：node playtest/r15-frag-probe.mjs <s1|s2|s3|s4>
// 每次一个「打开」（独立 Chrome / 独立存档），各自写 r15-frag-<phase>.json；不残留进程。
// 记录：入口步数/可发现性、30s 时长手感、中途退出与次数扣减、奖励 vs 挂机/派遣、锁死态。
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PHASE = process.argv[2] || "s1";
const BASE = "http://127.0.0.1:5173/";
const OUT = "playtest/r15-frag-shots";
mkdirSync(OUT, { recursive: true });
const WATCH = ["src/ui/arcade.ts", "src/engine/minigames.ts", "src/style.css", "src/main.ts", "index.html"];
const hashFiles = () =>
  Object.fromEntries(WATCH.map((f) => [f, createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 12)]));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { phase: PHASE, meta: { startedAt: new Date().toISOString(), url: BASE }, hashesBefore: hashFiles(), errors: [] };
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
          return { __err: String(e).slice(0, 300) };
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
      const origin = () => safeEv("performance.timeOrigin");
      const load = async (w, h, mobile) => {
        await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
        await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await c.send("Page.navigate", { url: BASE });
        await sleep(400);
        await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 15000);
        await sleep(900);
        R.pageOrigin = await origin();
      };
      const tap = async (x, y) => {
        await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
        await sleep(35);
        await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(110);
      };
      const rectOf = async (sel) =>
        safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,text:(e.textContent||'').slice(0,100)};})()`);
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
      const stopTimers = () => safeEv(`(()=>{for (const k of ['__autoCatch','__autoBoss','__autoBeat','__mash']) { if (window[k]) clearInterval(window[k]); } return 1;})()`);
      const snap = () =>
        safeEv(`(()=>{
          try {
            const s = __MOYU__.state; const $ = (id) => document.getElementById(id);
            const toast = $('dom-toast');
            return {
              t: Date.now(), moyu: s.moyu, arcade: s.arcade, levels: s.levels,
              hudMoyu: $('hud-moyu').textContent, hudIdle: $('hud-idle').textContent, hudClick: $('hud-click').textContent,
              leftText: $('arcade-left').textContent, open: !$('arcade').classList.contains('hidden'),
              title: $('arcade-title').textContent, body: ($('arcade-body').innerText || '').slice(0, 700),
              resultShown: !!$('arcade-back'),
              toast: { text: (toast?.textContent || '').slice(0, 200), show: !!toast?.classList.contains('show') },
            };
          } catch (e) { return { __err: String(e).slice(0, 200) }; }
        })()`);
      const entryMetrics = () =>
        safeEv(`(()=>{
          const b = document.getElementById('btn-arcade'); const r = b.getBoundingClientRect();
          const cx = r.x + r.width/2, cy = r.y + r.height/2; const hit = document.elementFromPoint(cx, cy);
          const stage = document.getElementById('stage').getBoundingClientRect();
          const shop = document.getElementById('shop').getBoundingClientRect();
          const inter = (a,b) => Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) * Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
          const bt = document.body.innerText;
          const sub = document.querySelector('.hud-sub');
          return {
            viewport: { w: innerWidth, h: innerHeight },
            btn: { label: b.getAttribute('aria-label'), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, visible: r.width>0 && getComputedStyle(b).display!=='none' },
            centerHit: hit ? { id: hit.id || null, tag: hit.tagName, isSelf: hit === b } : null,
            shopTop: Math.round(shop.top), stageRect: { top: Math.round(stage.top), h: Math.round(stage.height) },
            overlapStageRatio: +(inter(r,stage)/(stage.width*stage.height||1)).toFixed(4),
            bodyHasArcadeWord: { 摸鱼站: bt.includes('摸鱼站'), 小游戏: bt.includes('小游戏'), 游戏: bt.includes('游戏') },
            hudSubOverflow: sub ? { scrollW: sub.scrollWidth, clientW: sub.clientWidth } : null,
          };
        })()`);
      const openArcade = async () => {
        const t = Date.now();
        await tapSel("#btn-arcade");
        await sleep(260);
        const s = await snap();
        return { steps: 1, msToMenu: Date.now() - t, open: s.open, left: s.leftText, body: s.body, title: s.title };
      };
      const menuInfo = () =>
        safeEv(`(()=>{
          const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
          return {
            leftText: document.getElementById('arcade-left').textContent,
            cards: cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText, desc:c.querySelector('.arcade-desc')?.innerText, btn:c.querySelector('button')?.innerText, disabled:!!c.querySelector('button')?.disabled, locked:c.classList.contains('locked')})),
            panelText: document.getElementById('arcade').innerText.slice(0,700),
            showsRewardInfo: /奖励|获得|摸鱼值|收益/.test(document.getElementById('arcade-body').innerText),
            showsResetHint: /明天|次日|重置|跨日|恢复/.test(document.getElementById('arcade').innerText),
            panelRect: (()=>{const r=document.querySelector('.arcade-panel').getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})(),
          };
        })()`);
      const playFindBossAuto = async ({ menuTaps = false } = {}) => {
        if (menuTaps) await tapSel("#btn-arcade");
        await sleep(250);
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(350);
        const st = await snap();
        const t = Date.now();
        await safeEv(`(()=>{
          window.__autoBoss = setInterval(() => {
            const b = document.querySelector('#play-grid .face.boss');
            if (!b) return;
            const r = b.getBoundingClientRect();
            b.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.x + r.width/2, clientY: r.y + r.height/2 }));
          }, 90);
          return 1;
        })()`);
        const midScore = async (label) => ({ label, timer: await safeEv(`document.getElementById('play-timer')?.textContent`), score: await safeEv(`document.getElementById('play-score')?.textContent`) });
        const series = [];
        for (let i = 0; i < 6; i++) {
          await sleep(4000);
          series.push(await midScore(`t+${(i + 1) * 4}s`));
        }
        await waitFor("!!document.getElementById('arcade-back')", 12000);
        await stopTimers();
        const end = await snap();
        return { startTitle: st.title, startBody: st.body, series, end, playMs: Date.now() - t };
      };

      /* ================= s1：移动端全新档 — 入口 + 接咖啡 30s ================= */
      if (PHASE === "s1") {
        log("s1: 移动端 390x844 全新存档");
        await load(390, 844, true);
        await shot("s1-01-first-screen");
        R.firstScreen = await entryMetrics();

        const e = await openArcade();
        R.entry = e;
        R.menu = await menuInfo();
        await shot("s1-02-menu");

        R.a11y = await safeEv(`(()=>{const a=document.activeElement; return {activeAfterOpen: a ? (a.id||a.tagName) : null};})()`);
        const trail = [];
        for (let i = 0; i < 5; i++) {
          for (const type of ["keyDown", "keyUp"])
            await c.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
          await sleep(110);
          trail.push(await safeEv(`(()=>{const a=document.activeElement; return a ? (a.id||a.className||a.tagName) : null;})()`));
        }
        R.a11y.tabTrail = trail;

        // 接咖啡
        const before = await snap();
        await tapSel('#arcade-body button[data-game="coffee"]');
        await sleep(350);
        const st = await snap();
        R.coffee = { startedTitle: st.title, startBody: st.body, before: { moyu: before.moyu, played: before.arcade.played } };
        await shot("s1-03-coffee-start");
        // 采样下落（证明视觉与判定窗口一致）
        const motion = [];
        for (let i = 0; i < 12; i++) {
          motion.push({
            ms: i * 250,
            timer: await safeEv(`document.getElementById('play-timer')?.textContent`),
            drops: await safeEv(`[...document.querySelectorAll('#play-drops .drop')].map(e=>({top:e.style.top,left:e.style.left,cls:e.className}))`),
          });
          if (i === 2) await shot("s1-04-coffee-fall-1");
          if (i === 5) await shot("s1-05-coffee-fall-2");
          await sleep(250);
        }
        R.coffee.motion = motion;
        const tops = motion.flatMap((m) => (m.drops || []).map((d) => parseFloat(d.top)).filter((n) => Number.isFinite(n)));
        R.coffee.dropTopRange = tops.length ? { min: +Math.min(...tops).toFixed(1), max: +Math.max(...tops).toFixed(1), n: tops.length } : null;

        // 自动接咖啡（模拟"看得懂"的玩家：落到杯口附近点它的横坐标）
        await safeEv(`(()=>{
          window.__autoCatch = setInterval(() => {
            const area = document.getElementById('play-area'); if (!area) return;
            const r = area.getBoundingClientRect();
            const drops = [...document.querySelectorAll('#play-drops .drop')].filter(e => !e.classList.contains('caught') && !e.classList.contains('landed'));
            let best = null, bestTop = 78;
            for (const d of drops) {
              const t = parseFloat(d.style.top);
              if (Number.isFinite(t) && t > bestTop) { bestTop = t; best = d; }
            }
            if (!best) return;
            const x = r.left + (parseFloat(best.style.left) / 100) * r.width;
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: r.top + r.height * 0.8, pointerType: 'touch' }));
          }, 45);
          return 1;
        })()`);
        const p0 = Date.now();
        const timeline = [];
        for (let i = 0; i < 6; i++) {
          await sleep(3500);
          timeline.push({ t: +((Date.now() - p0) / 1000).toFixed(1), timer: await safeEv(`document.getElementById('play-timer')?.textContent`), score: await safeEv(`document.getElementById('play-score')?.textContent`) });
          if (i === 2) await shot("s1-06-coffee-autoplay");
        }
        R.coffee.timeline = timeline;
        await waitFor("!!document.getElementById('arcade-back')", 15000);
        await stopTimers();
        const end = await snap();
        await shot("s1-07-coffee-result");
        R.coffee.end = {
          body: end.body, resultShown: end.resultShown, played: end.arcade.played, best: end.arcade.best,
          moyu: end.moyu, moyuDelta: +(end.moyu - before.moyu).toFixed(2), toast: end.toast, leftText: end.leftText,
          resultShowsReward: /奖励|获得|摸鱼值/.test(end.body), hasRecordBadge: /新纪录/.test(end.body),
        };
        R.coffee.end.buttons = await safeEv(`[...document.querySelectorAll('#arcade-body button')].map(b=>({id:b.id,text:b.textContent.trim(),h:Math.round(b.getBoundingClientRect().height)}))`);
        // 返回菜单 → 次数/锁态
        await tapSel("#arcade-back");
        await sleep(300);
        const m2 = await snap();
        R.afterCoffee = { leftText: m2.leftText, body: m2.body, played: m2.arcade.played };
        await shot("s1-08-menu-after-one");
        await tapSel("#arcade-close");
        await sleep(200);
        R.close = { openAfter: (await snap()).open };
        R.reloaded = (await origin()) !== R.pageOrigin;
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ================= s2：移动端全新档 — 中途退出 ×3 + 锁死态 ================= */
      if (PHASE === "s2") {
        log("s2: 移动端 390x844 中途退出实测");
        await load(390, 844, true);
        await shot("s2-01-first-screen");
        R.firstScreen = await entryMetrics();
        R.entry = await openArcade();
        R.menu = await menuInfo();
        await shot("s2-02-menu");

        // 0) 只是打开菜单再关闭：不应扣次数
        const s0 = await snap();
        await tapSel("#arcade-close");
        await sleep(250);
        const s0b = await snap();
        R.menuCloseNoCost = { before: s0.arcade.played, after: s0b.arcade.played, open: s0b.open };

        // 1) 局内点 ✕ 退出（接咖啡 2.5s，0 分）
        const q1a = await snap();
        await tapSel("#btn-arcade");
        await sleep(250);
        await tapSel('#arcade-body button[data-game="coffee"]');
        await sleep(2500);
        const mid1 = await snap();
        await shot("s2-03-coffee-mid-before-quit");
        await tapSel("#arcade-close");
        await sleep(350);
        const q1b = await snap();
        await shot("s2-04-after-quit-x");
        R.quitX = {
          game: "coffee", midTitle: mid1.title, midBody: mid1.body, playedBefore: q1a.arcade.played,
          openAfter: q1b.open, playedAfter: q1b.arcade.played, bestAfter: q1b.arcade.best,
          moyuDelta: +(q1b.moyu - q1a.moyu).toFixed(2), toast: q1b.toast, leftText: q1b.leftText,
          resultShown: q1b.resultShown,
        };
        // 重开确认次数
        await tapSel("#btn-arcade");
        await sleep(250);
        const q1c = await snap();
        R.quitX.afterReopen = { left: q1c.leftText, played: q1c.arcade.played, body: q1c.body };
        await shot("s2-05-reopen-after-quit");

        // 2) 局内 Esc 退出（找老板 3s）
        const q2a = await snap();
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(3000);
        await shot("s2-06-findboss-mid");
        await esc();
        const q2b = await snap();
        await shot("s2-07-after-quit-esc");
        R.quitEsc = {
          game: "findboss", openAfter: q2b.open, playedBefore: q2a.arcade.played, playedAfter: q2b.arcade.played,
          moyuDelta: +(q2b.moyu - q2a.moyu).toFixed(2), toast: q2b.toast, leftText: q2b.leftText,
        };
        // 等 33s：不应该有幽灵结算（次数/分数再变）
        log("等 33s 验证无残留计时器…");
        const waitStart = await snap();
        await sleep(33000);
        const waited = await snap();
        R.zombieCheck = {
          playedAtWaitStart: waitStart.arcade.played, playedAfter33s: waited.arcade.played,
          bestUnchanged: JSON.stringify(waitStart.arcade.best) === JSON.stringify(waited.arcade.best),
          open: waited.open, toast: waited.toast,
          moyuDelta: +(waited.moyu - waitStart.moyu).toFixed(2),
        };
        await shot("s2-08-after-zombie-wait");

        // 3) 局内误触背景（节奏点击 2s 后点面板外）——现在会结算并扣次数
        await tapSel("#btn-arcade");
        await sleep(250);
        await tapSel('#arcade-body button[data-game="rhythm"]');
        await sleep(2000);
        const rMid = await snap();
        await shot("s2-09-rhythm-mid");
        const panel = await rectOf(".arcade-panel");
        const tapPt = { x: 8, y: panel && !panel.__err ? Math.round(panel.y + panel.h / 2) : 300 };
        R.backdrop = { midTitle: rMid.title, midBody: rMid.body, playedBefore: rMid.arcade.played, panelRect: panel, tapAt: tapPt };
        await tap(tapPt.x, tapPt.y);
        await sleep(350);
        const ab = await snap();
        await shot("s2-10-after-backdrop-mistap");
        R.backdrop.closed = !ab.open;
        R.backdrop.playedAfter = ab.arcade.played;
        R.backdrop.toast = ab.toast;
        R.backdrop.moyuDelta = +(ab.moyu - rMid.moyu).toFixed(2);

        // 4) 三次用完 → 锁死态
        await tapSel("#btn-arcade");
        await sleep(300);
        R.locked = await menuInfo();
        R.lockedAfter = await snap();
        await shot("s2-11-locked");
        const dis = await rectOf("#arcade-body .arcade-card button");
        if (dis && !dis.__err) await tap(dis.x + dis.w / 2, dis.y + dis.h / 2);
        await sleep(300);
        const disAfter = await snap();
        R.locked.tapDisabled = { title: disAfter.title, played: disAfter.arcade.played, open: disAfter.open };
        await shot("s2-12-tap-disabled");
        R.reloaded = (await origin()) !== R.pageOrigin;
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ================= s3：桌面 — 30s 手感 + 满分局 + 富态奖励 ================= */
      if (PHASE === "s3") {
        log("s3: 桌面 1280x800");
        await load(1280, 800, false);
        await shot("s3-01-first-screen");
        R.firstScreen = await entryMetrics();
        R.menu = await (async () => { const e = await openArcade(); R.entry = e; await shot("s3-02-menu"); return menuInfo(); })();

        // 找老板满分局（30s，自动点王总，看分数上限/REF 600 是否易饱和）
        const g1 = await playFindBossAuto({ menuTaps: false });
        await shot("s3-03-findboss-result");
        R.findbossLow = {
          series: g1.series, end: { body: g1.end.body, played: g1.end.arcade.played, best: g1.end.arcade.best, toast: g1.end.toast, left: g1.end.leftText, hudIdle: g1.end.hudIdle, hasRecordBadge: /新纪录/.test(g1.end.body) },
          playMs: g1.playMs,
        };
        await tapSel("#arcade-back");
        await sleep(300);

        // 富态：reset + grant 1e9 + 买挂机升级
        log("富态：reset+grant(1e9)+升级…");
        await safeEv(`__MOYU__.reset()`);
        await sleep(600);
        await safeEv(`__MOYU__.grant(1e9)`);
        await sleep(600);
        R.rich = { upgrades: await safeEv(`(()=>{
          const ids=['phone','toilet','group','meeting','deep','retire']; let bought=0;
          for (let round=0; round<6; round++) for (const id of ids) {
            const el=document.querySelector('.shop-card[data-upgrade="'+id+'"]');
            if (el && !el.disabled) { el.click(); bought++; }
          }
          return {bought, idle:document.getElementById('hud-idle').textContent, click:document.getElementById('hud-click').textContent, moyu:document.getElementById('hud-moyu').textContent};
        })()`) };
        await sleep(600);
        await shot("s3-04-rich");
        const rb = await snap();
        R.rich.before = { hudIdle: rb.hudIdle, hudClick: rb.hudClick, moyu: rb.moyu, levels: rb.levels };
        const g2 = await playFindBossAuto({ menuTaps: true });
        await shot("s3-05-rich-result");
        R.rich.after = {
          scoreText: g2.end.body, played: g2.end.arcade.played, toast: g2.end.toast, moyu: g2.end.moyu,
          hudIdle: g2.end.hudIdle, left: g2.end.leftText, moyuDelta: +(g2.end.moyu - rb.moyu).toFixed(2),
          best: g2.end.arcade.best, hudIdleDuringPlay: g2.series?.[0]?.timer ?? null,
        };
        R.rich.rewardParsed = /\+([0-9][^（]*)/.exec(g2.end.toast.text)?.[1] ?? null;
        R.reloaded = (await origin()) !== R.pageOrigin;
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ================= s4：移动端 — 节奏点击：跟拍 vs 乱点 ================= */
      if (PHASE === "s4") {
        log("s4: 移动端 390x844 节奏点击");
        await load(390, 844, true);
        R.entry = await openArcade();
        await tapSel('#arcade-body button[data-game="rhythm"]');
        await sleep(300);
        await shot("s4-01-rhythm-start");
        // 跟拍 4s：只在亮点时点
        await safeEv(`(()=>{
          window.__autoBeat = setInterval(() => {
            const area = document.getElementById('play-area'); if (!area) return;
            const on = document.querySelector('#beat-row .beat.on');
            if (!on) return;
            const r = area.getBoundingClientRect();
            area.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerType: 'touch' }));
          }, 30);
          return 1;
        })()`);
        await sleep(4000);
        await stopTimers();
        const beatScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await shot("s4-02-rhythm-onbeat");
        // 乱点 3s：20Hz
        await safeEv(`(()=>{
          const a = document.getElementById('play-area'); const r = a.getBoundingClientRect();
          window.__mash = setInterval(() => { a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch'})); }, 50);
          return 1;
        })()`);
        await sleep(3000);
        await stopTimers();
        const mashScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await shot("s4-03-rhythm-mash");
        const after = await snap();
        R.rhythm = { onBeat4sScore: beatScore, mashExtra3sScore: mashScore, totalBody: after.body, title: after.title };
        // 中途 ✕ 退出（会消耗一次并结算）
        await tapSel("#arcade-close");
        await sleep(350);
        const q = await snap();
        R.rhythm.quit = { open: q.open, played: q.arcade.played, best: q.arcade.best, toast: q.toast, left: q.leftText };
        await shot("s4-04-rhythm-quit");
        R.reloaded = (await origin()) !== R.pageOrigin;
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      R.errors = c.errors.slice(0, 20);
      c.close();
    },
    { timeoutMs: 180_000 },
  );
} catch (e) {
  R.crash = String(e?.stack || e).slice(0, 2000);
  log("CRASH", R.crash.slice(0, 600));
}
write();
console.log("DONE", PHASE);