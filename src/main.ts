import "./style.css";
import { initialState, gain } from "./engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "./engine/actions";
import { advance } from "./engine/tick";
import { settleReturn } from "./engine/resume";
import { CLICK_MEMES } from "./engine/flavor";
import { serialize, restore, clearSave, SAVE_KEY, type SaveAdapter } from "./engine/save";
import {
  newEventState,
  scheduleEvents,
  onBossTap,
  onMemeTap,
  bossSurviveReward,
  type EventState,
} from "./engine/events";
import { Hud } from "./ui/hud";
import { Shop } from "./ui/shop";
import { Welcome } from "./ui/welcome";
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
  const currentOfflineRate = (): number => (Date.now() - restored.createdAt < 86_400_000 ? 1 : 0.7);
  const offline = settleReturn(state, Date.now() - restored.offlineSeconds * 1000, Date.now(), currentOfflineRate());
  state = offline.state;

  // 2) UI 与场景骨架（先装配，资产后到）
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const scene = new Scene({});
  const hud = new Hud();
  const welcome = new Welcome();
  const shop = new Shop((id) => {
    const next = buyUpgrade(state, id);
    if (next) {
      state = next;
      hud.refresh(state);
      shop.refresh(state);
      serialize(state, localStorageAdapter, Date.now());
    }
  });

  const fit = (): void => {
    const wrap = canvas.parentElement!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
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

  // 3) 输入：主指针才算点击（防多指连点刷）；巡逻中点击会被逮
  const es: EventState = newEventState();
  scene.events = es;
  canvas.addEventListener("pointerdown", (e) => {
    if (!e.isPrimary) return;
    const p = scene.toVirtual(e.clientX, e.clientY, canvas);
    if (es.bossUntil > scene.gameTime) {
      const r = onBossTap(state, es);
      state = r.state;
      scene.fx.floatText(p.x, p.y, `被逮住了！-${Math.round(r.lost)}`);
      return;
    }
    // 丢梗命中（虚拟坐标半径内）
    const vx = p.x / scene.scale;
    const vy = p.y / scene.scale;
    const hitMeme =
      es.memeUntil > scene.gameTime && Math.hypot(vx - scene.memePos.x, vy - scene.memePos.y) < 3 * 16;
    if (hitMeme) {
      const r = onMemeTap(state, es);
      state = r.state;
      scene.fx.floatText(p.x, p.y, `梗收了 +${Math.round(r.earned)}`);
      return;
    }
    const gained = clickPowerOf(state);
    state = doClick(state);
    const meme = CLICK_MEMES[Math.floor(Math.random() * CLICK_MEMES.length)];
    const text = Math.random() < 0.22 && meme ? meme : `+${gained}`;
    scene.fx.floatText(p.x, p.y, text);
  });

  // 4) 主循环（资产未到也照跑，占位色块兜底）
  let last = performance.now();
  let lastActiveMs = Date.now();
  let fpsWindowStart = last;
  let fpsFrames = 0;
  let lastHud = 0;
  let prevBossActive = false;
  const rng = Math.random;
  const frame = (now: number): void => {
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
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
    // 巡逻结束：未被抓则发安然奖励
    const bossActive = es.bossUntil > scene.gameTime;
    if (prevBossActive && !bossActive && !es.bossCaught) {
      const reward = bossSurviveReward(state, es);
      if (reward > 0) {
        state = gain(state, reward);
        scene.fx.floatText((scene.w / 2), scene.h * 0.3, `安然度过 +${Math.round(reward)}`);
      }
    }
    prevBossActive = bossActive;
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
      hud.refresh(state);
      shop.refresh(state);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // 5) 存档与前后台切换
  setInterval(() => serialize(state, localStorageAdapter, Date.now()), 10_000);
  const saveNow = (): void => serialize(state, localStorageAdapter, Date.now());
  document.addEventListener("pagehide", saveNow);

  const settleForeground = (): void => {
    const r = settleReturn(state, lastActiveMs, Date.now(), currentOfflineRate());
    if (r.earned > 0) {
      state = r.state;
      hud.refresh(state);
      shop.refresh(state);
      if (r.showPanel) welcome.show(r.applied, r.earned, () => undefined);
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
    welcome.show(offline.applied, offline.earned, () => undefined);
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
}

function showBootError(err: unknown): void {
  console.error("[moyu] boot failed", err);
  const banner = document.createElement("div");
  banner.className = "boot-error";
  banner.textContent = "游戏加载出错了……刷新一下试试？";
  document.body.appendChild(banner);
}

boot().catch(showBootError);
