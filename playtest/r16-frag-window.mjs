// r16 补充（简化版）：日报每 6 小时一窗口 → claimed 是否复位（一天可领 4 次？）
import { writeFileSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "http://127.0.0.1:5173/";
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { steps: [] };
const now = () => Date.now();

await runChrome(async ({ port }) => {
  log("launching; connecting port", port);
  const c = await connect(port);
  log("connected");
  const rawSend = c.send.bind(c);
  c.send = (m, p) => Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 10000))]);
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  const ev = async (expr) => { try { return await c.ev(expr); } catch (e) { return { __err: String(e).slice(0, 200) }; } };
  const waitFor = async (expr, ms = 20000, step = 120) => { const st = now(); while (now() - st < ms) { if (await ev(expr)) return true; await sleep(step); } return false; };
  const readDaily = () => ev(`(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save')||'null');return b&&b.daily?{date:b.daily.date,window:b.daily.window,claimed:b.daily.claimed,claimsToday:b.daily.claimsToday,streak:b.daily.streak,goals:b.daily.goals}:null}catch(e){return {err:String(e)}}})()`);
  const reload = async (tag) => {
    log("reload", tag);
    await c.send("Page.reload", { ignoreCache: false });
    const ok = await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 25000);
    log("reload ready", tag, ok);
    await sleep(3200);
  };
  const patchReload = async (patchSrc, tag) => {
    const id = (await c.send("Page.addScriptToEvaluateOnNewDocument", { source: `try{const k='moyu-save';const b=JSON.parse(localStorage.getItem(k)||'null');if(b&&b.daily){${patchSrc}}localStorage.setItem(k,JSON.stringify(b));}catch(e){}` })).identifier;
    try { await c.send("DOM.enable").catch(() => undefined); } catch { /* ignore */ }
    try { await reload(tag); } finally { await c.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: id }); }
  };

  await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  log("navigate");
  await c.send("Page.navigate", { url: BASE });
  const ready = await waitFor("document.readyState==='complete' && !!window.__MOYU__ && !!document.getElementById('btn-arcade')", 30000);
  log("app ready", ready);
  await sleep(1500);
  const d0 = (await ev(`(()=>{try{return window.__MOYU__.state.daily}catch(e){return null}})()`)) ?? (await readDaily());
  log("d0", JSON.stringify(d0));
  R.steps.push({ stage: "初始(首日)", daily: d0 });
  const today = new Date();
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  await patchReload(`b.daily.claimed=true;b.daily.claimsToday=1;b.daily.lastCompleteDate='${dateStr}';b.daily.streak=1;b.daily.goals.forEach(g=>{g.progress=g.target;g.done=true;});`, "patch-claimed");
  const d1 = (await ev(`(()=>{try{return window.__MOYU__.state.daily}catch(e){return null}})()`)) ?? (await readDaily());
  log("d1", JSON.stringify(d1));
  R.steps.push({ stage: "已领(同窗口)重载后", daily: d1 });
  await patchReload(`b.daily.window=(b.daily.window+1)%4;`, "patch-window");
  const d2 = (await ev(`(()=>{try{return window.__MOYU__.state.daily}catch(e){return null}})()`)) ?? (await readDaily());
  await sleep(800);
  const claimBtn = await ev(`(()=>{const b=document.getElementById('journal-claim');return b?{text:b.textContent,dis:b.disabled}:null})()`);
  const energy = await ev(`(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save'));return b.energy}catch(e){return null}})()`);
  log("d2", JSON.stringify(d2), "claimBtn", JSON.stringify(claimBtn));
  R.steps.push({ stage: "下一窗口重载后", daily: d2, claimBtn, energy });
  R.verdict = {
    sameWindowClaimed: d1?.claimed,
    nextWindowClaimed: d2?.claimed,
    claimsTodayKept: d2?.claimsToday,
    windowChanged: d2?.window,
    goalIds: d1?.goals?.map((g) => g.id),
    goalIdsNext: d2?.goals?.map((g) => g.id),
  };
  writeFileSync("playtest/r16-frag-window.json", JSON.stringify(R, null, 2));
  log("verdict", JSON.stringify(R.verdict));
}, { timeoutMs: 120_000 });
log("DONE");