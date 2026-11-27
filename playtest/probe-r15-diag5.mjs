import { runChrome, connect, sleep } from "./lib/chrome.mjs";
const URL="http://127.0.0.1:5173/";
await runChrome(async ({ port }) => {
  const c = await connect(port); const send=c.send, ev=c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  const frameRate = async (label) => { const a=await ev("window.__MOYU__?window.__MOYU__.frames:null"); await sleep(1000); const b=await ev("window.__MOYU__?window.__MOYU__.frames:null"); console.error(label, "frames", a, "->", b, "delta", (b??0)-(a??0)); };
  // close other targets first (like v2)
  try { const info=await send("Target.getTargetInfo"); const myId=info.targetInfo?.targetId;
    const list=await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
    for(const t of list) if(t.type==='page' && t.id!==myId) await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(()=>{});
    await fetch(`http://127.0.0.1:${port}/json/activate/${myId}`).catch(()=>{});
  } catch(e){ console.error("target setup err", String(e)); }
  await send("Page.navigate", {url:URL});
  for(let i=0;i<250;i++){ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; await sleep(100); }
  await frameRate("after-navigate");
  await send("Page.reload", {ignoreCache:true});
  for(let i=0;i<250;i++){ try { if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; } catch(e){} await sleep(100); }
  await frameRate("after-reload");
  await ev(`(()=>{ window.__R15={rafMeta:new Map(),rafPending:new Set(),rafExec:0};
    const o=window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame=(cb)=>{ const stack=(new Error().stack||'').slice(0,300); let id; id=o((t)=>{ window.__R15.rafPending.delete(id); window.__R15.rafExec++; cb(t); }); window.__R15.rafPending.add(id); window.__R15.rafMeta.set(id,stack); return id; };
    return 1; })()`);
  const a=await ev("({frames:window.__MOYU__.frames, exec:window.__R15.rafExec})"); await sleep(1000); const b=await ev("({frames:window.__MOYU__.frames, exec:window.__R15.rafExec})");
  console.error("after-instrument frames", JSON.stringify(a), "->", JSON.stringify(b));
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(300);
  const ca=await ev("({frames:window.__MOYU__.frames, exec:window.__R15.rafExec})"); await sleep(1000); const cb2=await ev("({frames:window.__MOYU__.frames, exec:window.__R15.rafExec})");
  console.error("after-open-arcade", JSON.stringify(ca), "->", JSON.stringify(cb2));
  c.close();
}, {timeoutMs:90000});
