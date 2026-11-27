/**
 * r15 线上小探针：跨日 boot 角标 / 有剩余次数时 reload 角标
 * Chrome 走 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "https://luojindui.github.io/moyu/";
const wait = (ms) => sleep(ms);
const out = {};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Runtime.enable"); await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const ev = async (expr) => { const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval"); return r.result.value; };
  const waitBoot = async () => { for (let i = 0; i < 150; i++) { if (await ev(`!!(document.getElementById('btn-arcade')&&document.getElementById('stage'))`).catch(() => false)) { await wait(1500); return; } await wait(200); } throw new Error("boot"); };
  const closeModals = async () => { for (let i = 0; i < 12; i++) { const d = await ev(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok')?.click();return'w';}const cd=document.getElementById('cards');if(cd&&!cd.classList.contains('hidden')){document.getElementById('cards-skip')?.click();return'c';}return'n'})()`).catch(() => "e"); if (d === "n") return; await wait(250); } };
  const badge = () => ev(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');return {badge:b?b.textContent:null,aria:document.getElementById('btn-arcade')?.getAttribute('aria-label')}})()`);
  const state = () => ev(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save')||'null')?.arcade||null}catch(e){return null}})()`);
  const patch = async (fn) => {
    const blob = await ev(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
    fn(blob);
    await ev(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))}); Storage.prototype.setItem=function(){}; return true})()`);
    await c.send("Page.reload"); await waitBoot(); await closeModals(); await wait(300);
  };
  await c.send("Page.navigate", { url: URL_ });
  await waitBoot(); await closeModals();
  // 先确保有存档（点一下 canvas 触发保存，或等待自动存档）
  await ev(`document.getElementById('stage').dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:640,clientY:450}))`);
  await wait(2500);
  out.hasSave = !!(await state() || await ev(`localStorage.getItem('moyu-save')!==null`));
  // A. 有剩余次数（played=1）reload
  await patch((b) => { b.arcade = { date: new Date().toLocaleDateString("sv-SE"), played: 1, best: { coffee: 496 } }; });
  out.played1 = await badge();
  // B. 跨日：昨天 played=3，今天 boot 应重置为 0 并显示 3
  await patch((b) => { b.arcade = { date: "2026-11-26", played: 3, best: { coffee: 496, findboss: 6250 } }; });
  out.crossDay = { badge: await badge(), state: await state() };
  // C. 0/3 reload：aria 是否播报已玩完
  await patch((b) => { b.arcade = { date: new Date().toLocaleDateString("sv-SE"), played: 3, best: b.arcade?.best || {} }; });
  out.played3 = await badge();
  writeFileSync(DIR + "online-badge-evidence.json", JSON.stringify(out, null, 2));
  c.close();
}, { timeoutMs: 120_000 });
console.log("DONE", JSON.stringify(out));