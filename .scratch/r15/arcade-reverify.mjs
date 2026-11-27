/**
 * r15 收集党 · 摸鱼站复验探针（HEAD cd1bcea）
 * 重点：①接咖啡能玩（掉落动画+视觉判定同源）②破纪录仪式 ③最高分持久化 ④3次/天+奖励 ⑤中途退出
 * 只读 src/，不改源码；Chrome 统一走 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "http://127.0.0.1:5173/";
const wait = (ms) => sleep(ms);
const evid = { steps: {}, coffee: {}, findboss: {}, rhythm: {}, limit: {}, persist: {}, record: {}, noRecord: {}, exit: {}, errors: [] };
const saveEvidence = () => writeFileSync(DIR + "evidence2.json", JSON.stringify(evid, null, 2));

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    await c.send("Runtime.enable");
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    const evalJs = async (expression) => {
      const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    };
    const shot = async (name) => {
      const s = await c.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64"));
    };
    const waitForApp = async () => {
      for (let i = 0; i < 150; i++) {
        const ok = await evalJs(`!!(window.__MOYU__ && document.getElementById('arcade-body'))`).catch(() => false);
        if (ok) { await wait(700); return true; }
        await wait(100);
      }
      throw new Error("app not ready");
    };
    const closeOverlays = async () => {
      await evalJs(`(()=>{
        const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click();
        const cd=document.getElementById('cards'); if(cd&&!cd.classList.contains('hidden')) document.getElementById('cards-skip')?.click();
        return true; })()`).catch(() => {});
      await wait(120);
    };
    const openArcade = async () => {
      await evalJs(`(()=>{const r=document.getElementById('arcade'); if(r.classList.contains('hidden')) document.getElementById('btn-arcade').click(); return true})()`);
      await wait(250);
    };
    const hideArcade = async () => {
      await evalJs(`(()=>{const r=document.getElementById('arcade'); if(!r.classList.contains('hidden')) document.getElementById('arcade-close').click(); return true})()`);
      await wait(200);
    };
    const menuData = () => evalJs(`(()=>{
      const r=document.getElementById('arcade'); if(!r||r.classList.contains('hidden')) return null;
      return { title: document.getElementById('arcade-title').textContent,
        left: document.getElementById('arcade-left').textContent,
        cards: [...document.querySelectorAll('#arcade-body .arcade-card')].map(c=>({
          name:c.querySelector('.arcade-name')?.childNodes[0]?.textContent?.trim()||'',
          small:c.querySelector('.arcade-name small')?.textContent||'',
          btn:c.querySelector('button')?.textContent?.trim()||'',
          disabled:!!c.querySelector('button')?.disabled, locked:c.classList.contains('locked')})),
        bodyText: document.getElementById('arcade-body').innerText }; })()`);
    const resultData = () => evalJs(`(()=>{
      const back=document.getElementById('arcade-back'); if(!back) return null;
      const body=document.getElementById('arcade-body');
      return { bodyText: body.innerText,
        record: document.querySelector('#arcade-body .arcade-record')?.textContent || null,
        reward: document.querySelector('#arcade-body .arcade-reward')?.textContent || null,
        score: document.querySelector('#arcade-body .arcade-score')?.textContent || null,
        hints: [...document.querySelectorAll('#arcade-body .arcade-hint')].map(e=>e.textContent),
        hasAgain: !!document.getElementById('arcade-again') }; })()`);
    const toastText = () => evalJs(`(()=>{const t=document.getElementById('dom-toast');return t?t.textContent:null})()`);
    const stateArcade = () => evalJs(`window.__MOYU__.state.arcade`);
    const saveArcade = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade||null}catch(e){return null}})()`);
    const badge = () => evalJs(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');const a=document.getElementById('btn-arcade');return {badge:b?b.textContent:null, aria:a?a.getAttribute('aria-label'):null};})()`);
    const waitResult = async (ms = 8000) => {
      for (let i = 0; i < ms / 60; i++) {
        const done = await evalJs(`!!document.getElementById('arcade-back')`).catch(() => false);
        if (done) { await wait(120); return true; }
        await wait(60);
      }
      return false;
    };
    const backToMenu = async () => { await evalJs(`document.getElementById('arcade-back')?.click()`); await wait(200); };
    const writeSaveThenReload = async (mutate) => {
      await evalJs(`window.__MOYU__.saveNow()`).catch(() => {});
      const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
      if (!blob) throw new Error("no save");
      mutate(blob);
      const json = JSON.stringify(blob);
      await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(json)}); Storage.prototype.setItem=function(){}; return true})()`);
      await c.send("Page.reload");
      await waitForApp(); await wait(900); await closeOverlays();
    };
    const stage = async (name, fn) => {
      try { await fn(); evid.steps[name] = "ok"; }
      catch (e) { evid.steps[name] = "FAIL: " + String(e).slice(0, 300); evid.errors.push(name + ": " + String(e).slice(0, 300)); try { await shot("err-" + name); } catch {} }
      saveEvidence();
    };
    const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
    evid.today = today;

    // 已知掉落（rng=0.42；新公式 t += 0.8 + 0.55*rng）
    const RNG = () => 0.42;
    const coffeeDrops = (() => { const out=[]; let t=0.8; let id=0;
      while (t < 30 - 0.5) { out.push({ id: id++, at:+t.toFixed(2), x:+(0.12+RNG()*0.76).toFixed(2) }); t += 0.8 + RNG()*0.55; }
      return out; })();
    const rhythmBeats = (() => { const o=[]; for (let t=0.6;t<30;t+=0.5) o.push(+t.toFixed(3)); return o; })();
    evid.expected = { coffeeDrops: coffeeDrops.length, rhythmBeats: rhythmBeats.length };

    await c.send("Page.navigate", { url: URL_ });
    await waitForApp();
    await closeOverlays();

    // 预置旧纪录：咖啡 100（用于验证「新纪录（旧 100）」）
    await stage("seed", async () => {
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: { coffee: 100 } }; });
      await openArcade();
      evid.seed = { menu: await menuData(), badge: await badge() };
      await shot("01-menu-seeded");
      await hideArcade();
    });

    // ---------- ① 接咖啡 ----------
    await stage("coffee", async () => {
      await openArcade();
      const start = await evalJs(`(async()=>{
        const drops = ${JSON.stringify(coffeeDrops)};
        window.__origRandom = Math.random;
        Math.random = () => 0.42;
        document.querySelector('button[data-game="coffee"]').click();
        const area = document.getElementById('play-area');
        if (!area) { Math.random = window.__origRandom; return {err:'no area'}; }
        const rect = area.getBoundingClientRect();
        const t0 = performance.now();
        const fire = (cx, cy) => area.dispatchEvent(new PointerEvent('pointerdown', {clientX:cx, clientY:cy, bubbles:true}));
        window.__taps=[]; window.__catchEvents=[]; window.__samples=[]; window.__landed=[];
        let lastTapAt = -9;
        const loop = setInterval(()=>{
          const now = (performance.now()-t0)/1000;
          const els = [...document.querySelectorAll('#play-drops .drop')];
          // 视觉采样（落点/位置/样式）
          window.__samples.push({t:+now.toFixed(2), drops: els.map(e=>({top:+(parseFloat(e.style.top)||0).toFixed(2), cls:e.className}))});
          for (const e of els) if (e.classList.contains('landed')) window.__landed.push({t:+now.toFixed(2), top:parseFloat(e.style.top)});
          if (now < 2.2 || now - lastTapAt < 0.12) return; // 前两颗故意不接；点间隔>120ms
          const cand = els.filter(e=>!e.classList.contains('caught') && !e.classList.contains('landed'))
            .map(e=>({e, top:parseFloat(e.style.top)||0})).filter(o=>o.top>=84)
            .sort((a,b)=>b.top-a.top);
          if (!cand.length) return;
          const {e, top} = cand[0];
          const r = e.getBoundingClientRect();
          const tapAt0 = (performance.now()-t0)/1000;
          let nearest = null, nd = 9;
          for (const d of drops) { const dd = Math.abs(d.at - tapAt0); if (dd < nd) { nd = dd; nearest = d.at; } }
          fire(r.left+r.width/2, r.top+r.height/2);
          lastTapAt = (performance.now()-t0)/1000;
          const cls = e.className;
          const cs = getComputedStyle(e);
          const row = { tapAt:+tapAt0.toFixed(3), visualTop:+top.toFixed(1), nearestDropAt:nearest, delta:+(tapAt0-nearest).toFixed(3), clsAfter:cls };
          window.__taps.push(row);
          if (cls.includes('caught')) window.__catchEvents.push({t:+tapAt0.toFixed(2), top:+top.toFixed(1), bg:cs.backgroundColor, transform:cs.transform});
        }, 40);
        return { ok:true, rect:{left:rect.left,top:rect.top,width:rect.width,height:rect.height} };
      })()`);
      evid.coffee.start = start;
      await wait(1100);
      evid.coffee.midFall = await evalJs(`window.__samples[window.__samples.length-1]`);
      await shot("02-coffee-midfall");
      await wait(400);
      evid.coffee.landedEarly = await evalJs(`window.__landed.filter(x=>x.t<2.0)`);
      await shot("03-coffee-landed-dim");
      // 等第一次视觉接住（杯口），立刻截图绿块
      let caughtShot = false;
      for (let i = 0; i < 60; i++) {
        const n = await evalJs(`window.__catchEvents.length`).catch(() => 0);
        if (n > 0) { await shot("04-coffee-caught-green"); caughtShot = true; break; }
        await wait(60);
      }
      evid.coffee.caughtShot = caughtShot;
      await wait(1200);
      await shot("05-coffee-near-cup");
      await wait(27000);
      const done = await waitResult(9000);
      evid.coffee.done = done;
      evid.coffee.result = await resultData();
      evid.coffee.toast = await toastText();
      evid.coffee.arcade = await stateArcade();
      evid.coffee.save = await saveArcade();
      evid.coffee.taps = await evalJs(`window.__taps.slice(0,6).concat(window.__taps.slice(-3))`);
      evid.coffee.tapCount = await evalJs(`window.__taps.length`);
      evid.coffee.tapDeltaStats = await evalJs(`(()=>{const t=window.__taps.map(x=>Math.abs(x.delta));return {n:t.length,min:Math.min(...t).toFixed(3),max:Math.max(...t).toFixed(3),avg:(t.reduce((a,b)=>a+b,0)/t.length).toFixed(3)}})()`);
      evid.coffee.catchEvents = await evalJs(`window.__catchEvents.slice(0,5)`);
      evid.coffee.catchEventCount = await evalJs(`window.__catchEvents.length`);
      // 下落轨迹：抽 5 个时刻的 top 值
      evid.coffee.fallTrajectory = await evalJs(`(()=>{const s=window.__samples; const out=[]; for (const x of s) { if (!x.drops.length) continue; const tops=x.drops.filter(d=>!d.cls.includes('landed')).map(d=>d.top); if(tops.length) out.push({t:x.t, tops}); } return out.filter((_,i)=>i%6===0).slice(0,10); })()`);
      evid.coffee.landedCount = await evalJs(`window.__landed.length`);
      await shot("06-coffee-result");
      evid.coffee.resultAfter = await resultData();
      await backToMenu();
      evid.coffee.menuAfter = await menuData();
      evid.coffee.badgeAfter = await badge();
      await shot("07-menu-after-coffee");
    });

    // ---------- ② 找老板（真 30 秒） ----------
    await stage("findboss", async () => {
      await evalJs(`document.querySelector('button[data-game="findboss"]').click()`);
      await wait(120);
      await evalJs(`(()=>{
        window.__fb={clicks:0,samples:[]};
        window.__fbIv=setInterval(()=>{
          const b=document.querySelector('#play-grid .face.boss');
          if(b){ b.click(); window.__fb.clicks++; }
          if(document.getElementById('arcade-back')) clearInterval(window.__fbIv);
        }, 90);
        window.__fbSample=setInterval(()=>{
          const t=document.querySelector('#play-timer')?.textContent;
          const s=document.querySelector('#play-score')?.textContent;
          const h=document.querySelector('#play-body')?.textContent;
          const hint=document.querySelectorAll('#arcade-body .arcade-hint')[0]?.textContent||null;
          window.__fb.samples.push({timer:t, score:s, hint});
          if(document.getElementById('arcade-back')) clearInterval(window.__fbSample);
        }, 1000);
        return true; })()`);
      await wait(5000);
      evid.findboss.midPlay = await evalJs(`(()=>({timer:document.querySelector('#play-timer')?.textContent, score:document.querySelector('#play-score')?.textContent, hint:document.querySelector('#arcade-body .arcade-hint')?.textContent, grid:!!document.getElementById('play-grid')}))()`);
      await shot("08-findboss-playing");
      await wait(24000);
      const done = await waitResult(10000);
      evid.findboss.done = done;
      evid.findboss.samples = await evalJs(`window.__fb.samples`);
      evid.findboss.clicks = await evalJs(`window.__fb.clicks`);
      evid.findboss.result = await resultData();
      evid.findboss.toast = await toastText();
      evid.findboss.arcade = await stateArcade();
      await shot("09-findboss-result");
      await backToMenu();
      evid.findboss.menuAfter = await menuData();
      await shot("10-menu-after-findboss");
    });

    // ---------- ③ 节奏点击（PERFECT/MISS/漏拍惩罚） ----------
    await stage("rhythm", async () => {
      await evalJs(`(()=>{
        const beats = ${JSON.stringify(rhythmBeats)};
        document.querySelector('button[data-game="rhythm"]').click();
        const area = document.getElementById('play-area');
        const rect = area.getBoundingClientRect();
        const t0 = performance.now();
        const fire = () => area.dispatchEvent(new PointerEvent('pointerdown', {clientX:rect.left+rect.width/2, clientY:rect.top+rect.height/2, bubbles:true}));
        // 前 56 拍精准打；最后 3 拍故意漏
        for (let i=0;i<beats.length-3;i++) setTimeout(fire, Math.round(beats[i]*1000 - 2));
        // 5 次乱点（拍间 0.25s，落在两拍中间，应 MISS -5）
        for (const off of [3.35, 6.35, 9.35, 12.35, 15.35]) setTimeout(fire, Math.round(off*1000));
        window.__judge=[];
        const iv=setInterval(()=>{
          const j=document.querySelector('#judge-text');
          window.__judge.push({t:+((performance.now()-t0)/1000).toFixed(2), text:j?j.textContent:null, cls:j?j.className:null, score:document.querySelector('#play-score')?.textContent});
          if(document.getElementById('arcade-back')) clearInterval(iv);
        }, 250);
        return {beats:beats.length, plannedTaps:beats.length-3+5};
      })()`);
      await wait(2000);
      evid.rhythm.judgeEarly = await evalJs(`window.__judge.slice(0,10)`);
      await shot("11-rhythm-perfect");
      await wait(2500);
      evid.rhythm.judgeMid = await evalJs(`(()=>({text:document.querySelector('#judge-text')?.textContent, cls:document.querySelector('#judge-text')?.className, score:document.querySelector('#play-score')?.textContent}))()`);
      await wait(26000);
      const done = await waitResult(10000);
      evid.rhythm.done = done;
      evid.rhythm.result = await resultData();
      evid.rhythm.toast = await toastText();
      evid.rhythm.arcade = await stateArcade();
      evid.rhythm.judgeSamples = await evalJs(`window.__judge.filter(x=>x.text).slice(-12)`);
      evid.rhythm.missedDots = await evalJs(`document.querySelectorAll('#beat-row .beat.missed').length`);
      await shot("12-rhythm-result");
      await backToMenu();
      evid.limit.menu = await menuData();
      evid.limit.badge = await badge();
      evid.limit.buttons = await evalJs(`[...document.querySelectorAll('#arcade-body button[data-game]')].map(b=>({game:b.dataset.game, text:b.textContent.trim(), disabled:b.disabled}))`);
      await shot("13-menu-limit-reached");
      await hideArcade();
    });

    // ---------- ④ 刷新持久化 ----------
    await stage("persist", async () => {
      await c.send("Page.reload");
      await waitForApp(); await wait(900); await closeOverlays();
      await openArcade();
      evid.persist.menu = await menuData();
      evid.persist.badge = await badge();
      evid.persist.arcade = await stateArcade();
      await shot("14-menu-after-reload");
      await hideArcade();
    });

    // ---------- ⑤ 非破纪录（旧最高 9999） ----------
    await stage("noRecord", async () => {
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: { coffee: b.arcade?.best?.coffee || 0, findboss: b.arcade?.best?.findboss || 0, rhythm: 9999 } }; });
      await openArcade();
      await evalJs(`document.querySelector('button[data-game="rhythm"]').click()`);
      await wait(300);
      // 只打 10 拍，其余全漏 → 低分
      const taps = rhythmBeats.slice(0, 10);
      await evalJs(`(()=>{const area=document.getElementById('play-area');const r=area.getBoundingClientRect();const fire=()=>area.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));for(const b of ${JSON.stringify(taps)}) setTimeout(fire, Math.round(b*1000-2)); return true;})()`);
      await wait(31000);
      const done = await waitResult(10000);
      evid.noRecord.done = done;
      evid.noRecord.result = await resultData();
      evid.noRecord.toast = await toastText();
      evid.noRecord.arcade = await stateArcade();
      await shot("15-norecord-result");
      await backToMenu();
      evid.noRecord.menu = await menuData();
    });

    // ---------- ⑥ 中途退出（消耗次数 + 早退奖励折算接线） ----------
    await stage("exit", async () => {
      await hideArcade();
      evid.exit.confirmStub = await evalJs(`(()=>{window.__confirms=[];window.confirm=(m)=>{window.__confirms.push(m);return true};return true})()`);
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: b.arcade?.best || {} }; });
      await openArcade();
      evid.exit.before = await stateArcade();
      // 6 秒时 Esc（已接若干咖啡）
      await evalJs(`(()=>{
        window.__origRandom = window.__origRandom || Math.random;
        Math.random = () => 0.42;
        document.querySelector('button[data-game="coffee"]').click();
        const area=document.getElementById('play-area'); const r=area.getBoundingClientRect();
        const t0=performance.now(); let last=0;
        window.__exitTaps=0;
        const iv=setInterval(()=>{
          const now=(performance.now()-t0)/1000;
          const els=[...document.querySelectorAll('#play-drops .drop')];
          if(now-last<0.12) return;
          const cand=els.filter(e=>!e.classList.contains('caught')&&!e.classList.contains('landed')).map(e=>({e,top:parseFloat(e.style.top)||0})).filter(o=>o.top>=84).sort((a,b)=>b.top-a.top);
          if(!cand.length) return;
          const e=cand[0].e, rr=e.getBoundingClientRect();
          area.dispatchEvent(new PointerEvent('pointerdown',{clientX:rr.left+rr.width/2,clientY:rr.top+rr.height/2,bubbles:true}));
          window.__exitTaps++; last=(performance.now()-t0)/1000;
        },40);
        window.__exitIv=iv; return true; })()`);
      await wait(6200);
      evid.exit.midPlay = await evalJs(`(()=>({score:document.querySelector('#play-score')?.textContent, timer:document.querySelector('#play-timer')?.textContent, taps:window.__exitTaps}))()`);
      await shot("16-exit-midgame");
      // Esc → 触发 close()（confirm 已被 stub 为 true）
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait(500);
      evid.exit.confirms = await evalJs(`window.__confirms`);
      evid.exit.panelHidden = await evalJs(`document.getElementById('arcade').classList.contains('hidden')`);
      evid.exit.toast = await toastText();
      evid.exit.arcade = await stateArcade();
      evid.exit.save = await saveArcade();
      evid.exit.badge = await badge();
      await openArcade();
      evid.exit.menuAfter = await menuData();
      evid.exit.badgeAfter = await badge();
      await shot("17-menu-after-exit");
      // 早退豁免：<2s 退出不消耗
      await hideArcade();
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: b.arcade?.best || {} }; });
      await openArcade();
      await evalJs(`document.querySelector('button[data-game="coffee"]').click()`);
      await wait(1200);
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait(400);
      evid.exit.earlyArcade = await stateArcade();
      evid.exit.earlyConfirms = await evalJs(`window.__confirms`);
      await openArcade();
      evid.exit.earlyMenu = await menuData();
      await shot("18-menu-after-early-exit");
    });

    evid.final = await evalJs(`(()=>({arcade: window.__MOYU__.state.arcade, save: JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade}))()`);
    evid.consoleErrors = c.errors.slice(0, 20);
    saveEvidence();
    c.close();
  },
  { timeoutMs: 360_000 },
);
console.log("DONE =>", DIR + "evidence2.json");