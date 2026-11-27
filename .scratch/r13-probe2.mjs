/**
 * r13 探针 2：每日卡可否关闭/选后是否可见 + 回合制老板窗口内的面板外点击 + 超时反馈
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DIR = new URL("./r13/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--user-data-dir=/tmp/chrome-r13b-" + Date.now(), "--remote-debugging-port=9557", "about:blank"], { stdio: "ignore" });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:9557/json/version"); break; } catch { await sleep(100); } }
const target = await fetch("http://127.0.0.1:9557/json/new?about:blank", { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const evalJs = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails)); return r.result.value; };
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); writeFileSync(DIR + name + ".png", Buffer.from(s.data, "base64")); };
const closeWelcome = () => evalJs(`(()=>{const w=document.getElementById('welcome');if(w&&!w.classList.contains('hidden')){document.getElementById('welcome-ok').click();return true}return false})()`);
const visible = () => evalJs(`(()=>({cards:!document.getElementById('cards').classList.contains('hidden'),boss:!document.getElementById('boss-choice').classList.contains('hidden'),toast:{text:(document.getElementById('dom-toast')||{}).textContent,cls:(document.getElementById('dom-toast')||{className:''}).className},sr:(document.getElementById('sr-live')||{}).textContent}))()`);
const rawSave = () => evalJs(`(()=>{try{return JSON.parse(localStorage.getItem('moyu-save'))}catch(e){return null}})()`);
const patchReload = async (blob) => { await evalJs(`(()=>{const orig=Storage.prototype.setItem;localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(blob))});Storage.prototype.setItem=function(){};return true})()`); await send("Page.reload"); await sleep(2200); await closeWelcome(); await sleep(250); };

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(3000); await closeWelcome(); await sleep(200);

// A. 不可跳过验证：点遮罩 → 下一帧是否重新弹出
const today = await evalJs(`new Date().toLocaleDateString('sv-SE')`);
let save = await rawSave();
save.moyu = 1e9; save.totalEarned = 1e9; save.lifetimeEarned = 1e9;
save.cards = { date: today, offers: ["hr_talk", "coffee_day", "overtime"], chosen: null, until: 0, nextDayGuaranteed: null };
await patchReload(save);
out.panelAfterReload = await visible();
await evalJs(`(()=>{const r=document.getElementById('cards');r.dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`);
await sleep(250);
out.afterBackdropClick = await visible();
await shot("10-after-backdrop-click");
// 再点一次遮罩 + 等 1s 确认
await evalJs(`(()=>{document.getElementById('cards').dispatchEvent(new MouseEvent('click',{bubbles:true}));return true})()`);
await sleep(1000);
out.afterBackdropClickAgain = await visible();

// B. 选卡后：今日卡是否有常驻展示
await evalJs(`document.querySelector('#cards .card[data-id="hr_talk"]').click()`);
await sleep(300);
const bodyText = await evalJs(`document.body.innerText`);
out.cardVisibleAfterChoose = { hrInBodyText: bodyText.includes("HR 约谈"), flavorInBody: bodyText.includes("别紧张"), toast: (await visible()).toast };
await shot("11-after-choose-no-active-card");

// C. 回合制老板：先把巡逻数刷到 >3（新手保护结束）
await evalJs(`window.__MOYU__.grant(1e9)`);
for (let i = 0; i < 4; i++) {
  await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(200);
  const open = await evalJs(`(()=>{const r=document.getElementById('boss-choice');return r&&!r.classList.contains('hidden')?document.getElementById('boss-tell').textContent:null})()`);
  if (!open) { await sleep(400); continue; }
  const correct = open.includes("走路带风") ? "act-busy" : open.includes("盯着别人屏幕") ? "switch-screen" : "keep-slacking";
  await evalJs(`document.querySelector('#boss-opts button[data-choice="${correct}"]').click()`);
  await sleep(900); // 等巡逻结束结算
}
// 记录点击前余额，然后在 choice 窗口内点画布（面板外）
await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(1100);
const beforeTap = await evalJs(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,patrol:s.patrolSurvives,open:!document.getElementById('boss-choice').classList.contains('hidden'),tell:document.getElementById('boss-tell').textContent}})()`);
await evalJs(`(()=>{const c=document.getElementById('stage');c.dispatchEvent(new PointerEvent('pointerdown',{clientX:195,clientY:300,bubbles:true,pointerId:1,isPrimary:true,pointerType:'touch'}));return true})()`);
await sleep(250);
const afterTap = await evalJs(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,delta:s.moyu-${beforeTap.moyu},open:!document.getElementById('boss-choice').classList.contains('hidden'),toast:(document.getElementById('dom-toast')||{}).textContent}})()`);
const fx = await evalJs(`window.__MOYU__.fxTexts()`);
out.strayTapInChoice = { beforeTap, afterTap, fx };
await shot("12-stray-tap-in-choice");
// 选对结束
try { await evalJs(`document.querySelector('#boss-opts button[data-choice="act-busy"]').click()`); } catch {}
await sleep(600);

// D. 超时无反馈（先等旧 toast 消失）
await sleep(2200);
out.beforeTimeoutToast = await visible();
await evalJs(`window.__MOYU__.forceBoss('choice')`); await sleep(300);
out.timeoutBefore = await visible();
await sleep(4600);
out.timeoutAfter = await visible();
await shot("13-timeout");

writeFileSync(DIR + "evidence2.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
proc.kill("SIGKILL"); process.exit(0);
