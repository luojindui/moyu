import { initialState } from "./engine/state";
import { doClick, buyUpgrade, clickPowerOf } from "./engine/actions";
import { advance } from "./engine/tick";
import { offlineEarn } from "./engine/offline";
import { serialize, restore, clearSave, type SaveAdapter } from "./engine/save";
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

/** 调度与调试状态（agent 试玩钩子读取） */
const debug = {
  fps: 0,
  frames: 0,
  ticks: 0,
  assets: {} as Record<string, "loaded" | "error">,
  activity: {} as Record<string, number[][]>,
  spriteMap: null as unknown,
};

async function boot(): Promise<void> {
  // 离线结算
  const restored = restore(localStorageAdapter, Date.now());
  let state = restored.state ?? initialState();
  const offline = offlineEarn(state, restored.offlineSeconds);
  state = offline.state;

  // 精灵
  const canvas = document.getElementById("stage") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const load = async (key: string, src: string, cols: number, rows: number) => {
    const grid = await SpriteGrid.load({ src, cols, rows, frame: 16 });
    debug.assets[key] = "loaded";
    return grid;
  };
  const worker = await load("worker", "./assets/sprites/worker.png", 4, 10);
  const computer = await load("computer", "./assets/sprites/computer.png", 5, 10);
  const cooler = await load("cooler", "./assets/sprites/watercooler.png", 7, 1);
  debug.activity.worker = await frameActivity(worker, canvas);
  debug.activity.computer = await frameActivity(computer, canvas);
  debug.activity.cooler = await frameActivity(cooler, canvas);
  debug.spriteMap = SPRITE_MAP;

  const scene = new Scene({ worker, computer, cooler });
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

  // 画布尺寸（DPR 感知，上限 2）
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

  // 输入：点场景 = 摸鱼
  canvas.addEventListener("pointerdown", (e) => {
    const gained = clickPowerOf(state);
    state = doClick(state);
    const p = scene.toVirtual(e.clientX, e.clientY, canvas);
    scene.fx.floatText(p.x, p.y, `+${gained}`);
  });

  // 主循环
  let last = performance.now();
  let lastHud = 0;
  let fpsWindowStart = last;
  let fpsFrames = 0;
  const frame = (now: number): void => {
    const dt = Math.min(1, (now - last) / 1000);
    last = now;
    state = advance(state, dt);
    scene.update(dt);
    scene.draw(ctx);
    debug.frames++;
    debug.ticks++;
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

  // 自动存档
  setInterval(() => serialize(state, localStorageAdapter, Date.now()), 10_000);
  const saveNow = (): void => serialize(state, localStorageAdapter, Date.now());
  document.addEventListener("pagehide", saveNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNow();
  });

  // 离线收益面板
  if (offline.earned > 0) {
    welcome.show(offline.applied, offline.earned, () => undefined);
  }

  // agent 试玩调试钩子（只读 + 存档操作）
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
    saveNow(): void {
      saveNow();
    },
    reset(): void {
      clearSave(localStorageAdapter);
      state = initialState();
      hud.refresh(state);
      shop.refresh(state);
    },
    // 离线模拟：改写存档时间戳后刷新页面
    rewindSave(seconds: number): void {
      const blob = JSON.parse(localStorage.getItem("moyu-save") ?? "{}");
      blob.savedAt = Date.now() - seconds * 1000;
      localStorage.setItem("moyu-save", JSON.stringify(blob));
    },
  };

  hud.refresh(state);
  shop.refresh(state);
}

boot().catch((err) => {
  console.error("[moyu] boot failed", err);
});
