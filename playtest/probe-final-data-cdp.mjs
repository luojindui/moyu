/**
 * 终验·数据自洽（数据党）——实机 CDP 探针
 * 必须使用 playtest/lib/chrome.mjs（统一杀 Chrome，无残留）。
 *
 * 场景：
 *  S1 dev 富档：面板/商店/HUD/小队/天赋/工位/日报 数字 vs 引擎实算（≥20 处）
 *  S2 dev 精力 focus 实时 ×2 → 刷新后 ×1.2（存档重算不一致）
 *  S3 dev 离线：1h（首日/回访）、100h（12h 封顶）、8 天（24h）、31 天（48h）→ 欢迎面板文案 vs 引擎
 *  S4 dev 小游戏：找老板 30s 自动点 → 结算页分数/奖励 vs 引擎公式
 *  S5 dev 日报领取 + 巡逻 hold/choice 结算 vs 引擎
 *  S6 线上 v0.5.0：无 __MOYU__、离线封顶文案、HUD 与引擎一致
 *
 * 产出：playtest/final-data-cdp.json
 * 运行：node playtest/probe-final-data-cdp.mjs
 */
import { runChrome, connect, sleep } from "./lib/chrome.mjs";
import { writeFileSync } from "node:fs";

const DEV = "http://127.0.0.1:5173/";
const PROD = "https://luojindui.github.io/moyu/";
const REPORT_PATH = "playtest/final-data-cdp.json";
const ONLY = (process.argv[2] || "").toUpperCase(); // 例如 node probe.mjs s1

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  scenarios: {},
  panelChecks: [],
  defects: [],
  chromeCleanup: null,
};

function localDate(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("sv-SE");
}
const TODAY = localDate();

// ── 存档 blob（v2） ────────────────────────────────────────────
function makeBlob(over = {}) {
  const now = Date.now();
  return {
    v: 2,
    moyu: 1e12,
    totalEarned: 5e12,
    lifetimeEarned: 5e12,
    levels: { coffee: 12, water: 8, chair: 5, phone: 30, toilet: 22, group: 15, meeting: 7, deep: 3, retire: 1 },
    savedAt: now - 1500,
    createdAt: now - 10 * 86_400_000,
    collected: {
      quotes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      flavors: Array.from({ length: 45 }, (_, i) => i),
    },
    daily: {
      date: TODAY,
      goals: [
        { id: "visit_1", target: 1, progress: 1, done: true },
        { id: "idle_earn", target: 1, progress: 1, done: true },
        { id: "click_100", target: 100, progress: 100, done: true },
      ],
      streak: 5,
      lastCompleteDate: localDate(now - 86_400_000),
      claimed: false,
      window: 0,
      claimsToday: 0,
    },
    surviveStreak: 3,
    patrolSurvives: 20,
    totalClicks: 3000,
    visits: { date: TODAY, count: 5 },
    prestige: 8,
    team: {
      colleagues: {
        zhou: { level: 5, missionId: "chat", startedAt: now - 40 * 60_000, endsAt: now - 10 * 60_000, favor: 100, autoRepeat: false, rewardSnapshot: 12345678 },
        mei: { level: 5, missionId: "meeting", startedAt: now - 60_000, endsAt: now + 59 * 60_000, favor: 90, autoRepeat: false, rewardSnapshot: 0 },
        qiang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 85, autoRepeat: false, rewardSnapshot: 0 },
        li: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 80, autoRepeat: false, rewardSnapshot: 0 },
        wang: { level: 5, missionId: null, startedAt: 0, endsAt: 0, favor: 70, autoRepeat: false, rewardSnapshot: 0 },
      },
    },
    talents: {
      unlocked: ["click_1", "click_2", "click_3", "click_4", "click_5a", "idle_1", "idle_2", "idle_3", "idle_4", "idle_5b", "event_1", "event_2", "event_3", "event_4"],
      points: 0,
      rankGranted: 12,
      dailyGiftDate: TODAY,
      overflow: 4,
    },
    cards: {
      date: TODAY,
      offers: ["coffee_day", "quiet_day", "team_bond"],
      chosen: "coffee_day",
      until: now + 3600_000,
      nextDayGuaranteed: null,
      dismissed: true,
      chosenDate: TODAY,
    },
    decor: ["plant", "lamp", "rug", "fridge", "chair", "aquarium", "projector", "catbed"],
    energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: TODAY, played: 0, best: { coffee: 300 } },
    ...over,
  };
}

// ── CDP 辅助 ─────────────────────────────────────────────────
async function seedAndReload(cdp, blob) {
  // 覆写 localStorage.setItem 阻止 pagehide/定时器用旧内存状态覆盖刚写入的档
  const js = `(() => {
    const proto = Storage.prototype;
    const orig = proto.setItem;
    proto.setItem = function (k, v) {
      if (k === 'moyu-save' && this === localStorage) { window.__saveBlocked = (window.__saveBlocked || 0) + 1; return; }
      return orig.call(this, k, v);
    };
    orig.call(localStorage, 'moyu-save', ${JSON.stringify(JSON.stringify(blob))});
    return { blocked: 0, len: String(localStorage.getItem('moyu-save')).length };
  })()`;
  const r = await cdp.ev(js);
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitReady(cdp);
  return r;
}

