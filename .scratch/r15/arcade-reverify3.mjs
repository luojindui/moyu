/**
 * r15 收集党 · 复验补丁2：中途退出（6.5s Esc）扣次数 + 确认框 + 奖励折算接线
 * Chrome 走 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "http://127.0.0.1:5173/";
const wait = (ms) => sleep(ms);
const evid = {};
const saveEvidence = () => writeFileSync(DIR + "evidence2c.json", JSON.stringify(evid, null, 2));

await runChrome(async ({ port }) => {
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
    for (let i = 0; i < 150; i++) { const ok = await evalJs(`!!(window.__MOYU__ && document.getElementById('arcade-body'))`).catch(() => false); if (ok) { await wait(600); return; } await wait(100); }
    throw new Error("app not ready");
  };
  const clearModals = async () => {
    for (let i = 0; i < 20; i++) {
      const done = await evalJs(`(()=>{
        const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) { document.getElementById('welcome-ok')?.click(); return 'welcome'; }
        const cd=document.getElementById('cards'); if(cd&&!cd.classList.contains('hidden')) { document.getElementById('cards-skip')?.click(); return 'cards'; }
        return 'none'; })()`).catch(() => "err");
      if (done === "none") return;
      await wait(250);
    }
  };
  const openArcade = async () => { await evalJs(`(()=>{const r=document.getElementById('arcade');if(r.classList.contains('hidden'))document.getElementById('btn-arcade').click();return true})()`); await wait(300); };
  const stateArcade = () => evalJs(`window.__MOYU__.state.arcade`);
  const toastText = () => evalJs(`(()=>{const t=document.getElementById('dom-toast');return t?t.textContent:null})()`);
  const pressEsc = async () => {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  };
  const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);

  await c.send("Page.navigate", { url: URL_ });
  await waitForApp(); await clearModals();

  // 重置：played=0, 保留最高分
  await evalJs(`window.__MOYU__.saveNow()`);
  const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
  blob.arcade = { date: today, played: 0, best: blob.arcade?.best || {} };
  await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))}); Storage.prototype.setItem=function(){}; return true})()`);
  await c.send("Page.reload");
  await waitForApp(); await wait(700); await clearModals(); await wait(400); await clearModals();

  evid.before = await stateArcade();
  evid.beforeBadge = await evalJs(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');return {badge:b?b.textContent:null,aria:document.getElementById('btn-arcade').getAttribute('aria-label')}})()`);
  await openArcade();
  evid.menuOpen = await evalJs(`(()=>({hidden:document.getElementById('arcade').classList.contains('hidden'), title:document.getElementById('arcade-title').textContent, cards:!!document.querySelector('#arcade-body button[data-game]')}))()`);
  // confirm stub（reload 之后设置）
  await evalJs(`(()=>{window.__confirms=[];window.confirm=(m)=>{window.__confirms.push(m);return true};return true})()`);
  // 开始咖啡
  await evalJs(`(()=>{
    const drops=[]; let t=0.8; while(t<29.5){ drops.push({at:+t.toFixed(2),x:0.44}); t+=0.8+0.42*0.55; }
    window.__drops=drops; Math.random=()=>0.42;
    document.querySelector('button[data-game="coffee"]').click();
    const area=document.getElementById('play-area');
    window.__started={title:document.getElementById('arcade-title').textContent, hasArea:!!area, areaVisible: area ? area.getBoundingClientRect().height>100 : false};
    const rect=area.getBoundingClientRect(); const t0=performance.now(); let last=-9;
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
  await wait(300);
  evid.started = await evalJs(`window.__started`);
  await wait(5800);
  evid.mid = await evalJs(`(()=>({score:document.querySelector('#play-score')?.textContent, timer:document.querySelector('#play-timer')?.textContent, taps:window.__exitTaps, judge:document.querySelector('#judge-text')?.textContent}))()`);
  await shot("27-exit-midgame-6s");
  await pressEsc();
  await wait(600);
  evid.confirms = await evalJs(`window.__confirms`);
  evid.panelHidden = await evalJs(`document.getElementById('arcade').classList.contains('hidden')`);
  evid.toast = await toastText();
  evid.after = await stateArcade();
  evid.afterSave = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade`);
  evid.badge = await evalJs(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');return {badge:b?b.textContent:null,aria:document.getElementById('btn-arcade').getAttribute('aria-label')}})()`);
  await openArcade();
  evid.menuAfter = await evalJs(`(()=>({left:document.getElementById('arcade-left').textContent, title:document.getElementById('arcade-title').textContent}))()`);
  evid.errors = c.errors.slice(0, 10);
  await shot("28-menu-after-midexit");
  saveEvidence();
  c.close();
}, { timeoutMs: 90_000 });
console.log("DONE =>", DIR + "evidence2c.json");