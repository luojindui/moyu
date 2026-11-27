import { runChrome, connect, sleep } from "./lib/chrome.mjs";
const URL="http://127.0.0.1:5173/";
await runChrome(async ({ port }) => {
  const c = await connect(port); const send=c.send, ev=c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  const rate = async (label) => { const a=await ev("window.__MOYU__?window.__MOYU__.frames:null"); await sleep(600); const b=await ev("window.__MOYU__?window.__MOYU__.frames:null"); console.error(label, a, "->", b, "delta", (b??0)-(a??0)); };
  const esc = async () => { await send("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27}); await send("Input.dispatchKeyEvent", {type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27}); };
  const install = () => ev(`(()=>{ if(window.__R15) return 'already'; window.__R15={rafMeta:new Map(),rafPending:new Set(),rafExec:0,clearCalls:0,longMeta:new Map(),longPending:new Set(),dropRecs:[],toastText:''};
    const o=window.requestAnimationFrame.bind(window), cx=window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=(cb)=>{ const stack=(new Error().stack||'').slice(0,300); let id; id=o((t)=>{ window.__R15.rafPending.delete(id); window.__R15.rafExec++; cb(t); }); window.__R15.rafPending.add(id); window.__R15.rafMeta.set(id,stack); return id; };
    window.cancelAnimationFrame=(id)=>{ window.__R15.rafPending.delete(id); window.__R15.clearCalls++; cx(id); };
    const so=window.setTimeout.bind(window), co=window.clearTimeout.bind(window);
    window.setTimeout=(fn,ms,...a)=>{ const stack=(new Error().stack||'').slice(0,300); const id=so(fn,ms,...a); if(typeof ms==='number'&&ms>=5000){ window.__R15.longPending.add(id); window.__R15.longMeta.set(id,stack+'|'+ms);} return id; };
    window.clearTimeout=(id)=>{ window.__R15.longPending.delete(id); co(id); };
    const obs=new MutationObserver((muts)=>{ for(const m of muts){ for(const n of m.addedNodes){ if(n.nodeType===1&&n.classList&&n.classList.contains('drop')){ const rec={t:performance.now(),top:n.style.top,left:n.style.left,removeT:null}; n.__r15rec=rec; window.__R15.dropRecs.push(rec);} } for(const n of m.removedNodes){ if(n.nodeType===1&&n.classList&&n.classList.contains('drop')&&n.__r15rec) n.__r15rec.removeT=performance.now(); } } const el=document.getElementById('dom-toast'); if(el) window.__R15.toastText=el.textContent||''; });
    obs.observe(document.body,{childList:true,subtree:true,characterData:true});
    return 'installed'; })()`);
  await send("Page.navigate", {url:URL});
  for(let i=0;i<250;i++){ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; await sleep(100); }
  await rate("navigate");
  // freshReload equivalent
  await ev(`(()=>{ if(!window.__origSet){ window.__origSet = Storage.prototype.setItem; Storage.prototype.setItem = function(){}; } return 1; })()`);
  await ev("localStorage.clear(); sessionStorage.clear(); 1");
  await send("Page.reload", {ignoreCache:true});
  for(let i=0;i<250;i++){ try{ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; }catch(e){} await sleep(100); }
  await rate("after-reload");
  await ev(`(()=>{ const w=document.getElementById('welcome'); if(w&&!w.classList.contains('hidden')) document.getElementById('welcome-ok')?.click(); const cc=document.getElementById('cards'); if(cc&&!cc.classList.contains('hidden')) document.getElementById('cards-skip')?.click(); return 1; })()`);
  await rate("after-dismiss");
  await install();
  await rate("after-install");
  await ev("new Date().toLocaleDateString('sv-SE')");
  await rate("after-today");
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(130);
  await rate("after-open1");
  await ev("(()=>{ const cards=[...document.querySelectorAll('.arcade-card')]; return cards.length; })()");
  await rate("after-menu1");
  await esc(); await sleep(150);
  await rate("after-esc");
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(130);
  await rate("after-open2");
  await ev("window.__R15.coffeeStart = performance.now(); 1");
  await ev(`document.querySelector('button[data-game="coffee"]').click(); 1`);
  await rate("after-coffee-click");
  await sleep(500); await rate("coffee+0.5s");
  await sleep(1000); await rate("coffee+1.5s");
  const st = await ev("({frames:window.__MOYU__.frames, exec:window.__R15.rafExec, timer:document.getElementById('play-timer')?.textContent, drops:document.querySelectorAll('.drop').length})");
  console.error("state:", JSON.stringify(st));
  c.close();
}, {timeoutMs:90000});