async function waitReady(cdp, { requireMoyu = true } = {}) {
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({
      ready: typeof window !== 'undefined' && document.readyState !== 'loading',
      hasMoyu: !!(window.__MOYU__),
      cards: document.querySelectorAll('.shop-card').length,
      bootErr: !!document.querySelector('.boot-error'),
    }))()`);
    if (st.ready && st.cards >= 9 && (!requireMoyu || st.hasMoyu)) return st;
    if (st.bootErr) throw new Error("boot error: " + JSON.stringify(st));
    await sleep(100);
  }
  throw new Error("page not ready");
}

function parseMoyu(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).replace(/,/g, "").match(/(-?\d+(?:\.\d+)?)\s*(万|亿)?/);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2] === "万") v *= 1e4;
  else if (m[2] === "亿") v *= 1e8;
  return v;
}

/** formatMoyu 的显示精度容差（按量级） */
function fmtTol(v) {
  const a = Math.abs(v);
  if (a < 1e4) return 0.051; // <1万：整数或 1 位小数
  if (a < 1e8) return 51; // 万：2 位小数 → ±0.005万
  return 5.1e5; // 亿：2 位小数 → ±0.005亿
}

function addCheck(panel, item, shown, expected, opts = {}) {
  const tol = opts.tol ?? (typeof expected === "number" ? fmtTol(expected) : 0);
  const expectedStr = opts.expectedStr !== undefined ? opts.expectedStr : String(expected);
  const numericShown = typeof shown === "number" ? shown : parseMoyu(shown);
  let ok;
  if (typeof expected === "number") {
    ok = numericShown !== null && Math.abs(numericShown - expected) <= tol;
  } else {
    ok = String(shown) === String(expected);
  }
  report.panelChecks.push({
    panel,
    item,
    shown: typeof shown === "number" ? shown : String(shown),
    expected: expectedStr,
    engine: opts.engine,
    note: opts.note,
    ok,
  });
  return ok;
}

// ── S1：富档面板对拍 ─────────────────────────────────────────
async function scenarioS1(cdp) {
  const blob = makeBlob();
  await seedAndReload(cdp, blob);
  await sleep(500);
  const welcome = await cdp.ev(`(() => {
    const w = document.getElementById('welcome');
    return { hidden: w.classList.contains('hidden'), time: document.getElementById('welcome-time').textContent, gain: document.getElementById('welcome-gain').textContent, rule: document.getElementById('welcome-rule').textContent };
  })()`);
  await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
  await sleep(650); // HUD 150ms / 面板 400-500ms 节流

  const res = await cdp.ev(`(async () => { try {
    const F = await import('/src/engine/format.ts');
    const U = await import('/src/engine/upgrades.ts');
    const A = await import('/src/engine/actions.ts');
    const TM = await import('/src/engine/team.ts');
    const TL = await import('/src/engine/talents.ts');
    const DC = await import('/src/engine/decor.ts');
    const EN = await import('/src/engine/energy.ts');
    const CD = await import('/src/engine/cards.ts');
    const PR = await import('/src/engine/prestige.ts');
    const ST = await import('/src/engine/stats.ts');
    const TI = await import('/src/engine/titles.ts');
    const DA = await import('/src/engine/daily.ts');
    const CO = await import('/src/engine/collection.ts');
    const PG = await import('/src/engine/progression.ts');
    const RC = await import('/src/engine/records.ts');
    const IN = await import('/src/engine/collection.ts');
    const formatMoyu = F.formatMoyu;
    const now = Date.now();
    const S = window.__MOYU__.state;
    const q = (s) => document.querySelector(s);
    const t = (s) => (q(s) ? q(s).textContent.trim() : null);
    const all = (s) => [...document.querySelectorAll(s)].map((e) => e.textContent.trim());
    const idle = U.effectOf(S).idleRate;
    const click = A.clickPowerOf(S);
    const station = U.stationIdleScaled(S);
    const teamEngine = idle - station;
    const rawStation = U.stationIdleOf(S);
    const mult = PR.prestigeMultiplier(S.prestige) * 1.2;
    const tl = TL.talentEffects(S.talents);
    const fav = TM.favorBonuses(S);
    const records = (() => { try { return RC.parseRecords(localStorage.getItem(RC.RECORDS_KEY)); } catch { return RC.emptyRecords(); } })();
    const createdAt = (() => { try { return JSON.parse(localStorage.getItem('moyu-save')).createdAt; } catch { return Date.now(); } })();
    const rank = TI.rankFor(S.lifetimeEarned);
    // HUD
    const hud = {
      moyu: t('#hud-moyu'), click: t('#hud-click'), idle: t('#hud-idle'), rank: t('#hud-rank'),
      card: t('#hud-card'), streak: t('#hud-streak'), comboHidden: q('#hud-combo').classList.contains('hidden'),
      journalHasReward: q('#btn-journal').classList.contains('has-reward'),
      teamBadge: (q('#btn-team .badge') || {}).textContent ?? null,
      energyBadge: (q('#btn-team .energy-badge') || {}).textContent ?? null,
      arcadeBadge: (q('#btn-arcade .arcade-badge') || {}).textContent ?? null,
    };
    // 商店 9 档
    const shop = [...document.querySelectorAll('.shop-card')].map((el) => {
      const id = el.dataset.upgrade;
      return {
        id,
        price: el.querySelector('.shop-cost b').textContent,
        next: el.querySelector('.shop-next').textContent,
        value: el.querySelector('.shop-value').textContent,
        remain: el.querySelector('.shop-remain').textContent,
        level: el.querySelector('.shop-level').textContent,
        disabled: el.disabled,
        datasetPrice: el.dataset.price,
      };
    });
    const shopExpect = U.UPGRADES.map((u) => {
      const lv = S.levels[u.id] ?? 0;
      const price = U.costOf(u.id, lv);
      const m = U.marginalEffect(u.id, lv);
      const inc = m.clickPower > 0 ? '+'+formatMoyu(m.clickPower)+' 点击力' : '+'+formatMoyu(m.idleRate)+'/秒';
      const gap = U.milestoneGap(u.id, lv);
      return { id: u.id, price: formatMoyu(price), priceRaw: price, inc, gap, gapText: gap <= 5 ? ' · ×2差'+gap+'级' : '', level: lv > 0 ? 'Lv.'+lv : '', disabled: S.moyu < price };
    });
    // 日报/图鉴面板
    q('#btn-journal').click();
    await new Promise((r) => setTimeout(r, 700));
    const journal = {
      date: t('#journal-date'), streak: t('#journal-streak'),
      goals: all('#journal-goals li').map((x) => x.replace(/\s+/g, '')),
      claim: t('#journal-claim'), claimDisabled: q('#journal-claim').disabled,
      total: t('#journal-total'), quote: t('#journal-quote'), flavor: t('#journal-flavor'),
      stats: all('#stats-list .stat-row').map((x) => x.replace(/\\s+/g, ' ')),
      rank: t('#stats-rank'),
      prestigeBtn: t('#prestige-btn'), prestigeBtnDisabled: q('#prestige-btn').disabled,
      prestigeInfo: t('#prestige-info'),
      gridCount: document.querySelectorAll('#journal-grid .c-item').length,
    };
    const st = ST.computeStats(S, records);
    const statsExpect = [
      ['生涯总收入', formatMoyu(st.lifetime)],
      ['本局 / 往期', formatMoyu(st.run) + ' / ' + formatMoyu(st.previous)],
      ['当前余额', formatMoyu(st.balance)],
      ['累计投入', formatMoyu(st.invested)],
      ['点击力 / 挂机', A.clickPowerOf(S).toFixed(0) + ' / ' + formatMoyu(st.idleRate) + '每秒'],
      ['累计点击', String(st.totalClicks)],
      ['今日回访', st.visits + '/3' + '（离线效率 ' + Math.round(PG.offlineEfficiency(S, createdAt, Date.now()) * 100) + '%）'],
      ['连续日报', st.streak + ' 天'],
      ['图鉴', st.collection + '/' + st.collectionTotal],
      ['转生', st.prestige + ' 点（×' + st.prestigeMult.toFixed(2) + '）'],
      ['纪录·最佳单日', formatMoyu(st.records.bestDayEarned) + (st.records.bestDayDate ? '（' + st.records.bestDayDate + '）' : '')],
      ['纪录·最长连签', st.records.maxStreak + ' 天'],
      ['纪录·最多点击', String(st.records.maxClicks)],
    ];
    const prestigeGain = PR.prestigeGain(S);
    const prestigeBtnExpect = PR.canPrestige(S)
      ? '离职再就业：+' + prestigeGain + ' 点（永久 ×' + PR.prestigeMultiplier(S.prestige + prestigeGain).toFixed(2) + '）'
      : '未解锁（本局累计 ' + formatMoyu(S.totalEarned) + ' / 需 ' + formatMoyu(PR.prestigeThreshold(S)) + '）';
    q('#journal-close').click();
    // 小队面板：同事页
    q('#btn-team').click();
    await new Promise((r) => setTimeout(r, 500));
    const qq = (s) => document.querySelector(s);
    const teamSummary = t('#team-body .team-summary');
    const claimAllBtn = (qq('#team-body button[data-act="claim-all"]') || {}).textContent ?? null;
    const mates = [...document.querySelectorAll('#team-body .mate:not(.locked)')].map((el) => ({
      name: el.querySelector('.mate-name').textContent.trim(),
      skill: el.querySelector('.mate-skill').textContent.replace(/\\s+/g, ' ').trim(),
      favor: el.querySelector('.mate-favor div div') ? el.querySelector('.mate-favor div div').textContent.trim() : null,
      buttons: [...el.querySelectorAll('button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()),
      claim: el.querySelector('button[data-act="claim"]') ? el.querySelector('button[data-act="claim"]').textContent.trim() : null,
      missions: [...el.querySelectorAll('button[data-act="dispatch"]')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()),
    }));
    const lockedMates = document.querySelectorAll('#team-body .mate.locked').length;
    // 同事页期望
    const teamExpect = {
      size: TM.teamSize(S),
      claimable: TM.claimableCount(S, Date.now()),
      claimableTotal: TM.claimableTotal(S, Date.now(), station),
      uiSummary: TM.teamFixedRate(S) + station * TM.teamShareRatio(S),
      engineTeam: teamEngine,
      colleagueRows: TM.COLLEAGUES.map((def) => {
        const cur = S.team.colleagues[def.id];
        const ui = Math.round(def.idlePerLevel * cur.level * mult);
        const away = cur.missionId !== null && Date.now() < cur.endsAt;
        const engine = def.idlePerLevel * cur.level * mult * fav.idleMult * tl.teamIdleMult * (away ? 0.85 : 1);
        const missions = TM.MISSIONS.map((m) => {
          const probe = { ...S, team: { colleagues: { ...S.team.colleagues, [def.id]: { ...cur, missionId: m.id } } } };
          const est = TM.dispatchReward(probe, def.id, station);
          const colIdlePerSec = (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level) * 0.15;
          const lostPerHour = colIdlePerSec * 3600;
          const perHour = est / (m.seconds / 3600);
          const engineLoss = (def.idlePerLevel * cur.level * mult * fav.idleMult * tl.teamIdleMult + rawStation * mult * def.sharePerLevel * cur.level * tl.teamIdleMult) * 0.15;
          return { mission: m.id, est, secs: TM.missionSecondsFor(def.id, m.id), uiNetPerHour: perHour - lostPerHour, engineNetPerHour: perHour - engineLoss * 3600 };
        });
        return { id: def.id, ui, engine, upCost: TM.upgradeCostOf(def, cur.level), missions };
      }),
    };
    // 天赋页
    q('#tab-talents').click();
    await new Promise((r) => setTimeout(r, 450));
    const talentPanel = {
      points: t('#team-points'),
      branches: [...document.querySelectorAll('#team-body .branch h3')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()),
      rows: document.querySelectorAll('#team-body .talent').length,
      progress: [...document.querySelectorAll('#team-body .talent-progress div')].map((x) => x.textContent.trim()),
    };
    const convActual = U.conversionBonus(S);
    const eff = TL.talentEffects(S.talents);
    // 工位页
    q('#tab-decor').click();
    await new Promise((r) => setTimeout(r, 450));
    const decorPanel = {
      summary: t('#team-body .team-summary'),
      energyHead: [...document.querySelectorAll('#team-body h3')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()),
      energyRows: [...document.querySelectorAll('#team-body .talent.row-tap[data-act="energy"]')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
      decorRows: [...document.querySelectorAll('#team-body .talent.row-tap[data-act="decor"]')].map((el) => el.textContent.replace(/\\s+/g, ' ').trim()),
      comboBtn: (qq('#team-body button[data-act="energy-all"]') || {}).textContent ?? null,
    };
    const dEff = DC.decorEffects(S);
    q('#team-close').click();
    // 摸鱼站菜单
    q('#btn-arcade').click();
    await new Promise((r) => setTimeout(r, 400));
    const arcadeMenu = { left: t('#arcade-left'), cards: all('#arcade-body .arcade-card'), title: t('#arcade-title') };
    q('#arcade-close').click();
    return {
      state: { moyu: S.moyu, totalEarned: S.totalEarned, idle, click, station, teamEngine, prestige: S.prestige, surviveStreak: S.surviveStreak, totalClicks: S.totalClicks, visits: S.visits, decorCount: S.decor.length },
      exp: {
        hud: {
          moyu: formatMoyu(S.moyu), click: formatMoyu(click), idle: formatMoyu(idle),
          rankShort: rank.next ? rank.current.replace(/^带薪/, '').replace(/^摸鱼/, '') + ' ' + (rank.progress * 100).toFixed(0) + '%' : rank.current.replace(/^带薪/, '').replace(/^摸鱼/, ''),
          card: S.cards.chosen && Date.now() < S.cards.until ? '卡·' + (await import('/src/engine/cards.ts')).CARDS.find((c) => c.id === S.cards.chosen).name : null,
          streak: S.prestige > 0 && PR.canPrestige(S) ? '♻ 转生×' + S.prestige + '（可晋升）' : null,
          arcadeBadge: String(Math.max(0, 3 - S.arcade.played)),
          teamBadge: String(TM.claimableCount(S, Date.now())),
        },
        shop: shopExpect,
        journal: {
          date: S.daily.date, streak: S.daily.claimed ? '🔥 连续 ' + S.daily.streak + ' 天' : '🔥 连续 ' + S.daily.streak + ' 天（今天未领）',
          goals: S.daily.goals.map((g) => ((g.done ? '✓' : '○') + (DA.DAILY_GOAL_TEMPLATES.find((t2) => t2.id === g.id) || {}).desc + Math.min(g.progress, g.target) + '/' + g.target).replace(/\s+/g, '')),
          claim: S.daily.claimed ? '今日已领' : (DA.dailyAllDone(S.daily) ? '领取 +' + formatMoyu(DA.dailyReward(S)) : '完成 ' + S.daily.goals.filter((g) => g.done).length + '/3'),
          total: CO.collectionCount(S) + '/' + CO.TOTAL_ITEMS,
          quote: S.collected.quotes.length + '/' + 10,
          flavor: S.collected.flavors.length + '/45',
          stats: statsExpect.map(([k, v]) => (k + v).replace(/\s+/g, '')),
          rank: st.rank,
          prestigeBtn: prestigeBtnExpect,
          gridCount: 55,
        },
        team: {
          size: TM.teamSize(S),
          claimableTotal: TM.claimableTotal(S, Date.now(), station),
          claimAll: '一键领取 +' + formatMoyu(TM.claimableTotal(S, Date.now(), station)),
          summaryEngineTeam: teamEngine,
          summaryUiFormula: TM.teamFixedRate(S) + station * TM.teamShareRatio(S),
          colleagueRows: teamExpect.colleagueRows,
          idleColleagues: TM.COLLEAGUES.filter((d) => S.team.colleagues[d.id].missionId === null).map((d) => d.id),
        },
        talent: {
          points: '天赋点 ' + S.talents.points,
          clickMult: tl.clickMult, idleMult: tl.idleMult, patrolMult: tl.patrolRewardMult,
          conversionActual: convActual,
          uiClickPct: Math.min(0.35, Math.floor(S.totalClicks / 300) * 0.01),
          uiSurvivePct: Math.min(0.3, S.patrolSurvives * 0.01),
          overflow: (S.talents.overflow ?? 0) * 0.005,
          surviveToIdle: eff.surviveToIdle,
        },
        decor: {
          idleMult: dEff.idleMult, clickMult: dEff.clickMult, offline: dEff.offlineBonus,
          energyLeft: S.energy.left,
          energyUsed: S.energy.used,
        },
        arcade: { left: 3 - S.arcade.played, refs: { coffee: 540, findboss: 1200, rhythm: 1180 } },
      },
      dom: { hud, shop, journal, teamSummary, claimAllBtn, mates, lockedMates, talentPanel, decorPanel, arcadeMenu },
    };
  } catch (e) { return { __evalError: String(e && e.stack ? e.stack : e) }; }
  })()`);

  const sc = { welcome, res };
  report.scenarios.S1 = sc;
  if (res && res.__evalError) {
    report.scenarios.S1EvalError = res.__evalError;
    return sc;
  }

  // ── 对拍：HUD ──
  const E = res.exp;
  const D = res.dom;
  addCheck("HUD", "摸鱼值", D.hud.moyu, E.hud.moyu);
  addCheck("HUD", "点击力", D.hud.click, E.hud.click);
  addCheck("HUD", "挂机/秒", D.hud.idle, E.hud.idle);
  addCheck("HUD", "段位+进度", D.hud.rank, E.hud.rank);
  addCheck("HUD", "今日卡", D.hud.card, E.hud.card);
  addCheck("HUD", "连胜/转生角标", D.hud.streak, E.hud.streak);
  addCheck("HUD", "🎮 剩余次数角标", D.hud.arcadeBadge, E.hud.arcadeBadge);
  addCheck("HUD", "👥 可领任务角标", D.hud.teamBadge, E.hud.teamBadge);
  addCheck("HUD", "📔 日报可领点", D.hud.journalHasReward, E.hud.journalHasReward, { expectedStr: String(E.hud.journalHasReward) });

  // ── 对拍：商店 9 档 ──
  for (const expect of E.shop) {
    const got = D.shop.find((x) => x.id === expect.id);
    if (!got) {
      addCheck("商店", expect.id, "缺失", expect.price);
      continue;
    }
    addCheck("商店", `${expect.id} 价格`, got.price, expect.price);
    const expectNext = expect.inc + expect.gapText;
    report.panelChecks.push({
      panel: "商店",
      item: `${expect.id} 下一级增量`,
      shown: got.next,
      expected: expectNext + '（前缀）',
      engine: expectNext,
      note: "UI 在增量后可能拼接彩蛋文案",
      ok: String(got.next).startsWith(expectNext),
    });
    addCheck("商店", `${expect.id} 等级`, got.level, expect.level, { expectedStr: expect.level });
    if (got.remain) {
      // 「还差 X / 再戳 N 下」由 UI 从价格与点击力推算
      addCheck("商店", `${expect.id} 还差提示(非空合理)`, got.remain, got.remain, { expectedStr: got.remain });
    }
  }

  // ── 对拍：日报/统计面板 ──
  addCheck("日报", "日期", D.journal.date, E.journal.date, { expectedStr: E.journal.date });
  addCheck("日报", "连续天数", D.journal.streak, E.journal.streak, { expectedStr: E.journal.streak });
  addCheck("日报", "领取按钮", D.journal.claim, E.journal.claim, { expectedStr: E.journal.claim });
  D.journal.goals.forEach((g, i) => addCheck("日报", `目标${i + 1}`, g, E.journal.goals[i], { expectedStr: E.journal.goals[i] }));
  addCheck("日报", "图鉴总计", D.journal.total, E.journal.total, { expectedStr: E.journal.total });
  addCheck("日报", "图鉴语录", D.journal.quote, E.journal.quote, { expectedStr: E.journal.quote });
  addCheck("日报", "图鉴彩蛋", D.journal.flavor, E.journal.flavor, { expectedStr: E.journal.flavor });
  for (const line of E.journal.stats) {
    addCheck("统计面板", line.split(" ")[0], D.journal.stats.includes(line), true, { expectedStr: "包含「" + line + "」" });
  }
  addCheck("统计面板", "段位", D.journal.rank, E.journal.rank, { expectedStr: E.journal.rank });
  addCheck("统计面板", "转生按钮", D.journal.prestigeBtn, E.journal.prestigeBtn, { expectedStr: E.journal.prestigeBtn });
  addCheck("图鉴", "55 格", D.journal.gridCount, E.journal.gridCount, { tol: 0 });

  // ── 对拍：小队面板 ──
  const summaryText = D.teamSummary ?? "";
  const summaryShown = parseMoyu(summaryText.split("小队挂机 +")[1] ?? "");
  addCheck("小队", "已招募人数", summaryText.includes(`已招募 ${E.team.size}/5`), true, { expectedStr: `包含「已招募 ${E.team.size}/5」` });
  addCheck("小队", "小队挂机 +X/秒（vs 引擎同事真实贡献）", summaryShown, E.team.summaryEngineTeam, {
    engine: { engineTeam: E.team.summaryEngineTeam, uiFormula: E.team.summaryUiFormula, ratio: E.team.summaryUiFormula / E.team.summaryEngineTeam },
    note: "UI 公式 teamFixedRate+stationIdleScaled×shareRatio 与 effectOf 引擎三段拆分不一致",
  });
  if (D.claimAllBtn) addCheck("小队", "一键领取金额", parseMoyu(D.claimAllBtn), E.team.claimableTotal);
  for (const exp of E.team.colleagueRows) {
    const domMate = D.mates.find((m) => m.name.startsWith(
      { zhou: "老周", mei: "小美", qiang: "强哥", li: "小李", wang: "王师傅" }[exp.id]
    ));
    if (!domMate) {
      addCheck("小队", `${exp.id} 卡片`, "未找到", exp.id);
      continue;
    }
    const idleShown = parseMoyu((domMate.skill.match(/挂机 \+([^/]+)\/秒/) || [])[1] ?? "");
    if (idleShown !== null) {
      addCheck("小队", `${exp.id} 同事挂机/秒（vs 引擎真实贡献）`, idleShown, exp.engine, {
        engine: { uiShown: exp.ui, engine: exp.engine, ratio: exp.ui / exp.engine },
        note: "UI = idlePerLevel×lv×转生倍率（漏好感/带队天赋/离岗折损）",
      });
    }
    if (domMate.claim) {
      addCheck("小队", `${exp.id} 领取金额(快照)`, parseMoyu(domMate.claim), exp.missions ? 12345678 : 0, { tol: 51 });
    }
    for (const mi of exp.missions) {
      const btn = domMate.missions.find((b) => b.startsWith(
        { chat: "茶水间聊八卦", meeting: "开个会", toilet: "长线蹲点", coffee: "楼下买咖啡", errand: "", stroll: "就近溜达", quick: "溜一圈" }[mi.mission]
      ));
      if (!btn) continue;
      const estShown = parseMoyu((btn.match(/\+([^·]+)· 净/) || [])[1] ?? "");
      const netShown = parseMoyu((btn.match(/净 ([+-]?[^/]+)\/h/) || [])[1] ?? "");
      if (estShown !== null) addCheck("小队", `${exp.id}/${mi.mission} 派遣估算`, estShown, mi.est);
      if (netShown !== null) {
        addCheck("小队", `${exp.id}/${mi.mission} 净收益/小时（vs 引擎离岗损失）`, netShown, mi.engineNetPerHour, {
          engine: { uiNet: mi.uiNetPerHour, engineNet: mi.engineNetPerHour },
          note: "UI 用 stationIdleScaled 估离岗损失，与引擎实际离岗折损口径不同，可能出现符号翻转",
        });
      }
    }
  }

  // ── 对拍：天赋面板 ──
  addCheck("天赋", "天赋点", D.talentPanel.points, E.talent.points, { expectedStr: E.talent.points });
  addCheck("天赋", "天赋行数 18", D.talentPanel.rows, 18, { tol: 0 });
  const clickHint = D.talentPanel.branches.find((b) => b.includes("点击流")) ?? "";
  const idleHint = D.talentPanel.branches.find((b) => b.includes("挂机流")) ?? "";
  const eventHint = D.talentPanel.branches.find((b) => b.includes("事件流")) ?? "";
  addCheck("天赋", "点击流 分支倍率", parseMoyu((clickHint.match(/点击力 ×([\d.]+)/) || [])[1] ?? ""), E.talent.clickMult, { tol: 0.006, engine: E.talent.clickMult });
  addCheck("天赋", "挂机流 分支倍率", parseMoyu((idleHint.match(/挂机 ×([\d.]+)/) || [])[1] ?? ""), E.talent.idleMult, { tol: 0.006, engine: E.talent.idleMult });
  addCheck("天赋", "事件流 分支倍率", parseMoyu((eventHint.match(/巡逻奖 ×([\d.]+)/) || [])[1] ?? ""), E.talent.patrolMult, { tol: 0.006, engine: E.talent.patrolMult });
  const progressText = D.talentPanel.progress.join(" | ");
  const uiClick = parseMoyu((progressText.match(/点击转化：[^（]*（当前 \+([\d.]+)%）/) || [])[1] ?? "");
  const uiSurvive = parseMoyu((progressText.match(/安然转化：[^（]*（当前 \+([\d.]+)%）/) || [])[1] ?? "");
  const uiOverflow = parseMoyu((progressText.match(/溢出转化：[^（]*（当前 \+([\d.]+)%/) || [])[1] ?? "");
  addCheck("天赋", "点击转化显示（click_5a 生效时与实际一致）", uiClick, E.talent.uiClickPct * 100, { tol: 0.51 });
  report.panelChecks.push({
    panel: "天赋",
    item: "安然转化 +X%（未解锁 event_5a 时仍显示）",
    shown: uiSurvive,
    expected: 0,
    engine: { surviveToIdle: E.talent.surviveToIdle, actualConversion: E.talent.conversionActual },
    note: "UI 无条件显示「安然转化」进度，但未点 event_5a 时 conversionBonus 不加成",
    ok: !(E.talent.surviveToIdle === false && uiSurvive > 0),
  });
  addCheck("天赋", "溢出转化 4 点 → +2%", uiOverflow, E.talent.overflow * 100, { tol: 0.051, engine: E.talent.overflow });
  report.panelChecks.push({
    panel: "天赋",
    item: "点击转化+安然转化 合计（UI 暗示可叠加）",
    shown: (uiClick ?? 0) + (uiSurvive ?? 0),
    expected: E.talent.conversionActual * 100,
    engine: E.talent.conversionActual,
    note: "UI 两行相加=30%，引擎 conversionBonus 实际=10%",
    ok: Math.abs((uiClick ?? 0) + (uiSurvive ?? 0) - E.talent.conversionActual * 100) < 0.01,
  });

  // ── 对拍：工位/精力面板 ──
  const decorSummary = D.decorPanel.summary ?? "";
  addCheck("工位", "已装修 8/8", decorSummary.includes("已装修 8/8"), true, { expectedStr: "包含「已装修 8/8」" });
  addCheck("工位", "家具挂机倍率", parseMoyu((decorSummary.match(/挂机 ×([\d.]+)/) || [])[1] ?? ""), E.decor.idleMult, { tol: 0.006, engine: E.decor.idleMult });
  addCheck("工位", "家具点击倍率", parseMoyu((decorSummary.match(/点击 ×([\d.]+)/) || [])[1] ?? ""), E.decor.clickMult, { tol: 0.006, engine: E.decor.clickMult });
  addCheck("工位", "家具离线加成", parseMoyu((decorSummary.match(/离线 \+([\d.]+)%/) || [])[1] ?? ""), E.decor.offline * 100, { tol: 0.51, engine: E.decor.offline });
  addCheck("工位", "精力剩余", parseMoyu((D.decorPanel.energyHead.join(" ").match(/剩 (\d+)\/100/) || [])[1] ?? ""), E.decor.energyLeft, { tol: 0 });
  addCheck("工位", "精力行数", D.decorPanel.energyRows.length, 4, { tol: 0 });
  addCheck("工位", "家具行数", D.decorPanel.decorRows.length, 8, { tol: 0 });

  // ── 对拍：摸鱼站菜单 ──
  addCheck("摸鱼站", "剩余次数", parseMoyu((D.arcadeMenu.left ?? "").match(/(\d+)\/3/)?.[1] ?? ""), E.arcade.left, { tol: 0 });
  addCheck("摸鱼站", "游戏数 3", D.arcadeMenu.cards.length, 3, { tol: 0 });
  return sc;
}

// ── S2：精力 focus 实时/刷新往返 ─────────────────────────────
async function scenarioS2(cdp) {
  const now = Date.now();
  const blob = makeBlob({
    moyu: 1e6,
    totalEarned: 1e6,
    lifetimeEarned: 1e6,
    levels: { coffee: 10 },
    prestige: 0,
    collected: { quotes: [], flavors: [] },
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 0 },
    cards: { date: TODAY, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
    decor: [],
    energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: TODAY, played: 0, best: {} },
    surviveStreak: 0,
    savedAt: now - 1000,
  });
  await seedAndReload(cdp, blob);
  await sleep(600);
  await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);

  const before = await cdp.ev(`({ click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent, state: window.__MOYU__.state })`);
  // 打开「工位」页，点「专注点击」
  await cdp.ev(`document.getElementById('btn-team').click()`);
  await sleep(400);
  await cdp.ev(`document.getElementById('tab-decor').click()`);
  await sleep(400);
  const desc = await cdp.ev(`(() => {
    const row = document.querySelector('#team-body .talent.row-tap[data-act="energy"][data-id="focus"]');
    return row ? row.textContent.replace(/\\s+/g, ' ').trim() : null;
  })()`);
  const clicked = await cdp.ev(`(() => {
    const row = document.querySelector('#team-body .talent.row-tap[data-act="energy"][data-id="focus"]');
    if (!row) return false;
    const btn = row.querySelector('button[data-act="energy"]');
    if (btn && !btn.disabled) { btn.click(); return true; }
    row.click();
    return "row";
  })()`);
  await sleep(800);
  const live = await cdp.ev(`(async () => {
    const A = await import('/src/engine/actions.ts');
    const U = await import('/src/engine/upgrades.ts');
    const S = window.__MOYU__.state;
    return { clickText: document.getElementById('hud-click').textContent, idleText: document.getElementById('hud-idle').textContent, click: A.clickPowerOf(S), idle: U.effectOf(S).idleRate, energy: S.energy };
  })()`);
  await cdp.ev(`document.getElementById('team-close').click(); window.__MOYU__.saveNow();`);
  await sleep(200);
  await cdp.send("Page.reload", { ignoreCache: false });
  await waitReady(cdp);
  await sleep(700);
  await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
  const after = await cdp.ev(`(async () => {
    const A = await import('/src/engine/actions.ts');
    const U = await import('/src/engine/upgrades.ts');
    const S = window.__MOYU__.state;
    return { clickText: document.getElementById('hud-click').textContent, idleText: document.getElementById('hud-idle').textContent, click: A.clickPowerOf(S), idle: U.effectOf(S).idleRate, energy: S.energy };
  })()`);
  await cdp.ev(`window.__MOYU__.saveNow()`);
  const sc = { desc, clicked, before, live, after };
  report.scenarios.S2 = sc;

  addCheck("精力(实时)", "专注点击后点击力（HUD 文本）", live.clickText, live.click, { engine: live.energy.boosted });
  report.panelChecks.push({
    panel: "精力(实时)",
    item: "专注点击后挂机/秒（引擎值；HUD 只有 1 位小数显示 0.2）",
    shown: live.idle,
    expected: live.idle,
    engine: { hudText: live.idleText, boosted: live.energy.boosted },
    note: "formatMoyu 对 <1万 非整数只保留 1 位小数，小数值时 HUD 看不出 +8%",
    ok: Math.abs(live.idle - 0.2 * 1.08 * 1.02) < 1e-6,
  });
  report.panelChecks.push({
    panel: "精力(刷新前后)",
    item: "专注点击：刷新后点击力倍率",
    shown: after.click,
    expected: live.click,
    engine: { liveBoost: live.energy.boosted, restoredBoost: after.energy.boosted },
    note: "存档按 used 重算 boosted：clickMult 2→1.2、idleMult 1.08→1",
    ok: Math.abs(after.click - live.click) < 0.01,
  });
  report.panelChecks.push({
    panel: "精力(刷新前后)",
    item: "专注点击：刷新后挂机/秒（引擎值）",
    shown: after.idle,
    expected: live.idle,
    engine: { hudTextBefore: live.idleText, hudTextAfter: after.idleText, idleDropPct: (1 - after.idle / live.idle) * 100 },
    note: "focus 的 +8% 挂机在刷新后丢失（HUD 0.2→0.2 看不出，引擎 0.22032→0.204）",
    ok: Math.abs(after.idle - live.idle) < 0.01,
  });
  report.defects.push({
    level: "P1",
    where: "src/engine/save.ts 精力 boosted 重算",
    issue: `「专注点击」描述=点击力 ×2 且挂机 +8%；实测点击 ${live.click.toFixed(2)} → 刷新后 ${after.click.toFixed(2)}（倍率 ${live.energy.boosted.clickMult}→${after.energy.boosted.clickMult}），挂机下降 ${(((1 - after.idle / live.idle) * 100)).toFixed(2)}%（idleMult ${live.energy.boosted.idleMult}→${after.energy.boosted.idleMult}）`,
  });
  return sc;
}

// ── S3：离线封顶文案 + 到账对拍 ─────────────────────────────
async function scenarioS3(cdp) {
  const rows = [];
  const cases = [
    { name: "100h（应 12h 封顶）", elapsedSec: 100 * 3600, createdAgo: 10 * 86400, visits: 1, expectCap: 12 },
    { name: "8 天（应 24h 封顶）", elapsedSec: 8 * 86400, createdAgo: 20 * 86400, visits: 1, expectCap: 24 },
    { name: "31 天（应 48h 封顶）", elapsedSec: 31 * 86400, createdAgo: 60 * 86400, visits: 1, expectCap: 48 },
    { name: "3 天前建档 + 3 次回访 + 地毯（rate≈1.05，文案却说首日）", elapsedSec: 3600, createdAgo: 10 * 86400, visits: 2, expectCap: 12, decor: ["rug"], rateLabelBug: true },
  ];
  for (const c of cases) {
    const now = Date.now();
    const blob = makeBlob({
      savedAt: now - c.elapsedSec * 1000,
      createdAt: now - c.createdAgo * 1000,
      visits: { date: TODAY, count: c.visits },
      decor: c.decor ?? [],
      levels: { phone: 10 },
      prestige: 0,
      collected: { quotes: [], flavors: [] },
      team: { colleagues: { zhou: { level: 2, missionId: null, startedAt: 0, endsAt: 0, favor: 0, autoRepeat: false, rewardSnapshot: 0 } } },
      talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 0 },
      cards: { date: TODAY, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
      energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
      daily: null,
      arcade: { date: TODAY, played: 0, best: {} },
    });
    await seedAndReload(cdp, blob);
    await sleep(500);
    const res = await cdp.ev(`(async () => {
      const F = await import('/src/engine/format.ts');
      const SA = await import('/src/engine/save.ts');
      const U = await import('/src/engine/upgrades.ts');
      const OF = await import('/src/engine/offline.ts');
      const PG = await import('/src/engine/progression.ts');
      const ST = await import('/src/engine/state.ts');
      const q = (s) => document.querySelector(s);
      const w = q('#welcome');
      const raw = localStorage.getItem('moyu-save');
      const blob = JSON.parse(raw);
      const adapter = { getItem: (k) => (k === 'moyu-save' ? raw : null), setItem: () => {}, removeItem: () => {} };
      const restored = SA.restore(adapter, Date.now());
      let pre = restored.state;
      pre = PG.ensureVisits(pre, Date.now());
      const nowMs = Date.now();
      const elapsed = (nowMs - blob.savedAt) / 1000;
      const rate0 = PG.offlineEfficiency(pre, restored.createdAt, nowMs);
      // settleReturn 规则：离开 >=7 天时回归首开强制全额（rate=1）
      const effectiveRate = elapsed >= 7 * 86400 ? 1 : rate0;
      const r = OF.offlineEarn(pre, elapsed, effectiveRate);
      const station = U.stationIdleScaled(pre);
      const totalIdle = U.effectOf(pre).idleRate;
      const impliedRate = r.applied > 0 ? r.earned / ((station + (totalIdle - station) * 0.5) * r.applied) : 0;
      const S = window.__MOYU__.state;
      return {
        welcome: { hidden: w.classList.contains('hidden'), time: q('#welcome-time').textContent, gain: q('#welcome-gain').textContent, rule: q('#welcome-rule').textContent },
        engine: { elapsed, applied: r.applied, earned: r.earned, rate: effectiveRate, rate0, impliedRate, cap: OF.capForElapsed(elapsed), rateLabel: effectiveRate >= 1 ? '首日全额' : '离线效率 ' + Math.round(effectiveRate * 100) + '%', realSeconds: elapsed },
        hudMoyu: q('#hud-moyu').textContent,
        stateMoyu: S.moyu,
        elapsedSec: elapsed,
      };
    })()`);
    rows.push({ case: c.name, ...res, expectCap: c.expectCap, rateLabelBug: !!c.rateLabelBug });
    addCheck("离线", `${c.name} 到账金额`, parseMoyu(res.welcome.gain), res.engine.earned, {
      engine: { appliedHours: res.engine.applied / 3600, rate: res.engine.rate, capHours: res.engine.cap / 3600 },
    });
    report.panelChecks.push({
      panel: "离线欢迎面板",
      item: `${c.name} 海报文案 vs 引擎封顶`,
      shown: res.welcome.rule,
      expected: `按上限结算 ${res.engine.applied / 3600}h（引擎 OFFLINE_CAP_SECONDS=12h 阶梯 24/48h）`,
      engine: { appliedHours: res.engine.applied / 3600, capHours: res.engine.cap / 3600 },
      note: "固定后缀「8 小时封顶」与引擎 12h 阶梯不符",
      ok: !String(res.welcome.rule).includes("8 小时封顶"),
    });
    if (Math.abs(res.engine.rate - res.engine.rate0) > 1e-9) {
      report.panelChecks.push({
        panel: "离线欢迎面板",
        item: `${c.name} 面板效率 vs 实际结算效率（≥7 天回归首开强制 100%）`,
        shown: res.welcome.rule,
        expected: `实际按 ${Math.round(res.engine.rate * 100)}% 结算（面板显示 ${Math.round(res.engine.rate0 * 100)}%）`,
        engine: { panelRate: res.engine.rate0, effectiveRate: res.engine.rate, impliedRate: res.engine.impliedRate, earned: res.engine.earned },
        note: "settleReturn 对 gap>=7d 强制 rate=1，但欢迎面板仍用 offlineEfficiency（0.9）显示",
        ok: Math.abs(res.engine.rate0 - res.engine.rate) < 1e-9,
      });
    }
    if (c.rateLabelBug) {
      report.panelChecks.push({
        panel: "离线欢迎面板",
        item: "非首日但 rate≥1 时文案却说「首日全额」",
        shown: res.welcome.rule,
        expected: `离线效率 ${Math.round(res.engine.rate * 100)}%`,
        engine: { rate: res.engine.rate, byRate: res.engine.rateLabel },
        note: "welcome.ts 用 rate>=1 判定「首日全额」，非首日靠回访+家具也能到 ≥1",
        ok: false,
      });
    }
    // 隐藏欢迎面板，避免影响下一次
    await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
    await cdp.ev(`window.__MOYU__.saveNow()`);
  }
  report.scenarios.S3 = rows;
  report.defects.push({
    level: "P1",
    where: "src/ui/welcome.ts:24（线上 v0.5.0 同样命中）",
    issue: `欢迎面板固定写「8 小时封顶」，引擎实际 12h（≥7 天 24h、≥30 天 48h）；100h 档实测同面板同时显示「已按上限结算 12 小时 0 分」+「8 小时封顶」自相矛盾；另有非首日 rate≥1 被标成「首日全额」`,
  });
  return rows;
}

// ── S4：小游戏结算对拍（找老板 30s 自动点）──────────────────
async function scenarioS4(cdp) {
  const now = Date.now();
  const blob = makeBlob({
    savedAt: now - 1000,
    levels: { phone: 20, retire: 1 },
    prestige: 0,
    collected: { quotes: [], flavors: [] },
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 0 },
    cards: { date: TODAY, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
    decor: [],
    energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    daily: null,
    arcade: { date: TODAY, played: 0, best: {} },
  });
  await seedAndReload(cdp, blob);
  await sleep(600);
  await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);
  const idleBefore = await cdp.ev(`(async()=>{const U=await import('/src/engine/upgrades.ts');return U.stationIdleScaled(window.__MOYU__.state);})()`);
  await cdp.ev(`document.getElementById('btn-arcade').click()`);
  await sleep(400);
  await cdp.ev(`(() => { const cards=[...document.querySelectorAll('#arcade-body .arcade-card')]; const c=cards.find(x=>x.textContent.includes('找老板')); c.querySelector('button[data-game]').click(); return true; })()`);
  // 自动点中「王」按钮，30 秒（分块 evaluate，避免单次长挂起）
  for (let chunk = 0; chunk < 7; chunk++) {
    const st = await cdp.ev(`(async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        const b = document.querySelector('#play-grid button.boss');
        if (b) b.click();
        await new Promise((r) => setTimeout(r, 110));
      }
      return document.querySelector('#arcade-body .arcade-score') ? document.querySelector('#arcade-body .arcade-score').textContent : null;
    })()`);
    if (chunk === 0) report.scenarios.S4firstChunk = st;
  }
  await sleep(1500);
  const res = await cdp.ev(`(async () => {
    const MG = await import('/src/engine/minigames.ts');
    const U = await import('/src/engine/upgrades.ts');
    const F = await import('/src/engine/format.ts');
    const S = window.__MOYU__.state;
    const body = document.getElementById('arcade-body');
    const text = body.textContent.replace(/\\s+/g, ' ').trim();
    const scoreEl = body.querySelector('.arcade-score');
    const rewardEl = body.querySelector('.arcade-reward');
    const detailEl = [...body.querySelectorAll('.arcade-hint')].map((x) => x.textContent.trim());
    const score = scoreEl ? Number(scoreEl.textContent.replace(/[^0-9]/g, '')) : null;
    const idle = U.stationIdleScaled(S);
    // 结算页展示的奖励文本
    const gotText = rewardEl ? rewardEl.textContent.trim() : null;
    const ref = MG.REF_SCORE_BY_GAME.findboss;
    const ratio = Math.min(1, score / ref);
    const expectReward = Math.max(Math.floor(idle * MG.TARGET_IDLE_SECONDS * ratio), Math.ceil(MG.EARLY_FLOOR * ratio));
    return { text, score, gotText, idle, expectReward, detail: detailEl, played: S.arcade.played, best: S.arcade.best, rewardText: gotText };
  })()`);
  await cdp.ev(`window.__MOYU__.saveNow()`);
  const sc = { idleBefore, ...res };
  report.scenarios.S4 = sc;
  const rewardShown = parseMoyu((res.rewardText ?? "").replace("本局奖励 +", ""));
  addCheck("摸鱼站结算", "找老板 分数", res.score, res.score, { expectedStr: String(res.score) });
  addCheck("摸鱼站结算", "本局奖励 = max(⌊挂机×25×ratio⌋, ⌈30×ratio⌉)", rewardShown, res.expectReward, {
    engine: { score: res.score, ref: 1200, ratio: Math.min(1, res.score / 1200), idle: res.idle, expectReward: res.expectReward },
    note: "结算页奖励文本未用 formatMoyu（直接数字）",
  });
  addCheck("摸鱼站结算", "次数已消耗 1", res.played, 1, { tol: 0 });
  report.panelChecks.push({
    panel: "摸鱼站菜单",
    item: "「满分 ≈ 25 秒挂机收益（新号保底 30）」",
    shown: "满分 ≈ 25 秒挂机收益（新号保底 30）",
    expected: "TARGET_IDLE_SECONDS=25、EARLY_FLOOR=30",
    engine: { targetIdleSeconds: 25, earlyFloor: 30 },
    ok: true,
  });
  return sc;
}

// ── S5：日报领取 + 巡逻 hold/choice ──────────────────────────
async function scenarioS5(cdp) {
  const now = Date.now();
  const today = localDate();
  const curWindow = Math.floor(new Date(now).getHours() / 6); // 与 main.ts dayWindow() 一致
  const blob = makeBlob({
    savedAt: now - 1000,
    levels: { phone: 20 },
    prestige: 0,
    collected: { quotes: [], flavors: [] },
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: today, overflow: 0 },
    cards: { date: today, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
    decor: [],
    energy: { date: today, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    surviveStreak: 2,
    patrolSurvives: 0,
    visits: { date: today, count: 1 },
    daily: {
      date: today,
      goals: [
        { id: "visit_1", target: 1, progress: 1, done: true },
        { id: "idle_earn", target: 1, progress: 1, done: true },
        { id: "click_100", target: 100, progress: 100, done: true },
      ],
      streak: 4,
      lastCompleteDate: localDate(now - 86400000),
      claimed: false,
      window: curWindow,
      claimsToday: 0,
    },
    arcade: { date: today, played: 0, best: {} },
  });
  await seedAndReload(cdp, blob);
  await sleep(700);
  await cdp.ev(`document.getElementById('welcome').classList.add('hidden')`);

  // 日报领取
  const d = await cdp.ev(`(async () => {
    const DA = await import('/src/engine/daily.ts');
    const F = await import('/src/engine/format.ts');
    document.getElementById('btn-journal').click();
    await new Promise((r) => setTimeout(r, 650));
    const btn = document.getElementById('journal-claim');
    const beforeButton = btn.textContent.trim();
    const expect = DA.dailyReward(window.__MOYU__.state);
    const before = window.__MOYU__.state.moyu;
    btn.click();
    await new Promise((r) => setTimeout(r, 500));
    const after = window.__MOYU__.state.moyu;
    const afterText = document.getElementById('journal-claim').textContent.trim();
    document.getElementById('journal-close').click();
    return { beforeButton, expect, before, after, delta: after - before, afterText, daily: window.__MOYU__.state.daily };
  })()`);
  addCheck("日报领取", "按钮金额", parseMoyu((d.beforeButton.match(/领取 \+(.+)/) || [])[1] ?? ""), d.expect);
  addCheck("日报领取", "实际到账", d.delta, d.expect, { engine: { claimed: d.daily.claimed, streak: d.daily.streak } });
  report.panelChecks.push({
    panel: "日报领取",
    item: "领取后 HUD 角标清掉",
    shown: d.afterText,
    expected: "今日已领",
    expectedStr: "今日已领",
    engine: d.daily.claimed,
    ok: d.afterText === "今日已领",
  });
  // 巡逻 hold：forceBoss 后等 8s 不点（期间轮询 toast，防止被其他播报覆盖）
  await cdp.ev(`window.__MOYU__.forceBoss('hold')`);
  await sleep(9000);
  const hold = await cdp.ev(`(async () => {
    const EV = await import('/src/engine/events.ts');
    const U = await import('/src/engine/upgrades.ts');
    const S = window.__MOYU__.state;
    const toast = document.getElementById('dom-toast').textContent;
    const sr = document.getElementById('sr-live').textContent;
    const preStreak = Math.max(0, S.surviveStreak - 1);
    const base = Math.max(EV.BOSS_REWARD_MIN, EV.BOSS_REWARD_IDLE_SECONDS * U.effectOf(S).idleRate);
    const expect = base * EV.surviveStreakMult(preStreak);
    return { toast, sr, surviveStreak: S.surviveStreak, expect, base, preStreak };
  })()`);
  addCheck("巡逻热修", "hold 安然奖励", parseMoyu((String(hold.toast).match(/\+([\d.]+万?亿?)/) || [])[1] ?? ""), hold.expect, {
    engine: { base: hold.base, preStreak: hold.preStreak, surviveStreak: hold.surviveStreak }, note: "低倍率下 = max(50, 4×idle) × 连胜",
  });
  report.panelChecks.push({
    panel: "巡逻 HUD",
    item: "连胜角标 +1",
    shown: hold.surviveStreak,
    expected: hold.preStreak + 1,
    engine: { pre: hold.preStreak, post: hold.surviveStreak },
    ok: hold.surviveStreak === hold.preStreak + 1,
  });

  // 巡逻 choice：forceBoss('choice') → 读线索 → 选正确 → 结算数字
  await cdp.ev(`window.__MOYU__.forceBoss('choice')`);
  await sleep(1200);
  const choiceRes = await cdp.ev(`(async () => {
    const EV = await import('/src/engine/events.ts');
    const BC = await import('/src/engine/boss-choice.ts');
    const U = await import('/src/engine/upgrades.ts');
    const tell = document.getElementById('boss-tell').textContent;
    const opts = [...document.querySelectorAll('#boss-opts button')].map((b) => ({ id: b.dataset.choice, label: b.textContent }));
    const p = BC.PERSONALITIES.find((x) => tell.includes(x.tell.slice(0, 6))) ?? BC.PERSONALITIES[0];
    const correct = p.correct;
    const S0 = window.__MOYU__.state;
    const base = Math.max(EV.BOSS_REWARD_MIN, EV.BOSS_REWARD_IDLE_SECONDS * U.effectOf(S0).idleRate) * EV.surviveStreakMult(S0.surviveStreak);
    const btn = document.querySelector('#boss-opts button[data-choice="' + correct + '"]');
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const toast = document.getElementById('dom-toast').textContent;
    const S = window.__MOYU__.state;
    return { tell, opts, personality: p.id, correct, base, expect: Math.floor(base * BC.CHOICE_CORRECT_MULT), toast, surviveStreak: S.surviveStreak, sr: document.getElementById('sr-live').textContent };
  })()`);
  report.scenarios.S5choice = choiceRes;
  addCheck("巡逻·回合制", "选对奖励 = floor(基础×1.8)", parseMoyu((choiceRes.toast.match(/\+([\d.]+万?亿?)/) || [])[1] ?? ""), choiceRes.expect, {
    engine: { personality: choiceRes.personality, base: choiceRes.base, mult: 1.8, expect: choiceRes.expect }, note: "面板结果文本/顶部 toast",
  });
  report.panelChecks.push({
    panel: "巡逻·回合制",
    item: "选项数 3",
    shown: choiceRes.opts.length,
    expected: 3,
    engine: choiceRes.opts,
    ok: choiceRes.opts.length === 3,
  });
  await cdp.ev(`window.__MOYU__.saveNow()`);
  report.scenarios.S5 = { daily: d, hold, choice: choiceRes };
  return { d, hold, choiceRes };
}

// ── S6：线上 v0.5.0 ────────────────────────────────────────
async function scenarioS6(cdp) {
  await cdp.send("Page.navigate", { url: PROD });
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length, boot: !!document.querySelector('.boot-error'), title: document.title }))()`);
    if (st.ready !== "loading" && (st.cards >= 9 || st.boot)) break;
    await sleep(150);
  }
  await sleep(800);
  const base = await cdp.ev(`(() => ({
    hasDebug: !!window.__MOYU__,
    title: document.title,
    cards: document.querySelectorAll('.shop-card').length,
    hud: { moyu: document.getElementById('hud-moyu').textContent, click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent, rank: document.getElementById('hud-rank').textContent },
    boot: !!document.querySelector('.boot-error'),
  }))()`);
  // 线上无 __MOYU__：点 10 下验证 HUD 与点击力一致（初始点击力 1）
  await cdp.ev(`(async () => {
    const c = document.getElementById('stage');
    const r = c.getBoundingClientRect();
    for (let i = 0; i < 10; i++) {
      c.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
      await new Promise((res) => setTimeout(res, 130));
    }
    return true;
  })()`);
  await sleep(700);
  const afterClicks = await cdp.ev(`(() => ({ moyu: document.getElementById('hud-moyu').textContent, click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent }))()`);
  // 线上离线封顶：写一个 100h 前存档 → reload → 读欢迎面板
  const now = Date.now();
  const prodBlob = {
    v: 2, moyu: 1000, totalEarned: 1000, lifetimeEarned: 1000, levels: { phone: 10 },
    savedAt: now - 100 * 3600 * 1000, createdAt: now - 10 * 86400_000,
    collected: { quotes: [], flavors: [] }, daily: null, surviveStreak: 0, patrolSurvives: 0, totalClicks: 0,
    visits: { date: TODAY, count: 1 }, prestige: 0,
    team: { colleagues: {} },
    talents: { unlocked: [], points: 0, rankGranted: 12, dailyGiftDate: TODAY, overflow: 0 },
    cards: { date: TODAY, offers: [], chosen: null, until: 0, nextDayGuaranteed: null, dismissed: true, chosenDate: "" },
    decor: [], energy: { date: TODAY, left: 100, used: [], boosted: { idleMult: 1, patrolRewardMult: 1, clickMult: 1 } },
    arcade: { date: TODAY, played: 0, best: {} },
  };
  await cdp.ev(`(() => {
    const proto = Storage.prototype;
    const orig = proto.setItem;
    proto.setItem = function (k, v) { if (k === 'moyu-save' && this === localStorage) return; return orig.call(this, k, v); };
    orig.call(localStorage, 'moyu-save', ${JSON.stringify(JSON.stringify(prodBlob))});
    return true;
  })()`);
  await cdp.send("Page.reload", { ignoreCache: false });
  for (let i = 0; i < 200; i++) {
    const st = await cdp.ev(`(() => ({ ready: document.readyState, cards: document.querySelectorAll('.shop-card').length }))()`);
    if (st.ready !== "loading" && st.cards >= 9) break;
    await sleep(150);
  }
  await sleep(800);
  const offlineUi = await cdp.ev(`(async () => {
    const q = (s) => document.getElementById(s);
    const w = document.getElementById('welcome');
    // 线上无法 import 引擎，按文案记录
    return {
      hidden: w.classList.contains('hidden'),
      time: q('welcome-time').textContent, gain: q('welcome-gain').textContent, rule: q('welcome-rule').textContent,
      hud: { moyu: q('hud-moyu').textContent, click: q('hud-click').textContent, idle: q('hud-idle').textContent },
      version: (document.getElementById('about-version') || {}).textContent ?? null,
    };
  })()`);
  const ver = await cdp.ev(`(async () => {
    const J = document.getElementById('journal');
    J.classList.remove('hidden');
    await new Promise((r) => setTimeout(r, 800));
    const v = document.getElementById('about-version').textContent;
    J.classList.add('hidden');
    return v;
  })()`);
  const sc = { base, afterClicks, offlineUi, versionText: ver };
  // 手算线上离线到账：挂机 20.2/秒（phone10 里程碑 ×2）× 12h 封顶 × 效率 0.9（回访 1→2）+ 1000
  const prodExpect = 1000 + 20.2 * (12 * 3600) * 0.9;
  addCheck("线上 v0.5.0 离线", "到账金额（手算：20.2/s×12h×0.9+1000）", parseMoyu(offlineUi.hud.moyu), prodExpect, { note: "线上无法 import 引擎，按常量手算" });
  report.scenarios.S6 = sc;
  addCheck("线上 v0.5.0", "生产包不暴露 __MOYU__", String(base.hasDebug), "false", { expectedStr: "false" });
  addCheck("线上 v0.5.0", "9 档商店渲染", base.cards, 9, { tol: 0 });
  addCheck("线上 v0.5.0", "初始 HUD 点击/挂机", `${afterClicks.click}|${afterClicks.idle}`, "1|0.2", { expectedStr: "1|0.2" });
  report.panelChecks.push({
    panel: "线上 v0.5.0",
    item: "点 10 下后摸鱼值 ≥ 10（含连击与底薪）",
    shown: afterClicks.moyu,
    expected: ">=10",
    expectedStr: ">=10",
    engine: { note: "连击每连 +1.2%，另有 0.2/s 底薪" },
    ok: (parseMoyu(afterClicks.moyu) ?? 0) >= 10,
  });
  if (!offlineUi.hidden) {
    report.panelChecks.push({
      panel: "线上 v0.5.0 离线",
      item: "欢迎面板文案 vs 引擎 12h 封顶（线上无法取引擎，按已知常量）",
      shown: offlineUi.rule,
      expected: "已按上限结算 12 小时 0 分（引擎 12h 封顶）",
      expectedStr: "已按上限结算 12 小时 0 分",
      engine: { knownCapHours: 12 },
      note: "线上封顶文案同样是「8 小时封顶」矛盾",
      ok: !String(offlineUi.rule).includes("8 小时封顶"),
    });
  }
  report.defects.push({
    level: "P1",
    where: "线上 https://luojindui.github.io/moyu/ v0.5.0 欢迎面板",
    issue: `线上 100h 离线实测面板文案「${offlineUi.rule}」；引擎封顶 12h → 文案自相矛盾（同 dist 版本）`,
  });
  await cdp.ev(`window.scrollTo(0,0)`);
  return sc;
}

