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
  worker: { typingRow: 2, drinkingRow: 5, walkRow: 0 },
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
  /** 累计摸鱼值达标后隐藏新手引导字 */
  hideHint = false;
  /** 丢梗目标位置（虚拟坐标），由 main 设置 */
  memePos = { x: 0, y: 0 };

  constructor(public sprites: SceneSprites = {}) {}

  resize(cssW: number, cssH: number): void {
    this.w = cssW;
    this.h = cssH;
    this.scale = Math.max(2, Math.min(6, Math.round(cssW / 130)));
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
    const groundY = vh - 4.2 * 16;
    const deskX = vw / 2 - 2.2 * 16;
    const deskY = groundY - 1.9 * 16;
    return { vw, vh, groundY, deskX, deskY };
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const { vw, vh, groundY } = this.layout();
    const u = 16;
    const R = (x: number, y: number, w: number, h: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.fillRect(x * s, y * s, w * s, h * s);
    };

    // ================= 背景 =================
    // 墙面 + 竖条纹 + 护墙板
    R(0, 0, vw, groundY, "#3a3f5c");
    ctx.globalAlpha = 0.05;
    for (let x = 0; x < vw; x += u * 2) R(x, 0, u, groundY, "#ffffff");
    ctx.globalAlpha = 1;
    R(0, groundY - 3.4 * u, vw, 3.4 * u, "#353b56");
    R(0, groundY - 3.4 * u, vw, 0.25 * u, "#4b5271");
    R(0, groundY - 0.5 * u, vw, 0.5 * u, "#2e334d");

    // 地板（透视砖）
    R(0, groundY, vw, vh - groundY, "#5a4a3f");
    for (let i = 0; i * u < vh - groundY + u; i++) {
      const y = groundY + i * u;
      R(0, y, vw, 0.12 * u, "#6b584b");
      const inset = i * u * 0.3;
      for (let x = -inset; x < vw; x += u * 2) R(x, y, u, 0.12 * u, "#4c3f37");
    }

    // 窗户（左）
    const winX = 1.6 * u;
    const winY = 1.4 * u;
    const winW = 3.6 * u;
    const winH = 2.4 * u;
    R(winX - 0.35 * u, winY - 0.35 * u, winW + 0.7 * u, winH + 0.7 * u, "#262b42");
    R(winX, winY, winW, winH, "#7ec8ff");
    R(winX, winY, winW, winH * 0.42, "#a3dcff");
    R(winX + 0.4 * u, winY + 0.5 * u, 1.1 * u, 0.35 * u, "#eef8ff");
    R(winX + 0.75 * u, winY + 0.32 * u, 0.7 * u, 0.3 * u, "#eef8ff");
    R(winX + 2.2 * u, winY + 1.35 * u, 0.95 * u, 0.3 * u, "#dff2ff");
    R(winX + winW / 2 - 0.1 * u, winY, 0.2 * u, winH, "#262b42");
    R(winX, winY + winH / 2 - 0.1 * u, winW, 0.2 * u, "#262b42");
    R(winX - 0.75 * u, winY - 0.5 * u, 0.7 * u, winH + 0.9 * u, "#9d4e4b"); // 左帘
    R(winX + winW + 0.05 * u, winY - 0.5 * u, 0.7 * u, winH + 0.9 * u, "#9d4e4b"); // 右帘

    // 挂钟（右上）
    const clockX = vw - 2.4 * u;
    const clockY = 2 * u;
    ctx.fillStyle = "#e8e2d0";
    ctx.beginPath();
    ctx.arc(clockX * s, clockY * s, 0.72 * u * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#262b42";
    ctx.lineWidth = Math.max(2, s);
    ctx.beginPath();
    ctx.arc(clockX * s, clockY * s, 0.72 * u * s, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(clockX * s, clockY * s);
    ctx.lineTo(clockX * s + 0.32 * u * s, clockY * s - 0.22 * u * s);
    ctx.stroke();

    // 地毯（桌下，锚定工位）
    ctx.globalAlpha = 0.5;
    R(vw / 2 - 3.1 * u, groundY + 1.1 * u, 6.2 * u, 1.5 * u, "#6b4f43");
    R(vw / 2 - 2.6 * u, groundY + 1.25 * u, 5.2 * u, 1.2 * u, "#7c5c4c");
    ctx.globalAlpha = 1;

    // 公告板（右墙中部，避开饮水机）
    const boardX = vw - 3.9 * u;
    const boardY = Math.min(4.6 * u, groundY - 4.4 * u); // 矮屏（375×667）不落地
    R(boardX, boardY, 2.5 * u, 1.6 * u, "#5f4529");
    R(boardX + 0.1 * u, boardY + 0.1 * u, 2.3 * u, 1.4 * u, "#d9c9a3");
    R(boardX + 0.25 * u, boardY + 0.28 * u, 0.75 * u, 0.18 * u, "#c05a4a");
    R(boardX + 0.25 * u, boardY + 0.6 * u, 1.3 * u, 0.11 * u, "#8a7a58");
    R(boardX + 0.25 * u, boardY + 0.8 * u, 1 * u, 0.11 * u, "#8a7a58");
    R(boardX + 1.55 * u, boardY + 0.3 * u, 0.45 * u, 0.4 * u, "#f3e27a"); // 便签
    R(boardX + 1.62 * u, boardY + 0.85 * u, 0.4 * u, 0.36 * u, "#9fe0a0");

    // 吊灯
    R(vw / 2 - 0.07 * u, 0, 0.14 * u, 1 * u, "#262b42");
    R(vw / 2 - 0.9 * u, 1 * u, 1.8 * u, 0.42 * u, "#4b5271");
    ctx.globalAlpha = 0.13;
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.moveTo((vw / 2 - 1.3 * u) * s, 1.42 * u * s);
    ctx.lineTo((vw / 2 + 1.3 * u) * s, 1.42 * u * s);
    ctx.lineTo((vw / 2 + 2.6 * u) * s, groundY * s);
    ctx.lineTo((vw / 2 - 2.6 * u) * s, groundY * s);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 绿植（左下）
    const plantX = 0.8 * u;
    R(plantX, groundY - 1.5 * u, 0.85 * u, 1.5 * u, "#8a5a3c");
    R(plantX - 0.08 * u, groundY - 1.62 * u, 1.01 * u, 0.18 * u, "#6f452c");
    ctx.fillStyle = "#4d8a50";
    for (const [dx, dy, r] of [
      [0.42, 2.15, 0.5],
      [0.12, 2.45, 0.38],
      [0.72, 2.42, 0.4],
    ] as const) {
      ctx.beginPath();
      ctx.arc((plantX + dx) * s, (groundY - dy * u) * s, r * u * s, 0, Math.PI * 2);
      ctx.fill();
    }

    const { worker, computer, cooler } = this.sprites;

    // ================= 工位 =================
    const deskW = 4.2 * u;
    const deskX = vw / 2 - deskW / 2;
    const deskY = groundY - 2 * u;

    // 饮水机（右墙脚，桌子右侧）
    const coolerX = vw - 1.9 * u;
    const coolerY = groundY - 2 * u;
    if (cooler) {
      cooler.draw(ctx, this.coolerCol, SPRITE_MAP.cooler.row, coolerX, coolerY, s);
    } else {
      R(coolerX, coolerY, u, 2 * u, "#9ec8e8");
    }

    // 职员（坐姿，先画——桌沿会盖住下半身）
    const row = this.drinkUntil >= 0 ? SPRITE_MAP.worker.drinkingRow : SPRITE_MAP.worker.typingRow;
    const wkrX = vw / 2 - u / 2;
    const wkrY = deskY - 1.55 * u;
    if (worker) {
      worker.draw(ctx, this.workerCol, row, wkrX, wkrY, s);
    } else {
      R(wkrX, wkrY, u, 1.05 * u, "#e8c8a8");
    }

    // 桌面 + 桌腿 + 横撑
    R(deskX, deskY, deskW, 0.5 * u, "#8a6a4a");
    R(deskX, deskY, deskW, 0.12 * u, "#a5825c");
    R(deskX + 0.2 * u, deskY + 0.5 * u, 0.28 * u, 2 * u, "#6d5238");
    R(deskX + deskW - 0.48 * u, deskY + 0.5 * u, 0.28 * u, 2 * u, "#6d5238");
    R(deskX + 0.2 * u, deskY + 1.9 * u, deskW - 0.4 * u, 0.18 * u, "#5d4630");

    // 显示器（桌上正对职员）
    const pcX = vw / 2 - u / 2;
    const pcY = deskY - 1.05 * u;
    if (computer) {
      computer.draw(ctx, this.screenCol, SPRITE_MAP.computer.screenRow, pcX, pcY, s);
    } else {
      R(pcX, pcY, u, u, "#c8c8d8");
    }

    // 键盘（显示器前）
    R(vw / 2 - 0.9 * u, deskY - 0.42 * u, 1.8 * u, 0.22 * u, "#d8d8e0");
    R(vw / 2 - 0.85 * u, deskY - 0.38 * u, 1.7 * u, 0.14 * u, "#b9b9c8");

    // 桌面小物：马克杯 + 文件堆
    R(deskX + deskW - 0.95 * u, deskY - 0.48 * u, 0.42 * u, 0.48 * u, "#ddd6c6");
    R(deskX + deskW - 0.86 * u, deskY - 0.36 * u, 0.2 * u, 0.2 * u, "#4a3021");
    R(deskX + 0.25 * u, deskY - 0.28 * u, 0.75 * u, 0.28 * u, "#cfd6e6");
    R(deskX + 0.32 * u, deskY - 0.42 * u, 0.6 * u, 0.18 * u, "#e8eefc");

    // ================= 提示 / 事件横幅 =================
    ctx.textAlign = "center";
    if (this.events && this.events.bossUntil > this.gameTime) {
      // 老板巡逻：变体决定横幅文案与玩法
      const remain = Math.ceil(this.events.bossUntil - this.gameTime);
      const { bossVariant, bossTaps } = this.events;
      const bx = 0.6 * u;
      const by = 0.5 * u;
      const bw = vw - 1.2 * u;
      R(bx, by, bw, 2.1 * u, bossVariant === "hold" ? "#b3413c" : "#2f7a4f");
      R(bx, by, bw, 0.14 * u, bossVariant === "hold" ? "#d4564f" : "#3f9563");
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(12, 2.6 * s)}px system-ui`;
      ctx.fillText(bossBannerText(bossVariant, remain, bossTaps), (vw / 2) * s, (by + 1.35 * u) * s);
    } else if (this.events && this.events.memeUntil > this.gameTime) {
      // 同事丢梗：气泡目标
      const mx = this.memePos.x * s;
      const my = this.memePos.y * s;
      const bob = Math.sin(this.gameTime * 6) * 2 * s;
      ctx.fillStyle = "#ffd76e";
      ctx.beginPath();
      ctx.arc(mx, my + bob, 1.5 * u * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#8a6b1f";
      ctx.lineWidth = Math.max(2, s);
      ctx.stroke();
      ctx.fillStyle = "#4a3200";
      ctx.font = `bold ${Math.max(10, 1.8 * s)}px system-ui`;
      ctx.fillText("丢梗!", mx, my + bob + 1 * s);
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `bold ${Math.max(11, 2.4 * s)}px system-ui`;
      ctx.fillText(`戳它 +${MEME_REWARD_CLICKS}×点击力`, (vw / 2) * s, 2.3 * u * s);
    } else {
      if (!this.hideHint) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = `bold ${Math.max(12, 2.6 * s)}px system-ui`;
        ctx.fillText("戳屏幕摸鱼", (vw / 2) * s, (groundY + 2.8 * u) * s);
      }
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
  return `⚠ 老板来了！忍住别点，点了会罚 (${remain}s)`;
}
