// r16 补充：线上生产包新玩家「自然挂机戳」2.5 分钟，看回合制老板的真实暴露频率与专注要求
// 运行：node playtest/r16-frag-online-boss.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { runChrome, connect, sleep } from "./lib/chrome.mjs";

const BASE = "https://luojindui.github.io/moyu/";
const OUT = "playtest/r16-shots";
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const R = { startedAt: new Date().toISOString(), url: BASE, events: [], actions: [] };
const now = () => Date.now();

await runChrome(
  async ({ port }) => {
    const c = await connect(port);
    const rawSend = c.send.bind(c);
    c.send = (m, p) => Promise.race([rawSend(m, p), new Promise((_, rej) => setTimeout(() => rej(new Error("CDP timeout " + m)), 12000))]);
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    const J = (v) => JSON.stringify(v);
    const ev = async (expr) => { try { return await c.ev(expr); } catch (e) { return { __err: String(e).slice(0, 200) }; } };
    const shot = async (n) => { try { const r = await c.send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${OUT}/${n}.png`, Buffer.from(r.data, "base64")); log("shot", n); } catch { /* ignore */ } };
    const waitFor = async (expr, ms = 15000, step = 120) => { const st = now(); while (now() - st < ms) { if (await ev(expr)) return true; await sleep(step); } return false; };
    const vis = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return false;const b=e.getBoundingClientRect();return !e.classList.contains('hidden')&&b.width>0})()`);
    const rect = (sel) => ev(`(()=>{const e=document.querySelector(${J(sel)});if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    const tap = async (x, y) => {
      await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, radiusX: 1, radiusY: 1 }] });
      await sleep(35);
      await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    const tapSel = async (sel) => { const r = await rect(sel); if (!r) return false; await tap(r.x + r.w / 2, r.y + r.h / 2); return true; };
    const readSave = () => ev(`(()=>{try{const b=JSON.parse(localStorage.getItem('moyu-save')||'null');return b?{moyu:Math.round(b.moyu),surviveStreak:b.surviveStreak,patrolSurvives:b.patrolSurvives,totalClicks:b.totalClicks,totalEarned:Math.round(b.totalEarned||0),daily:b.daily?.goals}:null}catch(e){return {err:String(e)}}})()`);
    const bossInfo = () => ev(`(()=>{const e=document.getElementById('boss-choice');if(!e||e.classList.contains('hidden'))return null;return {text:(e.innerText||'').replace(/\\n+/g,' | ').slice(0,300),timerText:document.getElementById('boss-timer')?.textContent,barW:document.getElementById('boss-timer')?.querySelector('i')?.style.width,banner:document.querySelector('.boss-banner, #boss-banner')?.textContent||null};})()`);
    const toast = () => ev(`(()=>{const e=document.getElementById('dom-toast');return e&&e.classList.contains('show')?(e.textContent||'').slice(0,120):null})()`);
    const state = { boss: false, toast: "", banner: "", journalClaim: false };
    const poll = async (t) => {
      const [b, tt, ban, jc] = await Promise.all([
        bossInfo(),
        toast(),
        ev(`(()=>{const els=[...document.querySelectorAll('div,span')].filter(e=>/回合制老板来了|老板来了|巡逻/.test(e.textContent||'')&&e.getBoundingClientRect().width>0);return els.length?els[0].textContent.slice(0,120):null})()`),
        ev(`(()=>{const b=document.getElementById('journal-claim');return b&&!b.disabled?b.textContent:null})()`),
      ]);
      if (b && !state.boss) R.events.push({ t, type: "boss-show", text: b.text, timerText: b.timerText, banner: ban });
      if (!b && state.boss) R.events.push({ t, type: "boss-hide" });
      if (tt && tt !== state.toast) R.events.push({ t, type: "toast", text: tt });
      if (jc && jc !== state.journalClaim) R.events.push({ t, type: "journal-claimable", text: jc });
      state.boss = !!b; state.toast = tt || ""; state.journalClaim = jc || null;
      return b;
    };

    await c.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    const navStart = now();
    await c.send("Page.navigate", { url: BASE });
    await waitFor("document.readyState==='complete' && !!document.getElementById('btn-arcade')", 30000);
    await sleep(600);
    R.readyMs = now() - navStart;
    const t0o = now();
    const cv = await rect("#stage");
    const clickAt = async () => tap(cv.x + cv.w * (0.35 + 0.3 * Math.random()), cv.y + cv.h * (0.4 + 0.25 * Math.random()));
    let tapCount = 0;
    let boss1 = null;
    // 阶段 1：自然戳到第一次巡逻（最多 45 秒）
    while (now() - t0o < 45000) {
      const b = await poll(+((now() - t0o) / 1000).toFixed(1));
      if (b) { boss1 = b; break; }
      await clickAt(); tapCount++;
      await sleep(360);
    }
    R.actions.push({ t: +((now() - t0o) / 1000).toFixed(1), label: "自然戳到第一次巡逻", taps: tapCount });
    if (boss1) {
      await shot("B-01-boss-choice");
      const shownAt = now();
      // 真实学生读线索：1.4 秒
      await sleep(1400);
      const bar = await ev(`document.getElementById('boss-timer')?.querySelector('i')?.style.width`);
      const choice = /脚步声又快又重/.test(boss1.text) ? "act-busy" : /盯着别人的屏幕/.test(boss1.text) ? "switch-screen" : /边走边看手机/.test(boss1.text) ? "keep-slacking" : "act-busy";
      const before = await readSave();
      await tapSel(`button[data-choice="${choice}"]`);
      await sleep(1000);
      const after = await readSave();
      R.actions.push({ label: "读线索并作答", choice, barAtDecision: bar, decisionMs: now() - shownAt, moyuDelta: (after?.moyu ?? 0) - (before?.moyu ?? 0), streak: after?.surviveStreak });
      await shot("B-02-boss-result");
      // 等第二次巡逻（90-150s）；期间自然戳
      const waitStart = now();
      let boss2 = null;
      while (now() - waitStart < 150000) {
        const b = await poll(+((now() - t0o) / 1000).toFixed(1));
        if (b) { boss2 = b; break; }
        await clickAt(); tapCount++;
        await sleep(500);
      }
      R.actions.push({ t: +((now() - t0o) / 1000).toFixed(1), label: "等第二次巡逻", waitedSec: +((now() - waitStart) / 1000).toFixed(1), gotSecond: !!boss2, taps: tapCount });
      if (boss2) {
        await shot("B-03-boss2");
        // 模拟"被叫走没法答"：不点，等窗口过去
        const start = now();
        while (now() - start < 9000) { if (!(await vis("#boss-choice"))) break; await sleep(300); }
        R.actions.push({ t: +((now() - t0o) / 1000).toFixed(1), label: "第二次巡逻故意不答（碎片被打断）", bossText: boss2.text, hideAfterMs: now() - start, save: await readSave() });
        await sleep(800);
      }
      await shot("B-04-end");
    }
    R.finalSave = await readSave();
    R.tapCount = tapCount;
    R.totalSec = +((now() - t0o) / 1000).toFixed(1);
    R.errors = c.errors.slice(0, 5);
    writeFileSync("playtest/r16-frag-online-boss.json", JSON.stringify(R, null, 2));
    log("evidence written");
  },
  { timeoutMs: 300_000 },
);
log("DONE");