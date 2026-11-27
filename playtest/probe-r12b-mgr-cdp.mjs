/**
 * R12 复验探针（管理党，第二轮）：只读 src，验证 10 项修复
 *  ① 任务按钮收益数字/每小时  ② 自动重复（排班）  ③ 5 个独特被动  ④ 派遣 50% 挂机代价
 *  ⑤ 一键领取/面板内反馈        ⑥ 好感里程碑      ⑦ 招募价/share 递增
 *  ⑧ 结构签名重绘（不点空）      ⑨ 满级文案/hh:mm:ss/汇总/领奖快照  ⑩ 数值一致性
 * 输出 /tmp/probe-r12b-mgr.json + /tmp/r12b-*.png
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.MGRB_CDP_PORT || 9371);
const URL = "http://127.0.0.1:5173/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDir = `/tmp/chrome-cdp-r12b-${Date.now()}`;
const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", "--mute-audio", "--no-first-run", "--disable-extensions", "--disable-background-networking", `--user-data-dir=${userDir}`, `--remote-debugging-port=${PORT}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const watchdog = setTimeout(() => { try { proc.kill("SIGKILL"); } catch { /* ignore */ } console.error("[r12b] timeout"); process.exit(2); }, 240_000);
watchdog.unref?.();
async function waitJson(path, tries = 160) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}${path}`); if (r.ok) return await r.json(); } catch { /* retry */ } await sleep(100); } throw new Error("CDP not ready"); }
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; this.logs = []; ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } else if (m.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(m.params.exceptionDetails).slice(0, 500)); else if (m.method === "Runtime.consoleAPICalled") this.logs.push(`[${m.params.type}] ${(m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ")}`); }; }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async evaluate(expression) { const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error("eval fail: " + JSON.stringify(r.exceptionDetails).slice(0, 900)); return r.result.value; }
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
  const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return {ok:false, sel:${JSON.stringify(sel)}}; el.click(); return {ok:true, text:(el.textContent||'').trim().slice(0,90), disabled:!!el.disabled}; })()`);
  const shot = async (n) => { const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = `/tmp/r12b-${n}.png`; writeFileSync(p, Buffer.from(r.data, "base64")); out.shots.push(p); };
  const st = () => ev(`window.__MOYU__.state`);
  for (let i = 0; i < 150; i++) { await sleep(100); try { if (await ev(`!!(window.__MOYU__ && window.__MOYU__.frames > 30)`)) break; } catch { /* nav */ } }
  await sleep(500);
  await ev(`(async () => { window.__M = await import('/src/engine/team.ts'); window.__U = await import('/src/engine/upgrades.ts'); window.__P = await import('/src/engine/progression.ts'); window.__T = await import('/src/engine/talents.ts'); return true; })()`);
  out.meta = { hooks: await ev(`Object.keys(window.__MOYU__)`) };

  // ---------- 0. 开局：注资 + 商店（造中后期工位挂机） ----------
  await ev(`window.__MOYU__.grant(1e12)`); await sleep(250);
  for (let r = 0; r < 12; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(55); }
  await sleep(300);
  out.steps.before = await ev(`(() => { const s = window.__MOYU__.state; const U = window.__U; return { station: U.stationIdleScaled(s), idle: U.effectOf(s).idleRate, moyu: s.moyu, idleHud: document.querySelector('#hud-idle').textContent }; })()`);

  // ---------- 1. 打开面板：锁定卡文案（含被动） ----------
  await click("#btn-team"); await sleep(500);
  out.steps.locked = await ev(`(() => ({
    summary: document.querySelector('.team-summary')?.innerText.replace(/\\n+/g,' | ') ?? null,
    hint: document.querySelector('.team-hint')?.innerText.replace(/\\n+/g,' | ') ?? null,
    lockedTexts: [...document.querySelectorAll('.mate.locked')].map(el => el.innerText.replace(/\\n+/g,' | ')),
    panelScroll: (() => { const b = document.querySelector('#team-body'); return { scrollH: b.scrollHeight, clientH: b.clientHeight }; })(),
  }))()`);
  await shot("01-locked");

  // ---------- 2. 招募 5 人：实测挂机增量 vs 价格 ----------
  const recruitLog = [];
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) {
    const before = await ev(`(() => { const s = window.__MOYU__.state; return { idle: window.__U.effectOf(s).idleRate, moyu: s.moyu }; })()`);
    const r = await click(`[data-act="recruit"][data-id="${id}"]`);
    await sleep(650);
    const after = await ev(`(() => { const s = window.__MOYU__.state; return { idle: window.__U.effectOf(s).idleRate, moyu: s.moyu }; })()`);
    recruitLog.push({ id, r, cost: Math.round(before.moyu - after.moyu), deltaIdlePerSec: +(after.idle - before.idle).toFixed(2) });
  }
  out.steps.recruit = recruitLog;
  await sleep(400);
  await shot("02-recruited");

  // ---------- 3. 全部升 Lv5，检查满级文案/汇总 ----------
  for (const id of ["zhou", "mei", "qiang", "li", "wang"]) { for (let i = 0; i < 6; i++) { await click(`[data-act="upgrade"][data-id="${id}"]`); await sleep(60); } }
  await sleep(700);
  out.steps.maxed = await ev(`(() => {
    const s = window.__MOYU__.state, U = window.__U;
    const b = document.querySelector('[data-act="upgrade"][data-id="zhou"]');
    return {
      summary: document.querySelector('.team-summary')?.innerText.replace(/\\n+/g,' | '),
      upgradeLabel: b ? b.textContent.trim() : null, upgradeDisabled: b ? b.disabled : null,
      idle: U.effectOf(s).idleRate, station: U.stationIdleScaled(s),
      teamFixed: window.__M.teamFixedRate(s), share: window.__M.teamShareRatio(s),
      levels: Object.fromEntries(Object.entries(s.team.colleagues).map(([k,v]) => [k,v.level])),
    };
  })()`);
  await shot("03-maxed");

  // ---------- 4. 任务按钮数字 + 决策矩阵（含 50% 挂机损失） ----------
  out.steps.missionButtons = await ev(`(() => [...document.querySelectorAll('.mate')].slice(0,5).map(card => ({
    name: card.querySelector('.mate-name')?.textContent.trim(),
    idleLine: card.querySelector('.mate-skill')?.textContent.trim(),
    passive: [...card.querySelectorAll('.mate-skill')][1]?.textContent.trim(),
    buttons: [...card.querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / ')),
  })))()`);
  out.steps.matrix = await ev(`(() => {
    const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const T = window.__M, U = window.__U;
    const station = U.stationIdleScaled(s);
    const mult = 1; // prestige/collection 未改，用于把同事固定挂机折算进 HUD
    const rows = [];
    for (const def of T.COLLEAGUES) {
      const cur = s.team.colleagues[def.id];
      const per = [];
      for (const m of T.MISSIONS) {
        const fake = JSON.parse(JSON.stringify(s));
        fake.team.colleagues[def.id].missionId = m.id;
        const secs = T.missionSecondsFor(def.id, m.id);
        const est = T.dispatchReward(fake, def.id, station);
        const perHour = Math.round(est / (secs / 3600));
        // 派遣期间的挂机损失（同事固定×0.5 + 工位占比×0.5）
        const lostPerSec = 0.5 * (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level);
        per.push({ mission: m.id, hours: secs / 3600, est, perHour, lostPerHour: Math.round(lostPerSec * 3600), netPerHour: Math.round(perHour - lostPerSec * 3600), match: def.skill === m.type });
      }
      const best = per.reduce((a, b) => (b.netPerHour > a.netPerHour ? b : a), per[0]);
      rows.push({ id: def.id, name: def.name, trait: def.trait, traitValue: def.traitValue, level: cur.level, missions: per, bestByNet: best.mission, bestNetPerHour: best.netPerHour, starMission: per.find(p => p.match)?.mission });
    }
    return { station, rows };
  })()`);

  // ---------- 5. 被动验证（模块层） ----------
  out.steps.traits = await ev(`(() => {
    const s = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const T = window.__M, P = window.__P, U = window.__U;
    const base = JSON.parse(JSON.stringify(s));
    const now = Date.now(), created = now - 3 * 86400 * 1000;
    const offWith = P.offlineEfficiency(base, created, now);
    const noMei = JSON.parse(JSON.stringify(base)); delete noMei.team.colleagues.mei;
    const offWithout = P.offlineEfficiency(noMei, created, now);
    const noQiang = JSON.parse(JSON.stringify(base)); delete noQiang.team.colleagues.qiang;
    return {
      teamTraitsFull: T.teamTraits(base), teamTraitsNoMeiQiang: T.teamTraits(noQiang),
      offlineWithMei: offWith, offlineWithoutMei: offWithout, offlineDelta: +(offWith - offWithout).toFixed(4),
      secondsZhou: { quick: T.missionSecondsFor('zhou','quick'), coffee: T.missionSecondsFor('zhou','coffee') },
      secondsMeiCoffee: T.missionSecondsFor('mei','coffee'),
      // 小李短任务加成：同任务 li vs mei
      liQuick: (() => { const c = JSON.parse(JSON.stringify(base)); c.team.colleagues.li.missionId='quick'; return T.dispatchReward(c,'li',U.stationIdleScaled(c)); })(),
      meiQuick: (() => { const c = JSON.parse(JSON.stringify(base)); c.team.colleagues.mei.missionId='quick'; return T.dispatchReward(c,'mei',U.stationIdleScaled(c)); })(),
      liCoffee: (() => { const c = JSON.parse(JSON.stringify(base)); c.team.colleagues.li.missionId='coffee'; return T.dispatchReward(c,'li',U.stationIdleScaled(c)); })(),
      wangCoffee: (() => { const c = JSON.parse(JSON.stringify(base)); c.team.colleagues.wang.missionId='coffee'; return T.dispatchReward(c,'wang',U.stationIdleScaled(c)); })(),
      wangMeeting: (() => { const c = JSON.parse(JSON.stringify(base)); c.team.colleagues.wang.missionId='meeting'; return T.dispatchReward(c,'wang',U.stationIdleScaled(c)); })(),
    };
  })()`);

  // ---------- 6. 派遣 50% 挂机代价：实测 idle 前后 ----------
  const idleAll = (await st()).team;
  const idleBefore = await ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(700);
  const idleAfter = await ev(`window.__U.effectOf(window.__MOYU__.state).idleRate`);
  out.steps.awayCost = {
    idleBefore, idleAfter, drop: +(idleBefore - idleAfter).toFixed(2),
    cardText: await ev(`document.querySelector('.mate')?.innerText.replace(/\\n+/g,' | ')`),
    lostPerHour: Math.round((idleBefore - idleAfter) * 3600),
  };
  await shot("04-dispatch-away");

  // ---------- 7. 领奖反馈（单领）：flash DOM + toast ----------
  await ev(`window.__MOYU__.endMissions()`); await sleep(600);
  out.steps.claimReady = await ev(`(() => ({ claimBtn: document.querySelector('[data-act="claim"]')?.textContent.trim(), claimAll: document.querySelector('[data-act="claim-all"]')?.textContent.trim(), claimCount: document.querySelectorAll('[data-act="claim"]').length }))()`);
  const beforeClaim = (await st()).moyu;
  await click('[data-act="claim"][data-id="zhou"]'); await sleep(150);
  out.steps.claimSingle = await ev(`(() => {
    const f = document.querySelector('.team-flash');
    const r = f ? f.getBoundingClientRect() : null;
    const cs = f ? getComputedStyle(f) : null;
    const dt = document.querySelector('#dom-toast');
    return {
      flashText: f ? f.textContent : null, flashRect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      flashStyled: cs ? { position: cs.position, zIndex: cs.zIndex, background: cs.backgroundColor, fontSize: cs.fontSize } : null,
      domToast: dt ? { text: dt.textContent, show: dt.classList.contains('show'), z: getComputedStyle(dt).zIndex } : null,
      panelRect: (() => { const p = document.querySelector('.team-panel').getBoundingClientRect(); return { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) }; })(),
      live: document.querySelector('#sr-live').textContent,
      moyuGain: null,
    };
  })()`);
  out.steps.claimSingle.moyuGain = (await st()).moyu - beforeClaim;
  await shot("05-claim-flash");

  // ---------- 8. 自动重复：开关 + 领取后自动再派 + 离线不领就停摆 ----------
  await click('[data-act="auto"][data-id="zhou"]'); await sleep(300);
  await click('[data-act="auto"][data-id="wang"]'); await sleep(500);
  out.steps.autoToggle = await ev(`(() => {
    const s = window.__MOYU__.state;
    return { zhouAuto: s.team.colleagues.zhou.autoRepeat, wangAuto: s.team.colleagues.wang.autoRepeat,
      autoBtnTexts: [...document.querySelectorAll('[data-act="auto"]')].map(b => b.textContent.trim()) };
  })()`);
  // 给 zhou / wang 派任务（如果已在任务中则先结束）
  await ev(`window.__MOYU__.endMissions()`); await sleep(400);
  // 先领掉可能完成的
  if (await ev(`!!document.querySelector('[data-act="claim-all"]')`)) { await click('[data-act="claim-all"]'); await sleep(600); }
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="coffee"]'); await sleep(400);
  await click('[data-act="dispatch"][data-id="wang"][data-mission="coffee"]'); await sleep(500);
  const estAtDispatch = await ev(`(() => { const s = window.__MOYU__.state; return { zhou: s.team.colleagues.zhou.rewardSnapshot, wang: s.team.colleagues.wang.rewardSnapshot }; })()`);
  await ev(`window.__MOYU__.endMissions()`); await sleep(600);
  const allBefore = await st();
  await click('[data-act="claim-all"]'); await sleep(800);
  const allAfter = await st();
  out.steps.claimAll = {
    estAtDispatch,
    flash: await ev(`document.querySelector('.team-flash')?.textContent ?? null`),
    toast: await ev(`document.querySelector('#dom-toast')?.textContent ?? null`),
    actualGain: Math.round(allAfter.moyu - allBefore.moyu),
    buttonShown: out.steps.claimReady.claimAll,
    zhouReDispatched: allAfter.team.colleagues.zhou.missionId,
    wangReDispatched: allAfter.team.colleagues.wang.missionId,
    meiAfter: allAfter.team.colleagues.mei.missionId,
    zhouFavor: allAfter.team.colleagues.zhou.favor,
    claimablesAfter: await ev(`window.__M.claimableCount(window.__MOYU__.state, Date.now())`),
  };
  await shot("06-claim-all-auto");
  // 离线不领：结束后没人点领取 → 是否会自动再派？
  await ev(`window.__MOYU__.endMissions()`); await sleep(500);
  const idleState = await st();
  await click("#team-close"); await sleep(2500);
  const afterWait = await st();
  out.steps.offlineChain = {
    zhouMissionWhenDone: idleState.team.colleagues.zhou.missionId,
    zhouMissionAfterWait: afterWait.team.colleagues.zhou.missionId,
    moyuUnchanged: Math.round(afterWait.moyu - idleState.moyu),
    badge: await ev(`document.querySelector('#btn-team .badge')?.textContent ?? null`),
    liveAfter: await ev(`document.querySelector('#sr-live').textContent`),
  };

  // ---------- 9. 结构重绘/点空回归：倒计时期间 DOM 变更 & 按钮节点身份 ----------
  await click("#btn-team"); await sleep(400);
  if (await ev(`!!document.querySelector('[data-act="claim-all"]')`)) { await click('[data-act="claim-all"]'); await sleep(700); }
  await click('[data-act="dispatch"][data-id="mei"][data-mission="coffee"]'); await sleep(500);
  out.steps.rerender = await ev(`(async () => {
    const body = document.querySelector('#team-body');
    const b0 = document.querySelector('[data-act="auto"][data-id="zhou"]');
    let muts = 0, attr = 0;
    const mo = new MutationObserver((list) => { for (const m of list) { muts++; if (m.type === 'attributes') attr++; } });
    mo.observe(body, { childList: true, subtree: true, attributes: true, characterData: true });
    await new Promise(r => setTimeout(r, 1600));
    mo.disconnect();
    const b1 = document.querySelector('[data-act="auto"][data-id="zhou"]');
    return { mutationsIn1600: muts, attrMutations: attr, nodeReplaced: b0 !== b1, countdown: document.querySelector('[data-countdown]')?.textContent ?? null };
  })()`);
  // 连点：快速依次派 4 人同一任务，检查是否全部成功 + 无点空
  const rapid = [];
  for (const [id, mid] of [["li", "quick"], ["mei", "quick"], ["qiang", "quick"], ["wang", "quick"]]) {
    rapid.push(await click(`[data-act="dispatch"][data-id="${id}"][data-mission="${mid}"]`));
    await sleep(90);
  }
  await sleep(700);
  out.steps.rapid = { rapid, missions: await ev(`(() => Object.fromEntries(Object.entries(window.__MOYU__.state.team.colleagues).map(([k,v]) => [k, v.missionId])))()`) };
  await shot("07-rapid-dispatch");

  // ---------- 10. 领奖快照：派单后买升级（工位↑）再领，不应被放大 ----------
  const snap = await ev(`(() => { const s = window.__MOYU__.state; return { meiSnap: s.team.colleagues.mei.rewardSnapshot, station: window.__U.stationIdleScaled(s) }; })()`);
  for (let r = 0; r < 6; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(400);
  await ev(`window.__MOYU__.endMissions()`); await sleep(600);
  const recalculated = await ev(`(() => { const s = JSON.parse(JSON.stringify(window.__MOYU__.state)); const station = window.__U.stationIdleScaled(s); s.team.colleagues.mei.missionId='coffee'; return window.__M.dispatchReward(s, 'mei', station); })()`);
  const claimBtnText = await ev(`document.querySelector('[data-act="claim"][data-id="mei"]')?.textContent.trim() ?? null`);
  const beforeC = (await st()).moyu;
  await click('[data-act="claim"][data-id="mei"]'); await sleep(400);
  out.steps.snapshot = { ...snap, recalculatedAtNewStation: recalculated, claimBtnText, actualGain: Math.round((await st()).moyu - beforeC), stationAfter: await ev(`window.__U.stationIdleScaled(window.__MOYU__.state)`) };

  // ---------- 11. 好感里程碑：0/20/40/60/80/100 各档可观测效果 ----------
  out.steps.favorTiers = await ev(`(() => {
    const base = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const T = window.__M, U = window.__U, P = window.__P;
    const rows = [];
    for (const f of [0, 20, 40, 60, 80, 100]) {
      const c = JSON.parse(JSON.stringify(base));
      c.team.colleagues.zhou.favor = f;
      const c2 = JSON.parse(JSON.stringify(c)); c2.team.colleagues.zhou.missionId = 'chat';
      const now = Date.now(), created = now - 3 * 86400 * 1000;
      rows.push({
        favor: f, tier: T.favorTier(c),
        idle: +U.effectOf(c).idleRate.toFixed(1),
        offlineEff: +P.offlineEfficiency(c, created, now).toFixed(4),
        zhouDispatchChat: T.dispatchReward(c2, 'zhou', U.stationIdleScaled(c2)),
      });
    }
    return rows;
  })()`);

  // ---------- 12. 新天赋 wired 检查（idle_5b 同事挂机 +40%） ----------
  out.steps.talentTeamUlt = await ev(`(() => {
    const base = JSON.parse(JSON.stringify(window.__MOYU__.state));
    const U = window.__U;
    const withUlt = JSON.parse(JSON.stringify(base));
    withUlt.talents.unlocked = [...withUlt.talents.unlocked, 'idle_5b'];
    const noUlt = JSON.parse(JSON.stringify(base));
    noUlt.talents.unlocked = noUlt.talents.unlocked.filter(x => x !== 'idle_5b');
    return { basePoints: base.talents.points, idleNoUlt: U.effectOf(noUlt).idleRate, idleWithUlt: U.effectOf(withUlt).idleRate,
      teamIdleMultValue: window.__T.talentEffects(withUlt.talents).teamIdleMult };
  })()`);

  // ---------- 13. 第一体验：新号早期派遣是否亏本（reset 后重建） ----------
  await ev(`window.__MOYU__.reset()`); await sleep(400);
  await ev(`window.__MOYU__.grant(60000)`); await sleep(250);
  for (let r = 0; r < 3; r++) { await ev(`(() => { for (const c of document.querySelectorAll('.shop-card')) c.click(); return true; })()`); await sleep(60); }
  await sleep(300);
  if (!(await ev(`!document.querySelector('#team').classList.contains('hidden')`))) { await click("#btn-team"); await sleep(400); }
  await click('[data-act="recruit"][data-id="zhou"]'); await sleep(700);
  const earlyIdle = await ev(`(() => { const s = window.__MOYU__.state; return { station: window.__U.stationIdleScaled(s), idle: window.__U.effectOf(s).idleRate, moyu: s.moyu }; })()`);
  const earlyBtns = await ev(`(() => [...document.querySelectorAll('.mate-missions button')].map(b => b.innerText.replace(/\\n+/g,' / ')))()`);
  await click('[data-act="dispatch"][data-id="zhou"][data-mission="quick"]'); await sleep(700);
  const earlyAfter = await ev(`(() => { const s = window.__MOYU__.state; return { idle: window.__U.effectOf(s).idleRate }; })()`);
  out.steps.early = { idleBeforeDispatch: earlyIdle, buttons: earlyBtns, idleAfterDispatch: earlyAfter.idle, lostPerHour: Math.round((earlyIdle.idle - earlyAfter.idle) * 3600) };
  await shot("08-early-dispatch");

  out.meta.errors = cdp.errors; out.meta.consoleBad = cdp.logs.filter((l) => l.startsWith("[error]") || l.startsWith("[warning]"));
  writeFileSync("/tmp/probe-r12b-mgr.json", JSON.stringify(out, null, 2));
  console.log("wrote /tmp/probe-r12b-mgr.json");
}
try { await main(); } catch (e) { out.error = String(e && e.stack ? e.stack : e).slice(0, 2500); console.error("[r12b] FAIL", out.error); try { writeFileSync("/tmp/probe-r12b-mgr.json", JSON.stringify(out, null, 2)); } catch { /* ignore */ } }
try { proc.kill("SIGKILL"); } catch { /* ignore */ }
process.exit(0);
