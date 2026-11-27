/**
 * r15 小探针：🎮 剩余次数角标（reload 后 bootstrap 路径）
 * Chrome 走 playtest/lib/chrome.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "../../playtest/lib/chrome.mjs";

const DIR = new URL("./", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const URL_ = "http://127.0.0.1:5173/";
const wait = (ms) => sleep(ms);
const out = {};

await runChrome(async ({ port }) => {
  const c = await connect(port);
  await c.send("Runtime.enable"); await c.send("Page.enable");
  await c.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evalJs = async (expr) => { const r = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval fail"); return r.result.value; };
  const waitApp = async () => { for (let i = 0; i < 150; i++) { if (await evalJs(`!!window.__MOYU__`).catch(() => false)) { await wait(400); return; } await wait(100); } throw new Error("no app"); };
  const badge = () => evalJs(`(()=>{const b=document.querySelector('#btn-arcade .arcade-badge');return {badge:b?b.textContent:null,aria:document.getElementById('btn-arcade')?.getAttribute('aria-label')}})()`);
  const waitBadge = async (ms) => { for (let i = 0; i < ms / 200; i++) { const b = await badge(); if (b.badge || b.aria !== "摸鱼站小游戏") return b; await wait(200); } return await badge(); };
  const closeModals = async () => { await evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden'))document.getElementById('welcome-ok')?.click();const cd=document.getElementById('cards');if(cd&&!cd.classList.contains('hidden'))document.getElementById('cards-skip')?.click();return true})()`).catch(() => {}); await wait(200); };
  await c.send("Page.navigate", { url: URL_ });
  await waitApp(); await closeModals();
  const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
  const reloadWith = async (played) => {
    await evalJs(`window.__MOYU__.saveNow()`).catch(() => {});
    const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
    blob.arcade = { date: today, played, best: blob.arcade?.best || { coffee: 516 } };
    await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))}); Storage.prototype.setItem=function(){}; return true})()`);
    await c.send("Page.reload");
    await waitApp(); await wait(600); await closeModals();
    return await waitBadge(6000);
  };
  out.played0 = await reloadWith(0);
  out.played2 = await reloadWith(2);
  out.played3 = await reloadWith(3);
  // 跨日：页面不刷新时 ensureArcade 重置 played，但角标是否会恢复？(先 played=3 日; 再改成昨天 date 重载 → boot 会重置)
  const blob = await evalJs(`JSON.parse(localStorage.getItem('moyu-save')||'null')`);
  blob.arcade = { date: "2026-11-26", played: 3, best: blob.arcade?.best || {} };
  await evalJs(`(()=>{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))}); Storage.prototype.setItem=function(){}; return true})()`);
  await c.send("Page.reload"); await waitApp(); await wait(600); await closeModals();
  out.dayResetBoot = await waitBadge(6000);
  out.dayResetState = await evalJs(`window.__MOYU__.state.arcade`);
  saveEvidence(out);
  c.close();
}, { timeoutMs: 90_000 });
function saveEvidence(o) { writeFileSync(DIR + "evidence2d.json", JSON.stringify(o, null, 2)); }
console.log("DONE", JSON.stringify(out));