import "./style.css";
import { initialState, gain } from "./engine/state";
import { doClick, buyUpgrade, clickPowerOf, comboMultiplier, comboCapOf, comboWindowOf, COMBO_BREAK_S } from "./engine/actions";
import { effectOf, stationIdleScaled } from "./engine/upgrades";
import { advance } from "./engine/tick";
import { settleReturn } from "./engine/resume";
import { CLICK_MEMES, MEME_QUOTES } from "./engine/flavor";
import { serialize, restore, clearSave, encodeSaveCode, decodeSaveCode, backupNewerSave, SAVE_KEY, type SaveAdapter } from "./engine/save";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  finishPatrol,
  type EventState,
} from "./engine/events";
import { collectQuote, syncFlavorCollection } from "./engine/collection";
import { ensureVisits, offlineEfficiency } from "./engine/progression";
import { rankFor, RANKS } from "./engine/titles";
import { formatMoyu } from "./engine/format";
import { chapterFor, zhouLine, bossOutcome, bossChoiceLine, HR_PRESTIGE_LINE } from "./engine/story";
import { APP_VERSION } from "./version";
import { RECORDS_KEY, parseRecords, updateRecords, type Records } from "./engine/records";
import { doPrestige } from "./engine/prestige";
import { ensureDaily, dailyTrack, claimDaily } from "./engine/daily";
import { Hud } from "./ui/hud";
import { Shop } from "./ui/shop";
import { Welcome } from "./ui/welcome";
import { Journal } from "./ui/journal";
import { Quest } from "./ui/quest";
import { TeamPanel } from "./ui/team-panel";
import { CardPanel } from "./ui/card-panel";
import { BossChoicePanel } from "./ui/boss-panel";
import { CARDS, chooseCard, dismissCards, ensureCards } from "./engine/cards";
import { onBossChoice } from "./engine/events";
import { DECOR, buyDecor, decorComplete, decorDef } from "./engine/decor";
import { energyActionDef, ensureEnergy, useEnergy } from "./engine/energy";
import { CHOICE_SECONDS } from "./engine/boss-choice";
import { cardEffects } from "./engine/cards";
import { claimMission, colleagueDef, recruit, upgradeColleague, dispatch as dispatchMission , setAutoRepeat, favorTier } from "./engine/team";
import { grantDailyTalentPoint, grantRankTalents, resetTalents, talentEffects, unlockTalent } from "./engine/talents";
import { initAudio, playClick, playBreak, playSuccess, toggleMute, isMuted } from "./ui/audio";
import { Scene, SPRITE_MAP } from "./render/scene";
import { SpriteGrid, frameActivity } from "./render/sprites";

const localStorageAdapter: SaveAdapter = {
  getItem: (k) => localStorage.getItem(k),
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: (k) => localStorage.removeItem(k),
};

/** 调试与试玩钩子状态 */
const debug = {
  fps: 0,
  frames: 0,
  assets: {} as Record<string, "loaded" | "error">,
  activity: {} as Record<string, number[][]>,
  spriteMap: null as unknown,
};

