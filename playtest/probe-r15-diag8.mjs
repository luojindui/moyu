import { runChrome, connect, sleep } from "./lib/chrome.mjs";
const URL="http://127.0.0.1:5173/";
await runChrome(async ({ port }) => {
  const c = await connect(port); const send=c.send, ev=c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.navigate", {url:URL});
  for(let i=0;i<250;i++){ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; await sleep(100); }
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(200);
  const before = await ev("({f:window.__MOYU__.frames, hidden:document.getElementById('arcade').classList.contains('hidden')})");
  await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}))");
  await sleep(300);
  const after = await ev("({f:window.__MOYU__.frames, hidden:document.getElementById('arcade').classList.contains('hidden')})");
  await sleep(700);
  const after2 = await ev("({f:window.__MOYU__.frames})");
  console.error("before", JSON.stringify(before), "after", JSON.stringify(after), "after2", JSON.stringify(after2), "frames-advancing", after2.f>after.f);
  // 再开一次，验证可重复
  await ev("document.getElementById('btn-arcade').click(); 1"); await sleep(150);
  const reopened = await ev("({hidden:document.getElementById('arcade').classList.contains('hidden'), left:document.getElementById('arcade-left').textContent})");
  console.error("reopened", JSON.stringify(reopened));
  c.close();
}, {timeoutMs:60000});
