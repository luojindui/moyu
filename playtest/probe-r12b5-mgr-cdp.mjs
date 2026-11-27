/**
 * R12 第四次（最终）验证探针
 * 重点：① 净/h 显示 vs 真实净  ② 跨同事排序  ③ 面板重绘  ④ Lv1/Lv5 净收益
 * 以及自动领取反馈、favor 文案、-15% 文案
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGRB5_CDP_PORT || 9397);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12b5-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } process.exit(2); }, 240_000).unref?.();
async function waitJson(path, tries = 160) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(100); } throw new Error("CDP not ready"); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.logs = []; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); else if (m.method === "Runtime.consoleAPICalled") this.logs.push(`[${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ")}`); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value; }
}
const out = { steps: {}, shots: [] };
const PARSER = `(t) => { const m = t.match(/净\\s*([+-]?)([\\d.]+)(万|亿)?/); if (!m) return null; const mul = m[3] === '亿' ? 1e8 : m[3] === '万' ? 1e4 : 1; return (m[1] === '-' ? -1 : 1) * parseFloat(m[2]) * mul; }`;
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
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return {ok:false}; el.click(); return {ok:true}; })()`);
  const shot = async (n) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = `/tmp/r12b5-${n}.png`; writeFileSync(p, Buffer.from(r.data, "base64")); out.shots.push(p); };
  const st = () => ev(`window.__MOYU__.state`);
  const idle = () => ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`(async () => { window.__M = await import('/src/engine/team.ts'); window.__U = await import('/src/engine/upgrades.ts');  return true; })()`);
  out.meta = { version: await ev(`document.querySelector('meta[name="version"]')?.content ?? null`) };
  const parseNet = `const parseNet = ${PARSER};`;

  // ===== ④ 引擎层：Lv1 vs Lv5 净收益/h =====
  out.steps.levels = await ev(`(() => {
    const T = window.__M, U = window.__U; const station = 15035.252; const ids = ['zhou','mei','qiang','li','wang'];
    const missions = T.MISSIONS.map(m => m.id);
    const s0 = window.__MOYU__.state;
    const mk = (lv) => { const s = JSON.parse(JSON.stringify(s0)); for (const id of ids) s.team.colleagues[id] = { level: lv, missionId: null, startedAt:0, endsAt:0, favor:0, autoRepeat:false, rewardSnapshot:0 }; return s; };
    const rows = {};
    for (const lv of [1,5]) {
      const s = mk(lv); const list = [];
      for (const id of ids) {
        const def = T.colleagueDef(id); let best = null;
        for (const mid of missions) {
          const c = JSON.parse(JSON.stringify(s)); c.team.colleagues[id].missionId = mid;
          const secs = T.missionSecondsFor(id, mid);
          const est = T.dispatchReward(c, id, station);
          const gross = est/(secs/3600);
          // 真实离岗损失：全队在家 idle − 只有他一人离岗 idle
          const away = JSON.parse(JSON.stringify(s)); away.team.colleagues[id].missionId = mid;
          const lost = (U.idleIfHome(s) - U.effectOf(away).idleRate) * 3600;
          const net = gross-lost;
          if (!best || net>best.net) best = { mission: mid, gross: Math.round(gross), lost: Math.round(lost), net: Math.round(net) };
        }
        list.push({ name: def.name, ...best });
      }
      rows['lv'+lv] = list;
    }
    return rows;
  })()`);

  // ===== 中后期状态 =====
  await ev(`window.__MOYU__.grant(1e12)`); await sleep(250);
  for (let r = 0; r < 12; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(55); }
  await sleep(300);
  await click("#btn-team"); await sleep(500);
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="recruit"][data-id="${id}"]`); await sleep(550); }
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { for (let i = 0; i < 6; i++) { await click(`[data-act="upgrade"][data-id="${id}"]`); await sleep(55); } }
  await sleep(800);
  out.steps.maxed = await ev(`(() => ({
    summary: document.querySelector('.team-summary')?.innerText.replace(/\\n+/g,' | '),
    station: window.__U.stationIdleScaled(window.__MOYU__.state),
    idle: window.__U.effectOf(window.__MOYU__.state).idleRate,
    favorHint: document.querySelector('.mate .mate-favor')?.innerText.replace(/\\n+/g,' | '),
    idleLine: document.querySelector('.mate .mate-skill')?.textContent.trim(),
  }))()`);
  await shot("01-maxed");

  // ===== ① / ② 净/h 显示 vs 真实净 + 排序 =====
  out.steps.netAccuracy = await ev(`(() => {
    ${parseNet}
    const s = window.__MOYU__.state; const T = window.__M; const U = window.__U;
    const station = U.stationIdleScaled(s);
    const rows = [];
    for (const def of T.COLLEAGUES) {
      const cur = s.team.colleagues[def.id];
      const card = [...document.querySelectorAll('.mate')].find(c => c.innerText.startsWith(def.name));
      const btns = [...card.querySelectorAll('.mate-missions button')];
      const b = btns.find(x => x.innerText.includes('咖啡'));
      const shownNet = parseNet(b.innerText.replace(/\n/g, ' '));
      const fake = JSON.parse(JSON.stringify(s)); fake.team.colleagues[def.id].missionId = 'coffee';
      const est = T.dispatchReward(fake, def.id, station);
      const secs = T.missionSecondsFor(def.id, 'coffee');
      const gross = est / (secs/3600);
      const lost = (U.idleIfHome(s) - U.effectOf(fake).idleRate) * 3600;
      rows.push({ name: def.name, lv: cur.level, shownNet: Math.round(shownNet ?? -1), trueNet: Math.round(gross - lost), gross: Math.round(gross), lost: Math.round(lost) });
    }
    const shownOrder = [...rows].sort((a,b) => b.shownNet - a.shownNet).map(r => r.name);
    const trueOrder = [...rows].sort((a,b) => b.trueNet - a.trueNet).map(r => r.name);
    return { station, rows, shownOrder, trueOrder, rankingMatches: shownOrder.join() === trueOrder.join() };
  })()`);

  // ===== ③ 面板重绘：1.6s 无操作 =====
  out.steps.rerender = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    const node0 = document.querySelector('[data-act="auto"]');
    const card0 = document.querySelectorAll('.mate')[0];
    const cnt = () => document.querySelectorAll('.mate').length;
    let records = 0, fullRebuilds = 0, kinds = {};
    const mo = new MutationObserver((list) => { for (const m of list) { records++; kinds[m.type] = (kinds[m.type]||0)+1; if (m.type === 'childList' && [...m.addedNodes].some(n => n.classList && (n.classList.contains('team-summary') || n.classList.contains('mate')))) fullRebuilds++; } });
    mo.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    await new Promise(r => setTimeout(r, 1600));
    mo.disconnect();
    return { records, fullRebuilds, kinds, nodeReplaced: node0 !== document.querySelector('[data-act="auto"]'), cardReplaced: card0 !== document.querySelectorAll('.mate')[0], cards: cnt() };
  })()`);

  // ===== 自动领取：不点领取是否自动续班并到账 + 是否误报 toast =====
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="auto"][data-id="${id}"]`); await sleep(130); }
  await sleep(400);
  for (const [id, mid] of [["zhou","coffee"],["mei","coffee"],["qiang","toilet"],["li","quick"],["wang","coffee"]]) { await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`); await sleep(200); }
  await sleep(500);
  const beforeAuto = await st();
  await ev(`window.__MOYU__.endMissions()`); await sleep(1000);
  const afterAuto = await st();
  out.steps.autoClaim = {
    moyuDelta: Math.round(afterAuto.moyu - beforeAuto.moyu),
    favors: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k,v]) => [k, v.favor])),
    missions: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k,v]) => [k, v.missionId])),
    claimables: afterAuto ? (await ev(`window.__M.claimableCount(window.__MOYU__.state, Date.now())`)) : -1,
    badge: await ev(`document.querySelector('#btn-team .badge')?.textContent ?? null`),
    toast: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`),
  };

  // ===== 反馈：面板打开时领取 → 只有 flash 且格式化 =====
  // 关掉一个自动重复，造出可领取
  await click('[data-act="auto"][data-id="wang"]'); await sleep(200);
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  await click('[data-act="claim"][data-id="wang"]'); await sleep(150);
  out.steps.feedbackOpen = await ev(`(() => {
    const f = document.querySelector('.team-flash'); const dt = document.querySelector('#dom-toast');
    const p = document.querySelector('.team-panel').getBoundingClientRect();
    return { flash: f ? f.textContent : null, flashPosition: f ? getComputedStyle(f).position : null,
      toastText: dt ? dt.textContent : null, toastShown: dt ? dt.classList.contains('show') : null,
      panel: { x: Math.round(p.x), w: Math.round(p.width) } };
  })()`);
  await shot("02-feedback-open");
  // 一键领取（面板内）
  await click('[data-act="auto"][data-id="li"]'); await sleep(200);
  await ev(`window.__MOYU__.endMissions()`); await sleep(700);
  const claimAll = await ev(`document.querySelector('[data-act="claim-all"]')?.textContent.trim() ?? null`);
  await click('[data-act="claim-all"]'); await sleep(150);
  out.steps.claimAll = { label: claimAll, flash: await ev(`document.querySelector('.team-flash')?.textContent ?? null`), toastText: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`), toastShown: await ev(`document.querySelector('#dom-toast')?.classList.contains('show') ?? false`) };
  await shot("03-claim-all");
  // 关闭面板后领取 → 顶部 toast 且格式化
  await click("#team-close"); await sleep(300);
  await ev(`window.__MOYU__.endMissions()`); await sleep(900);
  out.steps.feedbackClosed = await ev(`(() => { const dt = document.querySelector('#dom-toast'); return { toastText: dt?.textContent ?? null, shown: dt?.classList.contains('show') ?? false, flash: document.querySelector('.team-flash')?.textContent ?? null }; })()`);

  // ===== 新号首派：净显示 vs 真实 =====
  await ev(`window.__MOYU__.reset()`); await sleep(400);
  await ev(`window.__MOYU__.grant(60000)`); await sleep(250);
  for (let r = 0; r < 3; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(300);
  if (!(await ev(`!document.querySelector('#team').classList.contains('hidden')`))) { await click("#btn-team"); await sleep(400); }
  await click('[data-act="recruit"][data-id="zhou"]'); await sleep(800);
  const early = await ev(`(() => {
    ${parseNet}
    const s = window.__MOYU__.state; const T = window.__M; const U = window.__U;
    const station = U.stationIdleScaled(s); const def = T.colleagueDef('zhou');
    const id = 'zhou'; const cur = s.team.colleagues[id];
    const btns = [...document.querySelectorAll('.mate-missions button')].map(b => ({ text: b.innerText.replace(/\\n/g,' / '), net: parseNet(b.innerText.replace(/\\n/g,' ')) }));
    const coffee = T.MISSIONS.find(m => m.id === 'coffee');
    const fake = JSON.parse(JSON.stringify(s)); fake.team.colleagues[id].missionId = 'coffee';
    const est = T.dispatchReward(fake, id, station); const secs = T.missionSecondsFor(id,'coffee');
    const gross = est/(secs/3600);
    const away = JSON.parse(JSON.stringify(s)); away.team.colleagues[id].missionId = 'coffee';
    const lost = (U.idleIfHome(s) - U.effectOf(away).idleRate) * 3600;
    return { station, idleHome: U.effectOf(s).idleRate, buttons: btns, trueNetCoffee: Math.round(gross-lost), shownNetCoffee: btns.find(b=>b.text.includes('咖啡'))?.net ?? null };
  })()`);
  const idleHome = await idle();
  if (!(await ev(`!document.querySelector('#team').classList.contains('hidden')`))) { await click("#btn-team"); await sleep(400); }
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(800);
  out.steps.early = { ...early, idleAfterDispatch: +(await idle()).toFixed(2), measuredLostPerHour: Math.round((idleHome - (await idle())) * 3600) };
  await shot("04-early");

  out.meta.errors = cdp.errors; out.meta.bad = cdp.logs.filter(l => l.startsWith("[error]"));
  writeFileSync("/tmp/probe-r12b5-mgr.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/probe-r12b5-mgr.json");
}
try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2000); console.error("FAIL", out.error); try { writeFileSync("/tmp/probe-r12b5-mgr.json", JSON.stringify(out, null, 2)); } catch { /* ignore */ } }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