const LOAD_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function boot(): Promise<void> {
  try {
    if (!sessionStorage.getItem("moyu-boot-ms")) sessionStorage.setItem("moyu-boot-ms", String(Date.now()));
  } catch {
    /* 忽略 */
  }
  initAudio();
  // 1) 状态与离线结算（不依赖任何资产）；离线效率现算：建档 24h 内全额，之后 70%
  const restored = restore(localStorageAdapter, Date.now());
  let state = restored.state ?? initialState();
  state = ensureVisits(state, Date.now()); // 本次打开算一次回访（可把离线效率挣回 1.0）
  // 先按今天重置精力/卡池，再结算离线：否则"昨天的精力加成"会被算进今天这笔离线收益
  state = ensureEnergy(state, new Date().toLocaleDateString("sv-SE"));
  const currentOfflineRate = (): number => offlineEfficiency(state, restored.createdAt, Date.now());
  const offline = settleReturn(state, Date.now() - restored.offlineSeconds * 1000, Date.now(), currentOfflineRate());
  state = offline.state;

  // 2) UI 与场景骨架（先装配，资产后到）
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const scene = new Scene({});
  const hud = new Hud();
  const welcome = new Welcome();
  const today = (): string => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（本地时区）
  // 读档迁移：补齐历史彩蛋档 + 保证今日日报存在
  state = syncFlavorCollection(state);
  const dayWindow = (): number => Math.floor(new Date().getHours() / 6); // 每 6 小时一个时段
  state = ensureDaily(state, today(), Math.random, dayWindow());
  const journal = new Journal(
    () => {
      const r = claimDaily(state, today());
      if (r.claimedReward !== null) {
        state = r.state;
        hud.refresh(state);
        journal.refresh(state, true); // 领取后立即重绘（不等 400ms 节流）
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    () => {
      // 导出当前存档为存档码
      const store = new Map<string, string>();
      const mem: SaveAdapter = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => void store.set(k, v),
        removeItem: (k) => void store.delete(k),
      };
      serialize(state, mem, Date.now());
      return encodeSaveCode(store.get(SAVE_KEY) ?? "{}");
    },
    (code: string) => {
      // 导入存档码：校验 → 备份旧档 → 重置 savedAt（不结算离线）→ 重新加载
      const dec = decodeSaveCode(code);
      if (!dec.ok) return { ok: false, message: `导入失败：${dec.error}` };
      try {
        const blob = JSON.parse(dec.blob!) as Record<string, unknown>;
        blob.savedAt = Date.now(); // 防旧码反复刷离线
        const old = localStorage.getItem(SAVE_KEY);
        if (old) localStorage.setItem(`${SAVE_KEY}.bak`, old);
        localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
        suppressSave = true; // 阻止 pagehide/自动存档用旧内存状态覆盖刚导入的档
        clearInterval(saveTimer);
        setTimeout(() => location.reload(), 300);
        return { ok: true, message: "导入成功，正在重新加载…" };
      } catch {
        return { ok: false, message: "导入失败：存档内容损坏" };
      }
    },
    () => {
      // 离职再就业：确认后重置本局
      const r = doPrestige(state);
      if (!r) return;
      state = r.state;
      es.bossUntil = -1;
      es.memeUntil = -1;
      es.nextBossAt = Infinity;
      es.nextMemeAt = Infinity;
      es.bossCaught = false;
      es.bossPenaltyTotal = 0;
      es.surviveStreak = 0; // 转生重置连胜（避免旧连胜被下次巡逻写回）
      prevBossActive = false;
      scene.gameTime = 0;
      hud.refresh(state);
      shop.refresh(state);
      journal.refresh(state, true);
      toast(HR_PRESTIGE_LINE);
      serialize(state, localStorageAdapter, Date.now());
    },
  );
  const teamPanel = new TeamPanel({
    onRecruit: (id) => {
      const next = recruit(state, id);
      if (next) {
        state = next;
        hud.refresh(state);
        shop.refresh(state);
        teamPanel.refreshNow(state);
        announce(`招募成功：${colleagueDef(id)?.name ?? ""}`);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onUpgrade: (id) => {
      const next = upgradeColleague(state, id);
      if (next) {
        state = next;
        hud.refresh(state);
        shop.refresh(state);
        teamPanel.refreshNow(state);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onDispatch: (id, missionId) => {
      const next = dispatchMission(state, id, missionId, Date.now(), stationIdleScaled(state));
      if (next) {
        state = next;
        teamPanel.refreshNow(state);
        announce(`${colleagueDef(id)?.name ?? ""} 出发去派遣了`);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onClaim: (id) => {
      const r = claimMission(state, id, Date.now(), stationIdleScaled(state));
      if (r) {
        state = r.state;
        hud.refresh(state);
        shop.refresh(state);
        teamPanel.refreshNow(state);
        if (teamPanel.isOpen) teamPanel.flash(`任务完成 +${formatMoyu(r.reward)}`);
        else toast(`任务完成 +${formatMoyu(r.reward)}`);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onClaimAll: () => {
      const now = Date.now();
      const station = stationIdleScaled(state);
      let total = 0;
      let count = 0;
      for (const def of ["zhou", "mei", "qiang", "li", "wang"]) {
        const r = claimMission(state, def, now, station);
        if (r) {
          state = r.state;
          total += r.reward;
          count++;
        }
      }
      if (count > 0) {
        hud.refresh(state);
        shop.refresh(state);
        teamPanel.refreshNow(state);
        const msg = `一键领取 ${count} 个任务 +${formatMoyu(total)}`;
        if (teamPanel.isOpen) teamPanel.flash(msg);
        else toast(msg);
        playSuccess();
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onToggleAuto: (id, on) => {
      const next = setAutoRepeat(state, id, on);
      if (next) {
        state = next;
        teamPanel.refreshNow(state);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onUnlockTalent: (id) => {
      const next = unlockTalent(state, id);
      if (next) {
        state = next;
        hud.refresh(state);
        teamPanel.refreshNow(state);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onBuyDecor: (id) => {
      const next = buyDecor(state, id);
      if (next) {
        state = next;
        hud.refresh(state);
        teamPanel.refreshNow(state);
        const def = decorDef(id);
        const done = decorComplete(state);
        const msg = done
          ? `工位装修完成！全部 8 件，挂机额外 +10%`
          : `已装修：${def?.name ?? ""}（${def?.desc ?? ""}）`;
        showToast(msg);
        announce(msg, 1);
        if (done) {
          playSuccess();
          showToast("🎉 工位装修完成：挂机 +10%");
        }
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onUseEnergy: (id) => {
      const next = useEnergy(state, id as never);
      if (next) {
        state = next;
        hud.refresh(state);
        teamPanel.refreshNow(state);
        const def = energyActionDef(id as never);
        const msg = `精力已使用：${def?.name ?? ""}（剩余 ${state.energy.left} 点）`;
        showToast(msg);
        announce(msg, 1);
        if (state.energy.used.length >= 3) {
          setTimeout(() => announce("今日精力已用完"), 400);
        }
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onUseAllEnergy: () => {
      let used = 0;
      // 省心组合 = 最便宜的三项（social 25 + fake-work 35 + slack 40 = 100）
      for (const a of ["social", "fake-work", "slack"] as const) {
        const next = useEnergy(state, a);
        if (next) {
          state = next;
          used++;
        }
      }
      if (used > 0) {
        hud.refresh(state);
        teamPanel.refreshNow(state);
        const msg = `已使用 ${used} 项精力（剩余 ${state.energy.left} 点）`;
        showToast(msg);
        announce(msg, 1);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    onResetTalents: () => {
      if (!confirm("确定重置全部天赋？会返还全部已用点数。")) return;
      state = resetTalents(state);
      hud.refresh(state);
      teamPanel.refreshNow(state);
      serialize(state, localStorageAdapter, Date.now());
      toast("天赋已重置，点数已返还");
    },
  });
  const cardPanel = new CardPanel(
    (id) => {
      const def = CARDS.find((c) => c.id === id);
      const next = chooseCard(state, id, Date.now());
      if (next) {
        state = next;
        hud.refresh(state);
        showToast(`今日卡：${def?.name ?? ""}`);
        serialize(state, localStorageAdapter, Date.now());
      }
    },
    () => {
      state = dismissCards(state);
      cardPanel.hide();
      serialize(state, localStorageAdapter, Date.now());
    },
  );
  let choicePickedThisRound = false;
  const bossPanel = new BossChoicePanel((choice) => {
    const r = onBossChoice(state, es, choice, scene.gameTime);
    if (r) {
      choicePickedThisRound = true;
      state = r.state;
      hud.refresh(state);
      if (r.correct) {
        playSuccess();
        trackDaily("survive");
      }
      const line = bossChoiceLine(es.bossPersonality, r.correct);
      const text =
        r.delta === 0 && !r.correct
          ? `${line}（新手保护，这次不扣钱）`
          : `${line} ${r.delta >= 0 ? "+" : ""}${Math.round(r.delta)}`;
      bossPanel.showResult(r.correct, text);
      // 兜底：面板内结果在低帧率下可能一闪而过，顶部再给一次短提示
      setTimeout(() => showToast(text), 280);
      announce(r.correct ? "应对正确" : "应对错误");
      serialize(state, localStorageAdapter, Date.now());
    }
  });

  const shop = new Shop(
    (id) => {
    const next = buyUpgrade(state, id);
    if (next) {
      state = syncFlavorCollection(next); // 购买后同步新解锁的彩蛋档
      shop.refresh(state);
      journal.refresh(state);
      state = { ...state, daily: state.daily ? dailyTrack(state.daily, "buy") : null };
      hud.refresh(state);
      serialize(state, localStorageAdapter, Date.now());
      }
    },
    (msg) => {
      showToast(msg);
      announce(msg);
    },
  );

  const fit = (): void => {
    const wrap = canvas.parentElement!;
    const dpr = Math.min(3, window.devicePixelRatio || 1); // DPR3 设备不再糊
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    scene.resize(w, h);
  };
  fit();
  window.addEventListener("resize", fit);
  // 商店首帧撑高会改变容器高度 → 用 ResizeObserver 跟随（修复 draw 区比容器高 42px 的错位）
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => fit());
    ro.observe(canvas.parentElement!);
  }

  // 3) 输入：主指针才算点击（防多指连点刷）；巡逻中点击 = 偷点（有收入也有风险）
  const es: EventState = newEventState();
  es.surviveStreak = state.surviveStreak; // 连胜入档：读档恢复
  scene.events = es;
  let combo = 0; // 连击链（间隔 <0.4s 累积，>3s 断）
  let lastClickAt = 0;
  const trackDaily = (kind: "click" | "meme" | "buy" | "survive" | "visit" | "idle", n = 1): void => {
    if (state.daily) state = { ...state, daily: dailyTrack(state.daily, kind, n) };
  };
  // 上线即记一次 visit 目标（否则"今天上线看一眼"永远 0/1）
  trackDaily("visit");
  let lastPointerAt = 0;
  const doTap = (clientX: number, clientY: number): void => {
    // 回合制老板窗口内画布点击不处理（避免"边思考边被罚偷点"）
    if (bossPanel.isOpen) {
      const vp = scene.toVirtual(clientX, clientY, canvas);
      scene.fx.floatText(vp.x, vp.y, "先选应对");
      return;
    }
    const nowMs = performance.now();
    // 允许双指连点（音游常用），但两次点击至少间隔 80ms 防作弊
    if (nowMs - lastPointerAt < 80) return;
    lastPointerAt = nowMs;
    const p = scene.toVirtual(clientX, clientY, canvas);
    // 连击链更新
    const gap = (nowMs - lastClickAt) / 1000;
    const prevCombo = combo;
    // 天赋 click_2/click_3：窗口 +0.15s、上限 +10
    const comboWin = comboWindowOf(state);
    const comboCap = comboCapOf(state);
    combo = gap < comboWin ? Math.min(comboCap, combo + 1) : gap > COMBO_BREAK_S ? 0 : combo;
    if (prevCombo >= 2 && combo === 0) playBreak();
    lastClickAt = nowMs;

    if (es.bossUntil > scene.gameTime) {
      // 偷点：拿走点击收入 + 赌一次罚款（过了宽限才罚，每巡逻一次）
      const r = onBossTap(state, es, scene.gameTime, combo);
      state = r.state;
      trackDaily("click");
      if (r.caught) {
        scene.fx.floatText(p.x, p.y, `偷点被逮！+${Math.round(r.income)} -${Math.round(r.lost)}`);
      } else if (es.bossVariant === "type" || es.bossVariant === "blitz") {
        // 任务变体：说的是"摸鱼 +N"，不显示"偷点"
        scene.fx.floatText(p.x, p.y, `摸鱼 +${Math.round(r.income)}`);
      } else if (r.income > 0) {
        scene.fx.floatText(p.x, p.y, `偷点 +${Math.round(r.income)}`);
      }
      playClick(combo);
      return;
    }
    // 丢梗命中（虚拟坐标半径内）
    const vx = p.x / scene.scale;
    const vy = p.y / scene.scale;
    const hitMeme =
      es.memeUntil > scene.gameTime && Math.hypot(vx - scene.memePos.x, vy - scene.memePos.y) < 3 * 16;
    if (hitMeme) {
      const r = onMemeTap(state, es);
      const qi = Math.floor(Math.random() * MEME_QUOTES.length);
      state = collectQuote(r.state, qi).state;
      trackDaily("meme");
      const quote = MEME_QUOTES[qi] ? zhouLine(MEME_QUOTES[qi]!) : "";
      scene.fx.floatText(p.x, p.y - 24, quote ?? "");
      scene.fx.floatText(p.x, p.y, `梗收了 +${Math.round(r.earned)}`);
      journal.refresh(state);
      return;
    }
    const clickComboCap = comboCapOf(state);
    let gained = clickPowerOf(state) * comboMultiplier(combo, clickComboCap);
    // 天赋 click_4：每 N 次点击必暴击 ×5（巡逻偷点不触发，保红线 C）
    const critEvery = talentEffects(state.talents).critEvery;
    const isCrit = critEvery > 0 && (state.totalClicks + 1) % critEvery === 0;
    if (isCrit) {
      gained *= 5;
      scene.fx.floatText(p.x, p.y - 30, "暴击!");
      playSuccess();
    }
    // 暴击倍率同时作用于实际入账（飘字=入账）
    state = doClick(state, combo, isCrit ? 5 : 1);
    trackDaily("click");
    if (state.totalClicks % 25 === 0) state = syncFlavorCollection(state); // 点击线彩蛋按累计点击数解锁
    const meme = CLICK_MEMES[Math.floor(Math.random() * CLICK_MEMES.length)];
    playClick(combo);
    const text =
      combo >= 6 ? `连点×${combo} +${Math.round(gained)}` : Math.random() < 0.22 && meme ? meme : `+${Math.round(gained)}`;
    scene.fx.floatText(p.x, p.y, text);
  };
  canvas.addEventListener("pointerdown", (e) => doTap(e.clientX, e.clientY));
  // 键盘（桌面）：空格/回车 = 点一下场景中心
  canvas.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      doTap(r.left + r.width / 2, r.top + r.height / 2);
    }
  });

  // 4) 主循环（资产未到也照跑，占位色块兜底）
  let last = performance.now();
  let lastActiveMs = Date.now();
  let fpsWindowStart = last;
  let fpsFrames = 0;
  let lastDaySnapshot = { date: today(), lifetime: state.lifetimeEarned };
  let lastHud = 0;
  let prevBossActive = false;
  const quest = new Quest((text) => toast(text));
  let lastRankName = "";
  let lastChapterId = "";
  let warnedBoss = false;
  let lastDoneMissions = new Set<string>();
  let lastCollectionCount = state.collected.quotes.length + state.collected.flavors.length;
  const srLive = document.getElementById("sr-live");
  // DOM toast：长消息走这里（canvas 飘字只留短文本 +N / 连×N）
  const toastEl = (() => {
    const el = document.createElement("div");
    el.id = "dom-toast";
    document.body.appendChild(el);
    return el;
  })();
  let toastTimer = 0;
  const showToast = (text: string): void => {
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1800);
  };

  let announceLockUntil = 0;
  const announce = (text: string, priority = 0): void => {
    const now = Date.now();
    // 操作反馈（priority=1）锁定 500ms，避免被段位/章节等系统播报立刻覆盖
    if (priority === 0 && now < announceLockUntil) return;
    if (srLive) srLive.textContent = text; // aria-live 区域：读屏可听到关键事件
    if (priority === 1) announceLockUntil = now + 500;
  };
  const toast = (text: string): void => {
    // 短文本走 canvas 飘字（跟着场景），长文本走 DOM toast（不折行不截断）
    if (text.length <= 10) scene.fx.floatText(scene.w / 2, scene.h * 0.22, text);
    else showToast(text);
    announce(text);
  };
  // 模态：Esc 关闭 + 打开时把焦点移入面板
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const j = document.getElementById("journal")!;
    const w = document.getElementById("welcome")!;
    if (!j.classList.contains("hidden")) journal.hide();
    else if (teamPanel.isOpen) teamPanel.hide();
    else if (cardPanel.isOpen) {
      state = dismissCards(state);
      cardPanel.hide();
    }
    else if (!w.classList.contains("hidden")) w.classList.add("hidden");
  });
  const rng = Math.random;
  const frame = (now: number): void => {
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    // 面板打开 / 页面不可见时降帧：只减少绘制，状态仍按真实 dt 推进（否则开面板时收入变 1/3）
    const overlayOpen = !document.getElementById("journal")!.classList.contains("hidden");
    const throttleDraw = overlayOpen || document.visibilityState === "hidden";
    lastActiveMs = Date.now();
    scene.gameTime += dt;
    // 随机事件调度（丢梗位置：每次窗口随机出现在场景上半区，并按视口高度防裁剪）
    const memeWasIdle = es.memeUntil < 0;
    // 任一模态打开时，把即将触发的事件往后推（避免"老板盖在日报/卡弹窗上"）
    const anyModalOpen =
      !document.getElementById("journal")!.classList.contains("hidden") ||
      !document.getElementById("team")!.classList.contains("hidden") ||
      !document.getElementById("cards")!.classList.contains("hidden");
    if (anyModalOpen && es.bossUntil < 0 && es.nextBossAt <= scene.gameTime) {
      es.nextBossAt = scene.gameTime + 3;
    }
    scheduleEvents(es, scene.gameTime, rng, cardEffects(state, Date.now()).eventRateMult);
    if (memeWasIdle && es.memeUntil > 0) {
      announce("老周丢来一个梗：戳亮起的黄点");
      const vh = scene.h / scene.scale;
      const yMax = Math.min(10 * 16, Math.max(6 * 16, vh - 6 * 16));
      scene.memePos = {
        x: 4 * 16 + Math.random() * ((scene.w / scene.scale) - 8 * 16),
        y: 4 * 16 + Math.random() * (yMax - 4 * 16),
      };
    }
    // 天赋 event_4：巡逻提前 2s 预警
    {
      const warnSec = talentEffects(state.talents).patrolWarnSeconds + (favorTier(state) >= 1 ? 1 : 0);
      const untilBoss = es.nextBossAt - scene.gameTime;
      if (warnSec > 0 && es.bossUntil < 0 && untilBoss > 0 && untilBoss <= warnSec && !warnedBoss) {
        warnedBoss = true;
        showToast("王总快来了！");
        announce("王总快来了");
      } else if (es.bossUntil >= 0 || untilBoss > warnSec + 3) {
        warnedBoss = false;
      }
    }

    // 巡逻开启瞬间播报规则（读屏用户需要知道要"忍住"）
    if (!prevBossActive && es.bossUntil > scene.gameTime) {
      announce(
        es.bossVariant === "hold"
          ? "王总巡逻：8 秒内不要点屏幕"
          : es.bossVariant === "blitz"
            ? "摸鱼冲刺：8 秒内连点 16 下"
            : es.bossVariant === "choice"
              ? `回合制老板：看线索，在 ${CHOICE_SECONDS} 秒内选对应对`
              : "假装工作：8 秒内点 5 下",
      );
    }
    // 巡逻结束：安然 → 发奖（含连胜乘数）并推进连胜；被抓 → 0 奖清零
    const bossActive = es.bossUntil > scene.gameTime;
    if (prevBossActive && !bossActive) {
      const r = finishPatrol(state, es);
      state = r.state;
      if (r.reward > 0) {
        trackDaily("survive");
        playSuccess();
        const label = es.bossVariant === "blitz" ? "冲刺成功 ×1.5" : es.bossVariant === "type" ? "假装工作成功" : bossOutcome(false);
        showToast(`${label} +${Math.round(r.reward)}（连胜 ${es.surviveStreak}）`);
      } else if (es.bossVariant === "type" || es.bossVariant === "blitz") {
        // 点击任务变体未达标：鼓励语气，不责备
        showToast("这次没完成，没关系～");
      }
    }
    prevBossActive = bossActive;
    // 跨日/跨时段刷新日报（长时间挂机不刷新页面）
    const d = today();
    const w = dayWindow();
    if (state.daily && (state.daily.date !== d || state.daily.window !== w)) {
      state = ensureDaily(state, d, Math.random, w);
      journal.refresh(state, true);
    }
    state = advance(state, dt);
    scene.update(dt);
    if (!throttleDraw) {
      scene.draw(ctx);
      debug.frames++;
    }
    fpsFrames++;
    if (now - fpsWindowStart >= 1000) {
      debug.fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
      fpsFrames = 0;
      fpsWindowStart = now;
    }
    if (now - lastHud >= 150) {
      lastHud = now;
      scene.hideHint = state.totalEarned > 500;
      // 每日首开 +1 天赋点（碎片党每次打开都有 1 个决策）
      {
        const today = new Date().toLocaleDateString("sv-SE");
        const dg = grantDailyTalentPoint(state.talents, today);
        if (dg.granted > 0) {
          state = { ...state, talents: dg.talents };
          teamPanel.refresh(state);
          showToast("送你 1 个天赋点，点 👥 看看");
        }
      }
      // 段位天赋点：按生涯段位发放（幂等）
      {
        const rankIdx = RANKS.findIndex((r, i) => state.lifetimeEarned >= r.at && (i + 1 >= RANKS.length || state.lifetimeEarned < RANKS[i + 1]!.at));
        const idx = rankIdx >= 0 ? Math.max(0, RANKS.filter((r) => state.lifetimeEarned >= r.at).length - 1) : 0;
        const g = grantRankTalents(state.talents, idx);
        if (g.granted > 0) {
          state = { ...state, talents: g.talents };
          toast(`段位奖励：天赋点 +${g.granted}`);
          teamPanel.refresh(state);
          serialize(state, localStorageAdapter, Date.now());
        }
      }
      // 挂机目标：只要在自动收入就记（佛系零操作也能完成）
      if (effectOf(state).idleRate > 0.5) trackDaily("idle");
      // 剧情章节：便签 + 职员配色随生涯进度变化（零新美术）
      const ch = chapterFor(state.lifetimeEarned);
      scene.note = ch.title;
      scene.decor = state.decor; // 工位家具（看得见的成长）
      // canvas 内容的读屏替代：装修摘要
      {
        const el = document.getElementById("decor-summary");
        if (el) {
          const names = state.decor.map((id) => DECOR.find((d) => d.id === id)).filter(Boolean);
          el.textContent = names.length
            ? `工位已装修：${names.map((d) => `${d!.name}（${d!.desc}）`).join("、")}`
            : "工位尚未装修";
        }
      }
      scene.palette = ch.palette;
      if (lastChapterId && ch.id !== lastChapterId) toast(`新章节：${ch.title}`);
      lastChapterId = ch.id;
      quest.tick(state, null);
      // 段位晋升提示（让"新变化"被看见，而不是只藏在 HUD 一行）
      const rankNow = rankFor(state.lifetimeEarned).current;
      if (lastRankName && rankNow !== lastRankName) toast(`段位晋升：${rankNow}`);
      lastRankName = rankNow;
      // 图鉴新增提示
      const cCount = state.collected.quotes.length + state.collected.flavors.length;
      if (cCount > lastCollectionCount) toast(`图鉴 +${cCount - lastCollectionCount}（${cCount}/55）`);
      lastCollectionCount = cCount;
      // 连击超时归零（不点后 HUD 不该一直显示连点）
      if (combo > 0 && (performance.now() - lastClickAt) / 1000 > COMBO_BREAK_S) {
        combo = 0;
        playBreak();
      }
      // 每日精力：跨日重置
      {
        const today = new Date().toLocaleDateString("sv-SE");
        const withEnergy = ensureEnergy(state, today);
        if (withEnergy !== state) {
          state = withEnergy;
          serialize(state, localStorageAdapter, Date.now());
        }
      }
      // 每日事件卡：跨日刷新 + 未选时弹窗
      {
        const today = new Date().toLocaleDateString("sv-SE");
        const withCards = ensureCards(state, today, rng, Date.now());
        if (withCards !== state) {
          state = withCards;
          serialize(state, localStorageAdapter, Date.now());
        }
        const anyPanelOpen =
          !document.getElementById("welcome")!.classList.contains("hidden") ||
          !document.getElementById("team")!.classList.contains("hidden") ||
          !document.getElementById("journal")!.classList.contains("hidden");
        if (!anyPanelOpen) cardPanel.maybeShow(state);
      }
      // 回合制老板：同步弹层
      {
        const wasOpen = bossPanel.isOpen;
        // 新一轮 choice 开始 → 复位"已作答"标记
        if (!wasOpen && bossPanel.isOpen) choicePickedThisRound = false;
        bossPanel.sync(es);
        if (wasOpen && !bossPanel.isOpen && es.bossChoiceDone && es.bossUntil < 0) {
          // 只有"确实超时未作答"才提示；已作答的走面板内结果
          if (!choicePickedThisRound) showToast("没来得及选…这次不算");
          choicePickedThisRound = false;
        }
      }

      // 任务完成提醒（角标之外给一次明确提示）
      {
        const nowMs = Date.now();
        const doneNow = new Set<string>();
        for (const cid of ["zhou", "mei", "qiang", "li", "wang"]) {
          const c2 = state.team.colleagues[cid];
          if (c2 && c2.missionId !== null && nowMs >= c2.endsAt) doneNow.add(cid);
        }
        // 自动重复的同事：完成后自动领取并续班（否则离线会停摆且仍吃离岗折损）
        for (const cid of doneNow) {
          const c2 = state.team.colleagues[cid];
          if (!c2 || !c2.autoRepeat) continue;
          const r = claimMission(state, cid, nowMs, stationIdleScaled(state));
          if (r) {
            state = r.state;
            teamPanel.refresh(state);
          }
        }
        for (const cid of doneNow) {
          const c2 = state.team.colleagues[cid];
          if (c2?.autoRepeat) continue; // 已自动领取的不再提示
          if (!lastDoneMissions.has(cid)) {
            const name = colleagueDef(cid)?.name ?? "";
            if (teamPanel.isOpen) teamPanel.flash(`${name} 回来了，可领取`);
            else showToast(`${name} 回来了，点 👥 领取`);
            playSuccess();
            break; // 一次只提示一条，避免刷屏
          }
        }
        lastDoneMissions = doneNow;
      }
      // 天赋点角标（有无未花点数）
      const teamBtn = document.getElementById("btn-team");
      if (teamBtn) {
        const pBadge = teamBtn.querySelector<HTMLElement>(".talent-badge");
        if (state.talents.points > 0) {
          if (!pBadge) {
            const el = document.createElement("span");
            el.className = "talent-badge";
            teamBtn.appendChild(el);
          }
          (teamBtn.querySelector(".talent-badge") as HTMLElement).textContent = "天赋";
        } else if (pBadge) {
          pBadge.remove();
        }
      }
      hud.refresh(state, combo);
      shop.refresh(state);
      journal.refresh(state);
      teamPanel.refresh(state);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // 5) 存档与前后台切换
  // 本地生涯纪录（独立 key，不动存档 schema）
  let records: Records = (() => {
    try {
      return parseRecords(localStorage.getItem(RECORDS_KEY));
    } catch {
      return parseRecords(null);
    }
  })();
  const saveRecords = (): void => {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
    } catch {
      /* 忽略 */
    }
  };
  let suppressSave = false; // rewindSave 后暂停写档，避免覆盖回拨的时间戳
  // 启动时先备份"更高版本"的存档（防本客户端降级覆盖新数据）
  backupNewerSave(localStorageAdapter);

  const saveTimer = setInterval(() => {
    if (!suppressSave) serialize(state, localStorageAdapter, Date.now());
  }, 10_000);
  const saveNow = (): void => {
    if (!suppressSave) serialize(state, localStorageAdapter, Date.now());
    // 纪录：以"当日收入"为近似，用 lifetime 增量按日累计不易精确，这里用当日净增（同日首帧差值）
    const dayKey = today();
    const dayEarnedNow = state.lifetimeEarned - (lastDaySnapshot.date === dayKey ? lastDaySnapshot.lifetime : state.lifetimeEarned);
    const r = updateRecords(records, {
      date: dayKey,
      dayEarned: dayEarnedNow,
      streak: state.daily?.streak ?? 0,
      lifetime: state.lifetimeEarned,
      clicks: state.totalClicks,
      collection: state.collected.quotes.length + state.collected.flavors.length,
    });
    if (r.changed) {
      records = r.records;
      saveRecords();
    }
  };
  void saveTimer;
  document.addEventListener("pagehide", saveNow);

  const settleForeground = (): void => {
    state = ensureEnergy(state, new Date().toLocaleDateString("sv-SE"));
    const r = settleReturn(state, lastActiveMs, Date.now(), currentOfflineRate());
    if (r.earned > 0) {
      state = r.state;
      hud.refresh(state);
      shop.refresh(state);
      if (r.showPanel) {
        const realSeconds = Math.max(0, (Date.now() - lastActiveMs) / 1000);
        welcome.show(realSeconds, r.earned, currentOfflineRate(), () => undefined, r.applied);
      }
    }
    lastActiveMs = Date.now();
    last = performance.now();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
    else settleForeground();
  });
  // bfcache 恢复（persisted）不触发 visibilitychange 的场景
  window.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) settleForeground();
  });

  if (offline.earned > 0 && offline.showPanel) {
    welcome.show(restored.offlineSeconds, offline.earned, currentOfflineRate(), () => undefined, offline.applied);
  }

  // 6) agent 试玩调试钩子：仅开发/测试构建暴露，生产包剥离（防止 rewindSave 刷离线作弊）
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__MOYU__ = {
    get state(): unknown {
      return JSON.parse(JSON.stringify(state));
    },
    /** 仅 dev：强制触发一次指定变体的巡逻（测试回合制老板用） */
    forceBoss(variant?: string): string {
      es.nextBossAt = scene.gameTime - 0.01;
      es.bossUntil = -1;
      es.memeUntil = -1; // 丢梗期间不会开巡逻
      es.bossChoiceDone = false;
      if (variant) {
        es.forcedVariant = variant as typeof es.bossVariant;
      }
      if (variant === "choice") es.bossPersonality = "suspicious";
      return es.bossVariant;
    },
    /** 仅 dev：当前飘字坐标（验证点击反馈位置） */
    fxTexts(): Array<{ x: number; y: number; text: string }> {
      return scene.fx.peekTexts();
    },
    /** 仅 dev：把所有进行中的派遣直接快进到"已完成"（试玩/测试用） */
    endMissions(): void {
      const now = Date.now();
      const cols = { ...state.team.colleagues };
      for (const id of Object.keys(cols)) {
        const c = cols[id]!;
        if (c.missionId) cols[id] = { ...c, startedAt: now - 1000, endsAt: now - 1 };
      }
      state = { ...state, team: { colleagues: cols } };
      teamPanel.refresh(state);
    },
    get fps(): number {
      return debug.fps;
    },
    get frames(): number {
      return debug.frames;
    },
    get assets(): unknown {
      return debug.assets;
    },
    get activity(): unknown {
      return debug.activity;
    },
    get spriteMap(): unknown {
      return debug.spriteMap;
    },
    get savedAt(): number | null {
      try {
        const blob = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as { savedAt?: number } | null;
        return typeof blob?.savedAt === "number" ? blob.savedAt : null;
      } catch {
        return null;
      }
    },
    saveNow(): void {
      saveNow();
    },
    /** 仅 dev：注入摸鱼值（验证/试玩用，生产包不含） */
    grant(n: number): void {
      state = gain(state, Math.max(0, n));
      hud.refresh(state);
      shop.refresh(state);
      teamPanel.refresh(state);
      journal.refresh(state, true);
    },
    reset(): void {
      clearSave(localStorageAdapter);
      state = initialState();
      es.bossUntil = -1;
      es.memeUntil = -1;
      es.nextBossAt = Infinity;
      es.nextMemeAt = Infinity;
      es.bossCaught = false;
      es.surviveStreak = 0;
      es.bossPenaltyTotal = 0;
      prevBossActive = false; // 防止巡逻中重置触发幻影安然奖励
      scene.gameTime = 0;
      hud.refresh(state);
      shop.refresh(state);
    },
    /** 离线模拟：把存档时间戳回拨 N 秒（供刷新后测试离线结算） */
    rewindSave(seconds: number): void {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) {
          serialize(state, localStorageAdapter, Date.now());
        }
        const blob = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "{}");
        if (typeof blob.v === "number") {
          blob.savedAt = Date.now() - seconds * 1000;
          localStorage.setItem(SAVE_KEY, JSON.stringify(blob));
          suppressSave = true; // 刷新前不再覆盖
          clearInterval(saveTimer);
        }
      } catch {
        /* 损坏存档：保持原样，reset() 可清理 */
      }
    },
  };

  // 7) 资产异步加载：失败降级为占位色块，游戏不死
  const load = async (key: string, src: string, cols: number, rows: number): Promise<void> => {
    try {
      const grid = await withTimeout(
        SpriteGrid.load({ src, cols, rows, frame: 16 }),
        LOAD_TIMEOUT_MS,
      );
      debug.assets[key] = "loaded";
      scene.sprites = { ...scene.sprites, [key]: grid };
    } catch {
      debug.assets[key] = "error";
    }
  };
  const probe = document.createElement("canvas");
  await Promise.allSettled([
    load("computer", "./assets/sprites/computer.png", 5, 10),
    load("cooler", "./assets/sprites/watercooler.png", 7, 1),
  ]);
  // 4 套职员配色（章节视觉变化）：并行加载，失败降级
  const workerSheets: SpriteGrid[] = [];
  await Promise.allSettled(
    [0, 1, 2, 3].map(async (i) => {
      try {
        const grid = await withTimeout(
          SpriteGrid.load({ src: `./assets/sprites/worker-${i}.png`, cols: 4, rows: 10, frame: 16 }),
          LOAD_TIMEOUT_MS,
        );
        workerSheets[i] = grid;
        debug.assets[`worker-${i}`] = "loaded";
      } catch {
        debug.assets[`worker-${i}`] = "error";
      }
    }),
  );
  const workerGrids = workerSheets.filter(Boolean);
  if (workerGrids.length > 0) {
    scene.sprites = { ...scene.sprites, worker: workerGrids[0]!, workers: workerGrids };
  }
  debug.spriteMap = SPRITE_MAP;
  if (scene.sprites.worker) debug.activity.worker = await frameActivity(scene.sprites.worker, probe).catch(() => []);
  if (scene.sprites.computer) debug.activity.computer = await frameActivity(scene.sprites.computer, probe).catch(() => []);
  if (scene.sprites.cooler) debug.activity.cooler = await frameActivity(scene.sprites.cooler, probe).catch(() => []);

  hud.refresh(state);
  shop.refresh(state);

  // 音效开关
  const muteBtn = document.getElementById("btn-mute");
  if (muteBtn) {
    muteBtn.textContent = isMuted() ? "🔇" : "🔊";
    muteBtn.addEventListener("click", () => {
      muteBtn.textContent = toggleMute() ? "🔇" : "🔊";
    });
  }

  // 数据保留：请求持久化存储 + 一次性提醒（Safari 7 天无交互会清 localStorage）
  try {
    void navigator.storage?.persist?.();
    const HINT_KEY = "moyu-persist-hint-v1";
    if (!localStorage.getItem(HINT_KEY) && state.visits.count >= 2) {
      localStorage.setItem(HINT_KEY, "1");
      setTimeout(() => scene.fx.floatText(scene.w / 2, scene.h * 0.2, "提示：添加到主屏幕可避免 7 天未玩被清档"), 2500);
    }
  } catch {
    /* 忽略 */
  }

  // 离线可用：仅生产构建注册 SW；带版本参数使旧缓存自然淘汰
  if (import.meta.env.PROD && "serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker
      .register(`./sw.js?v=${APP_VERSION}`)
      .then((reg) => {
        // 发现新版本 → 顶部提示条（不打断挂机，用户点按才更新）
        const notify = (): void => {
          if (document.getElementById("update-bar")) return;
          const bar = document.createElement("div");
          bar.id = "update-bar";
          bar.textContent = "发现新版本，点此更新";
          bar.addEventListener("click", () => {
            reg.waiting?.postMessage("SKIP_WAITING");
            location.reload();
          });
          document.body.appendChild(bar);
        };
        if (reg.waiting) notify();
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          sw?.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) notify();
          });
        });
        // 回到前台时检查更新
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") void reg.update();
        });
      })
      .catch(() => undefined);
  }
}

function showBootError(err: unknown): void {
  console.error("[moyu] boot failed", err);
  const banner = document.createElement("div");
  banner.className = "boot-error";
  banner.textContent = "游戏加载出错了……刷新一下试试？";
  document.body.appendChild(banner);
}

boot().catch(showBootError);
