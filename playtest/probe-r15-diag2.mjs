import { runChrome, connect, sleep } from "./lib/chrome.mjs";
await runChrome(async ({ port }) => {
  const c = await connect(port); const send=c.send, ev=c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", {url:"http://127.0.0.1:5173/"});
  for(let i=0;i<200;i++){ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>20")) break; await sleep(100); }
  await ev(`(()=>{ const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click(); const cc=document.getElementById('cards'); if(cc&&!cc.classList.contains('hidden')) document.getElementById('cards-skip')?.click(); return 1; })()`);
  await ev(`(()=>{ window.__D={raf:[], toasts:[]};
    const o=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=(cb)=>{ const st=(new Error().stack||'').split(String.fromCharCode(10)).slice(1,3).join('|'); const id=o((t)=>{ window.__D.raf.push({t:performance.now(), st}); cb(t); }); return id; };
    return 1; })()`);
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(150);
  await ev(`window.__D.t0=performance.now(); document.querySelector('button[data-game="coffee"]').click(); 1`);
  for (let i=0;i<12;i++){
    await sleep(300);
    const s = await ev(`(()=>{ const d=window.__D; const arc=d.raf.filter(x=>x.st.includes('arcade')).length; const main=d.raf.length-arc; return {ms:Math.round(performance.now()-d.t0), timer:document.getElementById('play-timer')?.textContent, score:document.getElementById('play-score')?.textContent, drops:document.querySelectorAll('.drop').length, rafTotal:d.raf.length, rafArcade:arc, rafMain:main, frames:window.__MOYU__.frames, vis:document.visibilityState, play:!!document.getElementById('play-area'), back:!!document.getElementById('arcade-back')}; })()`);
    console.error(JSON.stringify(s));
  }
  const stacks = await ev("window.__D.raf.slice(0,3).map(x=>x.st)");
  console.error("stacks:", JSON.stringify(stacks));
  c.close();
}, {timeoutMs:60000});
