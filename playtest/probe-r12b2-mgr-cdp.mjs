/**
 * R12 复验补充探针：自动重复/挂机代价/重绘/一键领取/经济可行性
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGRB2_CDP_PORT || 9373);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12b2-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } process.exit(2); }, 150_000).unref?.();
async function waitJson(path, tries = 160) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(100); } throw new Error("CDP not ready"); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 700)); return r.result.value; }
}
const out = { steps: {}, shots: [] };
async function main() {
  await waitJson("/json/version");
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send("Page.navigate", { url: URL });
  const ev = (s) => cdp.evaluate(s);
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return {ok:false}; el.click(); return {ok:true, text:(el.textContent||'').trim().slice(0,80)}; })()`);
  const shot = async (n) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = `/tmp/r12b2-${n}.png`; writeFileSync(p, Buffer.from(r.data, "base64")); out.shots.push(p); };
  const st = () => ev(`window.__MOYU__.state`);
  const idle = () => ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`(async () => { window.__M = await import('/src/engine/team.ts'); window.__U = await import('/src/engine/upgrades.ts'); return true; })()`);
  await ev(`window.__MOYU__.grant(1e12)`); await sleep(250);
  for (let r = 0; r < 12; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(55); }
  await sleep(300);
  await click("#btn-team"); await sleep(400);
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="recruit"][data-id="${id}"]`); await sleep(600); }
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { for (let i = 0; i < 6; i++) { await click(`[data-act="upgrade"][data-id="${id}"]`); await sleep(55); } }
  await sleep(600);
  out.steps.setup = { station: await ev(`window.__U.stationIdleScaled(window.__MOYU__.state)`), idle: await idle() };

  // ---------- A. 经济可行性：不同工位挂机下各同事最优任务的净收益/小时 ----------
  out.steps.viability = await ev(`(() => {
    const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const T = window.__M, U = window.__U;
    const stations = [50, 100, 300, 1000, 3000, 10000, 30000, 100000, 1000000];
    const rows = [];
    for (const station of stations) {
      const per = [];
      for (const def of T.COLLEAGUES) {
        const cur = s.team.colleagues[def.id];
        let best = null;
        for (const m of T.MISSIONS) {
          const c = JSON.parse(JSON.stringify(s));
          c.team.colleagues[def.id].missionId = m.id;
          const secs = T.missionSecondsFor(def.id, m.id);
          const est = T.dispatchReward(c, def.id, station);
          const perHour = est / (secs / 3600);
          const lostPerHour = 0.5 * (def.idlePerLevel * cur.level + station * def.sharePerLevel * cur.level) * 3600;
          const net = perHour - lostPerHour;
          if (!best || net > best.net) best = { mission: m.id, perHour: Math.round(perHour), lostPerHour: Math.round(lostPerHour), net: Math.round(net) };
        }
        per.push({ name: def.name, mission: best.mission, perHour: best.perHour, lostPerHour: best.lostPerHour, net: best.net });
      }
      rows.push({ station, per });
    }
    return rows;
  })()`);

  // ---------- B. 派遣中/完成后未领/领取后的挂机对比 ----------
  const idle0 = await idle();
  for (const [id, mid] of [["zhou", "coffee"], ["mei", "coffee"], ["qiang", "toilet"], ["li", "quick"], ["wang", "coffee"]]) {
    await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`); await sleep(250);
  }
  await sleep(700);
  const idleBusy = await idle();
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  const idleDoneUnclaimed = await idle();
  await shot("01-done-unclaimed");
  const claimAllLabel = await ev(`document.querySelector('[data-act="claim-all"]')?.textContent.trim() ?? null`);
  await click('[data-act="claim-all"]'); await sleep(900);
  const idleAfterClaim = await idle();
  out.steps.awayPenalty = {
    idleAllHome: +idle0.toFixed(1), idleFiveBusy: +idleBusy.toFixed(1), idleDoneUnclaimed: +idleDoneUnclaimed.toFixed(1), idleAfterClaim: +idleAfterClaim.toFixed(1),
    penaltyWhileDoneUnclaimed: +(idle0 - idleDoneUnclaimed).toFixed(1), claimAllLabel,
    summaryAfter: await ev(`document.querySelector('.team-summary')?.innerText.replace(/\\n+/g,' | ')`),
  };

  // ---------- C. 自动重复全开：一键领取后 5 人自动再派；重复周期只需 3 次点按 ----------
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="auto"][data-id="${id}"]`); await sleep(160); }
  await sleep(500);
  out.steps.autoAll = await ev(`(() => Object.fromEntries(Object.entries(window.__MOYU__.state.team.colleagues).map(([k,v]) => [k, v.autoRepeat])))()`);
  for (const [id, mid] of [["zhou", "coffee"], ["mei", "coffee"], ["qiang", "toilet"], ["li", "quick"], ["wang", "coffee"]]) {
    await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`); await sleep(250);
  }
  await sleep(600);
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  await shot("02-five-claimable");
  await click('[data-act="claim-all"]'); await sleep(1000);
  const afterAuto = await st();
  out.steps.autoChain = {
    missions: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k, v]) => [k, v.missionId])),
    favours: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k, v]) => [k, v.favor])),
    claimablesAfter: await ev(`window.__M.claimableCount(window.__MOYU__.state, Date.now())`),
  };
  await shot("03-auto-redispatched");

  // ---------- D. 干净重绘测试：任务进行中、不触发任何结构变化，1.6s 内 DOM 变更 ----------
  out.steps.rerenderClean = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    const node0 = document.querySelector('[data-act="auto"][data-id="mei"]');
    const card0 = document.querySelectorAll('.mate')[1];
    let muts = 0, types = {};
    const mo = new MutationObserver((list) => { for (const m of list) { muts++; types[m.type] = (types[m.type]||0)+1; } });
    mo.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    await new Promise(r => setTimeout(r, 1600));
    mo.disconnect();
    return { mutations: muts, types, autoNodeSame: node0 === document.querySelector('[data-act="auto"][data-id="mei"]'), cardNodeSame: card0 === document.querySelectorAll('.mate')[1], countdown: document.querySelector('[data-countdown]')?.textContent ?? null };
  })()`);

  // ---------- E. 连点：结束派遣 → 5 人快速依次派任务，检查点空 ----------
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  await click('[data-act="claim-all"]'); await sleep(900);
  const rapid = [];
  for (const [id, mid] of [["zhou", "coffee"], ["mei", "coffee"], ["qiang", "toilet"], ["li", "quick"], ["wang", "coffee"]]) {
    rapid.push(await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`));
    await sleep(110);
  }
  out.steps.rapidTaps = { rapid, missions: await ev(`(() => Object.fromEntries(Object.entries(window.__MOYU__.state.team.colleagues).map(([k,v]) => [k, v.missionId])))()`) };
  await shot("04-clean-panel");

  // ---------- F. 领奖快照一致性：派单后升工位 → 一键领取标签 vs 实际 ----------
  await ev(`window.__MOYU__.endMissions()`); await sleep(600);
  for (let r = 0; r < 5; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(500);
  const label = await ev(`document.querySelector('[data-act="claim-all"]')?.textContent.trim() ?? null`);
  const individualSum = await ev(`(() => [...document.querySelectorAll('[data-act="claim"]')].map(b => b.textContent.trim()))()`);
  const before = (await st()).moyu;
  await click('[data-act="claim-all"]'); await sleep(900);
  const gained = (await st()).moyu - before;
  out.steps.claimAllConsistency = { label, individual: individualSum, actualGain: Math.round(gained), flash: await ev(`document.querySelector('.team-flash')?.textContent ?? null`), toast: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`) };
  // 关闭面板截图（领奖后残留 flash 是否影响下一次打开）
  await shot("05-claim-all-consistency");

  // ---------- G. 好感 UI 文案 + 各档实际效果 ----------
  await click("#team-close"); await sleep(300);
  await click("#btn-team"); await sleep(600);
  out.steps.favorUi = await ev(`(() => [...document.querySelectorAll('.mate')].map(c => [...c.querySelectorAll('.mate-favor div')].map(x => x.textContent.trim())).slice(0,2))()`);

  // ---------- H. 自动重复跨刷新持久化 ----------
  await ev(`window.__MOYU__.saveNow()`); await sleep(300);
  await cdp.send("Page.reload", { ignoreCache: false }); await sleep(2500);
  for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 20)`)) break; } catch { /* nav */ } }
  await sleep(500);
  out.steps.reload = await ev(`(() => { const s = window.__MOYU__.state; return { autos: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, v.autoRepeat])), missions: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, v.missionId])), badge: document.querySelector('#btn-team .badge')?.textContent ?? null }; })()`);
  await click("#btn-team"); await sleep(700);
  await shot("06-after-reload");
  out.errors = cdp.errors;
  writeFileSync("/tmp/probe-r12b2-mgr.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/probe-r12b2-mgr.json");
}
try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2000); console.error("FAIL", out.error); try { writeFileSync("/tmp/probe-r12b2-mgr.json", JSON.stringify(out, null, 2)); } catch { /* ignore */ } }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
