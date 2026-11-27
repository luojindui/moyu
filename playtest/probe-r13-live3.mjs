// R13 实机探针 3：巡逻奖励卡（big_meeting patrol×2）对 hold / choice 两种变体的实际生效差异
import { spawn } from "node:child_process";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9849;
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=/tmp/chrome-r13c-${Date.now()}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: "ignore" });
async function waitJson(p, tries = 120) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); if (r.ok) return await r.json(); } catch { } await sleep(100); } throw new Error("cdp"); }
await waitJson("/json/version");
const t = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description || "").slice(0, 200)); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } };
const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); };
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: JSON.stringify(r.exceptionDetails).slice(0, 250) } : r.result.value; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
const now = Date.now();
const save = { v: 2, moyu: 1000000, totalEarned: 1000000, levels: {}, savedAt: now, createdAt: now - 2 * 86400000, surviveStreak: 0, cards: { date: new Date().toLocaleDateString("sv-SE"), offers: ["big_meeting", "coffee_day", "overtime"], chosen: "big_meeting", until: now + 86400000, nextDayGuaranteed: null } };
const src = `try{localStorage.setItem('moyu-save', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`;
const r = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
await send("Page.navigate", { url: URL }); await sleep(2200);
await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: r.identifier });
const snap = () => ev(`(()=>{const s=window.__MOYU__.state;return {moyu:s.moyu,streak:s.surviveStreak,cards:s.cards};})()`);
const out = {};
out.setup = await snap();
// hold：patrolRewardMult ×2 应生效（base 50 → 100）
await ev(`window.__MOYU__.forceBoss('hold')`); await sleep(300);
const a = await snap(); await sleep(8500); const b = await snap();
out.holdBigMeeting = { reward: +(b.moyu - a.moyu).toFixed(1), streak: b.streak };
// choice：同样 big_meeting，选对奖励是否 ×2（期望 220，实测若 110 则未接卡倍率）
await ev(`window.__MOYU__.forceBoss('choice')`); await sleep(350);
const tell = await ev(`document.getElementById('boss-tell').textContent`);
const map = { "急性子": "act-busy", "多疑": "switch-screen", "健忘": "keep-slacking" };
const correct = Object.keys(map).find((k) => tell.includes(k));
const c0 = await snap();
await ev(`document.querySelector('#boss-opts button[data-choice="${map[correct]}"]').click()`); await sleep(300);
const c1 = await snap();
out.choiceBigMeeting = { tell, delta: +(c1.moyu - c0.moyu).toFixed(1), streak: c1.streak, cardsChosen: c1.cards.chosen };
out.consoleErrors = errors;
console.log(JSON.stringify(out, null, 1));
proc.kill("SIGKILL"); process.exit(0);
