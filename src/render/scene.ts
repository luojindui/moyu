import { SpriteGrid } from "./sprites";
import { Fx } from "./fx";
import type { EventState } from "../engine/events";
import {
  MEME_REWARD_CLICKS,
  BOSS_TYPE_TARGET,
  BOSS_BLITZ_TARGET,
  type BossVariant,
} from "../engine/events";

/** 场景精灵的行列映射（视觉定稿前可一键调整） */
export const SPRITE_MAP = {
  worker: { typingRow: 1, drinkingRow: 3, walkRow: 0 },
  computer: { screenRow: 0 },
  cooler: { row: 0 },
};

const TYPING_FPS = 7;
const SCREEN_FPS = 2;
const COOLER_FPS = 3;
const DRINK_EVERY = 22; // 平均每 22 秒切到喝水动画
const DRINK_FOR = 2.5;

export interface SceneSprites {
  worker?: SpriteGrid;
  computer?: SpriteGrid;
  cooler?: SpriteGrid;
}

/**
 * 像素办公场景。坐标系：全部使用"虚拟像素"（16 单位网格），
 * SpriteGrid.draw 负责乘 scale；纯 canvas 矩形在此处乘 scale。
 */
export class Scene {
  private t = 0;
  private nextDrink = DRINK_EVERY;
  private drinkUntil = -1;
  private workerCol = 0;
  private screenCol = 0;
  private coolerCol = 0;
  readonly fx = new Fx();
  scale = 4;
  w = 0; // CSS 像素
  h = 0;
  /** 随机事件状态（由 main 挂载；场景只读渲染） */
  events: EventState | null = null;
  /** 当前事件时钟（游戏秒） */
  gameTime = 0;
  /** 丢梗目标位置（虚拟坐标），由 main 设置 */
  memePos = { x: 0, y: 0 };

  constructor(public sprites: SceneSprites = {}) {}

  resize(cssW: number, cssH: number): void {
    this.w = cssW;
    this.h = cssH;
    this.scale = Math.max(2, Math.min(7, Math.floor(cssW / 200)));
  }

  update(dt: number): void {
    this.t += dt;
    const { worker, computer, cooler } = this.sprites;
    if (worker) this.workerCol = Math.floor(this.t * TYPING_FPS) % worker.cols;
    if (computer) this.screenCol = Math.floor(this.t * SCREEN_FPS) % computer.cols;
    if (cooler) this.coolerCol = Math.floor(this.t * COOLER_FPS) % cooler.cols;
    if (this.drinkUntil < 0 && this.t >= this.nextDrink) {
      this.drinkUntil = this.t + DRINK_FOR;
      this.nextDrink = this.t + DRINK_EVERY + Math.random() * 8;
    } else if (this.drinkUntil >= 0 && this.t >= this.drinkUntil) {
      this.drinkUntil = -1;
    }
    this.fx.update(dt);
  }

  isDrinking(): boolean {
    return this.drinkUntil >= 0;
  }

