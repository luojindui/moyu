import { describe, it, expect } from "vitest";
import { Scene } from "../src/render/scene";
import type { SpriteGrid } from "../src/render/sprites";

/**
 * 审计探针 A：场景精灵绘制几何。
 * 怀疑：scene.draw 里精灵传的是 CSS 像素坐标，而 SpriteGrid.draw 内部又乘一次 scale，
 * 双重缩放导致精灵被画到画布外。规格「手机适配 375×667」下职员/电脑/饮水机可能全部不可见。
 * 本探针用假精灵记录真实 drawImage 目标矩形（与 sprites.ts 的 draw 实现逐行一致）。
 */

interface DestRect {
  x: number;
  y: number;
  size: number;
}

interface FillRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function renderScene(w: number, h: number) {
  const sprites: Record<string, DestRect> = {};
  const fills: FillRect[] = [];
  // 复刻 src/render/sprites.ts SpriteGrid.draw 的坐标变换：dest = (x*scale, y*scale, 16*scale)
  const mk = (name: string, cols: number) =>
    ({
      cols,
      rows: 10,
      frame: 16,
      draw: (_ctx: unknown, _col: number, _row: number, x: number, y: number, scale: number) => {
        sprites[name] = { x: x * scale, y: y * scale, size: 16 * scale };
      },
    }) as unknown as SpriteGrid;

  const scene = new Scene({ worker: mk("worker", 4), computer: mk("computer", 5), cooler: mk("cooler", 7) });
  scene.resize(w, h);
  scene.update(0.016);

  const ctx = {
    fillRect: (x: number, y: number, cw: number, ch: number) => void fills.push({ x, y, w: cw, h: ch }),
    strokeRect: () => {},
    fillText: () => {},
    drawImage: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  scene.draw(ctx);

  const s = (scene as unknown as { scale: number }).scale;
  const u = 16 * s;
  // 桌面 = draw() 中唯一的 (u*4, u*0.5) 矩形
  const desk = fills.find((f) => f.w === u * 4 && f.h === u * 0.5);
  return { w, h, s, u, sprites, desk };
}

describe("审计 A：场景精灵几何（375×667 手机，stage 实际约 375×470）", () => {
  const g = renderScene(375, 470);

  it("前提：375 宽时 scale=2（floor(375/200) 下限钳到 2）", () => {
    expect(g.s).toBe(2);
  });

  it("职员应完整出现在画布内", () => {
    const wk = g.sprites.worker!;
    console.log("worker dest:", wk, "canvas:", g.w, "x", g.h);
    expect(wk.x).toBeGreaterThanOrEqual(0);
    expect(wk.y).toBeGreaterThanOrEqual(0);
    expect(wk.x + wk.size).toBeLessThanOrEqual(g.w);
    expect(wk.y + wk.size).toBeLessThanOrEqual(g.h); // 🔴 实测 y=524 > 470，屏幕外
  });

  it("电脑应完整出现在画布内", () => {
    const pc = g.sprites.computer!;
    console.log("computer dest:", pc);
    expect(pc.y + pc.size).toBeLessThanOrEqual(g.h); // 🔴 实测 y=581.6，屏幕外
  });

  it("饮水机应完整出现在画布内", () => {
    const co = g.sprites.cooler!;
    console.log("cooler dest:", co);
    expect(co.x + co.size).toBeLessThanOrEqual(g.w); // 🔴 实测 x=526 > 375，屏幕外
  });

  it("电脑的水平区间应与桌子重叠（放在桌上）", () => {
    const pc = g.sprites.computer!;
    const desk = g.desk!;
    console.log("desk:", desk, "computer:", pc);
    const overlap = pc.x < desk.x + desk.w && pc.x + pc.size > desk.x;
    expect(overlap).toBe(true); // 🔴 实测桌子 123.5~274.5，电脑 323.8~355.8，完全分离
  });
});

describe("审计 A2：宽屏（1280×800）", () => {
  it("职员应出现在画布内", () => {
    const g = renderScene(1280, 800);
    const wk = g.sprites.worker!;
    console.log("wide worker dest:", wk, "scale:", g.s);
    expect(wk.x + wk.size).toBeLessThanOrEqual(g.w); // 🔴 实测 x=3552，屏幕外
    expect(wk.y + wk.size).toBeLessThanOrEqual(g.h);
  });
});
