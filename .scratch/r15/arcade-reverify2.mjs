/**
 * r15 收集党 · 摸鱼站复验补丁探针（中途退出/角标/宽容窗）
 * Chrome 走 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "http://127.0.0.1:5173/";
const wait = (ms) => sleep(ms);
const evid = { stages: {}, badgeReload: {}, lateCatch: {}, exitMid: {}, exitEarly: {}, cancel: {}, errors: [] };
const saveEvidence = () => writeFileSync(DIR + "evidence2b.json", JSON.stringify(evid, null, 2));

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
    const waitForApp = async () => {
      for (let i = 0; i < 150; i++) { const ok = await evalJs(`!!(window.__MOYU__ && document.getElementById('arcade-body'))`).catch(() => false); if (ok) { await wait(700); return; } await wait(100); }
      throw new Error("app not ready");
    };
    const closeOverlays = async () => { await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden'))document.getElementById('welcome-ok')?.click();const cd=document.getElementById('cards');if(cd&&!cd.classList.contains('hidden'))document.getElementById('cards-skip')?.click();return true})()`).catch(() => {}); await wait(120); };
    const openArcade = async () => { await evalJs(`(()=>{const r=document.getElementById('arcade');if(r.classList.contains('hidden'))document.getElementById('btn-arcade').click();return true})()`); await wait(250); };
    const hideArcade = async () => { await evalJs(`(()=>{const r=document.getElementById('arcade');if(!r.classList.contains('hidden'))document.getElementById('arcade-close').click();return true})()`); await wait(200); };
    const badge = () => evalJs(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');const a=document.getElementById('btn-arcade');return {badge:b?b.textContent:null,aria:a?a.getAttribute('aria-label'):null}})()`);
    const stateArcade = () => evalJs(`window.__MOYU__.state.arcade`);
    const saveArcade = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade||null}catch(e){return null}})()`);
    const toastText = () => evalJs(`(()=>{const t=document.getElementById('dom-toast');return t?t.textContent:null})()`);
    const menuData = () => evalJs(`(()=>{const r=document.getElementById('arcade');if(!r||r.classList.contains('hidden'))return null;return {left:document.getElementById('arcade-left').textContent, cards:[...document.querySelectorAll('#arcade-body .arcade-card')].map(c=>c.querySelector('.arcade-name')?.textContent), buttons:[...document.querySelectorAll('#arcade-body button[data-game]')].map(b=>({text:b.textContent.trim(),disabled:b.disabled}))}})()`);
    const writeSaveThenReload = async (mutate) => {
      await evalJs(`window.__MOYU__.saveNow()`).catch(() => {});
      const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
      mutate(blob);
      const json = JSON.stringify(blob);
      await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(json)}); Storage.prototype.setItem=function(){}; return true})()`);
      await c.send("Page.reload");
      await waitForApp(); await wait(800); await closeOverlays();
    };
    const stubConfirm = (ret) => evalJs(`(()=>{window.__confirms=[];window.confirm=(m)=>{window.__confirms.push(m);return ${ret}};return true})()`);
    const pressEsc = async () => {
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    };
    const stage = async (name, fn) => {
      try { await fn(); evid.stages[name] = "ok"; }
      catch (e) { evid.stages[name] = "FAIL: " + String(e).slice(0, 300); evid.errors.push(name + ": " + String(e).slice(0, 300)); try { await shot("err-" + name); } catch {} }
      saveEvidence();
    };
    const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
    // 咖啡已知掉落（rng=0.42 新公式）
    const drops = (() => { const o = []; let t = 0.8; let id = 0; while (t < 29.5) { o.push({ id: id++, at: +t.toFixed(2), x: 0.44 }); t += 0.8 + 0.42 * 0.55; } return o; })();

    await c.send("Page.navigate", { url: URL_ });
    await waitForApp(); await closeOverlays();

    // A. 刷新后 🎮 角标是否恢复
    await stage("badgeReload", async () => {
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 1, best: { coffee: 516, findboss: 8000, rhythm: 1065 } }; });
      evid.badgeReload.after = await badge();
      await openArcade();
      evid.badgeReload.menu = await menuData();
      await shot("21-badge-after-reload");
      await hideArcade();
    });

    // B. 宽容窗：落地变暗后 0.32s 内还能接住吗 + 早退（<2s）是否扣次数
    await stage("lateCatch", async () => {
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: b.arcade?.best || {} }; });
      await openArcade();
      await stubConfirm(true);
      await evalJs(`(()=>{
        window.__origRandom = Math.random; Math.random = () => 0.42;
        document.querySelector('button[data-game="coffee"]').click();
        const area=document.getElementById('play-area');
        const rect=area.getBoundingClientRect();
        window.__late={};
        const t0=performance.now();
        // 在 elapsed≈1.0s 时点"已落地变暗"的那颗（drop at=0.8，落地在 elapsed>0.8）
        setTimeout(()=>{
          const el=[...document.querySelectorAll('#play-drops .drop')].find(e=>e.classList.contains('landed'));
          if(el){ const r=el.getBoundingClientRect(); area.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));
            window.__late={clicked:true, clsBefore:el.className, top:el.style.top, scoreAfter:document.getElementById('play-score')?.textContent, t:+((performance.now()-t0)/1000).toFixed(2)};
          } else window.__late={clicked:false};
        }, 1020);
        return true; })()`);
      await wait(1300);
      evid.lateCatch = await evalJs(`(()=>{const el=document.querySelector('#play-drops .drop.landed');return window.__late;})()`);
      await shot("22-landed-late-catch");
      // 立刻 Esc（<2s）→ 观察是否弹确认 & 是否扣次数
      await pressEsc();
      await wait(400);
      evid.exitEarly.arcade = await stateArcade();
      evid.exitEarly.confirms = await evalJs(`window.__confirms`);
      evid.exitEarly.panelHidden = await evalJs(`document.getElementById('arcade').classList.contains('hidden')`);
      evid.exitEarly.toast = await toastText();
      evid.exitEarly.save = await saveArcade();
      evid.exitEarly.badge = await badge();
      await openArcade();
      evid.exitEarly.menu = await menuData();
      await shot("23-early-exit-menu");
    });

    // C. 中途退出（6.5s，>2s 会弹确认）：扣次数 + 奖励折算接线检查
    await stage("exitMid", async () => {
      await hideArcade();
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: b.arcade?.best || {} }; });
      await openArcade();
      await stubConfirm(true);
      await evalJs(`(()=>{
        const drops=${JSON.stringify(drops)};
        Math.random=()=>0.42;
        document.querySelector('button[data-game="coffee"]').click();
        const area=document.getElementById('play-area'); const rect=area.getBoundingClientRect();
        const t0=performance.now(); let last=-9;
        window.__exitTaps=0;
        window.__exitIv=setInterval(()=>{
          const now=(performance.now()-t0)/1000;
          const els=[...document.querySelectorAll('#play-drops .drop')];
          if(now-last<0.12) return;
          const cand=els.filter(e=>!e.classList.contains('caught')&&!e.classList.contains('landed')).map(e=>({e,top:parseFloat(e.style.top)||0})).filter(o=>o.top>=84).sort((a,b)=>b.top-a.top);
          if(!cand.length) return;
          const r=cand[0].e.getBoundingClientRect();
          area.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true}));
          window.__exitTaps++; last=(performance.now()-t0)/1000;
        },40);
        return true; })()`);
      await wait(6300);
      evid.exitMid.mid = await evalJs(`(()=>({score:document.querySelector('#play-score')?.textContent, timer:document.querySelector('#play-timer')?.textContent, taps:window.__exitTaps}))()`);
      await shot("24-exit-midgame-6s");
      await pressEsc();
      await wait(500);
      evid.exitMid.confirms = await evalJs(`window.__confirms`);
      evid.exitMid.panelHidden = await evalJs(`document.getElementById('arcade').classList.contains('hidden')`);
      evid.exitMid.toast = await toastText();
      evid.exitMid.arcade = await stateArcade();
      evid.exitMid.save = await saveArcade();
      evid.exitMid.badge = await badge();
      await openArcade();
      evid.exitMid.menu = await menuData();
      await shot("25-exit-menu");
    });

    // D. 确认框选“取消”：面板应保持、游戏继续
    await stage("cancel", async () => {
      await hideArcade();
      await writeSaveThenReload((b) => { b.arcade = { date: today, played: 0, best: b.arcade?.best || {} }; });
      await openArcade();
      await stubConfirm(false);
      await evalJs(`(()=>{ Math.random=()=>0.42; document.querySelector('button[data-game="coffee"]').click(); return true; })()`);
      await wait(4200);
      const before = await evalJs(`(()=>({timer:document.querySelector('#play-timer')?.textContent, playing:!!document.getElementById('play-area')}))()`);
      await pressEsc();
      await wait(400);
      evid.cancel.before = before;
      evid.cancel.confirms = await evalJs(`window.__confirms`);
      evid.cancel.panelStillOpen = await evalJs(`!document.getElementById('arcade').classList.contains('hidden')`);
      evid.cancel.stillPlaying = await evalJs(`!!document.getElementById('play-area')`);
      evid.cancel.timerAfter = await evalJs(`document.querySelector('#play-timer')?.textContent`);
      evid.cancel.arcade = await stateArcade();
      await shot("26-cancel-keeps-playing");
    });

    evid.finalArcade = await evalJs(`window.__MOYU__.state.arcade`);
    evid.consoleErrors = c.errors.slice(0, 10);
    saveEvidence();
    c.close();
  },
  { timeoutMs: 120_000 },
);
console.log("DONE =>", DIR + "evidence2b.json");