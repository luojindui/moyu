/**
 * 终验 v0.6.6 复验（数据党）——实机 CDP 探针（必须用 playtest/lib/chrome.mjs）
 * 复核上一轮 6 条 P1 + 新系统面板（成就墙/离线收益倍率/新手价）
 * 产出：playtest/v066-cdp.json + playtest/v066-shots/*.png
 * 运行：PATH=~/.nvm/versions/node/v22.23.2/bin:$PATH node playtest/probe-v066-cdp.mjs
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";

const DEV = "http://127.0.0.1:5173/";
const PROD = "https://luojindui.github.io/moyu/";
const OUT = "playtest/v066-cdp.json";
const SHOT_DIR = "playtest/v066-shots";
mkdirSync(SHOT_DIR, { recursive: true });

const today = () => new Date().toLocaleDateString("sv-SE");
const report = { generatedAt: new Date().toISOString(), snapshot: {}, checks: [], scenarios: {}, defects: [] };
try {
  report.snapshot.head = execSync("git rev-parse --short HEAD", { cwd: process.cwd() }).toString().trim();
  report.snapshot.headTitle = execSync("git log -1 --pretty=%s", { cwd: process.cwd() }).toString().trim();
  report.snapshot.dirty = execSync("git status --porcelain src/ || true", { cwd: process.cwd() }).toString().trim();
} catch { /* ignore */ }

function makeBlob(over = {}) {
  const now = Date.now();
  const T = today();
  return {
    v: 2, moyu: 1e12, totalEarned: 5e12, lifetimeEarned: 5e12,
    levels: { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 },
    savedAt: now - 1500, createdAt: now - 10 * 86_400_000,
    collected: { quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], flavors: Array.from({ length: 45 }, (_, i) => i) },
    daily: null, surviveStreak: 3, patrolSurvives: 20, totalClicks: 3000,
    visits: { date: T, count: 2 }, prestige: 8,
    team: { colleagues: {
      zhou: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      mei: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      qiang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      li: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
      wang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
    } },
    talents: { unlocked: ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"], points: 0, rankGranted: 12, dailyGiftDate: T, overflow: 4 },
    cards: { date: T, offers: [], chosen: "coffee_day", until: now + 3600_000, nextDayGuaranteed: null, dismissed: true, chosenDate: T },
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    energy: { date: T, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: T, played: 0, best: { coffee: 300 } },
    bestIdleRate: 2000, rankIndex: 7, cardsChosenTotal: 5, bestSurviveStreak: 3, bestTalentsUnlocked: 13,
    ...over,
  };
}

const parseMoyu = (s) => { const m = String(s ?? "").replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(万|亿)?/); if (!m) return null; let v = parseFloat(m[1]); if (m[2] === "万") v *= 1e4; else if (m[2] === "亿") v *= 1e8; return v; };
const fmtTol = (v) => { const a = Math.abs(v); if (a < 1e4) return 0.051; if (a < 1e8) return 51; return 5.1e5; };
function addCheck(panel, item, shown, expected, opts = {}) {
  const tol = opts.tol ?? (typeof expected === "number" ? fmtTol(expected) : 0);
  const shownNum = typeof shown === "number" ? shown : parseMoyu(shown);
  const ok = opts.ok !== undefined
    ? !!opts.ok
    : typeof expected === "number"
      ? shownNum !== null && Math.abs(shownNum - expected) <= tol
      : String(shown) === String(expected);
  report.checks.push({ panel, item, shown, expected: opts.expectedStr !== undefined ? opts.expectedStr : expected, engine: opts.engine, note: opts.note, ok });
  return ok;
}

async function shot(cdp, name) {
  try {
    const r = await cdp.send("Page.captureScreenshot", { format: "png" });
    const p = `${SHOT_DIR}/${name}.png`;
    writeFileSync(p, Buffer.from(r.data, "base64"));
    return p;
  } catch (e) { return "shot-error:" + String(e).slice(0, 80); }
}

async function waitReady(cdp, allowBootFail = false) {
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length, hasMoyu: !!window.__MOYU__, boot: document.querySelector('.boot-error') ? document.querySelector('.boot-error').textContent : null }))()`);
    if (st.boot) { if (allowBootFail) return st; throw new Error("boot error: " + st.boot); }
    if (st.ready !== "loading" && st.cards >= 9 && st.hasMoyu) return st;
    await sleep(100);
  }
  throw new Error("not ready");
}

async function seedAndReload(cdp, blob, { prod = false } = {}) {
  await cdp.ev(`(() => {
    const proto = Storage.prototype; const orig = proto.setItem;
    proto.setItem = function (k, v) { if (k === 'moyu-save' && this === localStorage) return; return orig.call(this, k, v); };
    orig.call(localStorage, 'moyu-save', ${JSON.stringify(JSON.stringify(blob))});
    if (${prod} && typeof sessionStorage !== 'undefined') sessionStorage.clear();
    return true;
  })()`);
  await cdp.send("Page.reload", { ignoreCache: false });
  if (prod) {
    for (let i = 0; i < 240; i++) {
      const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length }))()`);
      if (st.ready !== "loading" && st.cards >= 9) return;
      await sleep(150);
    }
    return;
  }
  await waitReady(cdp);
}

