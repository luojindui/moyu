/**
 * R9 探针 5：新手目标条与卡片数字是否一致（「再戳10下解锁」vs 卡片「再戳15下」）+ 点击反馈延迟
 * 只读，不改 src/
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9585;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r9e-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(url, tries = 150) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url); if (r.ok) return r.json(); } catch {} await sleep(100); } throw new Error("CDP not ready"); }
await waitJson(`http://127.0.0.1:${PORT}/json/version`);
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 300)); return r.result.value; };
const SCRIPT = `
(() => {
  const P = window.__r9c = { ptr: [], float: [] };
  document.addEventListener('pointerdown', (e) => { if (e.target.id === 'stage') P.ptr.push(Math.round(performance.now())); }, true);
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t) {
    try { const s = String(t); if (/^[+]/.test(s) || /连击/.test(s)) P.float.push({ ts: Math.round(performance.now()), text: s }); } catch (e) {}
    return orig.apply(this, arguments);
  };
})();`;
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.addScriptToEvaluateOnNewDocument", { source: SCRIPT });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" });
await sleep(2600);
const tap = async () => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 430, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
  await sleep(40);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};
const snap = async (n) => {
  const st = JSON.parse(await ev("JSON.stringify(__MOYU__.state)"));
  return {
    n: n + 1,
    clicks: st.totalClicks,
    moyu: Math.round(st.moyu * 10) / 10,
    quest: await ev("document.getElementById('quest-text').textContent"),
    questBar: await ev("document.getElementById('quest-bar').style.width"),
    coffeeDisabled: await ev("document.querySelector('[data-upgrade=coffee]').disabled"),
    coffeeRemain: await ev("document.querySelector('[data-upgrade=coffee] .shop-remain').textContent"),
    coffeeCost: await ev("document.querySelector('[data-upgrade=coffee] .shop-cost').textContent"),
    hud: await ev("document.querySelector('.hud-sub').innerText.replace(/\\n/g,' | ')"),
  };
};
const out = { series: [] };
out.series.push(await snap(0));
for (let i = 1; i <= 13; i++) {
  await tap();
  await sleep(1400);
  out.series.push(await snap(i));
}
out.feedbackLatencyMs = await ev(`JSON.stringify((()=>{
  const P=__r9c; const pairs=[];
  for(const p of P.ptr){ const f=P.float.find(x=>x.ts>=p && x.ts-p<500); if(f) pairs.push(f.ts-p); }
  return {pairs, avg: pairs.length?Math.round(pairs.reduce((a,b)=>a+b,0)/pairs.length*10)/10:null};
})())`).then(JSON.parse);
out.floatTexts = JSON.parse(await ev("JSON.stringify(__r9c.float.slice(0,10))"));
out.comboShownForSlow = out.floatTexts.some((f) => /连击/.test(f.text));
writeFileSync("playtest/r9-senior-evidence5.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ series: out.series, latency: out.feedbackLatencyMs, float: out.floatTexts, comboShownForSlow: out.comboShownForSlow }, null, 2));
ws.close(); proc.kill(); process.exit(0);
