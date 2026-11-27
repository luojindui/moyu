// R13 实机探针 2：用 document-start 注入存档（绕过旧页卸载覆盖），验证卡效果真实接线
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9848;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13b-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(p, tries = 120) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch { } await sleep(100); } throw new Error("cdp not ready"); }
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || "").slice(0, 200)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: JSON.stringify(r.exceptionDetails).slice(0, 250) } : r.result.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });

const today = () => new Date().toLocaleDateString("sv-SE");
const mkSave = (chosen, extraCards = {}, extra = {}) => {
  const now = Date.now();
  return {
    v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000,
    cards: { date: today(), offers: ["coffee_day", "click_frenzy", "overtime"], chosen, until: chosen ? now + 86400000 : 0, nextDayGuaranteed: null, ...extraCards },
    ...extra,
  };
};
const out = {};
async function loadWith(save, wait = 2100) {
  const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`;
  const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  await send("Page.navigate", { url: URL });
  await sleep(wait);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
}
const snap = () => ev(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,totalEarned:s.totalEarned,totalClicks:s.totalClicks,cards:s.cards,streak:s.surviveStreak};})()`);
const measureRate = async (ms = 1600) => { const a = (await snap()).moyu; await sleep(ms); const b = (await snap()).moyu; return +(b - a).toFixed(3); };

// 1) 无卡 baseline
await loadWith(mkSave(null));
const noCardRate = await measureRate();
const noCardSnap = await snap();
out.noCard = { rate1600ms: noCardRate, chosen: noCardSnap.cards.chosen, modalVisible: await ev(`!document.getElementById('cards').classList.contains('hidden')`) };

// 2) coffee_day（挂机 +15%）
await loadWith(mkSave("coffee_day"));
const idleCardRate = await measureRate();
out.coffee_day = {
  rate1600ms: idleCardRate,
  ratio: +(idleCardRate / noCardRate).toFixed(4),
  chosen: (await snap()).cards.chosen,
  modalVisible: await ev(`!document.getElementById('cards').classList.contains('hidden')`),
};

// 3) click_frenzy（点击 +80%）：合成 pointerdown 一次，测量单次点击收入
const clickOnce = async () => ev(`(()=>{const cv=document.getElementById('stage');const r=cv.getBoundingClientRect();const ev=new PointerEvent('pointerdown',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,bubbles:true});const b=window.__MOYU__.state;cv.dispatchEvent(ev);return {beforeMoyu:b.moyu};})()`);
await loadWith(mkSave(null));
await sleep(1500);
const c0 = await snap();
await clickOnce(); await sleep(120);
const c1 = await snap();
out.click_noCard = { clicks: c1.totalClicks - c0.totalClicks, income: +(c1.moyu - c0.moyu).toFixed(2) };
await loadWith(mkSave("click_frenzy"));
await sleep(1500);
const c2 = await snap();
await clickOnce(); await sleep(120);
const c3 = await snap();
out.click_frenzy = { clicks: c3.totalClicks - c2.totalClicks, income: +(c3.moyu - c2.moyu).toFixed(2), ratio: +((c3.moyu - c2.moyu) / Math.max(0.01, c1.moyu - c0.moyu)).toFixed(3), chosen: c3.cards.chosen };

// 4) 已选卡时 UI 是否展示当前生效卡（activeLabel 未被调用 → 找不到卡名）
const bodyText = await ev(`document.body.innerText`);
out.cardNameShownInUI = { coffeeDayNameInBodyText: bodyText.includes("咖啡管够"), chosen: c3.cards.chosen };

// 5) dev hook forceBoss 返回值 / 性格是否被固定
await loadWith(mkSave("coffee_day"));
const freshRet = await ev(`window.__MOYU__.forceBoss('choice')`);
await sleep(350);
const tell = await ev(`document.getElementById('boss-tell').textContent`);
out.forceBoss = { returnValueOnFreshState: freshRet, panelVisible: await ev(`!document.getElementById('boss-choice').classList.contains('hidden')`), tell, tellIsSuspicious: tell.includes("多疑") };
// 关闭面板（点任意项）
await ev(`document.querySelector('#boss-opts button').click()`); await sleep(200);

// 6) 巡逻奖励卡：big_meeting（patrol ×2）对 hold 生效；对 choice 是否生效
await loadWith(mkSave("big_meeting"));
const idleRate = (await snap()); // no direct rate; use boss reward comparison
await ev(`window.__MOYU__.forceBoss('hold')`); await sleep(300);
const preHold = await snap();
await sleep(8500);
const postHold = await snap();
out.holdWithBigMeeting = { reward: +(postHold.moyu - preHold.moyu).toFixed(1), streak: postHold.streak };

const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync("/tmp/r13-live2.png", Buffer.from(shot.data, "base64"));
out.consoleErrors = errors;
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL");
process.exit(0);
