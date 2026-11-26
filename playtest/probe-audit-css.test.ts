import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";

/**
 * 审计探针 B：样式表装配链路
 * src/style.css 存在，但怀疑从未被任何入口引用（main.ts 无 import、index.html 无 link）。
 * 若属实：三段式布局 / touch-action / .hidden 全部失效 → 需求「手机适配」整体崩塌，
 * 且 #welcome 的 hidden 切换是视觉空操作（离线面板永久可见）。
 */

const mainTs = readFileSync("src/main.ts", "utf8");
const indexHtml = readFileSync("index.html", "utf8");
const styleCssExists = existsSync("src/style.css");
const distIndex = readFileSync("dist/index.html", "utf8");
const distAssets = readdirSync("dist/assets");
const bundleFile = distAssets.find((f) => f.endsWith(".js"));
const bundle = bundleFile ? readFileSync(`dist/assets/${bundleFile}`, "utf8") : "";
const cssFile = distAssets.find((f) => f.endsWith(".css"));
const cssBundle = cssFile ? readFileSync(`dist/assets/${cssFile}`, "utf8") : "";

const mainImportsCss = /import\s+["']\.\/style\.css["']/.test(mainTs);
const htmlLinksCss = /<link[^>]*stylesheet|<style[\s>]/i.test(indexHtml);
const distLinksCss = /<link[^>]*\.css/i.test(distIndex);
const distHasCssFile = distAssets.some((f) => f.endsWith(".css"));
// vite 为分离式 CSS 产物：规则在 .css 文件而非 JS bundle
const bundleHasHiddenDisplayNone = cssBundle.includes("#welcome.hidden") || /\.hidden\s*\{[^}]*display\s*:\s*none/.test(cssBundle);
const wired = mainImportsCss || htmlLinksCss || distLinksCss || distHasCssFile;

describe("审计 B：样式表装配（手机适配需求）", () => {
  it("前提：src/style.css 文件存在（186 行完整样式）", () => {
    expect(styleCssExists).toBe(true);
  });

  it("样式表应至少通过一条链路进入产物（main.ts import / index.html link / dist css 文件）", () => {
    expect(wired).toBe(true); // 🔴 失败 = 全链路未装配
  });

  it("生产产物应包含 .hidden{display:none} 规则（vite 分离式 CSS 文件）", () => {
    expect(bundleHasHiddenDisplayNone).toBe(true); // ✅ 已修复：dist/assets/*.css 含该规则
  });

  it("证据快照", () => {
    console.log(
      JSON.stringify(
        { mainImportsCss, htmlLinksCss, distLinksCss, distHasCssFile, bundleHasHiddenDisplayNone, distAssets },
        null,
        1,
      ),
    );
    expect(true).toBe(true);
  });
});
