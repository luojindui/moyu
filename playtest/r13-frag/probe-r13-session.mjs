// R13 碎片党：单次 120s 真实会话打断统计（390x844）
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL_ = "http://127.0.0.1:5173/";
const PORT = 19900 + Math.floor(Math.random() * 90);
const PROFILE = `/tmp/chrome-r13frag-session-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} process.exit(2); }, 200000);
async function waitJson(p, tries = 200) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch {} await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const list = await waitJson("/json/list");
const ws = new WebSocket(list.find((x) => x.type === "page").webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const js = async (expr) => { try { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: r.exceptionDetails.text } : r.result.value; } catch (e) { return { __err: String(e) }; } };
const tap = async (x, y) => { await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); };
const waitTrue = async (expr, timeout = 6000, step = 60) => { const t0 = Date.now(); while (Date.now() - t0 < timeout) { if (await js(expr) === true) return Date.now() - t0; await sleep(step); } return -1; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Page.navigate", { url: URL_ });
await waitTrue(`!!window.__MOYU__`, 20000, 80);
await sleep(600);
const out = { note: "120s 会话，每 6s 点一次屏幕；弹层一律不理会（模拟通勤时偶尔瞥一眼）" };
// 首开：先按碎片党最快处理——点第一张卡（不改状态，只是模拟日常）
out.firstOpen = await js(`(()=>{const c=document.querySelector('#cards .card');const has=c?1:0;if(c)c.click();return {hadCards:has, chosen:window.__MOYU__.state.cards.chosen}})()`);
await sleep(500);
// 安装 announce 记录器 + 开始观察
await js(`(()=>{
  window.__r13={announces:[], choiceShows:[], toasts:[], t0:performance.now()};
  const live=document.getElementById('sr-live');
  new MutationObserver(()=>{const t=live.textContent.trim(); if(t) window.__r13.announces.push({t:+(performance.now()-window.__r13.t0).toFixed(0), text:t});}).observe(live,{childList:true,characterData:true,subtree:true});
  const toast=document.getElementById('dom-toast');
  new MutationObserver(()=>{ if(toast.classList.contains('show')) window.__r13.toasts.push({t:+(performance.now()-window.__r13.t0).toFixed(0), text:toast.textContent}); }).observe(toast,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
  return 'installed';
})()`);
const cr = await js(`(()=>{const b=document.getElementById('stage').getBoundingClientRect();return {x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height*0.3)}})()`);
const T0 = Date.now(); const DURATION = 120000;
let lastChoiceVisible = false, choiceStart = null, choiceRecord = null;
let taps = 0; let nextTapAt = 2500;
const fpsSamples = [];
while (Date.now() - T0 < DURATION) {
  const st = await js(`(()=>{const b=document.getElementById('boss-choice'), c=document.getElementById('cards');
    const bv=b&&!b.classList.contains('hidden'), cv=c&&!c.classList.contains('hidden');
    const tell=bv?(document.getElementById('boss-tell').textContent||''):'';
    return {bv,cv,tell, elapsed:+(performance.now()-(window.__r13?window.__r13.t0:0)).toFixed(0)}})()`);
  const tRel = Date.now() - T0;
  if (st.bv && !lastChoiceVisible) { choiceStart = Date.now(); choiceRecord = { atSec: +(tRel / 1000).toFixed(1), tell: st.tell, pickedByPlayer: false, visibleMs: null }; out.choiceEvents = out.choiceEvents || []; }
  if (!st.bv && lastChoiceVisible && choiceRecord) { choiceRecord.visibleMs = Date.now() - choiceStart; out.choiceEvents = out.choiceEvents || []; out.choiceEvents.push(choiceRecord); choiceRecord = null; }
  lastChoiceVisible = st.bv;
  if (Date.now() >= nextTapAt && !st.bv && !st.cv) { await tap(cr.x, cr.y); taps++; nextTapAt = Date.now() + 6000; }
  await sleep(180);
}
out.tapsInSession = taps;
out.announces = await js(`window.__r13.announces`);
out.toasts = await js(`window.__r13.toasts`);
out.choiceEventCount = (out.choiceEvents || []).length;
out.srLiveText = await js(`document.getElementById('sr-live').textContent`);
out.finalState = await js(`({moyu:Math.round(window.__MOYU__.state.moyu), patrolSurvives:window.__MOYU__.state.patrolSurvives, surviveStreak:window.__MOYU__.state.surviveStreak, daily:window.__MOYU__.state.daily&&{click:window.__MOYU__.state.daily.click, idle:window.__MOYU__.state.daily.idle}})`);
const bossAnn = (out.announces || []).filter((a) => /王总巡逻|摸鱼冲刺|假装工作|回合制/.test(a.text));
out.bossAnnounceCount = bossAnn.length;
out.bossAnnounces = bossAnn;
out.memeAnnounceCount = (out.announces || []).filter((a) => /丢来一个梗/.test(a.text)).length;
out.toastCount = (out.toasts || []).length;
console.log(JSON.stringify(out, null, 1));
writeFileSync("/tmp/r13frag-session.json", JSON.stringify(out, null, 1));
clearTimeout(watchdog); try { proc.kill("SIGKILL"); } catch {} process.exit(0);
