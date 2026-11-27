/**
 * R12 第三次复验（HEAD bcb2a7b）：离岗 15% / 同事贡献进奖励 / 净收益展示 / 完成即恢复 / 自动领取续班 / 重绘 / 反馈
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGRB4_CDP_PORT || 9379);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12b4-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } process.exit(2); }, 240_000).unref?.();
async function waitJson(path, tries = 160) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(100); } throw new Error("CDP not ready"); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.logs = []; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 400)); else if (m.method === "Runtime.consoleAPICalled") this.logs.push(`[${m.params.type}] ${(m.params.args||[]).map(a=>a.value??a.description??a.type).join(" ")}`); }; }
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
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return {ok:false}; el.click(); return {ok:true, text:(el.textContent||'').trim().slice(0,90)}; })()`);
  const shot = async (n) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = `/tmp/r12b4-${n}.png`; writeFileSync(p, Buffer.from(r.data, "base64")); out.shots.push(p); };
  const st = () => ev(`window.__MOYU__.state`);
  const idle = () => ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`(async () => { window.__M = await import('/src/engine/team.ts'); window.__U = await import('/src/engine/upgrades.ts'); window.__T = await import('/src/engine/talents.ts'); return true; })()`);
  out.meta = { version: await ev(`document.querySelector('meta[name="version"]')?.content ?? null`) };

  // ===== ① 引擎层：Lv1 vs Lv5 净收益（净 = 毛/h − 15% 离岗损失/h）=====
  out.steps.levels = await ev(`(() => {
    const T = window.__M; const station = 15035.252; const ids = ['zhou','mei','qiang','li','wang'];
    const missions = T.MISSIONS.map(m => m.id);
    const s0 = window.__MOYU__.state;
    const mk = (lv) => { const s = JSON.parse(JSON.stringify(s0)); for (const id of ids) s.team.colleagues[id] = { level: lv, missionId: null, startedAt:0, endsAt:0, favor:0, autoRepeat:false, rewardSnapshot:0 }; return s; };
    const rows = {};
    for (const lv of [1,3,5]) {
      const s = mk(lv); const list = [];
      for (const id of ids) {
        const def = T.colleagueDef(id);
        let best = null;
        for (const mid of missions) {
          const c = JSON.parse(JSON.stringify(s)); c.team.colleagues[id].missionId = mid;
          const secs = T.missionSecondsFor(id, mid);
          const est = T.dispatchReward(c, id, station);
          const gross = est/(secs/3600);
          const lost = 0.15*(def.idlePerLevel*lv + station*def.sharePerLevel*lv)*3600;
          const net = gross-lost;
          if (!best || net>best.net) best = { mission: mid, gross: Math.round(gross), lost: Math.round(lost), net: Math.round(net) };
        }
        list.push({ name: def.name, ...best });
      }
      rows['lv'+lv] = list;
    }
    return rows;
  })()`);

  // ===== ② 新号首派（工位 ~113/s）=====
  await ev(`window.__MOYU__.reset()`); await sleep(400);
  await ev(`window.__MOYU__.grant(60000)`); await sleep(250);
  for (let r = 0; r < 3; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(300);
  await click("#btn-team"); await sleep(500);
  await click('[data-act="recruit"][data-id="zhou"]'); await sleep(800);
  const earlyIdle = await idle();
  out.steps.early = {
    station: await ev(`window.__U.stationIdleScaled(window.__MOYU__.state)`),
    idleHome: +earlyIdle.toFixed(2),
    buttons: await ev(`(() => [...document.querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / ')))()`),
  };
  await shot("01-early-net");
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(800);
  out.steps.early.idleAway = +(await idle()).toFixed(2);
  out.steps.early.lostPerHourMeasured = Math.round((earlyIdle - (await idle())) * 3600);

  // ===== 中后期状态：注资 + 升满 =====
  await ev(`window.__MOYU__.reset()`); await sleep(400);
  await ev(`window.__MOYU__.grant(1e12)`); await sleep(250);
  for (let r = 0; r < 12; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(55); }
  await sleep(300);
  if (!(await ev(`!document.querySelector('#team').classList.contains('hidden')`))) { await click("#btn-team"); await sleep(400); }
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="recruit"][data-id="${id}"]`); await sleep(550); }
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { for (let i = 0; i < 6; i++) { await click(`[data-act="upgrade"][data-id="${id}"]`); await sleep(55); } }
  await sleep(700);
  out.steps.maxed = await ev(`(() => ({
    summary: document.querySelector('.team-summary')?.innerText.replace(/\\n+/g,' | '),
    maxLabel: document.querySelector('[data-act="upgrade"]')?.textContent.trim(),
    missionButtons: [...document.querySelectorAll('.mate')[0].querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / ')),
    favorHint: document.querySelector('.mate .mate-favor')?.innerText.replace(/\\n+/g,' | '),
    station: window.__U.stationIdleScaled(window.__MOYU__.state), idle: window.__U.effectOf(window.__MOYU__.state).idleRate,
    idleIfHome: window.__U.idleIfHome(window.__MOYU__.state),
  }))()`);
  await shot("02-maxed-net");
  // 校验按钮里的"净"是否等于 毛 − 本人离岗损失
  out.steps.netCheck = await ev(`(() => {
    const s = window.__MOYU__.state; const T = window.__M; const station = window.__U.stationIdleScaled(s);
    const out = [];
    for (const id of ['zhou','li','wang']) {
      const def = T.colleagueDef(id); const cur = s.team.colleagues[id];
      const card = [...document.querySelectorAll('.mate')].find(c => c.innerText.startsWith(def.name));
      if (!card) { out.push({ id, missing: true }); continue; }
      const btns = [...card.querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / '));
      const coffee = T.MISSIONS.find(m => m.id==='coffee');
      const fake = JSON.parse(JSON.stringify(s)); fake.team.colleagues[id].missionId='coffee';
      const est = T.dispatchReward(fake, id, station); const secs = T.missionSecondsFor(id,'coffee');
      const gross = est/(secs/3600);
      const ownLost = 0.15*(def.idlePerLevel*cur.level + station*def.sharePerLevel*cur.level)*3600;
      out.push({ id, name: def.name, btnCoffee: btns.find(t=>t.includes('咖啡')), gross: Math.round(gross), ownLost: Math.round(ownLost), correctNet: Math.round(gross-ownLost) });
    }
    return out;
  })()`);

  // ===== ③ 重绘：无操作 1.6s =====
  out.steps.rerender = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    const node0 = document.querySelector('[data-act="auto"]');
    const card0 = document.querySelectorAll('.mate')[0];
    let muts = 0; const types = {};
    const mo = new MutationObserver((list) => { for (const m of list) { muts++; types[m.type]=(types[m.type]||0)+1; } });
    mo.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    await new Promise(r => setTimeout(r, 1600));
    mo.disconnect();
    return { mutations: muts, types, nodeReplaced: node0 !== document.querySelector('[data-act="auto"]'), cardReplaced: card0 !== document.querySelectorAll('.mate')[0] };
  })()`);

  // ===== ④ 自动重复：不点领取是否自动续班并到账 =====
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="auto"][data-id="${id}"]`); await sleep(140); }
  await sleep(400);
  for (const [id, mid] of [["zhou","coffee"],["mei","coffee"],["qiang","toilet"],["li","quick"],["wang","coffee"]]) { await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`); await sleep(200); }
  await sleep(500);
  const idleBusy = +(await idle()).toFixed(1);
  const beforeAuto = await st();
  await ev(`window.__MOYU__.endMissions()`);
  await sleep(900); // 不点领取，等主循环自动结算
  const afterAuto = await st();
  out.steps.autoClaim = {
    idleBusy, idleAfterAuto: +(await idle()).toFixed(1),
    moyuDelta: Math.round(afterAuto.moyu - beforeAuto.moyu),
    missions: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k,v]) => [k, v.missionId])),
    favours: Object.fromEntries(Object.entries(afterAuto.team.colleagues).map(([k,v]) => [k, v.favor])),
    claimables: await ev(`window.__M.claimableCount(window.__MOYU__.state, Date.now())`),
    badge: await ev(`document.querySelector('#btn-team .badge')?.textContent ?? null`),
    toast: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`),
  };
  await shot("03-autoclaim");
  // 关闭面板后再等一个循环
  await click("#team-close"); await sleep(300);
  await ev(`window.__MOYU__.endMissions()`); await sleep(900);
  const closedAuto = await st();
  out.steps.autoClaimClosed = {
    missions: Object.fromEntries(Object.entries(closedAuto.team.colleagues).map(([k,v]) => [k, v.missionId])),
    claimables: await ev(`window.__M.claimableCount(window.__MOYU__.state, Date.now())`),
    badge: await ev(`document.querySelector('#btn-team .badge')?.textContent ?? null`),
    toast: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`),
  };

  // ===== ⑤ 反馈：面板打开时是否只走浮层、数字是否格式化 =====
  await click("#btn-team"); await sleep(500);
  // 关掉两人的自动重复以便出现可领取
  await click('[data-act="auto"][data-id="li"]'); await sleep(200);
  await click('[data-act="auto"][data-id="wang"]'); await sleep(200);
  await ev(`window.__MOYU__.endMissions()`); await sleep(800);
  const claimableNow = await ev(`document.querySelectorAll('[data-act="claim"]').length`);
  await click('[data-act="claim-all"]'); await sleep(150);
  out.steps.feedback = await ev(`(() => {
    const f = document.querySelector('.team-flash'); const dt = document.querySelector('#dom-toast');
    return { claimableNow: ${claimableNow}, flash: f ? f.textContent : null, toast: dt ? { text: dt.textContent, show: dt.classList.contains('show') } : null,
      flashStyled: f ? getComputedStyle(f).position : null, panel: (() => { const r = document.querySelector('.team-panel').getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width) }; })() };
  })()`);
  await shot("04-feedback");
  // 关闭面板后再领取一次（若还有可领）
  await click("#team-close"); await sleep(400);
  await ev(`window.__MOYU__.endMissions()`); await sleep(900);
  out.steps.feedbackClosed = await ev(`(() => { const dt = document.querySelector('#dom-toast'); return { text: dt?.textContent ?? null, show: dt?.classList.contains('show') ?? false, panelHidden: document.querySelector('#team')?.classList.contains('hidden') }; })()`);

  // ===== ⑥ 天赋树 27 点 / 成本 / 效果接入 =====
  await click("#btn-team"); await sleep(500);
  await click("#tab-talents"); await sleep(700);
  out.steps.talents = await ev(`(() => ({ points: window.__MOYU__.state.talents.points, text: document.querySelector('#team-body')?.innerText.slice(0, 900), buttons: [...document.querySelectorAll('#team-body button')].map(b => b.textContent.trim()).slice(0, 8) }))()`);
  await shot("05-talents");

  out.meta.errors = cdp.errors; out.meta.bad = cdp.logs.filter(l => l.startsWith("[error]"));
  writeFileSync("/tmp/probe-r12b4-mgr.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/probe-r12b4-mgr.json");
}
try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2000); console.error("FAIL", out.error); try { writeFileSync("/tmp/probe-r12b4-mgr.json", JSON.stringify(out, null, 2)); } catch { /* ignore */ } }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
