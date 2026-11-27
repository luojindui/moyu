import "./style.css";
import { initialState } from "./engine/state";
import { doClick, buyUpgrade, clickPowerOf, COMBO_WINDOW_S, COMBO_BREAK_S, COMBO_MAX } from "./engine/actions";
import { advance } from "./engine/tick";
import { settleReturn } from "./engine/resume";
import { CLICK_MEMES, MEME_QUOTES } from "./engine/flavor";
import { serialize, restore, clearSave, SAVE_KEY, type SaveAdapter } from "./engine/save";
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
import { rankFor } from "./engine/titles";
import { doPrestige } from "./engine/prestige";
import { ensureDaily, dailyTrack, claimDaily } from "./engine/daily";
import { Hud } from "./ui/hud";
import { Shop } from "./ui/shop";
import { Welcome } from "./ui/welcome";
import { Journal } from "./ui/journal";
import { Quest } from "./ui/quest";
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
  // 1) 状态与离线结算（不依赖任何资产）；离线效率现算：建档 24h 内全额，之后 70%
  const restored = restore(localStorageAdapter, Date.now());
  let state = restored.state ?? initialState();
  state = ensureVisits(state, Date.now()); // 本次打开算一次回访（可把离线效率挣回 1.0）
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
      prevBossActive = false;
      scene.gameTime = 0;
      hud.refresh(state);
      shop.refresh(state);
      journal.refresh(state, true);
      serialize(state, localStorageAdapter, Date.now());
    },
  );
  const shop = new Shop((id) => {
    const next = buyUpgrade(state, id);
    if (next) {
      state = syncFlavorCollection(next); // 购买后同步新解锁的彩蛋档
      shop.refresh(state);
      journal.refresh(state);
      state = { ...state, daily: state.daily ? dailyTrack(state.daily, "buy") : null };
      hud.refresh(state);
      serialize(state, localStorageAdapter, Date.now());
    }
  });

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
  const trackDaily = (kind: "click" | "meme" | "buy" | "survive", n = 1): void => {
    if (state.daily) state = { ...state, daily: dailyTrack(state.daily, kind, n) };
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    const p = scene.toVirtual(e.clientX, e.clientY, canvas);
    const nowMs = performance.now();
    // 连击链更新
    const gap = (nowMs - lastClickAt) / 1000;
    combo = gap < COMBO_WINDOW_S ? Math.min(COMBO_MAX, combo + 1) : gap > COMBO_BREAK_S ? 0 : combo;
    lastClickAt = nowMs;

    if (es.bossUntil > scene.gameTime) {
      // 偷点：拿走点击收入 + 赌一次罚款（过了宽限才罚，每巡逻一次）
      const r = onBossTap(state, es, scene.gameTime, combo);
      state = r.state;
      trackDaily("click");
      if (r.caught) {
        scene.fx.floatText(p.x, p.y, `偷点被逮！+${Math.round(r.income)} -${Math.round(r.lost)}`);
      } else {
        scene.fx.floatText(p.x, p.y, `偷点 +${Math.round(r.income)}`);
      }
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
      const quote = MEME_QUOTES[qi];
      scene.fx.floatText(p.x, p.y - 24, quote ?? "");
      scene.fx.floatText(p.x, p.y, `梗收了 +${Math.round(r.earned)}`);
      journal.refresh(state);
      return;
    }
    const gained = clickPowerOf(state) * (1 + 0.02 * Math.min(combo, COMBO_MAX));
    state = doClick(state, combo);
    trackDaily("click");
    if (state.totalClicks % 25 === 0) state = syncFlavorCollection(state); // 点击线彩蛋按累计点击数解锁
    const meme = CLICK_MEMES[Math.floor(Math.random() * CLICK_MEMES.length)];
    const text = combo >= 6 ? `连击×${combo} +${Math.round(gained)}` : Math.random() < 0.22 && meme ? meme : `+${Math.round(gained)}`;
    scene.fx.floatText(p.x, p.y, text);
  });

  // 4) 主循环（资产未到也照跑，占位色块兜底）
  let last = performance.now();
  let lastActiveMs = Date.now();
  let fpsWindowStart = last;
  let fpsFrames = 0;
  let lastHud = 0;
  let prevBossActive = false;
  const quest = new Quest((text) => toast(text));
  let lastRankName = "";
  let lastCollectionCount = state.collected.quotes.length + state.collected.flavors.length;
  const toast = (text: string): void => {
    scene.fx.floatText(scene.w / 2, scene.h * 0.22, text);
  };
  const rng = Math.random;
  let frameSkip = 0;
  const frame = (now: number): void => {
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    // 面板打开 / 页面不可见时降帧（移动端省电；浏览器后台本身会暂停 rAF）
    const overlayOpen = !document.getElementById("journal")!.classList.contains("hidden");
    if (overlayOpen || document.visibilityState === "hidden") {
      frameSkip += 1;
      if (frameSkip % 3 !== 0) {
        requestAnimationFrame(frame);
        return;
      }
    }
    lastActiveMs = Date.now();
    scene.gameTime += dt;
    // 随机事件调度（丢梗位置：每次窗口随机出现在场景上半区，并按视口高度防裁剪）
    const memeWasIdle = es.memeUntil < 0;
    scheduleEvents(es, scene.gameTime, rng);
    if (memeWasIdle && es.memeUntil > 0) {
      const vh = scene.h / scene.scale;
      const yMax = Math.min(10 * 16, Math.max(6 * 16, vh - 6 * 16));
      scene.memePos = {
        x: 4 * 16 + Math.random() * ((scene.w / scene.scale) - 8 * 16),
        y: 4 * 16 + Math.random() * (yMax - 4 * 16),
      };
    }
    // 巡逻结束：安然 → 发奖（含连胜乘数）并推进连胜；被抓 → 0 奖清零
    const bossActive = es.bossUntil > scene.gameTime;
    if (prevBossActive && !bossActive) {
      const r = finishPatrol(state, es);
      state = r.state;
      if (r.reward > 0) {
        trackDaily("survive");
        scene.fx.floatText(scene.w / 2, scene.h * 0.3, `安然度过 +${Math.round(r.reward)}（连胜 ${es.surviveStreak}）`);
      } else if (es.bossVariant === "type" || es.bossVariant === "blitz") {
        // 点击任务变体未达标：给明确失败反馈（不罚款）
        scene.fx.floatText(scene.w / 2, scene.h * 0.3, "没达标…下次手快点");
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
    scene.draw(ctx);
    debug.frames++;
    fpsFrames++;
    if (now - fpsWindowStart >= 1000) {
      debug.fps = Math.round((fpsFrames * 1000) / (now - fpsWindowStart));
      fpsFrames = 0;
      fpsWindowStart = now;
    }
    if (now - lastHud >= 150) {
      lastHud = now;
      scene.hideHint = state.totalEarned > 500;
      quest.tick(state, null);
      // 段位晋升提示（让"新变化"被看见，而不是只藏在 HUD 一行）
      const rankNow = rankFor(state.totalEarned).current;
      if (lastRankName && rankNow !== lastRankName) toast(`段位晋升：${rankNow}`);
      lastRankName = rankNow;
      // 图鉴新增提示
      const cCount = state.collected.quotes.length + state.collected.flavors.length;
      if (cCount > lastCollectionCount) toast(`图鉴 +${cCount - lastCollectionCount}（${cCount}/55）`);
      lastCollectionCount = cCount;
      hud.refresh(state);
      shop.refresh(state);
      journal.refresh(state);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // 5) 存档与前后台切换
  let suppressSave = false; // rewindSave 后暂停写档，避免覆盖回拨的时间戳
  const saveTimer = setInterval(() => {
    if (!suppressSave) serialize(state, localStorageAdapter, Date.now());
  }, 10_000);
  const saveNow = (): void => {
    if (!suppressSave) serialize(state, localStorageAdapter, Date.now());
  };
  void saveTimer;
  document.addEventListener("pagehide", saveNow);

  const settleForeground = (): void => {
    const r = settleReturn(state, lastActiveMs, Date.now(), currentOfflineRate());
    if (r.earned > 0) {
      state = r.state;
      hud.refresh(state);
      shop.refresh(state);
      if (r.showPanel) welcome.show(r.applied, r.earned, currentOfflineRate(), () => undefined);
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
    welcome.show(offline.applied, offline.earned, currentOfflineRate(), () => undefined);
  }

  // 6) agent 试玩调试钩子（先注册，资产加载不阻塞探测）
  (window as unknown as Record<string, unknown>).__MOYU__ = {
    get state(): unknown {
      return JSON.parse(JSON.stringify(state));
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
    load("worker", "./assets/sprites/worker.png", 4, 10),
    load("computer", "./assets/sprites/computer.png", 5, 10),
    load("cooler", "./assets/sprites/watercooler.png", 7, 1),
  ]);
  debug.spriteMap = SPRITE_MAP;
  if (scene.sprites.worker) debug.activity.worker = await frameActivity(scene.sprites.worker, probe).catch(() => []);
  if (scene.sprites.computer) debug.activity.computer = await frameActivity(scene.sprites.computer, probe).catch(() => []);
  if (scene.sprites.cooler) debug.activity.cooler = await frameActivity(scene.sprites.cooler, probe).catch(() => []);

  hud.refresh(state);
  shop.refresh(state);

  // 离线可用：注册 Service Worker（仅生产/支持时；失败静默）
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => undefined);
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
