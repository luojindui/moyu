// r15-frag：碎片党试玩「摸鱼站」（3 个 30 秒小游戏 / 每天 3 次）
// 3 次「打开」：移动端 ×2 + 桌面 ×1。全程只读 src/，不改代码。
// Chrome 进程统一由 lib/chrome.mjs 管理（不残留）。
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "http://127.0.0.1:5173/";
const OUT = "playtest/r15-frag-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = {
  meta: { startedAt: new Date().toISOString(), url: BASE },
  sessions: [],
  bugs: [],
  errors: [],
};

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
      await sleep(1000);
    };
    const tap = async (x, y) => {
      await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
      await sleep(35);
      await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await sleep(110);
    };
    const rectOf = async (sel) =>
      safeEv(`(()=>{const e=document.querySelector(${J(sel)}); if(!e) return null; const b=e.getBoundingClientRect(); return {x:b.x,y:b.y,w:b.width,h:b.height,text:(e.textContent||'').slice(0,80)};})()`);
    const tapSel = async (sel) => {
      const r = await rectOf(sel);
      if (!r || r.__err || r === null) return { error: "no el " + sel };
      await tap(r.x + r.w / 2, r.y + r.h / 2);
      return r;
    };
    const esc = async () => {
      for (const type of ["keyDown", "keyUp"])
        await c.send("Input.dispatchKeyEvent", {
          type,
          key: "Escape",
          code: "Escape",
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27,
        });
      await sleep(160);
    };
    const tabKey = async (shift = false) => {
      for (const type of ["keyDown", "keyUp"])
        await c.send("Input.dispatchKeyEvent", {
          type,
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
          nativeVirtualKeyCode: 9,
          modifiers: shift ? 8 : 0,
        });
      await sleep(120);
    };
    const snap = () =>
      safeEv(`(()=>{
        const s = __MOYU__.state;
        const $ = (id) => document.getElementById(id);
        const toast = $('dom-toast');
        const open = !$('arcade').classList.contains('hidden');
        return {
          t: Date.now(),
          moyu: s.moyu,
          arcade: s.arcade,
          hudMoyu: $('hud-moyu').textContent,
          hudIdle: $('hud-idle').textContent,
          hudClick: $('hud-click').textContent,
          leftText: $('arcade-left').textContent,
          open,
          title: $('arcade-title').textContent,
          body: ($('arcade-body').innerText || '').slice(0, 600),
          resultShown: !!$('arcade-back'),
          toast: { text: (toast?.textContent || '').slice(0, 160), show: !!toast?.classList.contains('show') },
        };
      })()`);

    /* ================= 打开 1：移动端，全新存档 ================= */
    log("=== 打开 1：移动端 390x844（全新存档） ===");
    const s1 = { label: "打开1/移动端/全新", startedAt: new Date().toISOString(), t: {} };
    await load(390, 844, true);
    shotSyncStart(s1);
    await shot("s1-01-first-screen");
    const first = await safeEv(`(()=>{
      const b = document.getElementById('btn-arcade');
      const r = b.getBoundingClientRect();
      const cx = r.x + r.width/2, cy = r.y + r.height/2;
      const hit = document.elementFromPoint(cx, cy);
      const stage = document.getElementById('stage').getBoundingClientRect();
      const shop = document.getElementById('shop').getBoundingClientRect();
      const iw = innerWidth, ih = innerHeight;
      const inter = (a,b) => Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) * Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
      const bodyText = document.body.innerText;
      return {
        viewport: { w: iw, h: ih },
        btn: { id: b.id, label: b.getAttribute('aria-label'), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, visible: r.width > 0 && getComputedStyle(b).display !== 'none' },
        centerHit: hit ? { id: hit.id || null, tag: hit.tagName, isSelf: hit === b } : null,
        stageRect: { top: Math.round(stage.top), h: Math.round(stage.height), w: Math.round(stage.width) },
        shopTop: Math.round(shop.top),
        btnStageOverlapRatio: +(inter(r, stage) / (stage.width * stage.height || 1)).toFixed(4),
        bodyHasWord: { 摸鱼站: bodyText.includes('摸鱼站'), 小游戏: bodyText.includes('小游戏'), 游戏: bodyText.includes('游戏') },
        staticHint: document.getElementById('shop-hint')?.textContent ?? null,
        floatingBtns: [...document.querySelectorAll('#hud .hud-sub button')].map((x) => {
          const q = x.getBoundingClientRect(); const st = getComputedStyle(x);
          return { id: x.id, text: x.textContent.trim(), pos: st.position, rect: { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) } };
        }),
      };
    })()`);
    s1.firstScreen = first;

    // 入口：1 次点击 🎮
    const tEntry = Date.now();
    const btnRect = await tapSel("#btn-arcade");
    await sleep(250);
    const menu1 = await snap();
    s1.entry = { steps: 1, tapTarget: btnRect, msToMenu: Date.now() - tEntry, menuVisible: menu1.open, title: menu1.title, left: menu1.leftText, body: menu1.body };
    s1.menu = await safeEv(`(()=>{
      const cards = [...document.querySelectorAll('#arcade-body .arcade-card')];
      return {
        leftText: document.getElementById('arcade-left').textContent,
        cards: cards.map((card) => ({
          name: card.querySelector('.arcade-name')?.innerText,
          desc: card.querySelector('.arcade-desc')?.innerText,
          btn: card.querySelector('button')?.innerText,
          disabled: !!card.querySelector('button')?.disabled,
        })),
        showsRewardInfo: /奖励|获得|摸鱼值\\+|收益/.test(document.getElementById('arcade-body').innerText),
        showsLimitResetHint: /明天|次日|重置|跨日/.test(document.getElementById('arcade').innerText),
        panelRect: (() => { const r = document.querySelector('.arcade-panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
      };
    })()`);
    await shot("s1-02-menu");

    // 键盘焦点（可访问性顺带检查）
    s1.a11y = await safeEv(`(()=>{const a=document.activeElement; return {activeBeforeTab: a ? (a.id || a.tagName) : null};})()`);
    const tabTrail = [];
    for (let i = 0; i < 5; i++) {
      await tabKey();
      const id = await safeEv(`(()=>{const a=document.activeElement; return a ? (a.id || a.className || a.tagName) : null;})()`);
      tabTrail.push(id);
    }
    s1.a11y.tabTrail = tabTrail;

    // 点开始接咖啡
    const beforeCoffee = await snap();
    await tapSel('#arcade-body button[data-game="coffee"]');
    await sleep(450);
    const coffeeStart = await snap();
    s1.coffee = { before: { moyu: beforeCoffee.moyu, played: beforeCoffee.arcade.played }, title: coffeeStart.title, body: coffeeStart.body };

    // 采样 .drop 位置，验证咖啡是否真的"下落"
    const motion = [];
    const tm0 = Date.now();
    for (let i = 0; i < 22; i++) {
      const o = await safeEv(`(()=>{
        const t = document.getElementById('play-timer');
        const area = document.getElementById('play-area');
        const ds = [...document.querySelectorAll('#play-drops .drop')].map((e) => ({ top: e.style.top, left: e.style.left }));
        return { timer: t ? t.textContent : null, areaH: area ? Math.round(area.getBoundingClientRect().height) : null, n: ds.length, drops: ds.slice(0, 5) };
      })()`);
      motion.push({ ms: Date.now() - tm0, ...o });
      if (i === 2) await shot("s1-03-coffee-early");
      if (i === 6) await shot("s1-04-coffee-mid");
      await sleep(260);
    }
    s1.coffee.motion = motion;
    const tops = motion.flatMap((m) => (m.drops || []).map((d) => parseFloat(d.top)));
    s1.coffee.dropTopRange = tops.length ? { min: +Math.min(...tops).toFixed(1), max: +Math.max(...tops).toFixed(1), samples: tops.length } : null;

    // 新手式瞎点（每 0.65-0.9s 点一次随机位置）
    const areaRect = await rectOf("#play-area");
    const scoreTimeline = [];
    let taps = 0;
    const playT0 = Date.now();
    while (Date.now() - playT0 < 24000) {
      const x = areaRect.x + areaRect.w * (0.1 + Math.random() * 0.8);
      const y = areaRect.y + areaRect.h * 0.55;
      await tap(x, y);
      taps++;
      if (taps % 4 === 0) {
        const sc = await safeEv(`document.getElementById('play-score')?.textContent`);
        scoreTimeline.push({ t: +((Date.now() - playT0) / 1000).toFixed(1), score: sc });
      }
      await sleep(620 + Math.random() * 260);
    }
    s1.coffee.naiveTaps = taps;
    s1.coffee.scoreTimeline = scoreTimeline;
    await waitFor("!!document.getElementById('arcade-back')", 12000);
    const coffeeEnd = await snap();
    await shot("s1-05-coffee-result");
    s1.coffee.end = {
      elapsedMs: (Date.now() - playT0) / 1000,
      scoreText: coffeeEnd.body,
      resultShown: coffeeEnd.resultShown,
      played: coffeeEnd.arcade.played,
      best: coffeeEnd.arcade.best,
      moyu: coffeeEnd.moyu,
      moyuDelta: coffeeEnd.moyu - beforeCoffee.moyu,
      toast: coffeeEnd.toast,
      leftText: coffeeEnd.leftText,
    };
    // 结算面板是否展示奖励
    s1.coffee.end.resultShowsReward = /奖励|获得|摸鱼值/.test(coffeeEnd.body);

    // 返回菜单
    await tapSel("#arcade-back");
    await sleep(300);
    const menu2 = await snap();
    s1.afterCoffee = { leftText: menu2.leftText, body: menu2.body, played: menu2.arcade.played };
    await shot("s1-06-menu-after-one");
    // 关闭
    const closeRect = await tapSel("#arcade-close");
    await sleep(250);
    s1.close = { clicked: closeRect, open: (await snap()).open };
    s1.t = { totalMs: Date.now() - tEntry };
    s1.durationMs = Date.now() - Date.parse(s1.startedAt);
    R.sessions.push(s1);
    log("打开 1 完成", JSON.stringify({ score: s1.coffee.end.scoreText, reward: s1.coffee.end.toast.text, played: s1.coffee.end.played }));

    /* ================= 打开 2：移动端，回访（保留存档） ================= */
    log("=== 打开 2：移动端 390x844（回访） ===");
    const s2 = { label: "打开2/移动端/回访", startedAt: new Date().toISOString() };
    await load(390, 844, true);
    await shot("s2-01-first-screen");
    const before2 = await snap();
    s2.arrive = { leftText: before2.leftText, played: before2.arcade.played, hudIdle: before2.hudIdle };

    // 入口 1 步
    const t2 = Date.now();
    await tapSel("#btn-arcade");
    await sleep(250);
    const menu2b = await snap();
    s2.entry = { steps: 1, ms: Date.now() - t2, left: menu2b.leftText, menu: menu2b.body };
    await shot("s2-02-menu");

    // A. 中途退出（✕）：找老板玩 1.6s 就关
    await tapSel('#arcade-body button[data-game="findboss"]');
    await sleep(1600);
    const findMid = await snap();
    s2.quitA = { game: "findboss", midBody: findMid.body, midPlayed: findMid.arcade.played };
    await shot("s2-03-findboss-mid");
    await tapSel("#arcade-close");
    await sleep(300);
    const q1 = await snap();
    s2.quitA.afterClose = { open: q1.open, played: q1.arcade.played, best: q1.arcade.best, left: q1.leftText, moyu: q1.moyu };
    s2.quitA.toast = q1.toast;
    // 再打开菜单确认次数没被扣
    await tapSel("#btn-arcade");
    await sleep(250);
    const q1b = await snap();
    s2.quitA.afterReopen = { left: q1b.leftText, played: q1b.arcade.played, body: q1b.body };
    await shot("s2-04-quitA-reopen");
    await tapSel("#arcade-close");
    await sleep(200);

    // B. 中途 Esc 退出（接咖啡 3s 后）→ 等 33s 验证没有"幽灵计时器"结算
    const bBefore = await snap();
    await tapSel('#arcade-body button[data-game="coffee"]');
    await sleep(3000);
    await shot("s2-05-coffee-mid");
    await esc();
    const escClosed = await snap();
    const escAt = Date.now();
    log("Esc 中途退出，等待 33s 验证有无残留结算…");
    await sleep(34000);
    const zombie = await snap();
    s2.quitB = {
      game: "coffee",
      closedImmediately: !escClosed.open,
      playedAtEsc: escClosed.arcade.played,
      playedAfter34s: zombie.arcade.played,
      bestAfter34s: zombie.arcade.best,
      moyuDelta: zombie.moyu - bBefore.moyu,
      waitSec: +((Date.now() - escAt) / 1000).toFixed(1),
      toast: zombie.toast,
      open: zombie.open,
    };
    await shot("s2-06-after-zombie-wait");

    // C. 误触背景：节奏点击中点面板外（模拟手滑）
    await tapSel("#btn-arcade");
    await sleep(250);
    await tapSel('#arcade-body button[data-game="rhythm"]');
    await sleep(1800);
    const rhythmMid = await snap();
    s2.rhythmMid = { body: rhythmMid.body, title: rhythmMid.title };
    await shot("s2-07-rhythm-mid");
    const panel = await rectOf(".arcade-panel");
    s2.backdropTest = { panel, closeTarget: { x: 8, y: Math.round(panel.y + panel.h / 2) } };
    await tap(8, Math.round(panel.y + panel.h / 2));
    await sleep(350);
    const afterBackdrop = await snap();
    s2.backdropTest.closedByBackdropTap = !afterBackdrop.open;
    s2.backdropTest.played = afterBackdrop.arcade.played;
    s2.backdropTest.toast = afterBackdrop.toast;
    await shot("s2-08-after-backdrop-tap");

    // D. 节奏点击乱点/连点（看是否无脑刷分）→ 测完退出不消耗次数
    if (afterBackdrop.open) {
      // 已经关了，重新进入节奏局
      await tapSel("#btn-arcade");
      await sleep(250);
    }
    const dBefore = await snap();
    await tapSel('#arcade-body button[data-game="rhythm"]');
    await sleep(500);
    // 20Hz 连点 4 秒（模拟无脑刷）
    await safeEv(`(()=>{
      const a = document.getElementById('play-area'); if(!a) return 'no-area';
      const r = a.getBoundingClientRect();
      window.__mash = setInterval(() => {
        a.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2, pointerType: 'touch' }));
      }, 50);
      return 'started';
    })()`);
    await sleep(4200);
    const mashScore = await safeEv(`document.getElementById('play-score')?.textContent`);
    await safeEv(`(()=>{clearInterval(window.__mash); return 'stopped';})()`);
    await shot("s2-09-rhythm-mash");
    await tapSel("#arcade-close");
    await sleep(250);
    const dAfter = await snap();
    s2.mash = {
      game: "rhythm",
      mashHz: 20,
      mashSec: 4.2,
      scoreAfter4s: mashScore,
      playedBefore: dBefore.arcade.played,
      playedAfterQuit: dAfter.arcade.played,
      toast: dAfter.toast,
      closed: !dAfter.open,
    };

    // E. 正式打完一局（找老板，5 轮全对，点按钮）
    await tapSel("#btn-arcade");
    await sleep(250);
    const eBefore = await snap();
    await tapSel('#arcade-body button[data-game="findboss"]');
    await sleep(400);
    const rounds = [];
    for (let i = 0; i < 5; i++) {
      const boss = await waitFor("(()=>{const b=document.querySelector('#play-grid .face.boss'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 4000);
      if (!boss || boss.__err) { rounds.push({ round: i + 1, error: "no boss btn" }); break; }
      const timerText = await safeEv(`document.getElementById('play-timer')?.textContent`);
      await tap(boss.x, boss.y);
      rounds.push({ round: i + 1, timerText });
      await sleep(230);
    }
    await waitFor("!!document.getElementById('arcade-back')", 6000);
    const eAfter = await snap();
    await shot("s2-10-findboss-result");
    s2.finish = {
      rounds,
      resultBody: eAfter.body,
      resultShowsReward: /奖励|获得|摸鱼值/.test(eAfter.body),
      played: eAfter.arcade.played,
      best: eAfter.arcade.best,
      moyuDelta: eAfter.moyu - eBefore.moyu,
      toast: eAfter.toast,
      leftText: eAfter.leftText,
      hudIdle: eAfter.hudIdle,
    };
    // 结算页能否再来一局 / 显示奖励
    s2.finish.buttons = await safeEv(`[...document.querySelectorAll('#arcade-body button')].map(b=>({id:b.id,text:b.textContent.trim()}))`);
    s2.durationMs = Date.now() - Date.parse(s2.startedAt);
    R.sessions.push(s2);
    log("打开 2 完成", JSON.stringify({ score: s2.finish.resultBody, reward: s2.finish.toast.text, played: s2.finish.played }));

    /* ================= 打开 3：桌面，烧掉最后一次 + 富态收益对比 ================= */
    log("=== 打开 3：桌面 1280x800（回访） ===");
    const s3 = { label: "打开3/桌面/回访", startedAt: new Date().toISOString() };
    await load(1280, 800, false);
    await shot("s3-01-first-screen");
    s3.entryMetrics = await safeEv(`(()=>{
      const b = document.getElementById('btn-arcade'); const r = b.getBoundingClientRect();
      const cx = r.x + r.width/2, cy = r.y + r.height/2; const hit = document.elementFromPoint(cx, cy);
      const stage = document.getElementById('stage').getBoundingClientRect();
      const inter = (a,b) => Math.max(0, Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)) * Math.max(0, Math.min(a.right,b.right)-Math.max(a.left,b.left));
      return { viewport: {w:innerWidth,h:innerHeight}, rect: {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}, centerHitIsSelf: hit === b, centerHit: hit ? (hit.id||hit.tagName) : null, overlapStageRatio: +(inter(r,stage)/(stage.width*stage.height||1)).toFixed(4) };
    })()`);
    await tapSel("#btn-arcade");
    await sleep(300);
    const m3 = await snap();
    await shot("s3-02-menu");
    s3.menu = { left: m3.leftText, played: m3.arcade.played };

    // 打完最后一次（找老板）
    await tapSel('#arcade-body button[data-game="findboss"]');
    await sleep(400);
    for (let i = 0; i < 5; i++) {
      const boss = await waitFor("(()=>{const b=document.querySelector('#play-grid .face.boss'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 4000);
      if (!boss || boss.__err) break;
      await tap(boss.x, boss.y);
      await sleep(200);
    }
    await waitFor("!!document.getElementById('arcade-back')", 6000);
    const after3 = await snap();
    await shot("s3-03-last-result");
    s3.lastGame = { played: after3.arcade.played, best: after3.arcade.best, toast: after3.toast, leftText: after3.leftText };
    // 返回菜单看锁死状态
    await tapSel("#arcade-back");
    await sleep(300);
    const locked = await safeEv(`(()=>{
      const cards=[...document.querySelectorAll('#arcade-body .arcade-card')];
      return {
        leftText: document.getElementById('arcade-left').textContent,
        panelText: document.getElementById('arcade').innerText,
        cards: cards.map(c=>({name:c.querySelector('.arcade-name')?.innerText, locked:c.classList.contains('locked'), disabled:!!c.querySelector('button')?.disabled, btnText:c.querySelector('button')?.innerText})),
        showsResetHint: /明天|次日|重置|跨日|恢复/.test(document.getElementById('arcade').innerText),
        showsRewardInfo: /奖励|获得/.test(document.getElementById('arcade').innerText),
      };
    })()`);
    s3.locked = locked;
    await shot("s3-04-locked");
    // 尝试点禁用按钮
    const disabledBtn = await rectOf('#arcade-body .arcade-card button');
    if (disabledBtn && !disabledBtn.__err) {
      await tap(disabledBtn.x + disabledBtn.w / 2, disabledBtn.y + disabledBtn.h / 2);
      await sleep(300);
    }
    const afterDisabledTap = await snap();
    s3.locked.tapDisabledStillLocked = !afterDisabledTap.open ? null : afterDisabledTap.title;
    await shot("s3-05-tap-disabled");
    await tapSel("#arcade-close");
    await sleep(200);

    // ===== 富态收益对比：reset + grant + 买挂机升级，再玩一次同款游戏 =====
    log("富态测试：reset + grant(1e9) + 升级挂机…");
    await safeEv(`__MOYU__.reset()`);
    await sleep(500);
    await safeEv(`__MOYU__.grant(1e9)`);
    await sleep(300);
    const upgradeStats = await safeEv(`(()=>{
      const ids = ['phone','toilet','group','meeting','deep','retire'];
      let bought = 0;
      for (let round = 0; round < 30; round++) {
        for (const id of ids) {
          const el = document.querySelector('.shop-card[data-upgrade="'+id+'"]');
          if (el && !el.disabled) { el.click(); bought++; }
        }
      }
      return { bought, idle: document.getElementById('hud-idle').textContent, click: document.getElementById('hud-click').textContent, moyu: document.getElementById('hud-moyu').textContent };
    })()`);
    await sleep(400);
    s3.rich = { upgradeStats };
    await shot("s3-06-rich");
    const richBefore = await snap();
    s3.rich.before = { hudIdle: richBefore.hudIdle, hudClick: richBefore.hudClick, moyu: richBefore.moyu, energy: richBefore.energy };
    // 打开摸鱼站，打找老板（与低收益时同一款、同一打法）
    await tapSel("#btn-arcade");
    await sleep(250);
    const richMenu = await snap();
    s3.rich.arcadeLeft = richMenu.leftText;
    await tapSel('#arcade-body button[data-game="findboss"]');
    await sleep(400);
    for (let i = 0; i < 5; i++) {
      const boss = await waitFor("(()=>{const b=document.querySelector('#play-grid .face.boss'); if(!b) return null; const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()", 4000);
      if (!boss || boss.__err) break;
      await tap(boss.x, boss.y);
      await sleep(200);
    }
    await waitFor("!!document.getElementById('arcade-back')", 6000);
    const richAfter = await snap();
    await shot("s3-07-rich-result");
    s3.rich.after = {
      resultBody: richAfter.body,
      played: richAfter.arcade.played,
      toast: richAfter.toast,
      moyu: richAfter.moyu,
      hudIdle: richAfter.hudIdle,
      leftText: richAfter.leftText,
    };
    s3.rich.reward = /\\+(\\d[^（]*)/.exec(richAfter.toast.text)?.[1] ?? null;
    s3.rich.moyuDelta = richAfter.moyu - richBefore.moyu;
    s3.durationMs = Date.now() - Date.parse(s3.startedAt);
    R.sessions.push(s3);
    log("打开 3 完成", JSON.stringify(s3.rich.after));

    R.errors = c.errors.slice(0, 20);
    c.close();
  },
  { timeoutMs: 420_000 },
);

R.meta.finishedAt = new Date().toISOString();
writeFileSync("playtest/r15-frag-evidence.json", JSON.stringify(R, null, 2));
log("evidence 写入 playtest/r15-frag-evidence.json");
console.log("DONE");

function shotSyncStart(s) {
  s.uiStartedAt = Date.now();
}