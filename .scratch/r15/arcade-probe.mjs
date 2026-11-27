/**
 * r15 收集党 · 摸鱼站（小游戏）实测探针
 * - 只读 src/，不改源码；证据写 .scratch/r15/
 * - Chrome 统一走 playtest/lib/chrome.mjs（保证无残留进程）
 * 覆盖：三游戏实玩 + 最高分显示 + 破纪录反馈 + 每日 3 次限制 + 持久化 + 跨日重置 + 0 分消耗 + Esc 中途退出
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "http://127.0.0.1:5173/";
const wait = (ms) => sleep(ms);
const evid = {
  steps: {},
  menu: {},
  games: {},
  record: {},
  limit: {},
  persist: {},
  dayReset: {},
  zeroScore: {},
  escExit: {},
  errors: [],
};
const saveEvidence = () => writeFileSync(DIR + "evidence.json", JSON.stringify(evid, null, 2));

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    await c.send("Runtime.enable");
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const evalJs = async (expression) => {
      const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
      return r.result.value;
    };
    const shot = async (name) => {
      const s = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64"));
    };
    const waitForApp = async () => {
      for (let i = 0; i < 120; i++) {
        const ok = await evalJs(`!!(window.__MOYU__ && document.getElementById('btn-arcade') && document.getElementById('arcade-body'))`).catch(() => false);
        if (ok) { await wait(600); return true; }
        await wait(100);
      }
      throw new Error("app not ready");
    };
    const closeOverlays = async () => {
      await evalJs(`(()=>{
        const w=document.getElementById('welcome');
        if(w && !w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click();
        const cd=document.getElementById('cards');
        if(cd && !cd.classList.contains('hidden')) document.getElementById('cards-skip')?.click();
        return true;
      })()`).catch(() => {});
      await wait(150);
    };
    const openArcade = async () => {
      await evalJs(`(()=>{const r=document.getElementById('arcade'); if(r.classList.contains('hidden')) document.getElementById('btn-arcade').click(); return true})()`);
      await wait(250);
    };
    const menuData = () => evalJs(`(()=>{
      const r=document.getElementById('arcade');
      if(!r || r.classList.contains('hidden')) return null;
      return {
        title: document.getElementById('arcade-title').textContent,
        left: document.getElementById('arcade-left').textContent,
        cards: [...document.querySelectorAll('#arcade-body .arcade-card')].map(c=>({
          name: c.querySelector('.arcade-name')?.childNodes[0]?.textContent?.trim() || '',
          small: c.querySelector('.arcade-name small')?.textContent || '',
          desc: c.querySelector('.arcade-desc')?.textContent || '',
          btn: c.querySelector('button')?.textContent?.trim() || '',
          disabled: !!c.querySelector('button')?.disabled,
          locked: c.classList.contains('locked'),
        })),
        bodyText: document.getElementById('arcade-body').innerText,
      };
    })()`);
    const bodyText = () => evalJs(`document.getElementById('arcade-body').innerText`);
    const resultText = () => evalJs(`(()=>{
      const back=document.getElementById('arcade-back');
      if(!back) return null;
      return { bodyText: document.getElementById('arcade-body').innerText, hint: document.querySelector('#arcade-body .arcade-hint')?.textContent || null, scoreShown: [...document.querySelectorAll('#arcade-body .arcade-score')].map(e=>e.textContent) };
    })()`);
    const toastText = () => evalJs(`(()=>{const t=document.getElementById('dom-toast');return t?{text:t.textContent,shown:t.classList.contains('show')}:null})()`);
    const stateArcade = () => evalJs(`window.__MOYU__.state.arcade`);
    const saveArcade = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade||null}catch(e){return null}})()`);
    const bodyHTML = () => evalJs(`document.getElementById('arcade-body').innerHTML`);
    const waitResult = async (ms = 6000) => {
      for (let i = 0; i < ms / 50; i++) {
        const done = await evalJs(`!!document.getElementById('arcade-back')`).catch(() => false);
        if (done) { await wait(150); return true; }
        await wait(50);
      }
      return false;
    };
    const backToMenu = async () => {
      await evalJs(`document.getElementById('arcade-back')?.click()`);
      await wait(200);
    };
    const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
    evid.today = today;

    // 确定性掉落序列（把 Math.random 固定成 0.42 后与引擎 genDrops 完全一致）
    const RNG = () => 0.42;
    const coffeeDrops = (() => {
      const drops = [];
      let t = 0.8;
      let id = 0;
      while (t < 30 - 0.5) {
        drops.push({ id: id++, at: Number(t.toFixed(2)), x: Number((0.12 + RNG() * 0.76).toFixed(2)) });
        t += 0.55 + RNG() * 0.5;
      }
      return drops;
    })();
    const rhythmBeats = (() => {
      const out = [];
      for (let t = 0.6; t < 30; t += 0.5) out.push(Number(t.toFixed(3)));
      return out;
    })();
    evid.expected = { coffeeDrops: coffeeDrops.length, coffeeFirst: coffeeDrops.slice(0, 4), rhythmBeats: rhythmBeats.length };

    const writeSaveThenReload = async (mutate) => {
      const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
      if (!blob) throw new Error("no save blob");
      mutate(blob);
      const json = JSON.stringify(blob);
      await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(json)}); Storage.prototype.setItem=function(){}; return true})()`);
      await c.send("Page.reload");
      await waitForApp();
      await wait(900);
      await closeOverlays();
    };

    // 每个阶段独立 try/catch，保证整体能跑完
    const stage = async (name, fn) => {
      try {
        evid.steps[name] = "start";
        await fn();
        evid.steps[name] = "ok";
      } catch (e) {
        evid.steps[name] = "FAIL: " + String(e).slice(0, 400);
        evid.errors.push(name + ": " + String(e).slice(0, 400));
        try { await shot("err-" + name); } catch { /* ignore */ }
      }
      saveEvidence();
    };

    await c.send("Page.navigate", { url: URL_ });
    await waitForApp();
    await closeOverlays();

    // ---------- 0. 初始菜单（最高分是否显示，未玩状态） ----------
    await stage("initialMenu", async () => {
      await openArcade();
      evid.menu.initial = await menuData();
      evid.menu.initialState = await stateArcade();
      await shot("01-menu-initial");
    });

    // ---------- 1. 找老板（第 1 次） ----------
    await stage("findboss1", async () => {
      await evalJs(`document.querySelector('button[data-game="findboss"]').click()`);
      await wait(80);
      evid.games.findbossPlaying = await evalJs(`(()=>{const el=document.querySelector('#arcade-body .arcade-timer'); return {timer: el?el.textContent:null, body:document.getElementById('arcade-body').innerText.slice(0,200)}})()`);
      await evalJs(`(()=>{
        window.__fb=0;
        window.__fbIv=setInterval(()=>{
          const b=document.querySelector('#play-grid .face.boss');
          if(b){ b.click(); window.__fb++; }
          if(document.getElementById('arcade-back')) clearInterval(window.__fbIv);
        },25);
        return true;
      })()`);
      const done = await waitResult(8000);
      evid.games.findboss1 = { done, result: await resultText(), toast: await toastText(), arcade: await stateArcade(), save: await saveArcade(), clicks: await evalJs(`window.__fb||0`) };
      await shot("02-findboss-result");
      await backToMenu();
      evid.menu.afterFindboss = await menuData();
      await shot("03-menu-after-findboss");
    });

    // ---------- 2. 接咖啡（第 2 次）：先"看见就点"，再按真实掉落时刻点 ----------
    await stage("coffee", async () => {
      const startInfo = await evalJs(`(async()=>{
        const drops = ${JSON.stringify(coffeeDrops)};
        // 固定 Math.random：startGame 内 const rng = Math.random 会取到它
        window.__origRandom = Math.random;
        Math.random = () => 0.42;
        document.querySelector('button[data-game="coffee"]').click();
        const area = document.getElementById('play-area');
        if (!area) { Math.random = window.__origRandom; return { err: 'no play area' }; }
        const rect = area.getBoundingClientRect();
        const t0 = performance.now();
        const fireAt = (cx, cy) => area.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, bubbles: true }));
        const fireCenter = () => fireAt(rect.left + rect.width/2, rect.top + rect.height/2);
        window.__drops = drops;
        window.__samples = [];
        window.__flashTaps = 0;
        window.__phase1Scores = [];
        window.__sampleNow = (tag) => {
          const el = [...document.querySelectorAll('#play-drops .drop')];
          const sc = document.getElementById('play-score');
          const s = { tag, t: +((performance.now()-t0)/1000).toFixed(2), n: el.length,
            drops: el.map(e=>({left:e.style.left, top:e.style.top})),
            score: sc ? sc.textContent : null };
          window.__samples.push(s);
          return s;
        };
        // 阶段 1（0-7.8s）：模拟玩家"看到咖啡就点它"
        const flashTap = setInterval(()=>{
          const d = document.querySelector('#play-drops .drop');
          if (d) {
            const r = d.getBoundingClientRect();
            fireAt(r.left + r.width/2, r.top + r.height/2);
            window.__flashTaps++;
          }
          const sc = document.getElementById('play-score');
          if (sc) window.__phase1Scores.push({ t:+((performance.now()-t0)/1000).toFixed(2), score: sc.textContent });
        }, 90);
        setTimeout(()=>clearInterval(flashTap), 7800);
        // 采样器（每 200ms）
        const sampler = setInterval(()=>window.__sampleNow('auto'), 200);
        // 阶段 2（>=8s）：按真实掉落时刻点（验证判定本身可用）
        const targets = drops.filter(d=>d.at >= 8);
        for (const d of targets) setTimeout(()=>fireCenter(), Math.round(d.at*1000 - 2));
        setTimeout(()=>{ clearInterval(sampler); Math.random = window.__origRandom; }, 31200);
        return { ok:true, rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height}, targets: targets.length };
      })()`);
      evid.games.coffeeStart = startInfo;
      await wait(2400);
      evid.games.coffeeSampleFlash = await evalJs(`window.__sampleNow('flash')`);
      await shot("04-coffee-flash-visible");
      evid.games.coffeeFlashCount = await evalJs(`window.__flashTaps`);
      await wait(5900); // t≈8.3s，快到 8.4s 的可判定时刻
      evid.games.coffeeSampleBeforeCatch = await evalJs(`window.__sampleNow('before-catch-8.4')`);
      await shot("05-coffee-before-catch-8.4");
      await wait(22000); // 跑完
      const done = await waitResult(8000);
      evid.games.coffee = {
        done,
        result: await resultText(),
        toast: await toastText(),
        arcade: await stateArcade(),
        save: await saveArcade(),
        samples: await evalJs(`window.__samples`),
        phase1Scores: await evalJs(`window.__phase1Scores.slice(0,6).concat(window.__phase1Scores.slice(-6))`),
      };
      await shot("06-coffee-result");
      await backToMenu();
      evid.menu.afterCoffee = await menuData();
      await shot("07-menu-after-coffee");
    });

    // ---------- 3. 节奏点击（第 3 次，按节拍精确点） ----------
    await stage("rhythm", async () => {
      const startInfo = await evalJs(`(()=>{
        const beats = ${JSON.stringify(rhythmBeats)};
        document.querySelector('button[data-game="rhythm"]').click();
        const area = document.getElementById('play-area');
        if (!area) return { err:'no play area' };
        const rect = area.getBoundingClientRect();
        const t0 = performance.now();
        const fire = () => area.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left+rect.width/2, clientY: rect.top+rect.height/2, bubbles:true }));
        for (const b of beats) setTimeout(fire, Math.round(b*1000 - 2));
        window.__rhythmScores = [];
        const iv = setInterval(()=>{ const sc=document.getElementById('play-score'); if(sc) window.__rhythmScores.push({t:+((performance.now()-t0)/1000).toFixed(2), score:sc.textContent}); if(document.getElementById('arcade-back')) clearInterval(iv); }, 250);
        return { ok:true, beats: beats.length };
      })()`);
      evid.games.rhythmStart = startInfo;
      await wait(1200);
      await shot("08-rhythm-playing");
      const done = await waitResult(34000);
      evid.games.rhythm = { done, result: await resultText(), toast: await toastText(), arcade: await stateArcade(), save: await saveArcade() };
      await shot("09-rhythm-result");
      await backToMenu();
      evid.menu.afterRhythm = await menuData();
      evid.limit.afterThree = await menuData();
      await shot("10-menu-limit-reached");
      // 每日次数已用尽：点开始按钮应无效（disabled）
      evid.limit.buttonDisabled = await evalJs(`[...document.querySelectorAll('#arcade-body button[data-game]')].map(b=>({game:b.dataset.game, disabled:b.disabled}))`);
      // 直接 JS click disabled 按钮，确认不会进入游戏
      evid.limit.jsClickBlocked = await evalJs(`(()=>{const b=document.querySelector('#arcade-body button[data-game="coffee"]'); if(!b) return null; b.click(); return { stillMenu: !!document.getElementById('play-area'), title: document.getElementById('arcade-title').textContent };})()`);
      await wait(300);
      evid.limit.afterJsClick = await bodyText();
    });

    // ---------- 4. 刷新后最高分持久化 ----------
    await stage("persist", async () => {
      await c.send("Page.reload");
      await waitForApp();
      await wait(900);
      await closeOverlays();
      await openArcade();
      evid.persist.menu = await menuData();
      evid.persist.arcade = await stateArcade();
      await shot("11-menu-after-reload");
      await evalJs(`document.getElementById('arcade-close')?.click()`);
      await wait(150);
    });

    // ---------- 5. 跨日重置：昨天玩了 3 次 + 最高分保留 ----------
    await stage("dayReset", async () => {
      await writeSaveThenReload((b) => {
        b.arcade = { date: "2026-11-26", played: 3, best: { ...(b.arcade?.best || {}), findboss: 100 } };
      });
      await openArcade();
      evid.dayReset.menu = await menuData();
      evid.dayReset.arcade = await stateArcade();
      await shot("12-menu-day-reset");
    });

    // ---------- 6. 破纪录：旧最高 100 → 新成绩（应无"新纪录"反馈） ----------
    await stage("recordBreak", async () => {
      // 关面板，开始找老板
      await evalJs(`document.getElementById('arcade-close')?.click()`);
      await wait(150);
      await openArcade();
      await evalJs(`document.querySelector('button[data-game="findboss"]').click()`);
      await wait(80);
      await evalJs(`(()=>{ window.__fbIv=setInterval(()=>{ const b=document.querySelector('#play-grid .face.boss'); if(b)b.click(); if(document.getElementById('arcade-back')) clearInterval(window.__fbIv); },25); return true; })()`);
      const done = await waitResult(8000);
      evid.record.break = { oldBest: 100, done, result: await resultText(), toast: await toastText(), arcade: await stateArcade(), save: await saveArcade(), htmlHasNewRecordWord: /新纪录|破纪录|NEW|纪录/.test(await bodyHTML()) };
      await shot("13-record-break-result");
      await backToMenu();
      evid.record.break.menu = await menuData();
      await shot("14-menu-after-record-break");
    });

    // ---------- 7. 非破纪录：旧最高 9999 → 新成绩更低（对比 UI 是否不同） ----------
    await stage("noRecord", async () => {
      await writeSaveThenReload((b) => {
        b.arcade = { date: today, played: 0, best: { findboss: 9999, coffee: b.arcade?.best?.coffee || 0, rhythm: b.arcade?.best?.rhythm || 0 } };
      });
      await openArcade();
      await evalJs(`document.querySelector('button[data-game="findboss"]').click()`);
      await wait(80);
      await evalJs(`(()=>{ window.__fbIv=setInterval(()=>{ const b=document.querySelector('#play-grid .face.boss'); if(b)b.click(); if(document.getElementById('arcade-back')) clearInterval(window.__fbIv); },25); return true; })()`);
      const done = await waitResult(8000);
      evid.record.noBreak = { oldBest: 9999, done, result: await resultText(), toast: await toastText(), arcade: await stateArcade() };
      await shot("15-norecord-result");
      await backToMenu();
      evid.record.noBreak.menu = await menuData();
    });

    // ---------- 8. 0 分也消耗次数 & 最高分不被 0 覆盖 ----------
    await stage("zeroScore", async () => {
      await evalJs(`document.getElementById('arcade-close')?.click()`);
      await wait(150);
      await writeSaveThenReload((b) => {
        b.arcade = { date: today, played: 2, best: { ...(b.arcade?.best || {}), rhythm: 1475 } };
      });
      await openArcade();
      evid.zeroScore.before = await menuData();
      await evalJs(`document.querySelector('button[data-game="rhythm"]').click()`);
      await wait(500);
      evid.zeroScore.playing = await evalJs(`(()=>({timer:document.querySelector('#play-timer')?.textContent, score:document.querySelector('#play-score')?.textContent}))()`);
      // 全程不点
      await wait(31000);
      const done = await waitResult(8000);
      evid.zeroScore.done = done;
      evid.zeroScore.result = await resultText();
      evid.zeroScore.toast = await toastText();
      evid.zeroScore.arcade = await stateArcade();
      evid.zeroScore.save = await saveArcade();
      await shot("16-zero-score-result");
      await backToMenu();
      evid.zeroScore.after = await menuData();
      await shot("17-menu-limit-after-zero");
    });

    // ---------- 9. Esc 中途退出是否消耗次数 ----------
    await stage("escExit", async () => {
      await writeSaveThenReload((b) => {
        b.arcade = { date: today, played: 0, best: b.arcade?.best || {} };
      });
      await openArcade();
      evid.escExit.before = await stateArcade();
      await evalJs(`document.querySelector('button[data-game="coffee"]').click()`);
      await wait(1500);
      evid.escExit.midPlaying = await evalJs(`(()=>({timer:document.querySelector('#play-timer')?.textContent, score:document.querySelector('#play-score')?.textContent}))()`);
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait(400);
      evid.escExit.panelHidden = await evalJs(`document.getElementById('arcade').classList.contains('hidden')`);
      evid.escExit.arcade = await stateArcade();
      await openArcade();
      evid.escExit.menuAfter = await menuData();
      evid.escExit.save = await saveArcade();
      await shot("18-after-esc-menu");
    });

    // ---------- 10. 收尾&异常 ----------
    evid.finalState = await evalJs(`(()=>({arcade: window.__MOYU__.state.arcade, saveArcade: JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade}))()`);
    evid.consoleErrors = c.errors.slice(0, 20);
    saveEvidence();
    c.close();
  },
  { timeoutMs: 300_000 },
);
console.log("DONE =>", DIR + "evidence.json");