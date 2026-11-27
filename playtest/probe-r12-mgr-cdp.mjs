/**
 * R12 摸鱼小队 · 管理党试玩探针（CDP，390x844 DPR3）
 * 只读 src（不修改），在 dev server 上与真实页面交互：
 *  - 注入资源 → 5 同事全招 / 升级 Lv5 / 派遣 / 领奖 / 好感刷到 100 / 天赋树
 *  - 记录面板文案、按钮、奖励数值、HUD 变化、等待期是否有可见信息
 *  - 用远端模块 /src/engine/team.ts 计算"决策矩阵"（同一 idle 下 5 同事 × 5 任务的收益/秒）
 * 输出：/tmp/probe-r12-mgr.json + /tmp/r12-mgr-*.png
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGR_CDP_PORT || 9358);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error("[r12-mgr]", ...a);

const userDir = `/tmp/chrome-cdp-r12mgr-${Date.now()}`;
const proc = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--disable-extensions",
    "--disable-background-networking",
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let chromeErr = "";
proc.stderr.on("data", (d) => (chromeErr += d.toString()));
const watchdog = setTimeout(() => {
  try { proc.kill("SIGKILL"); } catch { /* ignore */ }
  console.error("[r12-mgr] 超时强杀");
  process.exit(2);
}, 260_000);
watchdog.unref?.();

