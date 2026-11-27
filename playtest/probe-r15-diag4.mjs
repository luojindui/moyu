import { runChrome, connect, sleep } from "./lib/chrome.mjs";
await runChrome(async ({ port }) => {
  const c = await connect(port); const send=c.send, ev=c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", {url:"http://127.0.0.1:5173/"});
  for(let i=0;i<250;i++){ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; await sleep(100); }
  await ev(`(()=>{ const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click(); const cc=document.getElementById('cards'); if(cc&&!cc.classList.contains('hidden')) document.getElementById('cards-skip')?.click(); return 1; })()`);
  // instrument exactly like main probe
  await ev(`(()=>{ window.__R15={rafMeta:new Map(),rafPending:new Set(),clearCalls:0,longMeta:new Map(),longPending:new Set(),drops:[],toasts:[],rafExec:0};
    const o=window.requestAnimationFrame.bind(window), cx=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=(cb)=>{ const stack=(new Error().stack||'').slice(0,400); let id; id=o((t)=>{ window.__R15.rafPending.delete(id); window.__R15.rafExec++; cb(t); }); window.__R15.rafPending.add(id); window.__R15.rafMeta.set(id,stack); return id; };
    window.cancelAnimationFrame=(id)=>{ window.__R15.rafPending.delete(id); window.__R15.clearCalls++; cx(id); };
    const so=window.setTimeout.bind(window), co=window.clearTimeout.bind(window);
    window.setTimeout=(fn,ms,...a)=>{ const stack=(new Error().stack||'').slice(0,400); const id=so(fn,ms,...a); if(typeof ms==='number'&&ms>=5000){ window.__R15.longPending.add(id); window.__R15.longMeta.set(id,stack+'|'+ms);} return id; };
    window.clearTimeout=(id)=>{ window.__R15.longPending.delete(id); co(id); };
    return 1; })()`);
  const arcadeState = () => ev("window.__MOYU__.state.arcade");
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(150);
  await ev("window.__R15.coffeeStart = performance.now(); 1");
  await ev(`document.querySelector('button[data-game="coffee"]').click(); 1`);
  await sleep(120);
  const timerBefore = await ev("({frames:window.__MOYU__.frames, exec:window.__R15.rafExec, timer:document.getElementById('play-timer')?.textContent})");
  console.error("before-shot:", JSON.stringify(timerBefore));
  for (let i=0;i<14;i++){
    await sleep(160);
    const s = await ev(`(()=>{ const sc=document.getElementById('play-score'); const tm=document.getElementById('play-timer'); return {t:Math.round(performance.now()-window.__R15.coffeeStart), score:sc?sc.textContent:null, timer:tm?tm.textContent:null, dropEls:document.querySelectorAll('.drop').length, frames:window.__MOYU__.frames, exec:window.__R15.rafExec}; })()`);
    if (i===0) { const r=await send("Page.captureScreenshot",{format:"png"}); console.error("shotA", (r.data||"").length); }
    if (i===5) { const r=await send("Page.captureScreenshot",{format:"png"}); console.error("shotB", (r.data||"").length); }
    console.error(JSON.stringify(s));
  }
  for (let i=0;i<10;i++){ await sleep(1000); const s=await ev(`({ms:Math.round(performance.now()-window.__R15.coffeeStart), timer:document.getElementById('play-timer')?.textContent, frames:window.__MOYU__.frames, exec:window.__R15.rafExec, back:!!document.getElementById('arcade-back'), vis:document.visibilityState})`); console.error("watch", JSON.stringify(s)); }
  c.close();
}, {timeoutMs:90000});
