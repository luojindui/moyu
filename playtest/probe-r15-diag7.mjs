import { runChrome, connect, sleep } from "./lib/chrome.mjs";
const URL="http://127.0.0.1:5173/";
await runChrome(async ({ port }) => {
  const c = await connect(port); const send=c.send, ev=c.ev;
  await send("Page.enable"); await send("Runtime.enable");
  const info = async (label) => { const a=await ev("({f:window.__MOYU__?window.__MOYU__.frames:null, href:location.href, ready:document.readyState})"); await sleep(700); const b=await ev("({f:window.__MOYU__?window.__MOYU__.frames:null, href:location.href, ready:document.readyState})"); console.error(label, JSON.stringify(a), "delta", (b.f??0)-(a.f??0)); };
  await send("Page.navigate", {url:URL});
  for(let i=0;i<250;i++){ if(await ev("!!window.__MOYU__ && window.__MOYU__.frames>15")) break; await sleep(100); }
  await info("baseline");
  // A: real CDP Escape
  await send("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27});
  await send("Input.dispatchKeyEvent", {type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27});
  await sleep(200);
  await info("after-cdp-esc");
  // B: synthetic KeyboardEvent
  await ev("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}))");
  await sleep(200);
  await info("after-synthetic-esc");
  c.close();
}, {timeoutMs:60000});
