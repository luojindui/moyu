import { SpriteGrid } from "./sprites";
import { Fx } from "./fx";

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
  worker: SpriteGrid;
  computer: SpriteGrid;
  cooler: SpriteGrid;
}

/** 像素办公场景：墙/地板/工位桌/电脑/职员/饮水机，16 单位网格虚拟坐标 */
export class Scene {
  private t = 0;
  private nextDrink = DRINK_EVERY;
  private drinkUntil = -1;
  private workerCol = 0;
  private screenCol = 0;
  private coolerCol = 0;
  /** 触摸点（虚拟坐标）供 fx 使用 */
  readonly fx = new Fx();
  scale = 4;
  w = 0;
  h = 0;

  constructor(private sprites: SceneSprites) {}

  resize(cssW: number, cssH: number): void {
    this.w = cssW;
    this.h = cssH;
    // 场景设计宽度约 56 虚拟单位（=3.5 帧），取 2..7 的整数放大
    this.scale = Math.max(2, Math.min(7, Math.floor(cssW / 200)));
  }

  update(dt: number): void {
    this.t += dt;
    const { worker, computer, cooler } = this.sprites;
    this.workerCol = Math.floor(this.t * TYPING_FPS) % worker.cols;
    this.screenCol = Math.floor(this.t * SCREEN_FPS) % computer.cols;
    this.coolerCol = Math.floor(this.t * COOLER_FPS) % cooler.cols;
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

  draw(ctx: CanvasRenderingContext2D): void {
    const s = this.scale;
    const u = 16 * s; // 一帧的屏幕像素
    const groundY = this.h - u * 3;

    // 墙与地板
    ctx.fillStyle = "#3a3f5c";
    ctx.fillRect(0, 0, this.w, groundY);
    ctx.fillStyle = "#2e334d";
    ctx.fillRect(0, groundY - u, this.w, u); // 踢脚线
    ctx.fillStyle = "#5a4a3f";
    ctx.fillRect(0, groundY, this.w, this.h - groundY);
    ctx.fillStyle = "#524438";
    for (let y = groundY + u; y < this.h; y += u) {
      for (let x = ((y / u) % 2) * u; x < this.w; x += u * 2) ctx.fillRect(x, y, u, u);
    }

    // 窗户
    ctx.fillStyle = "#7ec8ff";
    ctx.fillRect(u * 2, u, u * 3, u * 2);
    ctx.fillStyle = "#8fd4ff";
    ctx.fillRect(u * 2, u, u * 3, u);
    ctx.strokeStyle = "#2b2b3a";
    ctx.lineWidth = Math.max(2, s);
    ctx.strokeRect(u * 2, u, u * 3, u * 2);

    const { worker, computer, cooler } = this.sprites;

    // 饮水机（右侧）
    cooler.draw(ctx, this.coolerCol, SPRITE_MAP.cooler.row, this.w - u * 3.5, groundY - u * 2, s);

    // 工位桌
    const deskX = this.w / 2 - u * 2;
    const deskY = groundY - u * 1.6;
    ctx.fillStyle = "#8a6a4a";
    ctx.fillRect(deskX, deskY, u * 4, u * 0.5);
    ctx.fillStyle = "#6d5238";
    ctx.fillRect(deskX + u * 0.2, deskY + u * 0.5, u * 0.25, u * 1.1);
    ctx.fillRect(deskX + u * 3.6, deskY + u * 0.5, u * 0.25, u * 1.1);

    // 电脑（桌上，屏幕朝外）
    computer.draw(ctx, this.screenCol, SPRITE_MAP.computer.screenRow, deskX + u * 1.2, deskY - u, s);

    // 职员（桌后，打字/喝水动画）
    const row = this.drinkUntil >= 0 ? SPRITE_MAP.worker.drinkingRow : SPRITE_MAP.worker.typingRow;
    worker.draw(ctx, this.workerCol, row, this.w / 2 - u * 0.5, deskY - u * 1.9, s);

    // 提示条
    ctx.font = `${Math.max(10, 3 * s)}px system-ui`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.textAlign = "center";
    ctx.fillText("戳屏幕摸鱼", this.w / 2, u * 0.9);

    this.fx.draw(ctx, s);
  }

  /** CSS 坐标 → 虚拟坐标（供 fx 定位） */
  toVirtual(clientX: number, clientY: number, canvas: HTMLCanvasElement): { x: number; y: number } {
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
}