  /** 虚拟坐标系下的布局（16 单位网格） */
  private layout() {
    const vw = this.w / this.scale;
    const vh = this.h / this.scale;
    const groundY = vh - 3 * 16;
    const deskX = vw / 2 - 2 * 16;
    const deskY = groundY - 1.6 * 16;
    return { vw, vh, groundY, deskX, deskY };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const { vw, vh, groundY, deskX, deskY } = this.layout();
    const u = 16;

    // 墙与地板
    ctx.fillStyle = "#3a3f5c";
    ctx.fillRect(0, 0, vw * s, groundY * s);
    ctx.fillStyle = "#2e334d";
    ctx.fillRect(0, (groundY - u) * s, vw * s, u * s);
    ctx.fillStyle = "#5a4a3f";
    ctx.fillRect(0, groundY * s, vw * s, (vh - groundY) * s);
    ctx.fillStyle = "#524438";
    for (let y = groundY + u; y < vh; y += u) {
      for (let x = ((y / u) % 2) * u; x < vw; x += u * 2) ctx.fillRect(x * s, y * s, u * s, u * s);
    }

    // 窗户
    ctx.fillStyle = "#7ec8ff";
    ctx.fillRect(2 * u * s, u * s, 3 * u * s, 2 * u * s);
    ctx.fillStyle = "#8fd4ff";
    ctx.fillRect(2 * u * s, u * s, 3 * u * s, u * s);
    ctx.strokeStyle = "#2b2b3a";
    ctx.lineWidth = Math.max(2, s);
    ctx.strokeRect(2 * u * s, u * s, 3 * u * s, 2 * u * s);

    // 工位桌
    ctx.fillStyle = "#8a6a4a";
    ctx.fillRect(deskX * s, deskY * s, 4 * u * s, 0.5 * u * s);
    ctx.fillStyle = "#6d5238";
    ctx.fillRect((deskX + 0.2 * u) * s, (deskY + 0.5 * u) * s, 0.25 * u * s, 1.1 * u * s);
    ctx.fillRect((deskX + 3.6 * u) * s, (deskY + 0.5 * u) * s, 0.25 * u * s, 1.1 * u * s);

    const { worker, computer, cooler } = this.sprites;

    // 精灵（缺资产时色块占位，游戏不死）
    const coolerX = vw - 3.5 * u;
    if (cooler) {
      cooler.draw(ctx, this.coolerCol, SPRITE_MAP.cooler.row, coolerX, groundY - 2 * u, s);
    } else {
      ctx.fillStyle = "#9ec8e8";
      ctx.fillRect(coolerX * s, (groundY - 2 * u) * s, u * s, 2 * u * s);
    }

    const pcX = deskX + 1.2 * u;
    const pcY = deskY - u;
    if (computer) {
      computer.draw(ctx, this.screenCol, SPRITE_MAP.computer.screenRow, pcX, pcY, s);
    } else {
      ctx.fillStyle = "#c8c8d8";
      ctx.fillRect(pcX * s, pcY * s, u * s, u * s);
    }

    const row = this.drinkUntil >= 0 ? SPRITE_MAP.worker.drinkingRow : SPRITE_MAP.worker.typingRow;
    const wkrX = vw / 2 - u / 2;
    const wkrY = deskY - 1.9 * u;
    if (worker) {
      worker.draw(ctx, this.workerCol, row, wkrX, wkrY, s);
    } else {
      ctx.fillStyle = "#e8c8a8";
      ctx.fillRect(wkrX * s, wkrY * s, u * s, 2 * u * s);
    }

    // 提示条（屏幕像素坐标，文字清晰优先）
    ctx.font = `${Math.max(10, 3 * s)}px system-ui`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "center";
    if (this.events && this.events.bossUntil > this.gameTime) {
      // 老板巡逻：变体决定横幅文案与玩法（variety #1）
      const remain = Math.ceil(this.events.bossUntil - this.gameTime);
      const { bossVariant, bossTaps } = this.events;
      ctx.fillStyle = bossVariant === "hold" ? "#b3413c" : "#2f7a4f";
      ctx.fillRect(0, 0, vw * s, 3.2 * s * 4);
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(14, 4 * s)}px system-ui`;
      ctx.fillText(bossBannerText(bossVariant, remain, bossTaps), (vw / 2) * s, 2.6 * s * 4);
    } else if (this.events && this.events.memeUntil > this.gameTime) {
      // 同事丢梗：气泡目标
      const mx = this.memePos.x * s;
      const my = this.memePos.y * s;
      const bob = Math.sin(this.gameTime * 6) * 3 * s;
      ctx.fillStyle = "#ffd76e";
      ctx.beginPath();
      ctx.arc(mx, my + bob, 2.2 * u * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a3c00";
      ctx.font = `bold ${Math.max(10, 2.2 * s)}px system-ui`;
      ctx.fillText("丢梗!", mx, my + bob + 1 * s);
      ctx.fillStyle = "#fff";
      ctx.fillText(`戳它 +${MEME_REWARD_CLICKS}×点击力`, (vw / 2) * s, u * 0.9 * s);
    } else {
      ctx.fillText("戳屏幕摸鱼", (vw / 2) * s, u * 0.9 * s);
    }

    this.fx.draw(ctx, s);
  }

  /** CSS 坐标 → 画布内坐标（供 fx 定位） */
  toVirtual(clientX: number, clientY: number, canvas: HTMLCanvasElement): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
}

/** 巡逻变体横幅文案 */
export function bossBannerText(variant: BossVariant, remain: number, taps: number): string {
  if (variant === "type") return `假装工作！点 ${Math.min(taps, BOSS_TYPE_TARGET)}/${BOSS_TYPE_TARGET} (${remain}s)`;
  if (variant === "blitz") return `摸鱼冲刺！连点 ${Math.min(taps, BOSS_BLITZ_TARGET)}/${BOSS_BLITZ_TARGET} 奖×1.5 (${remain}s)`;
  return `⚠ 老板来了！忍住别点 (${remain}s)`;
}
