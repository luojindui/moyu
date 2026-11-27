/**
 * R12 摸鱼小队 · 补充探针：交互细节
 * 1) 满级卡仍显示「升级 Lv.6」且按钮 disabled
 * 2) 面板打开时整块列表每 400ms 重绘（按钮节点被替换）→ 点击目标跳动
 * 3) 领奖反馈：toast 画在 canvas 上，被 #team 模态遮住；无音效
 * 4) 关闭面板后等待期主界面无任何「有人在外面」的提示；任务完成只有角标、无提示音
 * 5) 领奖是否需要重开面板；刷新页面后派遣状态是否保留
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGR2_CDP_PORT || 9361);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12mgr2-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } process.exit(2); }, 120_000);
watchdog.unref?.();

async function waitJson(path, tries = 160) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error("CDP not ready");
}
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(r.exceptionDetails).slice(0, 800)); return r.result.value; }
}

const out = { steps: {}, shots: [] };

async function main() {
  await waitJson("/json/version");
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.navigate", { url: URL });
  const ev = (s) => cdp.evaluate(s);
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
  const shot = async (name) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = `/tmp/r12-mgr2-${name}.png`; writeFileSync(p, Buffer.from(r.data, "base64")); out.shots.push(p); };
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`window.__MOYU__.grant(1e11)`);
  await sleep(200);
  for (let r = 0; r < 12; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(200);
  await click("#btn-team"); await sleep(400);
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { await click(`[data-act="recruit"][data-id="${id}"]`); await sleep(600); }
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { for (let i = 0; i < 6; i++) { await click(`[data-act="upgrade"][data-id="${id}"]`); await sleep(70); } }
  await sleep(600);

  // 1) 满级按钮
  out.steps.maxLevelButton = await ev(`(() => {
    const b = document.querySelector('[data-act="upgrade"][data-id="zhou"]');
    const s = window.__MOYU__.state;
    return { level: s.team.colleagues.zhou.level, label: b ? b.textContent.trim() : null, disabled: b ? b.disabled : null };
  })()`);
  out.steps.maxLevelClick = await ev(`(() => {
    const b = document.querySelector('[data-act="upgrade"][data-id="zhou"]');
    const before = window.__MOYU__.state.team.colleagues.zhou.level;
    if (b) b.click();
    const after = window.__MOYU__.state.team.colleagues.zhou.level;
    return { before, after, live: document.querySelector('#sr-live').textContent };
  })()`);

  // 2) 重绘 churn：面板空闲时记录 #team-body 的 DOM 变更、按钮节点是否被替换
  out.steps.rerender = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    const btn0 = document.querySelector('[data-act="upgrade"][data-id="zhou"]');
    let muts = 0;
    const mo = new MutationObserver((list) => { muts += list.length; });
    mo.observe(body, { childList: true, subtree: true, attributes: true });
    await new Promise(r => setTimeout(r, 1500));
    mo.disconnect();
    const btn1 = document.querySelector('[data-act="upgrade"][data-id="zhou"]');
    return { mutationsIn1500ms: muts, buttonNodeReplaced: btn0 !== btn1, bodyInnerHtmlLen: body.innerHTML.length };
  })()`);

  // 3) 派遣 → 快进 → 关闭面板 → 看主界面等待期提示
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]');
  await sleep(500);
  out.steps.dispatched8h = await ev(`(() => {
    const card = document.querySelector('.mate');
    return { card: card.innerText.replace(/\\n+/g,' | '), missionButtons: document.querySelectorAll('[data-act="dispatch"]').length };
  })()`);
  await click("#team-close");
  await sleep(1000);
  out.steps.mainClosed = await ev(`(() => {
    const leaf = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0);
    const hits = leaf.map(el => (el.textContent||'').trim()).filter(t => /派遣|进行中|任务完成|可领取/.test(t));
    return {
      badge: document.querySelector('#btn-team .badge')?.textContent ?? null,
      teamLabel: document.querySelector('#btn-team').getAttribute('aria-label'),
      leafHits: hits,
      live: document.querySelector('#sr-live').textContent,
      zIndexTeam: getComputedStyle(document.querySelector('#team')).zIndex,
      zIndexStage: getComputedStyle(document.querySelector('#stage-wrap')).zIndex,
    };
  })()`);
  await shot("closed-waiting");

  // 快进到任务完成，但面板保持关闭
  await ev(`(() => { window.__realNow = Date.now.bind(Date); window.__off = 0; window.__advance = (ms) => { window.__off += ms; Date.now = () => window.__realNow() + window.__off; return window.__off; }; window.__advance(9*3600*1000); return true; })()`);
  await sleep(1600);
  out.steps.doneWhileClosed = await ev(`(() => {
    const leaf = [...document.querySelectorAll('body *')].filter(el => el.children.length === 0);
    const hits = leaf.map(el => (el.textContent||'').trim()).filter(t => /可领取|任务完成|领取/.test(t));
    return { badge: document.querySelector('#btn-team .badge')?.textContent ?? null, teamLabel: document.querySelector('#btn-team').getAttribute('aria-label'), leafHits: hits, live: document.querySelector('#sr-live').textContent };
  })()`);
  await shot("done-while-closed");

  // 4) 重开面板 → 领奖瞬间截图（toast 画在 canvas 上，被面板遮住？）
  await click("#btn-team"); await sleep(700);
  await shot("claim-before");
  const claimInfo = await ev(`(() => {
    const s = window.__MOYU__.state;
    const btn = document.querySelector('[data-act="claim"]');
    return { claimBtn: btn ? btn.textContent.trim() : null, canvasRect: (() => { const r = document.querySelector('#stage').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; })(),
      panelRect: (() => { const r = document.querySelector('.team-panel').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height) }; })(),
      toastY: Math.round(document.querySelector('#stage').clientHeight * 0.22), zTeam: getComputedStyle(document.querySelector('#team')).zIndex, zStageWrap: getComputedStyle(document.querySelector('#stage-wrap')).zIndex };
  })()`);
  await ev(`(() => { const b = document.querySelector('[data-act="claim"]'); if (b) b.click(); return true; })()`);
  await sleep(120);
  await shot("claim-instant");
  out.steps.claimVisual = { ...claimInfo, liveAfter: await ev(`document.querySelector('#sr-live').textContent`), scrollPos: await ev(`document.querySelector('#team-body').scrollTop`) };

  // 5) 5 人全部派出后，关面板 → 快进 → 刷新页面，派遣是否保留、是否可领
  await ev(`window.__MOYU__.saveNow()`);
  await sleep(400);
  const beforeReload = await ev(`(() => { const s = window.__MOYU__.state; return Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, { mission: v.missionId, favor: v.favor }])); })()`);
  await cdp.send("Page.reload", { ignoreCache: false });
  await sleep(2600);
  for (let i = 0; i < 100; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 20)`)) break; } catch { /* nav */ } }
  await sleep(500);
  out.steps.reloadPersist = { beforeReload, afterReload: await ev(`(() => { const s = window.__MOYU__.state; return { team: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, { mission: v.missionId, favor: v.favor, endsAt: v.endsAt }])), now: Date.now() }; })()`),
    badge: await ev(`document.querySelector('#btn-team .badge')?.textContent ?? null`) };

  // 6) 面板滚动位置是否被重绘重置 + 关闭时倒计时是否停
  if (!(await ev(`!document.querySelector('#team').classList.contains('hidden')`))) { await click("#btn-team"); await sleep(400); }
  out.steps.scrollReset = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    body.scrollTop = body.scrollHeight;
    const t0 = body.scrollTop;
    await new Promise(r => setTimeout(r, 1200));
    return { t0, t1: document.querySelector('#team-body').scrollTop, scrollH: body.scrollHeight, clientH: body.clientHeight };
  })()`);
  out.meta = { errors: [] };
}

try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2000); console.error("[mgr2] FAIL", out.error); }
try { writeFileSync("/tmp/probe-r12-mgr2.json", JSON.stringify(out, null, 2)); console.log("wrote /tmp/probe-r12-mgr2.json", out.error ? "WITH ERROR" : "OK"); } catch (e) { console.error(e); }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