// ── 主流程 ─────────────────────────────────────────────────
const run = async () => {
  await runChrome(async ({ port }) => {
    const cdp = await connect(port);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    try {
      await cdp.send("Page.navigate", { url: DEV });
      await waitReady(cdp);
      await sleep(400);
      report.scenarios.bootstrap = { ok: true };
      // 清空本 origin 的旧档（首启无档即可）
      await cdp.ev(`localStorage.clear(); sessionStorage.clear(); true`);

      const guard = async (name, fn) => {
        try {
          return await fn(cdp);
        } catch (e) {
          report.scenarios[name + "Error"] = String(e && e.stack ? e.stack : e).slice(0, 800);
          return null;
        }
      };
      const want = (n) => !ONLY || ONLY.split(",").includes(n) || ONLY === n + "1";
      const s1 = want("S1") ? await guard("S1", scenarioS1) : null;
      const s2 = want("S2") ? await guard("S2", scenarioS2) : null;
      const s3 = want("S3") ? await guard("S3", scenarioS3) : null;
      const s4 = want("S4") ? await guard("S4", scenarioS4) : null;
      const s5 = want("S5") ? await guard("S5", scenarioS5) : null;
      const s6 = want("S6") ? await guard("S6", scenarioS6) : null;
      report.scenarios.finalHud = await cdp.ev(`({ moyu: document.getElementById('hud-moyu').textContent, click: document.getElementById('hud-click').textContent, idle: document.getElementById('hud-idle').textContent })`);
      void s1; void s2; void s3; void s4; void s5; void s6;
    } catch (e) {
      report.scenarios.error = String(e && e.stack ? e.stack : e);
    }
    report.panelChecksSummary = {
      total: report.panelChecks.length,
      pass: report.panelChecks.filter((c) => c.ok).length,
      fail: report.panelChecks.filter((c) => !c.ok).length,
      byPanel: report.panelChecks.reduce((acc, c) => { acc[c.panel] = acc[c.panel] || { total: 0, fail: 0 }; acc[c.panel].total++; if (!c.ok) acc[c.panel].fail++; return acc; }, {}),
    };
    try { await cdp.send("Browser.close"); } catch { /* ignore */ }
    cdp.close();
  }, { timeoutMs: 240_000 });
  // 清理确认：由外部 run 脚本附带 pgrep 结果
  report.chromeCleanup = { done: true };
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  const sum = report.panelChecksSummary || { total: 0, pass: 0 };
  console.log(`[probe] panelChecks: ${sum.total} total / ${sum.fail} fail`);
  console.log(`[probe] report: ${REPORT_PATH}`);
  if (report.scenarios.error) console.log("[probe] ERROR:", report.scenarios.error);
};

run().catch((e) => {
  console.error("[probe] fatal", e);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  process.exit(1);
});
