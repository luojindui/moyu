import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { Scene } from "../src/render/scene";
import type { SpriteGrid } from "../src/render/sprites";
import type { EventState } from "../src/engine/events";
import { newEventState } from "../src/engine/events";

/**
 * R2 审计探针④：装配与场景（回归 + 新渲染路径）。
 * - r1 两个 critical 的回归：CSS 装配、精灵几何
 * - 无资产占位渲染、巡逻横幅 / 丢梗气泡绘制不崩
 * - main.ts 关键接线（isPrimary / savedAt getter / reset 清 prevBossActive / meme y 钳制）
 */

const mainTs = readFileSync("src/main.ts", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const distAssets = readdirSync("dist/assets");
const distIndex = readFileSync("dist/index.html", "utf8");
const cssFile = distAssets.find((f) => f.endsWith(".css"));
const bundleJs = distAssets.find((f) => f.endsWith(".js"));
const bundle = bundleJs ? readFileSync(`dist/assets/${bundleJs}`, "utf8") : "";

describe("R2 审计④a：r1 critical 回归——CSS 装配", () => {
  it("main.ts 首行 import ./style.css 且 dist 产出 css 并被 index.html 引用", () => {
    expect(mainTs).toMatch(/import\s+["']\.\/style\.css["']/);
    expect(cssFile).toBeTruthy();
    expect(distIndex).toMatch(new RegExp(`assets/${cssFile}`));
  });
  it("index.html 含 hud-rank 与 viewport 元标签", () => {
    expect(indexHtml).toContain('id="hud-rank"');
    expect(indexHtml).toMatch(/name="viewport"/);
  });
});

describe("R2 审计④b：r1 critical 回归——精灵几何（虚拟坐标系修复后）", () => {
  function render(w: number, h: number, sprites: Partial<Record<"worker" | "computer" | "cooler", boolean>> = {}) {
    const rects: Record<string, { x: number; y: number; size: number }> = {};
    const fills: { x: number; y: number; w: number; h: number }[] = [];
    const mk = (name: string, cols: number) =>
      ({
        cols,
        rows: 10,
        frame: 16,
        draw: (_c: unknown, _col: number, _row: number, x: number, y: number, scale: number) => {
          rects[name] = { x: x * scale, y: y * scale, size: 16 * scale };
        },
      }) as unknown as SpriteGrid;
    const scene = new Scene({
      worker: sprites.worker ? mk("worker", 4) : undefined,
      computer: sprites.computer ? mk("computer", 5) : undefined,
      cooler: sprites.cooler ? mk("cooler", 7) : undefined,
    });
    scene.resize(w, h);
    scene.update(0.016);
    const ctx = {
      fillRect: (x: number, y: number, cw: number, ch: number) => void fills.push({ x, y, w: cw, h: ch }),
      strokeRect: () => {},
      fillText: () => {},
      drawImage: () => {},
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      font: "",
      textAlign: "",
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    scene.draw(ctx);
    return { rects, fills, scene };
  }

  it("375×470：worker/computer/cooler 全部在画布内且电脑在桌面上方", () => {
    const { rects, fills } = render(375, 470, { worker: true, computer: true, cooler: true });
    for (const [name, r] of Object.entries(rects)) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.size).toBeLessThanOrEqual(375);
      expect(r.y + r.size).toBeLessThanOrEqual(470);
    }
    const desk = fills.find((f) => f.w === 4 * 16 * 2 && f.h === 0.5 * 16 * 2); // scale=2
    const pc = rects.computer!;
    expect(pc.x).toBeLessThan(desk!.x + desk!.w);
    expect(pc.x + pc.size).toBeGreaterThan(desk!.x);
    expect(pc.y + pc.size).toBeLessThanOrEqual(desk!.y + 1); // 电脑底边贴桌面
  });

  it("1280×800 宽屏：三精灵仍在画布内", () => {
    const { rects } = render(1280, 800, { worker: true, computer: true, cooler: true });
    for (const r of Object.values(rects)) {
      expect(r.x + r.size).toBeLessThanOrEqual(1280);
      expect(r.y + r.size).toBeLessThanOrEqual(800);
    }
  });

  it("零资产（全占位色块）绘制不崩且占位矩形在画布内", () => {
    const { fills } = render(375, 470, {});
    const placeholders = fills.filter((f) => f.w === 16 * 2 && f.h >= 16 * 2); // 1×1 与 1×2 格色块
    expect(placeholders.length).toBeGreaterThanOrEqual(3);
    for (const p of placeholders) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("巡逻横幅与丢梗气泡路径绘制不崩（含 events 挂载）", () => {
    const es: EventState = { ...newEventState(), bossUntil: 100 };
    const s1 = render(375, 470, {});
    s1.scene.events = es;
    s1.scene.gameTime = 95;
    expect(() => s1.scene.draw(stubCtx())).not.toThrow();
    es.bossUntil = -1;
    es.memeUntil = 100;
    s1.scene.memePos = { x: 100, y: 80 };
    expect(() => s1.scene.draw(stubCtx())).not.toThrow();
  });
});

function stubCtx(): CanvasRenderingContext2D {
  return {
    fillRect: () => {},
    strokeRect: () => {},
    fillText: () => {},
    drawImage: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

describe("R2 审计④c：main.ts 关键接线（静态）", () => {
  it("多指防刷：pointerdown 含 isPrimary 守卫", () => {
    expect(mainTs).toMatch(/if\s*\(!e\.isPrimary\)\s*return/);
  });
  it("钩子含 savedAt 只读 getter（r1 修复回归）", () => {
    expect(mainTs).toMatch(/get\s+savedAt\(\)/);
  });
  it("reset 清 prevBossActive / es / gameTime（防幻影安然奖）", () => {
    const resetRegion = mainTs.slice(mainTs.indexOf("reset(): void"));
    expect(resetRegion).toContain("prevBossActive = false");
    expect(resetRegion).toContain("es.bossUntil = -1");
    expect(resetRegion).toContain("scene.gameTime = 0");
  });
  it("meme 生成 y 钳制存在", () => {
    expect(mainTs).toMatch(/yMax\s*=\s*Math\.min/);
  });
  it("资产失败降级：error 态 + 占位 + 超时", () => {
    expect(mainTs).toMatch(/debug\.assets\[key\]\s*=\s*"error"/);
    expect(mainTs).toContain("withTimeout");
    expect(mainTs).toContain("Promise.allSettled");
  });
  it("frameActivity 用独立 probe canvas（不再改主画布）", () => {
    expect(mainTs).toMatch(/createElement\("canvas"\)/);
    expect(mainTs).not.toMatch(/frameActivity\([^)]*,\s*canvas\)/);
  });
  it("boot 失败可见横幅", () => {
    expect(mainTs).toContain("showBootError");
    expect(mainTs).toContain("boot-error");
  });
  it("visibilitychange：hidden 存档 / visible 结算，pageshow persisted 兜底", () => {
    expect(mainTs).toMatch(/visibilityState === "hidden"[\s\S]{0,80}saveNow/);
    expect(mainTs).toMatch(/persisted[\s\S]{0,60}settleForeground/);
  });
  it("生产 bundle 含互斥/事件与 savedAt 钩子产物", () => {
    expect(bundle).toContain("__MOYU__");
    expect(bundle).toContain("savedAt");
    expect(bundle).toContain("bossUntil");
  });
  it("引擎源文件均存在（无丢失模块）", () => {
    for (const f of ["events", "resume", "titles", "flavor", "upgrades", "save", "offline", "tick", "actions", "format", "state"]) {
      expect(existsSync(`src/engine/${f}.ts`)).toBe(true);
    }
  });
});
