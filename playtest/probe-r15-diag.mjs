import { runChrome, connect, sleep } from "./lib/chrome.mjs";
await runChrome(async ({ port }) => {
  const c = await connect(port);
  const send = c.send, ev = c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  const list1 = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  console.error("targets-before:", JSON.stringify(list1.map(t=>({id:t.id,type:t.type,url:t.url.slice(0,30)}))));
  const info = await send("Target.getTargetInfo").catch(e=>({err:String(e)}));
  console.error("targetInfo:", JSON.stringify(info));
  await send("Page.navigate", {url:"http://127.0.0.1:5173/"});
  let ok=false;
  for(let i=0;i<200;i++){ const v=await ev("!!window.__MOYU__"); if(v){ok=true;break;} await sleep(100); }
  console.error("booted:", ok);
  const vis = await ev("({state:document.visibilityState, hidden:document.hidden, hasFocus:document.hasFocus()})");
  console.error("visibility:", JSON.stringify(vis));
  const f1 = await ev("window.__MOYU__.frames"); await sleep(1000); const f2 = await ev("window.__MOYU__.frames");
  console.error("frames delta 1s:", f2-f1);
  // activate
  const targetId = info.targetInfo?.targetId;
  try { const r = await fetch(`http://127.0.0.1:${port}/json/activate/${targetId}`); console.error("activate http status", r.status); } catch(e){ console.error("activate err", String(e)); }
  // close the other blank target(s)
  const list2 = await fetch(`http://127.0.0.1:${port}/json/list`).then(r=>r.json());
  for (const t of list2) { if (t.id !== targetId) { try { await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`); console.error("closed", t.id); } catch(e){} } }
  await sleep(300);
  const vis2 = await ev("({state:document.visibilityState, hidden:document.hidden, hasFocus:document.hasFocus()})");
  console.error("visibility-after:", JSON.stringify(vis2));
  const f3 = await ev("window.__MOYU__.frames"); await sleep(1000); const f4 = await ev("window.__MOYU__.frames");
  console.error("frames delta after activate:", f4-f3);
  c.close();
}, {timeoutMs:60000});
