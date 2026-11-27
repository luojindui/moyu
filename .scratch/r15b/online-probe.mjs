/**
 * r15 收集党 · 线上包复验（https://luojindui.github.io/moyu/，新无痕，生产构建无 __MOYU__）
 * 覆盖：关于版本 / boot 角标 / 三游戏实战 / 破纪录仪式 / 持久化 / 0-3 限制 / 非破纪录 / <2s 退还 / 2-28s 确认退出
 * Chrome 走 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "https://luojindui.github.io/moyu/";
const wait = (ms) => sleep(ms);
const evid = { steps: {}, errors: [], coffee: {}, findboss: {}, rhythm: {}, limit: {}, persist: {}, noRecord: {}, refund: {}, exit: {}, exitConfirm: {} };
const saveEvidence = () => writeFileSync(DIR + "online-evidence.json", JSON.stringify(evid, null, 2));

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    await c.send("Runtime.enable");
    await c.send("Page.enable");
    await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    const evalJs = async (expression) => {
      const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const shot = async (name) => { const s = await c.send("Page.captureScreenshot", { format: "png" }); writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64")); };
    const waitBoot = async (ms = 20000) => {
      for (let i = 0; i < ms / 200; i++) {
        const ok = await evalJs(`!!(document.getElementById('btn-arcade') && document.getElementById('arcade-body') && document.getElementById('stage'))`).catch(() => false);
        if (ok) { await wait(1200); return true; }
        await wait(200);
      }
      throw new Error("boot timeout");
    };
    const closeModals = async () => {
      for (let i = 0; i < 15; i++) {
        const done = await evalJs(`(()=>{
          const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) { document.getElementById('welcome-ok')?.click(); return 'welcome'; }
          const cd=document.getElementById('cards'); if(cd&&!cd.classList.contains('hidden')) { document.getElementById('cards-skip')?.click(); return 'cards'; }
          return 'none'; })()`).catch(() => "err");
        if (done === "none") return;
        await wait(250);
      }
    };
    const openArcade = async () => { await evalJs(`(()=>{const r=document.getElementById('arcade');if(r.classList.contains('hidden'))document.getElementById('btn-arcade').click();return true})()`); await wait(300); };
    const hideArcade = async () => { await evalJs(`(()=>{const r=document.getElementById('arcade');if(!r.classList.contains('hidden'))document.getElementById('arcade-close').click();return true})()`); await wait(200); };
    const badge = () => evalJs(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');const a=document.getElementById('btn-arcade');return {badge:b?b.textContent:null,aria:a?a.getAttribute('aria-label'):null}})()`);
    const saveArcade = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade||null}catch(e){return null}})()`);
    const toastText = () => evalJs(`(()=>{const t=document.getElementById('dom-toast');return t?t.textContent:null})()`);
    const menuData = () => evalJs(`(()=>{const r=document.getElementById('arcade');if(!r||r.classList.contains('hidden'))return null;
      return { left:document.getElementById('arcade-left').textContent,
        cards:[...document.querySelectorAll('#arcade-body .arcade-card')].map(c=>({name:c.querySelector('.arcade-name')?.textContent||'', btn:c.querySelector('button')?.textContent?.trim()||'', disabled:!!c.querySelector('button')?.disabled})),
        buttons:[...document.querySelectorAll('#arcade-body button[data-game]')].map(b=>({text:b.textContent.trim(),disabled:b.disabled})) };})()`);
    const resultData = () => evalJs(`(()=>{const back=document.getElementById('arcade-back');if(!back)return null;
      return { bodyText:document.getElementById('arcade-body').innerText,
        record:document.querySelector('#arcade-body .arcade-record')?.textContent||null,
        reward:document.querySelector('#arcade-body .arcade-reward')?.textContent||null,
        score:document.querySelector('#arcade-body .arcade-score')?.textContent||null,
        hints:[...document.querySelectorAll('#arcade-body .arcade-hint')].map(e=>e.textContent),
        hasAgain:!!document.getElementById('arcade-again'), hasBack:!!document.getElementById('arcade-back') };})()`);
    const waitResult = async (ms = 12000) => { for (let i = 0; i < ms / 80; i++) { if (await evalJs(`!!document.getElementById('arcade-back')`).catch(() => false)) { await wait(150); return true; } await wait(80); } return false; };
    const backToMenu = async () => { await evalJs(`document.getElementById('arcade-back')?.click()`); await wait(250); };
    const pressEsc = async () => {
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    };
    const patchSaveThenReload = async (mutate) => {
      const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
      if (!blob) throw new Error("no save");
      mutate(blob);
      await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))}); Storage.prototype.setItem=function(){}; return true})()`);
      await c.send("Page.reload");
      await waitBoot(); await closeModals(); await wait(300);
    };
    const stage = async (name, fn) => {
      try { await fn(); evid.steps[name] = "ok"; }
      catch (e) { evid.steps[name] = "FAIL: " + String(e).slice(0, 300); evid.errors.push(name + ": " + String(e).slice(0, 300)); try { await shot("err-" + name); } catch {} }
      saveEvidence();
    };

    // 0. 打开线上（新无痕）
    await c.send("Page.navigate", { url: URL_ });
    await waitBoot();
    await closeModals();
    evid.page = await evalJs(`({href:location.href, scripts:[...document.scripts].map(s=>s.src).filter(Boolean), title:document.title, hasDevHook:!!window.__MOYU__})`);
    await stage("about", async () => {
      await evalJs(`document.getElementById('btn-journal').click()`);
      await wait(700);
      evid.about = await evalJs(`(()=>{const v=document.getElementById('about-version');const n=document.getElementById('about-notes');return {version:v?v.textContent:null, notes:n?(n.textContent||'').slice(0,300):null, journalOpen:!document.getElementById('journal').classList.contains('hidden')}})()`);
      await shot("30-about-version");
      await evalJs(`document.getElementById('journal-close')?.click()`);
      await wait(300);
    });
    await stage("bootBadge", async () => {
      evid.boot = { badge: await badge(), arcade: await saveArcade() };
      await shot("31-boot-badge");
    });

    // 1. 接咖啡（视觉点按：只看 .drop 位置，到杯口线就点）
    await stage("coffee", async () => {
      await openArcade();
      evid.menuBoot = await menuData();
      await evalJs(`(()=>{
        document.querySelector('button[data-game="coffee"]').click();
        const area=document.getElementById('play-area'); if(!area){window.__startErr='no area';return;}
        const rect=area.getBoundingClientRect(); const t0=performance.now();
        window.__t0=t0; window.__trail=[]; window.__taps=[]; window.__catches=[]; window.__landed=[];
        const fire=(cx,cy)=>area.dispatchEvent(new PointerEvent('pointerdown',{clientX:cx,clientY:cy,bubbles:true}));
        let lastTap=-9;
        const iv=setInterval(()=>{
          const now=(performance.now()-t0)/1000;
          const els=[...document.querySelectorAll('#play-drops .drop')];
          if (Math.round(now*10)%2===0) window.__trail.push({t:+now.toFixed(2), tops:els.map(e=>+(parseFloat(e.style.top)||0).toFixed(1))});
          for(const e of els) if(e.classList.contains('landed')) window.__landed.push(+now.toFixed(2));
          if(now<2.2 || now-lastTap<0.12) return;
          const cand=els.filter(e=>!e.classList.contains('caught')&&!e.classList.contains('landed')).map(e=>({e,top:parseFloat(e.style.top)||0})).filter(o=>o.top>=84).sort((a,b)=>b.top-a.top);
          if(!cand.length) return;
          const r=cand[0].e.getBoundingClientRect();
          const tapAt=(performance.now()-t0)/1000;
          fire(r.left+r.width/2, r.top+r.height/2);
          lastTap=(performance.now()-t0)/1000;
          window.__taps.push({t:+tapAt.toFixed(2), top:+cand[0].top.toFixed(1), cls:cand[0].e.className});
          if(cand[0].e.classList.contains('caught')){ const cs=getComputedStyle(cand[0].e); window.__catches.push({t:+tapAt.toFixed(2),top:+cand[0].top.toFixed(1),bg:cs.backgroundColor}); }
        },40);
        window.__iv=iv;
        return true; })()`);
      await wait(1200);
      evid.coffee.midFall = await evalJs(`(()=>({t:document.querySelector('#play-timer')?.textContent, err:window.__startErr||null, sample:window.__trail.slice(-1)[0]}))()`);
      await shot("32-coffee-falling");
      // 等第一次接住截图
      let shotOk = false;
      for (let i = 0; i < 80; i++) { const n = await evalJs(`window.__catches.length`).catch(() => 0); if (n > 0) { await shot("33-coffee-caught-green"); shotOk = true; break; } await wait(60); }
      evid.coffee.caughtShot = shotOk;
      await wait(28000);
      const done = await waitResult(12000);
      evid.coffee.done = done;
      evid.coffee.result = await resultData();
      evid.coffee.toast = await toastText();
      evid.coffee.save = await saveArcade();
      evid.coffee.taps = await evalJs(`window.__taps.slice(0,5)`);
      evid.coffee.tapCount = await evalJs(`window.__taps.length`);
      evid.coffee.catchCount = await evalJs(`window.__catches.length`);
      evid.coffee.trail = await evalJs(`window.__trail.filter((_,i)=>i%5===0).slice(0,10)`);
      evid.coffee.landedCount = await evalJs(`new Set(window.__landed).size`);
      await shot("34-coffee-result");
      await backToMenu();
      evid.coffee.menuAfter = await menuData();
      evid.coffee.badgeAfter = await badge();
      await shot("35-menu-after-coffee");
      await hideArcade();
    });

    // 2. 找老板（真 30 秒；模拟人类 ~4 次/秒）
    await stage("findboss", async () => {
      await openArcade();
      await evalJs(`(()=>{
        document.querySelector('button[data-game="findboss"]').click();
        window.__fb={clicks:0,samples:[]};
        window.__fbIv=setInterval(()=>{ const b=document.querySelector('#play-grid .face.boss'); if(b){ b.click(); window.__fb.clicks++; } if(document.getElementById('arcade-back')) clearInterval(window.__fbIv); },240);
        window.__fbS=setInterval(()=>{
          const t=document.querySelector('#play-timer')?.textContent;
          const s=document.querySelector('#play-score')?.textContent;
          const hint=document.querySelector('#arcade-body .arcade-hint')?.textContent;
          window.__fb.samples.push({timer:t, score:s, hint});
          if(document.getElementById('arcade-back')) clearInterval(window.__fbS);
        },1000);
        return true; })()`);
      await wait(4500);
      evid.findboss.mid = await evalJs(`(()=>({timer:document.querySelector('#play-timer')?.textContent, score:document.querySelector('#play-score')?.textContent, hint:document.querySelector('#arcade-body .arcade-hint')?.textContent}))()`);
      await shot("36-findboss-playing");
      await wait(26000);
      const done = await waitResult(12000);
      evid.findboss.done = done;
      evid.findboss.samples = await evalJs(`window.__fb.samples`);
      evid.findboss.clicks = await evalJs(`window.__fb.clicks`);
      evid.findboss.lastHudScore = await evalJs(`window.__fb.samples.filter(x=>x.score).slice(-1)[0]?.score`);
      evid.findboss.result = await resultData();
      evid.findboss.toast = await toastText();
      evid.findboss.save = await saveArcade();
      await shot("37-findboss-result");
      await backToMenu();
      evid.findboss.menuAfter = await menuData();
      await hideArcade();
    });

    // 3. 节奏点击（56 拍精准 + 5 乱点 + 漏 3 拍）
    await stage("rhythm", async () => {
      await openArcade();
      await evalJs(`(()=>{
        const beats=[]; for(let t=0.6;t<30;t+=0.5) beats.push(+t.toFixed(3));
        document.querySelector('button[data-game="rhythm"]').click();
        const area=document.getElementById('play-area'); const rect=area.getBoundingClientRect();
        const fire=()=>area.dispatchEvent(new PointerEvent('pointerdown',{clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2,bubbles:true}));
        for(let i=0;i<beats.length-3;i++) setTimeout(fire, Math.round(beats[i]*1000-2));
        for(const off of [3.35,6.35,9.35,12.35,15.35]) setTimeout(fire, Math.round(off*1000));
        window.__judges=[];
        const iv=setInterval(()=>{ const j=document.querySelector('#judge-text'); window.__judges.push({text:j?j.textContent:null,cls:j?j.className:null,score:document.querySelector('#play-score')?.textContent}); if(document.getElementById('arcade-back')) clearInterval(iv); },250);
        return true; })()`);
      await wait(2200);
      evid.rhythm.judgeEarly = await evalJs(`window.__judges.slice(0,8)`);
      await shot("38-rhythm-perfect");
      await wait(28000);
      const done = await waitResult(12000);
      evid.rhythm.done = done;
      evid.rhythm.result = await resultData();
      evid.rhythm.toast = await toastText();
      evid.rhythm.save = await saveArcade();
      evid.rhythm.judgeTail = await evalJs(`window.__judges.filter(x=>x.text).slice(-8)`);
      await shot("39-rhythm-result");
      await backToMenu();
      evid.limit = { menu: await menuData(), badge: await badge() };
      await shot("40-menu-0of3");
      await hideArcade();
    });

    // 4. 刷新持久化 + boot 角标（0 次）
    await stage("persist", async () => {
      await c.send("Page.reload");
      await waitBoot(); await closeModals(); await wait(500);
      evid.persist.badge = await badge();
      await openArcade();
      evid.persist.menu = await menuData();
      evid.persist.save = await saveArcade();
      await shot("41-menu-after-reload");
      await hideArcade();
    });

    // 5. 非破纪录（旧最高 9999）
    await stage("noRecord", async () => {
      await patchSaveThenReload((b) => { b.arcade = { date: new Date().toLocaleDateString("sv-SE"), played: 0, best: { coffee: b.arcade?.best?.coffee || 0, findboss: b.arcade?.best?.findboss || 0, rhythm: 9999 } }; });
      await openArcade();
      await evalJs(`document.querySelector('button[data-game="rhythm"]').click()`);
      await wait(400);
      await evalJs(`(()=>{const area=document.getElementById('play-area');const r=area.getBoundingClientRect();const fire=()=>area.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));for(let i=0;i<10;i++) setTimeout(fire, Math.round((0.6+i*0.5)*1000-2));return true})()`);
      await wait(30500);
      const done = await waitResult(12000);
      evid.noRecord.done = done;
      evid.noRecord.result = await resultData();
      evid.noRecord.toast = await toastText();
      evid.noRecord.save = await saveArcade();
      await shot("42-norecord-result");
      await backToMenu();
      evid.noRecord.menu = await menuData();
    });

    // 6. <2s 早退：应退还次数
    await stage("refund", async () => {
      await hideArcade();
      await patchSaveThenReload((b) => { b.arcade = { date: new Date().toLocaleDateString("sv-SE"), played: 0, best: b.arcade?.best || {} }; });
      evid.refund.before = await saveArcade();
      await openArcade();
      await evalJs(`document.querySelector('button[data-game="coffee"]').click()`);
      await wait(1400);
      await pressEsc();
      await wait(500);
      evid.refund.toast = await toastText();
      evid.refund.panelHidden = await evalJs(`document.getElementById('arcade').classList.contains('hidden')`);
      evid.refund.after = await saveArcade();
      evid.refund.badge = await badge();
      await openArcade();
      evid.refund.menu = await menuData();
      await shot("43-after-refund-menu");
    });

    // 7. 2-28s 中途退出：确认框 + 扣次数 + 按比例奖励
    await stage("exitConfirm", async () => {
      await hideArcade();
      await patchSaveThenReload((b) => { b.arcade = { date: new Date().toLocaleDateString("sv-SE"), played: 0, best: b.arcade?.best || {} }; });
      await evalJs(`(()=>{window.__confirms=[];window.confirm=(m)=>{window.__confirms.push(m);return true};return true})()`);
      await openArcade();
      evid.exit.start = await saveArcade();
      await evalJs(`(()=>{
        document.querySelector('button[data-game="coffee"]').click();
        const area=document.getElementById('play-area'); const t0=performance.now(); let last=-9;
        window.__et=0;
        window.__eIv=setInterval(()=>{
          const now=(performance.now()-t0)/1000;
          const els=[...document.querySelectorAll('#play-drops .drop')];
          if(now-last<0.12) return;
          const cand=els.filter(e=>!e.classList.contains('caught')&&!e.classList.contains('landed')).map(e=>({e,top:parseFloat(e.style.top)||0})).filter(o=>o.top>=84).sort((a,b)=>b.top-a.top);
          if(!cand.length) return;
          const r=cand[0].e.getBoundingClientRect();
          area.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));
          window.__et++; last=(performance.now()-t0)/1000;
        },40);
        return true; })()`);
      await wait(6200);
      evid.exit.mid = await evalJs(`(()=>({score:document.querySelector('#play-score')?.textContent, timer:document.querySelector('#play-timer')?.textContent, taps:window.__et}))()`);
      await shot("44-exit-midgame");
      await pressEsc();
      await wait(600);
      evid.exit.confirms = await evalJs(`window.__confirms`);
      evid.exit.toast = await toastText();
      evid.exit.after = await saveArcade();
      evid.exit.badge = await badge();
      await openArcade();
      evid.exit.menu = await menuData();
      await shot("45-menu-after-exit");
    });

    evid.final = { href: await evalJs(`location.href`), arcadeFromSave: await saveArcade() };
    evid.consoleErrors = c.errors.slice(0, 15);
    saveEvidence();
    c.close();
  },
  { timeoutMs: 320_000 },
);
console.log("DONE =>", DIR + "online-evidence.json");