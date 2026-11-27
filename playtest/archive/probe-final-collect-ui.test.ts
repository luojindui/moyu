/**
 * probe-final-collect-ui.test.ts — 终验探针 ④/⑤（静态契约层）
 * 校验 index.html / manifest / 图标 / style.css 的移动端与 UI 完整性；
 * 运行时行为由 playtest/probe-final-collect-ui-cdp.mjs（真实无头 Chrome 390×844）覆盖。
 * 只读 src/，不改 src/。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("../index.html");
const css = read("../src/style.css");
const manifest = JSON.parse(read("../public/manifest.webmanifest")) as {
  name: string;
  short_name: string;
  display: string;
  orientation: string;
  start_url: string;
  scope: string;
  theme_color: string;
  background_color: string;
  icons: { src: string; sizes: string; type: string }[];
};

/** 读 PNG 头拿真实宽高（不依赖任何图像库） */
function pngSize(rel: string): { w: number; h: number } {
  const buf = readFileSync(new URL(rel, import.meta.url));
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("④ index.html：移动端 meta / 挂载点 / 初始 hidden", () => {
  it("viewport 适配移动端（device-width / viewport-fit=cover / 禁缩放）", () => {
    expect(html).toContain('name="viewport"');
    expect(html).toContain("width=device-width");
    expect(html).toContain("initial-scale=1.0");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain("maximum-scale=1.0");
    expect(html).toContain("user-scalable=no");
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
  });

  it("manifest / favicon / apple-touch-icon 链接齐全且指向存在的文件", () => {
    expect(html).toContain('<link rel="manifest" href="./manifest.webmanifest" />');
    expect(html).toContain('<link rel="icon" href="./favicon.png" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="./icon-192.png" />');
    expect(pngSize("../public/icon-192.png")).toEqual({ w: 192, h: 192 });
    expect(pngSize("../public/icon-512.png")).toEqual({ w: 512, h: 512 });
    expect(pngSize("../public/favicon.png").w).toBeGreaterThan(0);
  });

  it("HUD / canvas / 商店 / 日报图鉴挂载点齐全，📔 与连胜、段位、0/55 初始值正确", () => {
    for (const id of [
      "hud-moyu",
      "hud-click",
      "hud-idle",
      "hud-rank",
      "hud-streak",
      "btn-journal",
      "stage",
      "shop-cards",
      "journal",
      "journal-date",
      "journal-streak",
      "journal-goals",
      "journal-claim",
      "journal-quote",
      "journal-flavor",
      "journal-latest",
      "journal-total",
      "journal-grid",
    ]) {
      expect(html, `缺少挂载点 #${id}`).toContain(`id="${id}"`);
    }
    expect(html).toContain("📔");
    expect(html).toContain('<span id="hud-streak" class="hidden"></span>');
    expect(html).toContain('id="journal" class="hidden"');
    expect(html).toContain('id="journal-total">0/55');
    expect(html).toContain('id="journal-quote">0/10');
    expect(html).toContain('id="journal-flavor">0/45');
    expect(html).toContain("<canvas id=\"stage\"></canvas>");
  });
});

describe("⑤ PWA manifest：可加桌面（standalone / 竖屏 / 图标）", () => {
  it("display=standalone、orientation=portrait、start_url/scope 与主题色齐备", () => {
    expect(manifest.name).toBe("摸鱼工位");
    expect(manifest.short_name).toBe("摸鱼工位");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.start_url).toBe("./");
    expect(manifest.scope).toBe("./");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("manifest 图标 192/512 声明与磁盘文件尺寸一致", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      const [w, h] = icon.sizes.split("x").map(Number);
      const file = pngSize(`../public/${icon.src.replace("./", "")}`);
      expect(file).toEqual({ w, h });
    }
  });
});

describe("④ style.css：图鉴 2 列滚动网格 / 角标 / 隐藏态 / 移动端布局", () => {
  it("#journal 初始隐藏（hidden 类 display:none）", () => {
    expect(css).toMatch(/#journal\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/#journal\.hidden\s*\{[^}]*display:\s*none/);
  });

  it("图鉴 55 格：2 列网格 + 限高滚动 + on/off 态", () => {
    expect(css).toMatch(/\.journal-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    expect(css).toMatch(/\.journal-grid\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.journal-grid\s*\{[^}]*max-height:/);
    expect(css).toMatch(/\.c-item\.on\s*\{/);
    expect(css).toMatch(/\.c-item\.off\s*\{/);
    expect(css).toMatch(/\.journal-panel\s*\{[^}]*overflow-y:\s*auto/);
    expect(css).toMatch(/\.journal-panel\s*\{[^}]*max-height:/);
  });

  it("📔 可领角标：has-reward 红色圆点（::after）", () => {
    expect(css).toMatch(/#btn-journal\.has-reward\s*\{/);
    const rule = css.match(/#btn-journal\.has-reward::after\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toContain("background: #ff5a5a");
    expect(rule).toContain("border-radius: 50%");
    expect(rule).toMatch(/width:\s*9px/);
  });

  it("移动端：100dvh + 安全区 + 横向商店滚动 + HUD 不换行裁切策略", () => {
    expect(css).toMatch(/#app\s*\{[^}]*height:\s*100dvh/);
    expect(css).toContain("env(safe-area-inset-top)");
    expect(css).toMatch(/#shop-cards\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/#shop-cards\s*\{[^}]*overflow-x:\s*auto/);
    expect(css).toContain("touch-action: manipulation");
    expect(css).toContain("overscroll-behavior: none");
  });
});
