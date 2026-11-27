/**
 * R12 复验探针 v3：针对当前 HEAD（含 a28d856 的 3min 任务/完成提醒/签到天赋/flash CSS/favor20-60）
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGRB3_CDP_PORT || 9375);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12b3-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } process.exit(2); }, 240_000).unref?.();
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
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.navigate", { url: URL });
  const ev = (s) => cdp.evaluate(s);
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return {ok:false}; el.click(); return {ok:true, text:(el.textContent||'').trim().slice(0,90)}; })()`);
  const shot = async (n) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = `/tmp/r12b3-${n}.png`; writeFileSync(p, Buffer.from(r.data, "base64")); out.shots.push(p); };
  const st = () => ev(`window.__MOYU__.state`);
  const idle = () => ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`(async () => { window.__M = await import('/src/engine/team.ts'); window.__U = await import('/src/engine/upgrades.ts'); window.__P = await import('/src/engine/progression.ts'); window.__E = await import('/src/engine/events.ts'); return true; })()`);
  out.meta = { hooks: await ev(`Object.keys(window.__MOYU__)`), version: await ev(`document.querySelector('meta[name="version"]')?.content ?? null`) };
  out.meta.talentsAtBoot = await ev(`window.__MOYU__.state.talents`);
  await ev(`window.__MOYU__.grant(1e12)`); await sleep(250);
  for (let r = 0; r < 12; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(55); }
  await sleep(300);
  await click("#btn-team"); await sleep(500);
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="recruit"][data-id="${id}"]`); await sleep(600); }
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { for (let i = 0; i < 6; i++) { await click(`[data-act="upgrade"][data-id="${id}"]`); await sleep(55); } }
  await sleep(600);
  out.steps.maxed = await ev(`(() => ({
    summary: document.querySelector('.team-summary')?.innerText.replace(/\\n+/g,' | '),
    maxLabel: document.querySelector('[data-act="upgrade"]')?.textContent.trim(),
    missions: [...document.querySelectorAll('.mate')[0].querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / ')),
    station: window.__U.stationIdleScaled(window.__MOYU__.state), idle: window.__U.effectOf(window.__MOYU__.state).idleRate,
  }))()`);
  await shot("01-max");

  // 任务按钮数字 & 矩阵（含净收益）
  out.steps.matrix = await ev(`(() => {
    const s = JSON.parse(JSON.stringify(window.__MOYU__.state)); const T = window.__M, U = window.__U;
    const station = U.stationIdleScaled(s); const rows = [];
    for (const def of T.COLLEAGUES) {
      const cur = s.team.colleagues[def.id]; const per = [];
      for (const m of T.MISSIONS) {
        const c = JSON.parse(JSON.stringify(s)); c.team.colleagues[def.id].missionId = m.id;
        const secs = T.missionSecondsFor(def.id, m.id);
        const est = T.dispatchReward(c, def.id, station);
        const perHour = est / (secs / 3600);
        const lostPerHour = 0.5 * (def.idlePerLevel * cur.level + station * def.sharePerLevel * cur.level) * 3600;
        per.push({ mission: m.id, mins: Math.round(secs/60), est, perHour: Math.round(perHour), net: Math.round(perHour - lostPerHour), match: def.skill === m.type });
      }
      const best = per.reduce((a,b)=> b.net > a.net ? b : a, per[0]);
      rows.push({ name: def.name, trait: def.trait, per, bestMission: best.mission, bestNet: best.net, bestHour: best.perHour });
    }
    return { station, rows };
  })()`);

  // 领奖反馈（单领）：flash CSS / 面板是否被挤
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(600);
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  out.steps.completionToast = await ev(`(() => { const dt = document.querySelector('#dom-toast'); return { text: dt?.textContent ?? null, show: dt?.classList.contains('show') ?? false, fx: window.__MOYU__.fxTexts ? window.__MOYU__.fxTexts() : null }; })()`);
  const panelBefore = await ev(`(() => { const r = document.querySelector('.team-panel').getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; })()`);
  await click('[data-act="claim"][data-id="zhou"]'); await sleep(120);
  out.steps.claimFlash = await ev(`(() => {
    const f = document.querySelector('.team-flash'); const cs = f ? getComputedStyle(f) : null; const r = f ? f.getBoundingClientRect() : null;
    const p = document.querySelector('.team-panel').getBoundingClientRect();
    return { flash: f ? f.textContent : null, flashRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      position: cs?.position, z: cs?.zIndex, bg: cs?.backgroundColor,
      panelAfter: { x: Math.round(p.x), w: Math.round(p.width) }, toast: document.querySelector('#dom-toast')?.textContent ?? null };
  })()`);
  out.steps.claimFlash.panelBefore = panelBefore;
  await shot("02-claim-flash");

  // 自动重复 + 一键领取 + 完成未领的挂机惩罚
  const idleHome = await idle();
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="auto"][data-id="${id}"]`); await sleep(150); }
  await sleep(400);
  for (const [id, mid] of [["zhou","coffee"],["mei","coffee"],["qiang","toilet"],["li","stroll"],["wang","coffee"]]) { await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`); await sleep(220); }
  await sleep(600);
  const idleBusy = await idle();
  await ev(`window.__MOYU__.endMissions()`); await sleep(800);
  const idleDoneUnclaimed = await idle();
  const claimAllLabel = await ev(`document.querySelector('[data-act="claim-all"]')?.textContent.trim() ?? null`);
  await shot("03-all-claimable");
  await click('[data-act="claim-all"]'); await sleep(900);
  const idleAfterClaim = await idle();
  const afterAuto = await st();
  out.steps.autoLoop = {
    idleHome: +idleHome.toFixed(1), idleBusy: +idleBusy.toFixed(1), idleDoneUnclaimed: +idleDoneUnclaimed.toFixed(1), idleAfterClaim: +idleAfterClaim.toFixed(1),
    penaltyWhileDoneUnclaimed: +(idleHome - idleDoneUnclaimed).toFixed(1),
    claimAllLabel, flash: await ev(`document.querySelector('.team-flash')?.textContent ?? null`),
    redispatched: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k,v]) => [k, v.missionId])),
    favors: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k,v]) => [k, v.favor])),
  };
  await shot("04-auto-redispatch");

  // 离线不领：关闭面板等 3s，是否自动领取/循环
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  const beforeOffline = await st();
  await click("#team-close"); await sleep(3000);
  const afterOffline = await st();
  out.steps.offlineNoClaim = {
    missionsStillSet: Object.fromEntries(Object.entries(afterOffline.team.colleagues).map(([k,v]) => [k, v.missionId])),
    moyuDelta: Math.round(afterOffline.moyu - beforeOffline.moyu),
    badge: await ev(`document.querySelector('#btn-team .badge')?.textContent ?? null`),
    toast: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`),
    idleAtDoneUnclaimed: +(await idle()).toFixed(1),
  };

  // 干净重绘：不做操作 1.6s
  await click("#btn-team"); await sleep(500);
  out.steps.rerenderClean = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    const node0 = document.querySelector('[data-act="auto"]');
    const card0 = document.querySelectorAll('.mate')[0];
    let muts = 0, types = {};
    const mo = new MutationObserver((list) => { for (const m of list) { muts++; types[m.type] = (types[m.type]||0)+1; } });
    mo.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    await new Promise(r => setTimeout(r, 1600));
    mo.disconnect();
    return { mutations: muts, types, nodeReplaced: node0 !== document.querySelector('[data-act="auto"]'), cardReplaced: card0 !== document.querySelectorAll('.mate')[0] };
  })()`);

  // 快照一致性：派单后升工位再一键领
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  const labelBefore = await ev(`document.querySelector('[data-act="claim-all"]')?.textContent.trim() ?? null`);
  for (let r = 0; r < 5; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(500);
  const labelAfter = await ev(`document.querySelector('[data-act="claim-all"]')?.textContent.trim() ?? null`);
  const beforeC = (await st()).moyu;
  await click('[data-act="claim-all"]'); await sleep(900);
  out.steps.snapshotConsistency = { labelBeforeStationUp: labelBefore, labelAfter: labelAfter, actualGain: Math.round((await st()).moyu - beforeC), flash: await ev(`document.querySelector('.team-flash')?.textContent ?? null`) };

  // 好感里程碑（当前版本）
  out.steps.favorTiers = await ev(`(() => {
    const base = JSON.parse(JSON.stringify(window.__MOYU__.state)); const T = window.__M, U = window.__U, P = window.__P;
    const rows = [];
    for (const f of [0, 20, 40, 60, 80, 100]) {
      const c = JSON.parse(JSON.stringify(base)); c.team.colleagues.zhou.favor = f;
      const c2 = JSON.parse(JSON.stringify(c)); c2.team.colleagues.zhou.missionId = 'chat';
      const now = Date.now(), created = now - 3*86400*1000;
      rows.push({ favor: f, tier: T.favorTier(c), dispatchChat: T.dispatchReward(c2, 'zhou', U.stationIdleScaled(c2)), dispatchMult: T.favorBonuses(c).dispatchMult, memeMult: T.favorBonuses(c).memeMult, idle: +U.effectOf(c).idleRate.toFixed(1), offline: +P.offlineEfficiency(c, created, now).toFixed(3) });
    }
    return rows;
  })()`);

  // 新号早期：派遣是否仍净亏
  await ev(`window.__MOYU__.reset()`); await sleep(400);
  await ev(`window.__MOYU__.grant(60000)`); await sleep(250);
  for (let r = 0; r < 3; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(300);
  if (!(await ev(`!document.querySelector('#team').classList.contains('hidden')`))) { await click("#btn-team"); await sleep(400); }
  await click('[data-act="recruit"][data-id="zhou"]'); await sleep(800);
  const earlyIdle = await idle();
  const earlyButtons = await ev(`(() => [...document.querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / ')))()`);
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(700);
  const earlyAfter = await idle();
  out.steps.early = { idleBefore: +earlyIdle.toFixed(2), idleAfter: +earlyAfter.toFixed(2), lostPerHour: Math.round((earlyIdle - earlyAfter) * 3600), buttons: earlyButtons, station: await ev(`window.__U.stationIdleScaled(window.__MOYU__.state)`) };
  await shot("05-early");

  out.meta.errors = cdp.errors;
  writeFileSync("/tmp/probe-r12b3-mgr.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/probe-r12b3-mgr.json");
}
try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2000); console.error("FAIL", out.error); try { writeFileSync("/tmp/probe-r12b3-mgr.json", JSON.stringify(out, null, 2)); } catch { /* ignore */ } }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