async function waitJson(path, tries = 160) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return await r.json();
    } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error(`CDP not ready: ${path}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    this.consoleLogs = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.errors.push(JSON.stringify(msg.params.exceptionDetails).slice(0, 600));
      } else if (msg.method === "Runtime.consoleAPICalled") {
        const txt = (msg.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
        this.consoleLogs.push(`[${msg.params.type}] ${txt}`);
      }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async evaluate(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("evaluate failed: " + JSON.stringify(r.exceptionDetails).slice(0, 900));
    return r.result.value;
  }
}

const out = { meta: {}, steps: {}, screenshots: [] };

async function main() {
  await waitJson("/json/version");
  const t = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const cdp = new CDP(ws);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, screenWidth: 390, screenHeight: 844 });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.navigate", { url: URL });

  const shot = async (name) => {
    const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const p = `/tmp/r12-mgr-${name}.png`;
    writeFileSync(p, Buffer.from(r.data, "base64"));
    out.screenshots.push(p);
    return p;
  };
  const ev = (s) => cdp.evaluate(s);
  const click = async (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return { ok:false, sel:${JSON.stringify(sel)} }; el.click(); return { ok:true, text: (el.textContent||'').trim().slice(0,80), disabled: !!el.disabled }; })()`);
  const st = () => ev(`window.__MOYU__.state`);

  // 等待 ready
  for (let i = 0; i < 150; i++) {
    await sleep(100);
    try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ }
  }
  await sleep(600);
  out.meta.version = await ev(`document.querySelector('meta[name="version"]')?.content || null`);
  out.meta.bootError = await ev(`!!document.querySelector('.boot-error')`);
  // 远端引擎模块（与游戏同一份源码，纯函数，用于计算收益/加成；不改任何游戏状态）
  await ev(`(async () => { window.__M = await import('/src/engine/team.ts'); window.__U = await import('/src/engine/upgrades.ts'); return true; })()`);

  // ---------- 0. 初始 & 注入 ----------
  out.steps.initial = await ev(`(() => {
    const h = (s) => document.querySelector(s)?.textContent?.trim() ?? null;
    return { moyu: h('#hud-moyu'), idle: h('#hud-idle'), rank: h('#hud-rank'),
      teamHidden: document.querySelector('#team')?.classList.contains('hidden'),
      teamBtn: { label: document.querySelector('#btn-team')?.getAttribute('aria-label'), badge: document.querySelector('#btn-team .badge')?.textContent ?? null } };
  })()`);
  await shot("00-start");

  await ev(`window.__MOYU__.grant(1e11)`);
  await sleep(300);
  // 买一批商店升级，造出像样的工位挂机（否则派遣下限 300 主导，看不出比例）
  for (let round = 0; round < 12; round++) {
    await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`);
    await sleep(60);
  }
  await ev(`(() => { for (const c of document.querySelectorAll('.shop-card.confirming')) c.click(); return true; })()`);
  await sleep(300);
  out.steps.afterShop = {
    moyu: (await st()).moyu,
    idleHud: await ev(`document.querySelector('#hud-idle')?.textContent`),
    levels: (await st()).levels,
  };

  // ---------- 1. 打开摸鱼小队（未招募） ----------
  await click("#btn-team");
  await sleep(500);
  out.steps.panelLocked = await ev(`(() => {
    const body = document.querySelector('#team-body');
    const locked = [...document.querySelectorAll('.mate.locked')];
    return {
      open: !document.querySelector('#team')?.classList.contains('hidden'),
      innerText: body?.innerText ?? '',
      lockedCount: locked.length,
      lockedTexts: locked.map(el => el.innerText.replace(/\\n+/g, ' | ')),
      buttons: [...body.querySelectorAll('button')].map(b => ({ text: b.innerText.replace(/\\n+/g, '/'), disabled: b.disabled, act: b.dataset.act, id: b.dataset.id })),
      bodyScroll: { scrollH: body?.scrollHeight, clientH: body?.clientHeight },
      panelRect: (() => { const r = document.querySelector('.team-panel')?.getBoundingClientRect(); return r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null; })(),
    };
  })()`);
  await shot("01-panel-locked");

  // ---------- 2. 招募 5 人（记录每次 HUD idle 变化 vs 面板显示值） ----------
  const recruitLog = [];
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
    const before = {
      idle: await ev(`document.querySelector('#hud-idle')?.textContent`),
      idleRate: await ev(`(() => { const s = window.__MOYU__.state; return window.__U.effectOf(s).idleRate; })()`),
      moyu: (await st()).moyu,
    };
    const r = await click(`[data-act="recruit"][data-id="${id}"]`);
    await sleep(700);
    const after = {
      idle: await ev(`document.querySelector('#hud-idle')?.textContent`),
      idleRate: await ev(`(() => { const s = window.__MOYU__.state; return window.__U.effectOf(s).idleRate; })()`),
      moyu: (await st()).moyu,
      live: await ev(`document.querySelector('#sr-live')?.textContent`),
    };
    recruitLog.push({ id, r, before, after, deltaIdleRate: +(after.idleRate - before.idleRate).toFixed(3), paid: before.moyu - after.moyu });
  }
  out.steps.recruit = recruitLog;
  out.steps.afterRecruit = await ev(`(() => {
    const s = window.__MOYU__.state;
    const body = document.querySelector('#team-body');
    return {
      team: s.team,
      innerText: body?.innerText ?? '',
      cards: [...document.querySelectorAll('.mate')].map(el => ({ text: el.innerText.replace(/\\n+/g, ' | '), lv: el.querySelector('.mate-lv')?.textContent })),
      idleHud: document.querySelector('#hud-idle')?.textContent,
      idleRate: window.__U.effectOf(s).idleRate,
      station: window.__U.stationIdleScaled(s),
    };
  })()`);
  await shot("02-panel-recruited");

  // ---------- 3. 全部升到 Lv5 ----------
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
    for (let i = 0; i < 5; i++) {
      await click(`[data-act="upgrade"][data-id="${id}"]`);
      await sleep(90);
    }
  }
  await sleep(700);
  out.steps.afterMax = await ev(`(() => {
    const s = window.__MOYU__.state;
    const body = document.querySelector('#team-body');
    return {
      levels: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, v.level])),
      moyu: s.moyu,
      idleHud: document.querySelector('#hud-idle')?.textContent,
      idleRate: window.__U.effectOf(s).idleRate,
      station: window.__U.stationIdleScaled(s),
      innerText: body?.innerText ?? '',
    };
  })()`);
  await shot("03-panel-maxlevel");

  // ---------- 4. 决策矩阵：同一工位 idle 下 5 同事 × 5 任务 ----------
  out.steps.matrix = await ev(`(() => {
    const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const T = window.__M, U = window.__U;
    const station = U.stationIdleScaled(s);
    const idle = U.effectOf(s).idleRate;
    const rows = [];
    for (const def of T.COLLEAGUES) {
      const cur = s.team.colleagues[def.id];
      if (!cur) continue;
      const per = [];
      for (const m of T.MISSIONS) {
        const fake = JSON.parse(JSON.stringify(s));
        fake.team.colleagues[def.id].missionId = m.id;
        const reward = T.dispatchReward(fake, def.id, station);
        per.push({ mission: m.id, name: m.name, hours: m.seconds/3600, mult: m.mult, match: def.skill === m.type, reward, perHour: Math.round(reward / (m.seconds/3600)), perDay: Math.round(reward * (24/(m.seconds/3600))) });
      }
      rows.push({ id: def.id, name: def.name, level: cur.level, skill: def.skill, missionPerHour: per });
    }
    return { station, idle, rows };
  })()`);

  // ---------- 5. 派遣（含"同一任务多人并发"与"无撤销") ----------
  const dispatchLog = [];
  const plan = [["zhou", "quick"], ["mei", "meeting"], ["qiang", "toilet"], ["li", "quick"], ["wang", "coffee"]];
  out.steps.missionButtonsSample = await ev(`(() => {
    const card = document.querySelector('.mate');
    return { cardText: card?.innerText.replace(/\\n+/g,' | '), buttons: [...card.querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,'/')) };
  })()`);
  for (const [id, mid] of plan) {
    const r = await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`);
    await sleep(650);
    dispatchLog.push({ id, mid, r, live: await ev(`document.querySelector('#sr-live')?.textContent`) });
  }
  out.steps.dispatch = dispatchLog;
  out.steps.busyPanel = await ev(`(() => {
    const body = document.querySelector('#team-body');
    return {
      innerText: body?.innerText ?? '',
      cards: [...document.querySelectorAll('.mate')].map(el => el.innerText.replace(/\\n+/g, ' | ')),
      claimButtons: document.querySelectorAll('[data-act="claim"]').length,
      cancelButtons: [...document.querySelectorAll('#team-body button')].filter(b => /取消|撤回|中断/.test(b.innerText)).length,
      allButtons: [...document.querySelectorAll('#team-body button')].map(b => b.innerText.replace(/\\n+/g,'/').slice(0,40)),
    };
  })()`);
  await shot("04-panel-busy");

  // 关闭面板：等待期主界面有没有任何"有人在外面干活"的痕迹？
  await click("#team-close");
  await sleep(1200);
  out.steps.waitingMainScreen = await ev(`(() => {
    const bodyText = document.body.innerText;
    return {
      badge: document.querySelector('#btn-team .badge')?.textContent ?? null,
      teamBtnLabel: document.querySelector('#btn-team')?.getAttribute('aria-label'),
      live: document.querySelector('#sr-live')?.textContent,
      hasMissionWord: /派遣|任务|外出|进行中/.test(bodyText),
    };
  })()`);
  await shot("05-waiting-main");

  // ---------- 6. 时间快进 → 领奖 ----------
  await ev(`(() => {
    if (!window.__realNow) window.__realNow = Date.now.bind(Date);
    window.__off = 0;
    window.__advance = (ms) => { window.__off += ms; Date.now = () => window.__realNow() + window.__off; return window.__off; };
    window.__advance(4 * 3600 * 1000 + 60 * 1000);
    return true;
  })()`);
  await click("#btn-team");
  await sleep(900);
  out.steps.after4h = await ev(`(() => {
    const body = document.querySelector('#team-body');
    return { innerText: body?.innerText ?? '', claimButtons: [...document.querySelectorAll('[data-act="claim"]')].map(b => ({ id: b.dataset.id, text: b.innerText })) };
  })()`);
  await shot("06-panel-claimable");

  const claimLog = [];
  for (let round = 0; round < 2; round++) {
    const ids = await ev(`[...document.querySelectorAll('[data-act="claim"]')].map(b => b.dataset.id)`);
    for (const id of ids) {
      const before = await st();
      const r = await click(`[data-act="claim"][data-id="${id}"]`);
      await sleep(500);
      const after = await st();
      claimLog.push({
        round, id, r,
        live: await ev(`document.querySelector('#sr-live')?.textContent`),
        moyuDelta: after.moyu - before.moyu,
        favor: after.team.colleagues[id]?.favor,
        idleRate: await ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`),
      });
    }
    if (round === 0) {
      await ev(`window.__advance(4 * 3600 * 1000 + 60 * 1000)`);
      await sleep(900);
    }
  }
  out.steps.claims = claimLog;
  out.steps.afterClaims = await ev(`(() => {
    const body = document.querySelector('#team-body');
    const s = window.__MOYU__.state;
    return {
      innerText: body?.innerText ?? '',
      favors: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, v.favor])),
      badge: document.querySelector('#btn-team .badge')?.textContent ?? null,
    };
  })()`);
  await shot("07-panel-after-claims");

  // ---------- 7. 好感刷到 100（老周：匹配「聊八卦」+3/次），记录里程碑是否有效果 ----------
  const favorLog = [];
  let favorCur = (await st()).team.colleagues.zhou.favor;
  let guard = 0;
  while (favorCur < 100 && guard < 40) {
    guard++;
    await click(`[data-act="dispatch"][data-id="zhou"][data-mission="chat"]`);
    await sleep(220);
    await ev(`window.__advance(30 * 60 * 1000 + 2000)`);
    await sleep(560);
    const before = await st();
    const r = await click(`[data-act="claim"][data-id="zhou"]`);
    await sleep(420);
    const after = await st();
    const idle = await ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
    const reward = await ev(`(() => {
      const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
      const T = window.__M, U = window.__U;
      s.team.colleagues.zhou.missionId = 'chat';
      return T.dispatchReward(s, 'zhou', U.stationIdleScaled(s));
    })()`);
    favorCur = after.team.colleagues.zhou.favor;
    favorLog.push({
      n: guard, favor: favorCur, claimOk: r.ok,
      live: await ev(`document.querySelector('#sr-live')?.textContent`),
      moyuDelta: after.moyu - before.moyu,
      dispatchRewardAtFavor: reward,
      idleRate: +idle.toFixed(2),
      tier: await ev(`window.__M.favorTier(window.__MOYU__.state)`),
    });
    if (guard === 7) await shot("08-favor-20");
  }
  out.steps.favorGrind = { count: favorLog.length, log: favorLog };
  await sleep(400);
  out.steps.favorPanel = await ev(`(() => {
    const body = document.querySelector('#team-body');
    const s = window.__MOYU__.state;
    return {
      zhouCard: [...document.querySelectorAll('.mate')].map(el => el.innerText.replace(/\\n+/g,' | '))[0],
      favors: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k, v.favor])),
      tier: window.__M.favorTier(s),
      dispatchRewardNow: (() => {
        const c = JSON.parse(JSON.stringify(s)); c.team.colleagues.zhou.missionId = 'chat';
        return window.__M.dispatchReward(c, 'zhou', window.__U.stationIdleScaled(c));
      })(),
      idleRate: window.__U.effectOf(s).idleRate,
    };
  })()`);
  await shot("09-favor-100");

  // ---------- 8. 天赋树 ----------
  await click("#tab-talents");
  await sleep(700);
  out.steps.talentsInitial = await ev(`(() => {
    const body = document.querySelector('#team-body');
    const s = window.__MOYU__.state;
    return {
      points: s.talents.points, pointsHud: document.querySelector('#team-points')?.textContent,
      innerText: body?.innerText ?? '',
      buttons: [...body.querySelectorAll('button')].map(b => ({ text: b.innerText.replace(/\\n+/g,'/').slice(0,50), act: b.dataset.act, disabled: b.disabled })),
      idleRate: window.__U.effectOf(s).idleRate,
      station: window.__U.stationIdleScaled(s),
    };
  })()`);
  await shot("10-talents");
  // 点满挂机流，量一下收益变化
  for (const tid of ["idle_1", "idle_2", "idle_3", "idle_4", "idle_5"]) {
    await click(`[data-act="talent"][data-id="${tid}"]`);
    await sleep(180);
  }
  await sleep(500);
  out.steps.talentsIdleMax = await ev(`(() => {
    const body = document.querySelector('#team-body');
    const s = window.__MOYU__.state;
    return {
      points: s.talents.points, unlocked: s.talents.unlocked,
      innerText: body?.innerText ?? '',
      idleRate: window.__U.effectOf(s).idleRate,
      station: window.__U.stationIdleScaled(s),
      idleHud: document.querySelector('#hud-idle')?.textContent,
    };
  })()`);
  await shot("11-talents-idle-max");
  // 重置
  await click(`[data-act="reset-talents"]`);
  await sleep(500);
  out.steps.talentReset = await ev(`(() => {
    const s = window.__MOYU__.state;
    return { points: s.talents.points, unlocked: s.talents.unlocked, live: document.querySelector('#sr-live')?.textContent, idleRate: window.__U.effectOf(s).idleRate };
  })()`);

  // ---------- 9. 收尾状态 ----------
  out.steps.final = await ev(`(() => {
    const s = window.__MOYU__.state;
    return {
      moyu: s.moyu, lifetimeEarned: s.lifetimeEarned, idleHud: document.querySelector('#hud-idle')?.textContent,
      idleRate: window.__U.effectOf(s).idleRate, station: window.__U.stationIdleScaled(s),
      favorTier: window.__M.favorTier(s),
      teamFixed: window.__M.teamFixedRate(s), share: window.__M.teamShareRatio(s),
      talents: s.talents,
    };
  })()`);
  out.meta.errors = cdp.errors;
  out.meta.consoleErrors = cdp.consoleLogs.filter((l) => l.startsWith("[error]") || l.startsWith("[warning]"));
  out.meta.chromeErrTail = chromeErr.slice(-400);
}

try {
  await main();
} catch (e) {
  out.error = String(e && e.stack ? e.stack : e).slice(0, 3000);
  console.error("[r12-mgr] FAIL", out.error);
}
try {
  writeFileSync("/tmp/probe-r12-mgr.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/probe-r12-mgr.json", out.error ? "WITH ERROR" : "OK");
} catch (e) {
  console.error("write fail", e);
}
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
