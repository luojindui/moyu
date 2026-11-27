/**
 * R13：回合制老板弹层截图 + 4s 倒计时实测（弹出→超时消失耗时）
 */
import { writeFileSync } from "node:fs";
import { launch, sleep } from "./probe-r13-lib.mjs";

const b = await launch({ port: 9833 });
const out = {};
const PANEL_OPEN = "!!document.getElementById('boss-choice') && !document.getElementById('boss-choice').classList.contains('hidden')";
try {
  await sleep(2500);
  await b.ev("document.querySelectorAll('#cards-body .card')[0]?.click()");
  await sleep(300);
  await b.ev("window.__MOYU__.grant(1e9)");
  // 1) 触发后立刻截图（弹层 + 倒计时满格）
  await b.ev("window.__MOYU__.forceBoss('choice')");
  const seen = await b.waitFor(PANEL_OPEN, 4000, 20);
  out.panelAppeared = !!seen;
  await b.shot("/tmp/r13-boss-popup.png");
  out.tell = await b.ev("document.getElementById('boss-tell')?.textContent");
  out.buttons = await b.ev("[...document.querySelectorAll('#boss-opts button')].map(x=>x.textContent)");
  out.boxRect = await b.ev("(() => { const r = document.querySelector('#boss-choice .boss-box').getBoundingClientRect(); return {top:Math.round(r.top),bottom:Math.round(r.bottom),left:Math.round(r.left),right:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)}; })()");
  out.tellFont = await b.ev("(() => { const s = getComputedStyle(document.getElementById('boss-tell')); return {size:s.fontSize,color:s.color}; })()");
  out.btnSize = await b.ev("(() => { const b = document.querySelector('#boss-opts button'); const r = b.getBoundingClientRect(); const s = getComputedStyle(b); return {w:Math.round(r.width),h:Math.round(r.height),font:s.fontSize}; })()");
  out.vw = await b.ev("innerWidth");
  // 2) 不选，量弹层从出现到自动消失的真实耗时
  const t0 = Date.now();
  const v = await b.ev("new Promise(res=>{ const root=document.getElementById('boss-choice'); const t=setInterval(()=>{ if(root.classList.contains('hidden')){ clearInterval(t); res(1);} }, 20); setTimeout(()=>{clearInterval(t);res(0);}, 8000); })");
  out.autoHideMs = Date.now() - t0;
  out.autoHidden = !!v;
  out.toastAfterTimeout = await b.ev("(() => { const el = document.getElementById('dom-toast'); return {text: el?.textContent ?? '', shown: el?.classList.contains('show') ?? false}; })()");
  await b.shot("/tmp/r13-boss-timeout.png");
  // 3) 再触发一次，选对，截结算 toast
  await b.ev("window.__MOYU__.forceBoss('choice')");
  await b.waitFor(PANEL_OPEN, 4000, 20);
  const tell = await b.ev("document.getElementById('boss-tell')?.textContent");
  const pick = tell.includes("急性子") ? "act-busy" : tell.includes("多疑") ? "switch-screen" : "keep-slacking";
  const before = await b.ev("window.__MOYU__.state.moyu");
  await b.ev(`document.querySelector('#boss-opts button[data-choice="${pick}"]').click()`);
  await sleep(250);
  const after = await b.ev("window.__MOYU__.state.moyu");
  out.correctToast = await b.ev("document.getElementById('dom-toast')?.textContent");
  out.correctDelta = Math.round(after - before);
  await b.shot("/tmp/r13-boss-correct.png");
} catch (e) {
  out.fatal = String(e?.stack ?? e).slice(0, 400);
}
writeFileSync("playtest/r13-boss-ui.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
b.close();