const run = async () => {
  await runChrome(async ({ port }) => {
    const cdp = await connect(port);
    await cdp.send("Page.enable");
    try {
      await cdp.send("Page.navigate", { url: DEV });
      const boot = await waitReady(cdp, true);
      if (boot.boot) { report.scenarios.bootFailure = boot.boot; return; }
      report.checks.push({ panel: "启动", item: "dev 启动无 boot 错误", shown: "ok", expected: "ok", ok: true });
      await cdp.ev(`localStorage.clear(); sessionStorage.clear(); true`);
      await sleep(300);

      // ═══ S1：富档面板复核（①小队 ②派遣净收益 ⑥天赋行 成就墙 工位 商店 HUD）═══
      await seedAndReload(cdp, makeBlob());
      await sleep(700);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
      await sleep(400);
      const s1 = await cdp.ev(`(async () => {
        const U = await import('/src/engine/upgrades.ts');
        const TM = await import('/src/engine/team.ts');
        const TL = await import('/src/engine/talents.ts');
        const F = await import('/src/engine/format.ts');
        const PR = await import('/src/engine/prestige.ts');
        const AC = await import('/src/engine/achievements.ts');
        const DC = await import('/src/engine/decor.ts');
        const S = window.__MOYU__.state;
        const q = (s) => document.querySelector(s);
        const t = (s) => q(s)?.textContent ?? null;
        const bd = U.teamIdleBreakdown(S);
        const station = U.stationIdleScaled(S);
        const mult = PR.prestigeMultiplier(S.prestige) * U.collectionBonus(S);
        const rawStation = U.stationIdleOf(S) * mult;
        const fav = TM.favorBonuses(S).idleMult;
        const tm = TL.talentEffects(S.talents).teamIdleMult;
        // HUD
        const hud = { moyu: t('#hud-moyu'), click: t('#hud-click'), idle: t('#hud-idle'), rank: t('#hud-rank'), card: t('#hud-card'), streak: t('#hud-streak') };
        const TI = await import('/src/engine/titles.ts');
        const A2 = await import('/src/engine/actions.ts');
        const effIdle = U.effectOf(S).idleRate;
        const rank = TI.rankFor(S.lifetimeEarned);
        const shortName = rank.next ? rank.current.replace(/^带薪/, '').replace(/^摸鱼/, '') + ' ' + (rank.progress * 100).toFixed(0) + '%' : rank.current.replace(/^带薪/, '').replace(/^摸鱼/, '');
        const hudExp = { moyu: F.formatMoyu(S.moyu), click: F.formatMoyu(A2.clickPowerOf(S)), idle: F.formatMoyu(effIdle), rank: shortName, streak: S.prestige > 0 && PR.canPrestige(S) ? '♻ 转生×' + S.prestige + '（可晋升）' : null };
        // 商店
        const shop = [...document.querySelectorAll('.shop-card')].map((el) => ({ id: el.dataset.upgrade, price: el.querySelector('.shop-cost b').textContent, next: el.querySelector('.shop-next').textContent, level: el.querySelector('.shop-level').textContent }));
        const shopExp = U.UPGRADES.map((u) => { const lv = S.levels[u.id] ?? 0; const m = U.marginalEffect(u.id, lv); return { id: u.id, price: F.formatMoyu(U.costOf(u.id, lv)), next: (m.clickPower > 0 ? '+' + F.formatMoyu(m.clickPower) + ' 点击力' : '+' + F.formatMoyu(m.idleRate) + '/秒'), level: lv > 0 ? 'Lv.' + lv : '' }; });
        // 小队面板
        q('#btn-team').click();
        await new Promise((r) => setTimeout(r, 600));
        const summary = t('#team-body .team-summary');
        const mates = [...document.querySelectorAll('#team-body .mate:not(.locked)')].map((el) => ({
          name: el.querySelector('.mate-name').textContent.trim(),
          skill: el.querySelector('.mate-skill').textContent.replace(/\\s+/g, ' ').trim(),
          missions: [...el.querySelectorAll('button[data-act="dispatch"]')].map((b) => ({ id: b.dataset.id, mission: b.dataset.mission, text: b.textContent.replace(/\\s+/g, ' ').trim() })),
          buttons: [...el.querySelectorAll('button[data-act]')].map((b) => ({ act: b.dataset.act, id: b.dataset.id, text: b.textContent.replace(/\\s+/g, ' ').trim() })),
        }));
        // 每人贡献（面板公式）vs 引擎
        const perCol = TM.COLLEAGUES.map((def) => {
          const cur = S.team.colleagues[def.id];
          const away = cur.missionId !== null && Date.now() < cur.endsAt;
          const af = away ? TM.AWAY_IDLE_FACTOR : 1;
          const ui = def.idlePerLevel * cur.level * af * mult * fav * tm + rawStation * def.sharePerLevel * cur.level * af * tm;
          return { id: def.id, ui: Math.round(ui), engine: ui };
        });
        // 派遣净收益（页面公式 = team-panel 现行公式）vs 引擎真实离岗损失
        const dispatches = [];
        for (const def of TM.COLLEAGUES) {
          const cur = S.team.colleagues[def.id];
          if (!cur || cur.missionId !== null) continue;
          for (const m of TM.MISSIONS) {
            const probe = { ...S, team: { colleagues: { ...S.team.colleagues, [def.id]: { ...cur, missionId: m.id } } } };
            const est = TM.dispatchReward(probe, def.id, station);
            const perHour = est / (TM.missionSecondsFor(def.id, m.id) / 3600);
            const uiLoss = (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level) * 0.15 * 3600;
            const awayProbe = { ...S, team: { colleagues: { ...S.team.colleagues, [def.id]: { ...cur, missionId: m.id, startedAt: Date.now(), endsAt: Date.now() + m.seconds * 1000 } } } };
            const homeIdle = U.effectOf(S).idleRate;
            const awayIdle = U.effectOf(awayProbe).idleRate;
            const contribution = def.idlePerLevel * cur.level * mult * fav * tm + rawStation * def.sharePerLevel * cur.level * tm;
            const engineLoss = contribution * (1 - TM.AWAY_IDLE_FACTOR) * 3600;
            dispatches.push({
              colleague: def.id, mission: m.id, est, uiNet: perHour - uiLoss, engineNet: perHour - engineLoss,
              e2eNet: perHour - (homeIdle - awayIdle) * 3600,
              deltaIdle: homeIdle - awayIdle,
              signFlip: Math.sign(perHour - uiLoss) !== Math.sign(perHour - engineLoss),
            });
          }
        }
        // 天赋页
        q('#tab-talents').click();
        await new Promise((r) => setTimeout(r, 550));
        const talentProg = [...document.querySelectorAll('#team-body .talent-progress div')].map((x) => x.textContent.trim());
        const eff = TL.talentEffects(S.talents);
        const conv = U.conversionBonus(S);
        const clickPct = eff.clickToIdleStep > 0 ? Math.min(0.35, Math.floor(S.totalClicks / 300) * 0.01) : (eff.clickUltBase > 0 ? Math.min(0.32, eff.clickUltBase + Math.floor(S.totalClicks / 1000) * eff.clickUltPerK) : 0);
        const survivePct = eff.surviveToIdle ? Math.min(0.3, S.patrolSurvives * 0.01) : 0;
        // 工位页
        q('#tab-decor').click();
        await new Promise((r) => setTimeout(r, 550));
        const decorSummary = t('#team-body .team-summary');
        const dEff = DC.decorEffects(S);
        q('#team-close').click();
        // 成就墙 + 数据统计（日报面板）
        q('#btn-journal').click();
        await new Promise((r) => setTimeout(r, 800));
        const ach = {
          summary: t('#ach-summary'),
          cats: [...document.querySelectorAll('#ach-categories .ach-cat')].map((x) => x.textContent.trim()),
          items: [...document.querySelectorAll('#ach-list .ach-item')].map((el) => ({ name: el.querySelector('.ach-name').textContent.trim(), count: el.querySelector('.ach-count').textContent.trim(), done: el.classList.contains('done') })),
        };
        const achExp = {
          summary: AC.achPoints(S) + '/' + AC.ACHIEVEMENTS.length + ' · Lv.' + AC.achLevel(S),
          cats: AC.achByCategory(S).map((c) => AC.ACH_CATEGORY_NAME[c.cat] + ' ' + c.done + '/' + c.total),
          items: AC.ACHIEVEMENTS.map((a) => { const p = a.progress(S); const ok = p >= a.target; return { name: a.name, count: ok ? '✓' : Math.floor(Math.min(p, a.target)) + '/' + a.target }; }),
        };
        const stats = [...document.querySelectorAll('#stats-list .stat-row')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim());
        const prestigeBtn = t('#prestige-btn');
        q('#journal-close').click();
        const temp = document.querySelector('.ach-item');
        void temp;
        return {
          state: { moyu: S.moyu, idle: U.effectOf(S).idleRate, click: (await import('/src/engine/actions.ts')).clickPowerOf(S), teamTotal: bd.total, station, prestige: S.prestige, bestIdleRate: S.bestIdleRate, rankIndex: S.rankIndex, cardsChosenTotal: S.cardsChosenTotal, bestSurviveStreak: S.bestSurviveStreak, bestTalentsUnlocked: S.bestTalentsUnlocked },
          hud, hudExp, shop, shopExp, summary, mates, perCol, dispatches, talentProg, eff: { surviveToIdle: eff.surviveToIdle, clickToIdleStep: eff.clickToIdleStep, clickUltBase: eff.clickUltBase }, conv, clickPct, survivePct, decorSummary, dEff, ach, achExp, stats, prestigeBtn,
        };
      })()`);
      report.scenarios.S1 = s1;

      // ── ① 小队总挂机 ──
      addCheck("①小队面板", "小队挂机 +X/秒 = teamIdleBreakdown.total", parseMoyu((s1.summary ?? "").split("小队挂机 +")[1] ?? ""), s1.state.teamTotal, { engine: { breakdown: s1.state.teamTotal, station: s1.state.station } });
      // ① 每人贡献
      for (const pc of s1.perCol) {
        const mate = s1.mates.find((m) => m.name.includes({ zhou: "老周", mei: "小美", qiang: "强哥", li: "小李", wang: "王师傅" }[pc.id]));
        if (!mate) { addCheck("①小队面板", `${pc.id} 卡片缺失`, "missing", "found"); continue; }
        const shownVal = parseMoyu((mate.skill.match(/挂机 \+([^/]+)\/秒/) || [])[1] ?? "");
        addCheck("①小队面板", `${pc.id} 挂机/秒（面板 Math.round + formatMoyu 粒度）`, shownVal, Math.round(pc.engine), { tol: fmtTol(Math.round(pc.engine)) + 0.6, engine: pc });
      }
      // ② 派遣净收益
      const domDisp = s1.mates.flatMap((m) => m.missions.map((x) => ({ ...x, domNet: parseMoyu((x.text.match(/净 ([+-]?[^/]+)\/h/) || [])[1] ?? "") })));
      const netRows = s1.dispatches.map((d) => {
        const dom = domDisp.find((x) => x.id === d.colleague && x.mission === d.mission);
        return { ...d, domNet: dom ? dom.domNet : null };
      });
      const netBad = netRows.filter((r) => r.domNet === null || Math.sign(r.domNet) !== Math.sign(r.e2eNet) || Math.abs(r.domNet - r.e2eNet) > Math.max(2, Math.abs(r.e2eNet) * 0.02));
      const netFlips = netRows.filter((r) => r.domNet !== null && Math.sign(r.domNet) !== Math.sign(r.e2eNet));
      report.scenarios.dispatchNet = { total: netRows.length, bad: netBad.length, flips: netFlips.length, examples: netFlips.slice(0, 4), rows: netRows };
      report.checks.push({
        panel: "②派遣净收益", item: `18 个任务按钮「净 +X/h」= 引擎真实净（flips=${netFlips.length}）`,
        shown: `${netRows.length - netBad.length}/${netRows.length} 一致`, expected: "全部一致", engine: { flips: netFlips.slice(0, 4), e2eRows: netRows.slice(0, 3) }, ok: netBad.length === 0,
      });
      if (netFlips.length > 0) report.defects.push({ level: "P1", where: "src/ui/team-panel.ts 净收益公式", issue: `仍有符号翻转（端到端口径 = 奖励/小时 − 挂机率前后差×3600）：${netFlips.slice(0, 3).map((f) => `${f.colleague}/${f.mission} 面板 ${Math.round(f.domNet)}/h vs 引擎 ${Math.round(f.e2eNet)}/h`).join("；")}` });
      // ⑥ 天赋转化
      addCheck("⑥天赋面板", "点击转化行显示", s1.talentProg[0], "", { expectedStr: "包含「点击转化」", ok: String(s1.talentProg[0] ?? "").includes("点击转化") });
      const surviveLine = s1.talentProg.find((x) => x.includes("安然转化")) ?? "";
      const surviveShown = parseMoyu((surviveLine.match(/\+([\d.]+)%/) || [])[1] ?? "");
      report.checks.push({
        panel: "⑥天赋面板", item: "未解锁 event_5a 时是否仍显示「安然转化 +X%」",
        shown: surviveLine, expected: "不应显示非 0 加成（实际 conversionBonus 该段=0）",
        expectedStr: "不显示/显示0", engine: { surviveToIdle: s1.eff.surviveToIdle, conv: s1.conv, survivePctEngine: s1.survivePct, uiShown: surviveShown },
        note: "UI 恒显示进度行，实际 conversionBonus 不含该段", ok: !(s1.eff.surviveToIdle === false && (surviveShown ?? 0) > 0),
      });
      // 成就墙
      addCheck("成就墙", "汇总 22 条 + 等级", s1.ach.summary, s1.achExp.summary, { expectedStr: s1.achExp.summary });
      addCheck("成就墙", "分类进度 10 行", s1.ach.cats.length, 10, { tol: 0 });
      const catBad = s1.ach.cats.filter((c, i) => c !== s1.achExp.cats[i]);
      report.checks.push({ panel: "成就墙", item: "10 个分类进度文本 = 引擎 achByCategory", shown: `${s1.ach.cats.length - catBad.length}/10`, expected: "10/10", engine: catBad, ok: catBad.length === 0 });
      addCheck("成就墙", "条目数 22", s1.ach.items.length, 22, { tol: 0 });
      const cleanName = (n) => String(n).replace(/（已完成）/g, '').trim();
      const achMismatch = s1.ach.items.filter((it, i) => cleanName(it.name) !== s1.achExp.items[i]?.name || it.count !== s1.achExp.items[i]?.count);
      report.checks.push({ panel: "成就墙", item: "22 条进度/勾选 = 引擎 achDone/progress", shown: `${s1.ach.items.length - achMismatch.length}/${s1.ach.items.length}`, expected: "22/22", engine: achMismatch.slice(0, 4), ok: achMismatch.length === 0 });
      if (achMismatch.length) report.defects.push({ level: "P2", where: "src/ui/journal.ts 成就墙", issue: `成就进度显示与引擎不符 ${achMismatch.length} 条：${JSON.stringify(achMismatch.slice(0, 3))}` });
      // 工位离线收益倍率
      const domIncome = parseMoyu((s1.decorSummary.match(/离线收益 ×([\d.]+)/) || [])[1] ?? "");
      addCheck("工位面板", "离线收益倍率 ×N.NN", domIncome, s1.dEff.offlineIncomeMult, { tol: 0.006, engine: s1.dEff.offlineIncomeMult });
      // HUD/商店冒烟
      addCheck("HUD", "摸鱼值", s1.hud.moyu, s1.hudExp.moyu, { expectedStr: s1.hudExp.moyu });
      addCheck("HUD", "点击力", s1.hud.click, s1.hudExp.click, { expectedStr: s1.hudExp.click });
      addCheck("HUD", "挂机/秒", s1.hud.idle, s1.hudExp.idle, { expectedStr: s1.hudExp.idle });
      addCheck("HUD", "段位+进度", s1.hud.rank, s1.hudExp.rank, { expectedStr: s1.hudExp.rank });
      const shopBad = s1.shop.filter((c) => { const e = s1.shopExp.find((x) => x.id === c.id); return !e || c.price !== e.price || c.level !== e.level; });
      report.checks.push({ panel: "商店", item: "9 档价格/等级 vs costOf", shown: `${s1.shop.length - shopBad.length}/9`, expected: "9/9", engine: shopBad, ok: shopBad.length === 0 });
      report.scenarios.S1shots = [await shot(cdp, "s1-journal-ach")];

      // ═══ S2：③ focus 刷新往返 ═══
      const T = today();
      await seedAndReload(cdp, makeBlob({
        moyu: 1e7, totalEarned: 1e7, lifetimeEarned: 1e7, levels: { coffee: 10 }, prestige: 0,
        collected: { quotes: [], flavors: [] }, team: { colleagues: {} }, decor: [],
        talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: T, overflow: 0 },
        cards: { date: T, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
        energy: { date: T, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
        surviveStreak: 0, patrolSurvives: 0, savedAt: Date.now() - 1000,
      }));
      await sleep(600);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
      const focusLive = await cdp.ev(`(async () => {
        const A = await import('/src/engine/actions.ts'); const U = await import('/src/engine/upgrades.ts');
        document.getElementById('btn-team').click(); await new Promise((r) => setTimeout(r, 400));
        document.getElementById('tab-decor').click(); await new Promise((r) => setTimeout(r, 400));
        const row = document.querySelector('#team-body .talent.row-tap[data-act="energy"][data-id="focus"]');
        const btn = row && row.querySelector('button[data-act="energy"]');
        if (btn && !btn.disabled) btn.click(); else row.click();
        await new Promise((r) => setTimeout(r, 500));
        const S = window.__MOYU__.state;
        return { click: A.clickPowerOf(S), idle: U.effectOf(S).idleRate, boost: S.energy.boosted, hudClick: document.getElementById('hud-click').textContent };
      })()`);
      await cdp.ev(`document.getElementById('team-close').click(); window.__MOYU__.saveNow(); true`);
      await sleep(250);
      await cdp.send("Page.reload", { ignoreCache: false });
      await waitReady(cdp);
      await sleep(600);
      await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
      const focusAfter = await cdp.ev(`(async () => {
        const A = await import('/src/engine/actions.ts'); const U = await import('/src/engine/upgrades.ts');
        const S = window.__MOYU__.state;
        return { click: A.clickPowerOf(S), idle: U.effectOf(S).idleRate, boost: S.energy.boosted, hudClick: document.getElementById('hud-click').textContent };
      })()`);
      report.scenarios.focus = { focusLive, focusAfter };
      addCheck("③精力focus", "实时 boost ×2 / ×1.08", `${focusLive.boost.clickMult}|${focusLive.boost.idleMult}`, null, { expectedStr: "2|1.08", ok: focusLive.boost.clickMult === 2 && Math.abs(focusLive.boost.idleMult - 1.08) < 1e-9 });
      addCheck("③精力focus", "刷新后 boost ×2 / ×1.08", `${focusAfter.boost.clickMult}|${focusAfter.boost.idleMult}`, null, { expectedStr: "2|1.08", ok: focusAfter.boost.clickMult === 2 && Math.abs(focusAfter.boost.idleMult - 1.08) < 1e-9 });
      addCheck("③精力focus", "刷新后 HUD 点击力与刷新前一致", focusAfter.hudClick, focusLive.hudClick, { expectedStr: focusLive.hudClick });

      // ═══ S3：④⑤ 离线面板文案/到账/回归效率 ═══
      const offlineRows = [];
      const cases = [
        { name: "1h（非封顶）", elapsed: 3600, createdAgo: 10 * 86400, visits: 2 },
        { name: "100h（12h 封顶）", elapsed: 100 * 3600, createdAgo: 10 * 86400, visits: 2 },
        { name: "8 天（24h 封顶 + ≥7 天回归）", elapsed: 8 * 86400, createdAgo: 20 * 86400, visits: 2 },
        { name: "31 天（48h 封顶 + ≥7 天回归）", elapsed: 31 * 86400, createdAgo: 60 * 86400, visits: 2 },
      ];
      for (const c of cases) {
        const now = Date.now();
        const T2 = today();
        await seedAndReload(cdp, {
          v: 2, moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000, levels: { phone: 10 },
          savedAt: now - c.elapsed * 1000, createdAt: now - c.createdAgo * 1000,
          collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
          visits: { date: T2, count: c.visits }, prestige: 0, team: { colleagues: {} },
          talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: T2, overflow: 0 },
          cards: { date: T2, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
          decor: ["rug", "chair", "catbed"], energy: { date: T2, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
          arcade: { date: T2, played: 0, best: {} },
        });
        await sleep(600);
        const row = await cdp.ev(`(async () => {
          const PG = await import('/src/engine/progression.ts');
          const SA = await import('/src/engine/save.ts');
          const OF = await import('/src/engine/offline.ts');
          const U = await import('/src/engine/upgrades.ts');
          const DC = await import('/src/engine/decor.ts');
          const RS = await import('/src/engine/resume.ts');
          const F = await import('/src/engine/format.ts');
          const raw = localStorage.getItem('moyu-save');
          const blob = JSON.parse(raw);
          const adapter = { getItem: (k) => (k === 'moyu-save' ? raw : null), setItem: () => {}, removeItem: () => {} };
          const restored = SA.restore(adapter, Date.now());
          let pre = PG.ensureVisits(restored.state, Date.now());
          const nowMs = Date.now();
          const elapsed = (nowMs - blob.savedAt) / 1000;
          const rate = PG.offlineEfficiency(pre, restored.createdAt, nowMs);
          const rr = RS.settleReturn(pre, nowMs - elapsed * 1000, nowMs, rate);
          const station = U.stationIdleScaled(pre);
          const teamPart = U.effectOf(pre).idleRate - station;
          const income = DC.decorEffects(pre).offlineIncomeMult;
          const implied = rr.applied > 0 ? rr.earned / ((station + teamPart * 0.5) * rr.applied * income) : 0;
          const w = document.getElementById('welcome');
          return {
            welcome: { hidden: w.classList.contains('hidden'), time: document.getElementById('welcome-time').textContent, gain: document.getElementById('welcome-gain').textContent, rule: document.getElementById('welcome-rule').textContent },
            engine: { elapsed, applied: rr.applied, earned: rr.earned, panelRate: rate, impliedRate: implied, cap: OF.capForElapsed(elapsed), incomeMult: income, capHours: Math.round(OF.capForElapsed(elapsed) / 3600) },
            expectGain: F.formatMoyu(rr.earned),
          };
        })()`);
        offlineRows.push({ case: c.name, ...row });
        addCheck("④离线", `${c.name} 到账金额 = 引擎 settleReturn`, parseMoyu(row.welcome.gain), row.engine.earned, { engine: row.engine });
        // 封顶文案：非封顶显示 12h；封顶显示实际小时
        const rule = String(row.welcome.rule);
        const expectCapHours = c.elapsed < 12 * 3600 ? 12 : (c.elapsed >= 30 * 86400 ? 48 : c.elapsed >= 7 * 86400 ? 24 : 12);
        const textOk = c.elapsed < row.engine.cap
          ? rule.includes(`${12} 小时封顶`) // 日常 12h
          : rule.includes(`已按上限结算 ${Math.round(Math.min(c.elapsed, expectCapHours * 3600) / 3600)} 小时`);
        report.checks.push({ panel: "④离线", item: `${c.name} 封顶文案（引擎 cap=${row.engine.capHours}h）`, shown: rule, expected: c.elapsed < row.engine.cap ? "…12 小时封顶" : `…已按上限结算 ${expectCapHours} 小时`, engine: row.engine, ok: textOk });
        if (!textOk) report.defects.push({ level: "P1", where: "src/ui/welcome.ts 封顶文案", issue: `${c.name} 显示「${rule}」，引擎 cap=${row.engine.capHours}h` });
        // ⑤ 回归效率：panelRate vs impliedRate
        if (c.elapsed >= 7 * 86400) {
          const diff = row.engine.impliedRate / row.engine.panelRate - 1;
          report.checks.push({
            panel: "⑤离线回归", item: `${c.name} 面板效率 vs 实际结算效率`,
            shown: `面板 ${(row.engine.panelRate * 100).toFixed(0)}% / 实际 ${(row.engine.impliedRate * 100).toFixed(0)}%`,
            expected: "两者一致", expectedStr: "两者一致",
            engine: { panelRate: row.engine.panelRate, impliedRate: row.engine.impliedRate, extraPct: diff * 100, earned: row.engine.earned },
            note: "resume.settleReturn 对 ≥7 天强制 rate=1，绕过硬上限", ok: Math.abs(diff) < 0.005,
          });
          if (Math.abs(diff) >= 0.005) report.defects.push({ level: "P1", where: "src/engine/resume.ts + src/ui/welcome.ts", issue: `${c.name}：面板写 ${(row.engine.panelRate * 100).toFixed(0)}%，实际按 ${(row.engine.impliedRate * 100).toFixed(0)}% 结算（多 ${(diff * 100).toFixed(1)}%）；resume.settleReturn 仍对 ≥7 天强制 rate=1` });
        }
        if (c.name.startsWith("1h")) report.scenarios.S3shot = await shot(cdp, "s3-welcome-1h");
        await cdp.ev(`document.getElementById('welcome').classList.add('hidden'); window.__MOYU__.saveNow(); true`);
      }
      report.scenarios.offline = offlineRows;

      // ═══ S4：新系统（新手首位同事价 / 任务链文案）═══
      const T3 = today();
      await seedAndReload(cdp, {
        v: 2, moyu: 2000, totalEarned: 2000, lifetimeEarned: 2000, levels: {},
        savedAt: Date.now() - 500, createdAt: Date.now() - 500,
        collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
        visits: { date: T3, count: 1 }, prestige: 0, team: { colleagues: {} },
        talents: { unlocked: [], points: 0, rankGranted: -1, dailyGiftDate: "", overflow: 0 },
        cards: { date: "", offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: false, chosenDate: "" },
        decor: [], energy: { date: T3, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
        arcade: { date: T3, played: 0, best: {} },
      });
      await sleep(700);
      const s4 = await cdp.ev(`(async () => {
        const TM = await import('/src/engine/team.ts');
        const S = window.__MOYU__.state;
        const q = (s) => document.querySelector(s);
        q('#btn-team').click();
        await new Promise((r) => setTimeout(r, 600));
        const locked = [...document.querySelectorAll('#team-body .mate.locked')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim());
        const firstBtn = q('#team-body .mate.locked button[data-act="recruit"]');
        const recruitText = firstBtn ? firstBtn.textContent.replace(/\\s+/g, ' ').trim() : null;
        q('#team-close').click();
        const questText = q('#quest-text') ? q('#quest-text').textContent.trim() : null;
        return { recruitText, expectPrice: TM.recruitCostOf(S, 'zhou'), lockedCount: locked.length, questText, onboardingClass: document.body.className };
      })()`);
      report.scenarios.newbie = s4;
      addCheck("新手引导", "第 1 位同事招募价 = 1,500", parseMoyu(s4.recruitText), s4.expectPrice, { engine: { recruitCostOf: s4.expectPrice }, note: `按钮文案「${s4.recruitText}」` });
      report.checks.push({ panel: "新手引导", item: "目标链步数（quest 文本存在）", shown: s4.questText, expected: "非空", ok: !!s4.questText });
      report.scenarios.S4shot = await shot(cdp, "s4-newbie-team");

      // ═══ S5：线上 v0.6.6 ═══
      await cdp.send("Page.navigate", { url: PROD });
      for (let i = 0; i < 240; i++) {
        const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length, boot: !!document.querySelector('.boot-error') }))()`);
        if (st.ready !== "loading" && (st.cards >= 9 || st.boot)) break;
        await sleep(150);
      }
      await sleep(900);
      const prodBase = await cdp.ev(`(() => ({
        hasDebug: !!window.__MOYU__, cards: document.querySelectorAll('.shop-card').length,
        hud: { moyu: document.getElementById('hud-moyu').textContent, click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent, rank: document.getElementById('hud-rank').textContent },
        boot: !!document.querySelector('.boot-error'),
      }))()`);
      const prodVer = await cdp.ev(`(async () => {
        const J = document.getElementById('journal'); J.classList.remove('hidden');
        await new Promise((r) => setTimeout(r, 800));
        const v = document.getElementById('about-version').textContent;
        const ach = document.getElementById('ach-summary') ? document.getElementById('ach-summary').textContent : null;
        const achItems = document.querySelectorAll('#ach-list .ach-item').length;
        J.classList.add('hidden');
        return { version: v, achSummary: ach, achItems };
      })()`);
      // 线上离线：100h（12h 封顶）与 8 天（24h）
      const prodOffline = [];
      for (const c of [{ name: "100h", elapsed: 100 * 3600 }, { name: "8d", elapsed: 8 * 86400 }]) {
        const now = Date.now();
        const T4 = today();
        await seedAndReload(cdp, {
          v: 2, moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000, levels: { phone: 10 },
          savedAt: now - c.elapsed * 1000, createdAt: now - 20 * 86400_000,
          collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
          visits: { date: T4, count: 1 }, prestige: 0, team: { colleagues: {} },
          talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: T4, overflow: 0 },
          cards: { date: T4, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
          decor: [], energy: { date: T4, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
          arcade: { date: T4, played: 0, best: {} },
        }, { prod: true });
        await sleep(900);
        const ui = await cdp.ev(`(() => ({ hidden: document.getElementById('welcome').classList.contains('hidden'), time: document.getElementById('welcome-time').textContent, gain: document.getElementById('welcome-gain').textContent, rule: document.getElementById('welcome-rule').textContent, moyu: document.getElementById('hud-moyu').textContent }))()`);
        prodOffline.push({ case: c.name, ...ui });
      }
      report.scenarios.prod = { base: prodBase, ver: prodVer, offline: prodOffline };
      addCheck("线上v0.6.6", "生产包不暴露 __MOYU__", String(prodBase.hasDebug), "false", { expectedStr: "false" });
      addCheck("线上v0.6.6", "版本 = v0.6.6", prodVer.version, "v0.6.6 · 2026-11-27", { expectedStr: "v0.6.6 · 2026-11-27" });
      addCheck("线上v0.6.6", "9 档商店渲染", prodBase.cards, 9, { tol: 0 });
      addCheck("线上v0.6.6", "成就墙 22 条已上线", prodVer.achItems, 22, { tol: 0 });
      addCheck("线上v0.6.6", "初始 HUD 点击/挂机", `${prodBase.hud.click}|${prodBase.hud.idle}`, "1|0.2", { expectedStr: "1|0.2" });
      for (const o of prodOffline) {
        const expectTxt = o.case === "100h" ? "已按上限结算 12 小时" : "已按上限结算 24 小时";
        addCheck("线上v0.6.6", `离线 ${o.case} 封顶文案`, o.rule, expectTxt, { expectedStr: `包含「${expectTxt}」`, ok: String(o.rule).includes(expectTxt) });
      }
      // 反推线上 8 天档实际结算效率：100h=12h×0.9, 8d=24h×? → ratio=(24/12)×(?/0.9)
      const g100 = parseMoyu(prodOffline.find((o) => o.case === "100h")?.gain ?? "");
      const g8d = parseMoyu(prodOffline.find((o) => o.case === "8d")?.gain ?? "");
      if (g100 && g8d) {
        const implied8d = (g8d / g100) / 2 * 0.9;
        addCheck("线上v0.6.6", "8 天档实际结算效率（100h 档 12h×0.9 反推）", implied8d, 1, { tol: 0.02, engine: { g100, g8d, implied8d }, note: "面板写 90%，反推实际 100% → ⑤ 在线上同样未修" });
        if (Math.abs(implied8d - 1) < 0.02) {
          const rule = prodOffline.find((o) => o.case === "8d")?.rule ?? "";
          report.defects.push({ level: "P1", where: "线上 v0.6.6 欢迎面板（8 天回归）", issue: `面板「${rule}」，但按 100h 档反推实际按 ${(implied8d * 100).toFixed(1)}% 结算 → ≥7 天回归仍绕 95% 上限（线上同样命中）` });
        }
      }
      report.scenarios.S5shot = await shot(cdp, "s5-prod-offline");
    } catch (e) {
      report.scenarios.error = String(e && e.stack ? e.stack : e).slice(0, 1500);
    }
    try { await cdp.send("Browser.close"); } catch { /* ignore */ }
    cdp.close();
  }, { timeoutMs: 240_000 });
  report.summary = { total: report.checks.length, pass: report.checks.filter((c) => c.ok).length, fail: report.checks.filter((c) => !c.ok).length };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`[v066] ${report.summary.pass}/${report.summary.total} pass, ${report.summary.fail} fail`);
  if (report.scenarios.error) console.log("[v066] error:", report.scenarios.error);
};

run().catch((e) => { console.error("[v066] fatal", e); writeFileSync(OUT, JSON.stringify(report, null, 2)); process.exit(1); });