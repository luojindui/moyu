// r15-frag 分段探针：node playtest/r15-frag-probe.mjs <s1|s2|s3>
// 每次一个「打开」（独立 Chrome，独立存档），各自写 evidence-<phase>.json；不残留进程。
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const PHASE = process.argv[2] || "s1";
const BASE = "http://127.0.0.1:5173/";
const OUT = "playtest/r15-frag-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { phase: PHASE, meta: { startedAt: new Date().toISOString(), url: BASE }, errors: [] };

const write = () => {
  R.meta.finishedAt = new Date().toISOString();
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
      const load = async (w, h, mobile) => {
        await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
        await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
        await c.send("Page.navigate", { url: BASE });
        await sleep(400);
        await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 15000);
        await sleep(900);
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
        await sleep(160);
      };
      const snap = () =>
        safeEv(`(()=>{
          try {
            const s = __MOYU__.state;
            const $ = (id) => document.getElementById(id);
            const toast = $('dom-toast');
            return {
              t: Date.now(), moyu: s.moyu, arcade: s.arcade,
              hudMoyu: $('hud-moyu').textContent, hudIdle: $('hud-idle').textContent, hudClick: $('hud-click').textContent,
              leftText: $('arcade-left').textContent,
              open: !$('arcade').classList.contains('hidden'),
              title: $('arcade-title').textContent,
              body: ($('arcade-body').innerText || '').slice(0, 600),
              resultShown: !!$('arcade-back'),
              toast: { text: (toast?.textContent || '').slice(0, 160), show: !!toast?.classList.contains('show') },
            };
          } catch (e) { return { __err: String(e).slice(0, 200) }; }
        })()`);
      const playFindBoss = async ({ menuTaps = true } = {}) => {
        if (menuTaps) await tapSel("#btn-arcade");
        await sleep(250);
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(350);
        const rounds = [];
        for (let i = 0; i < 5; i++) {
          const boss = await waitFor("(()=>{const b=document.querySelector('#play-grid .face.boss'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 4000);
          if (!boss || boss.__err) { rounds.push({ round: i + 1, error: "no boss btn" }); break; }
          await tap(boss.x, boss.y);
          rounds.push({ round: i + 1, ok: true });
          await sleep(200);
        }
        await waitFor("!!document.getElementById('arcade-back')", 6000);
        const s = await snap();
        return { rounds, snap: s };
      };

      const entryMetrics = () =>
        safeEv(`(()=>{
          const b = document.getElementById('btn-arcade'); const r = b.getBoundingClientRect();
          const cx = r.x + r.width/2, cy = r.y + r.height/2;
          const hit = document.elementFromPoint(cx, cy);
          const stage = document.getElementById('stage').getBoundingClientRect();
          const shop = document.getElementById('shop').getBoundingClientRect();
          const inter = (a,b) => Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) * Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
          const bt = document.body.innerText;
          return {
            viewport: { w: innerWidth, h: innerHeight },
            btn: { label: b.getAttribute('aria-label'), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, visible: r.width > 0 && getComputedStyle(b).display !== 'none' },
            centerHit: hit ? { id: hit.id || null, tag: hit.tagName, isSelf: hit === b } : null,
            shopTop: Math.round(shop.top),
            stageRect: { top: Math.round(stage.top), h: Math.round(stage.height) },
            btnStageOverlapRatio: +(inter(r, stage) / (stage.width * stage.height || 1)).toFixed(4),
            bodyHasArcadeWord: { 摸鱼站: bt.includes('摸鱼站'), 小游戏: bt.includes('小游戏') },
          };
        })()`);

      /* ======================= 打开 1：移动端全新档 ======================= */
      if (PHASE === "s1") {
        log("s1: 移动端 390x844 全新存档");
        await load(390, 844, true);
        await shot("s1-01-first-screen");
        R.firstScreen = await entryMetrics();

        const tEntry = Date.now();
        await tapSel("#btn-arcade");
        await sleep(250);
        const menu = await snap();
        R.entry = { steps: 1, msToMenu: Date.now() - tEntry, open: menu.open, title: menu.title, left: menu.leftText, body: menu.body };
        R.menu = await safeEv(`(()=>{
          const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
          return {
            leftText: document.getElementById('arcade-left').textContent,
            cards: cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText, desc:c.querySelector('.arcade-desc')?.innerText, btn:c.querySelector('button')?.innerText, disabled:!!c.querySelector('button')?.disabled})),
            panelText: document.getElementById('arcade').innerText.slice(0,500),
            showsRewardInfo: /奖励|获得|摸鱼值\\+|收益/.test(document.getElementById('arcade-body').innerText),
            panelRect: (()=>{const r=document.querySelector('.arcade-panel').getBoundingClientRect(); return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})(),
          };
        })()`);
        await shot("s1-02-menu");

        // 键盘焦点：打开后是否移入 modal
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
        const coffeeTap = await tapSel('#arcade-body button[data-game="coffee"]');
        await sleep(400);
        const started = await snap();
        R.coffee = { tap: coffeeTap, startedTitle: started.title, body: started.body, before: { moyu: before.moyu, played: before.arcade.played } };

        const motion = [];
        const tm0 = Date.now();
        for (let i = 0; i < 22; i++) {
          const o = await safeEv(`(()=>{
            const t=document.getElementById('play-timer');
            const ds=[...document.querySelectorAll('#play-drops .drop')].map(e=>({top:e.style.top,left:e.style.left}));
            return {timer:t?t.textContent:null, n:ds.length, drops:ds.slice(0,5)};
          })()`);
          motion.push({ ms: Date.now() - tm0, ...o });
          if (i === 2) await shot("s1-03-coffee-early");
          if (i === 7) await shot("s1-04-coffee-mid");
          await sleep(260);
        }
        R.coffee.motion = motion;
        const tops = motion.flatMap((m) => (m.drops || []).map((d) => parseFloat(d.top)));
        R.coffee.dropTopRange = tops.length ? { min: +Math.min(...tops).toFixed(1), max: +Math.max(...tops).toFixed(1), samples: tops.length } : null;

        // 新手瞎点：每 0.65-0.9s 点一次随机位置，直到 24s
        const area = await rectOf("#play-area");
        const timeline = [];
        let taps = 0;
        const p0 = Date.now();
        while (area && !area.__err && Date.now() - p0 < 24000) {
          await tap(area.x + area.w * (0.1 + Math.random() * 0.8), area.y + area.h * 0.55);
          taps++;
          if (taps % 4 === 0) timeline.push({ t: +((Date.now() - p0) / 1000).toFixed(1), score: await safeEv(`document.getElementById('play-score')?.textContent`) });
          await sleep(620 + Math.random() * 260);
        }
        R.coffee.naiveTaps = taps;
        R.coffee.scoreTimeline = timeline;
        await waitFor("!!document.getElementById('arcade-back')", 12000);
        const end = await snap();
        await shot("s1-05-coffee-result");
        R.coffee.end = {
          scoreText: end.body, resultShown: end.resultShown, played: end.arcade.played, best: end.arcade.best,
          moyu: end.moyu, moyuDelta: end.moyu - before.moyu, toast: end.toast, leftText: end.leftText,
          resultShowsReward: /奖励|获得|摸鱼值/.test(end.body),
        };
        R.coffee.end.buttons = await safeEv(`[...document.querySelectorAll('#arcade-body button')].map(b=>({id:b.id,text:b.textContent.trim()}))`);
        // 返回菜单
        await tapSel("#arcade-back");
        await sleep(300);
        const menu2 = await snap();
        R.afterCoffee = { leftText: menu2.leftText, body: menu2.body, played: menu2.arcade.played };
        await shot("s1-06-menu-after-one");
        const closeR = await tapSel("#arcade-close");
        await sleep(250);
        R.close = { clicked: closeR, openAfter: (await snap()).open };
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ======================= 打开 2：移动端回访 ======================= */
      if (PHASE === "s2") {
        log("s2: 移动端 390x844（先打完 1 局再测中途退出）");
        await load(390, 844, true);
        await shot("s2-01-first-screen");
        R.firstScreen = await entryMetrics();
        const tEntry = Date.now();
        await tapSel("#btn-arcade");
        await sleep(250);
        const menu = await snap();
        R.entry = { steps: 1, msToMenu: Date.now() - tEntry, left: menu.leftText, body: menu.body };
        await shot("s2-02-menu");

        // 先打完 1 局（找老板）→ played=1
        const g1 = await playFindBoss({ menuTaps: false });
        await shot("s2-03-findboss-result");
        R.firstFinish = {
          rounds: g1.rounds, score: g1.snap.body, played: g1.snap.arcade.played, best: g1.snap.arcade.best,
          toast: g1.snap.toast, leftText: g1.snap.leftText, hudIdle: g1.snap.hudIdle, hudClick: g1.snap.hudClick,
          resultShowsReward: /奖励|获得|摸鱼值/.test(g1.snap.body),
        };
        R.firstFinish.buttons = await safeEv(`[...document.querySelectorAll('#arcade-body button')].map(b=>({id:b.id,text:b.textContent.trim()}))`);
        await tapSel("#arcade-back");
        await sleep(300);

        // A. 中途 ✕ 退出（找老板 1.6s）
        const aBefore = await snap();
        await tapSel('#arcade-body button[data-game="findboss"]');
        await sleep(1600);
        const mid = await snap();
        await shot("s2-04-findboss-mid");
        await tapSel("#arcade-close");
        await sleep(300);
        const q = await snap();
        R.quitA = {
          game: "findboss", midBody: mid.body, playedBefore: aBefore.arcade.played,
          closed: !q.open, playedAfterQuit: q.arcade.played, bestAfter: q.arcade.best, moyu: q.moyu, toast: q.toast, leftText: q.leftText,
        };
        await tapSel("#btn-arcade");
        await sleep(250);
        const q2 = await snap();
        R.quitA.afterReopen = { left: q2.leftText, played: q2.arcade.played, body: q2.body };
        await shot("s2-05-quitA-reopen");
        await tapSel("#arcade-close");
        await sleep(200);

        // B. 中途 Esc 退出（接咖啡 3s）→ 等 33s 看有没有幽灵结算
        const bBefore = await snap();
        await tapSel('#arcade-body button[data-game="coffee"]');
        await sleep(3000);
        await shot("s2-06-coffee-mid");
        await esc();
        const escClosed = await snap();
        log("Esc 退出后等 33s…");
        await sleep(33000);
        const z = await snap();
        R.quitB = {
          game: "coffee", closedImmediately: !escClosed.open, playedAtEsc: escClosed.arcade.played,
          playedAfter33s: z.arcade.played, bestAfter33s: z.arcade.best, moyuDelta: z.moyu - bBefore.moyu,
          open: z.open, resultShown: z.resultShown, toast: z.toast, title: z.title,
        };
        await shot("s2-07-after-zombie-wait");

        // C. 误触背景（节奏点击时点面板外）
        await tapSel("#btn-arcade");
        await sleep(250);
        await tapSel('#arcade-body button[data-game="rhythm"]');
        await sleep(1800);
        const rm = await snap();
        await shot("s2-08-rhythm-mid");
        const panel = await rectOf(".arcade-panel");
        R.backdropTest = { rhythmTitle: rm.title, body: rm.body, panel, tapAt: { x: 8, y: panel && !panel.__err ? Math.round(panel.y + panel.h / 2) : 300 } };
        await tap(R.backdropTest.tapAt.x, R.backdropTest.tapAt.y);
        await sleep(350);
        const ab = await snap();
        R.backdropTest.closedByBackdropTap = !ab.open;
        R.backdropTest.played = ab.arcade.played;
        R.backdropTest.toast = ab.toast;
        await shot("s2-09-after-backdrop-tap");

        // D. 节奏连点（20Hz/4s）看是否无脑刷分；测完直接退出不消耗次数
        if (!ab.open) {
          await tapSel("#btn-arcade");
          await sleep(250);
        }
        const dBefore = await snap();
        await tapSel('#arcade-body button[data-game="rhythm"]');
        await sleep(500);
        const mashStart = await safeEv(`(()=>{
          const a=document.getElementById('play-area'); if(!a) return {ok:false};
          const r=a.getBoundingClientRect();
          window.__mash=setInterval(()=>{a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'touch'}));},50);
          return {ok:true};
        })()`);
        await sleep(4200);
        const mashScore = await safeEv(`document.getElementById('play-score')?.textContent`);
        await safeEv(`(()=>{clearInterval(window.__mash); return 1;})()`);
        await shot("s2-10-rhythm-mash");
        await tapSel("#arcade-close");
        await sleep(250);
        const dAfter = await snap();
        R.mash = { game: "rhythm", hz: 20, sec: 4.2, started: mashStart, scoreAfter4s: mashScore, playedBefore: dBefore.arcade.played, playedAfterQuit: dAfter.arcade.played, toast: dAfter.toast, closed: !dAfter.open };
        R.durationMs = Date.now() - Date.parse(R.meta.startedAt);
      }

      /* ======================= 打开 3：桌面回访 + 锁死 + 富态 ======================= */
      if (PHASE === "s3") {
        log("s3: 桌面 1280x800");
        await load(1280, 800, false);
        await shot("s3-01-first-screen");
        R.firstScreen = await entryMetrics();
        const tEntry = Date.now();
        await tapSel("#btn-arcade");
        await sleep(250);
        R.entry = { steps: 1, msToMenu: Date.now() - tEntry, left: (await snap()).leftText };
        await shot("s3-02-menu");

        // 打满 3 次（找老板 ×3）
        const finishes = [];
        for (let n = 0; n < 3; n++) {
          const g = await playFindBoss({ menuTaps: n > 0 });
          finishes.push({ n: n + 1, score: g.snap.body, played: g.snap.arcade.played, best: g.snap.arcade.best, toast: g.snap.toast, leftText: g.snap.leftText });
          if (n === 0) await shot("s3-03-result-1");
          if (n === 2) await shot("s3-04-result-3");
          await tapSel("#arcade-back");
          await sleep(300);
        }
        R.finishes = finishes;
        R.locked = await safeEv(`(()=>{
          const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
          return {
            leftText: document.getElementById('arcade-left').textContent,
            panelText: document.getElementById('arcade').innerText.slice(0,600),
            cards: cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText, locked:c.classList.contains('locked'), disabled:!!c.querySelector('button')?.disabled, btnText:c.querySelector('button')?.innerText})),
            showsResetHint: /明天|次日|重置|跨日|恢复/.test(document.getElementById('arcade').innerText),
            showsRewardInfo: /奖励|获得/.test(document.getElementById('arcade').innerText),
          };
        })()`);
        await shot("s3-05-locked");
        const dis = await rectOf("#arcade-body .arcade-card button");
        if (dis && !dis.__err) await tap(dis.x + dis.w / 2, dis.y + dis.h / 2);
        await sleep(300);
        R.locked.afterTapDisabled = { open: (await snap()).open, title: (await snap()).title };
        await shot("s3-06-tap-disabled");
        await tapSel("#arcade-close");
        await sleep(200);

        // 低收益基准：找老板（前面 finishes[0] 已是同款）
        // ===== 富态：reset + grant + 买挂机升级，再打同款 =====
        log("富态：reset+grant(1e9)+升级挂机…");
        await safeEv(`__MOYU__.reset()`);
        await sleep(600);
        await safeEv(`__MOYU__.grant(1e9)`);
        await sleep(500);
        R.rich = {};
        R.rich.upgrades = await safeEv(`(()=>{
          const ids=['phone','toilet','group','meeting','deep','retire']; let bought=0;
          for (let round=0; round<6; round++) for (const id of ids) {
            const el=document.querySelector('.shop-card[data-upgrade="'+id+'"]');
            if (el && !el.disabled) { el.click(); bought++; }
          }
          return {bought, idle:document.getElementById('hud-idle').textContent, click:document.getElementById('hud-click').textContent, moyu:document.getElementById('hud-moyu').textContent};
        })()`);
        await sleep(500);
        await shot("s3-07-rich");
        const rb = await snap();
        R.rich.before = { hudIdle: rb.hudIdle, hudClick: rb.hudClick, moyu: rb.moyu };
        const g = await playFindBoss({ menuTaps: true });
        await shot("s3-08-rich-result");
        const ra = await snap();
        R.rich.after = { score: ra.body, played: ra.arcade.played, toast: ra.toast, moyu: ra.moyu, hudIdle: ra.hudIdle, leftText: ra.leftText };
        R.rich.moyuDelta = ra.moyu - rb.moyu;
        R.rich.rewardParsed = /\+([0-9][^（]*)/.exec(ra.toast.text)?.[1] ?? null;
        // 低收益那局同款对照
        R.rich.lowRef = finishes[0];
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