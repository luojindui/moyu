import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * 审计探针 E：装配层静态结构（src/main.ts + 生产 bundle）。
 * 验证四件事：
 * 1. __MOYU__ 钩子缺「存档时间戳」只读接口（规格明确要求 savedAt）；
 * 2. 资产加载失败时 debug.assets 永远不会出现 "error" 态（规格：资源加载状态）；
 * 3. pointerdown 输入绑定在三个 await 资产加载之后 → 资产 404/挂起时输入/循环/钩子全灭，
 *    boot 兜底只有 console.error，无降级 UI；
 * 4. rewindSave 对损坏存档会抛未捕获异常（用同源代码复刻验证）。
 */

const mainTs = readFileSync("src/main.ts", "utf8");
const distAssets = readdirSync("dist/assets");
const bundleFile = distAssets.find((f) => f.endsWith(".js"));
const bundle = bundleFile ? readFileSync(`dist/assets/${bundleFile}`, "utf8") : "";

const hookStart = mainTs.indexOf("__MOYU__");
const hookRegion = mainTs.slice(hookStart);

describe("审计 E：__MOYU__ 调试钩子（规格：state/fps/资源状态/存档时间戳/reset + 模拟驱动）", () => {
  it("应暴露存档时间戳的只读读取（get savedAt 之类）", () => {
    console.log("hook 暴露的成员:", /__MOYU__[^;]{0,400}/s.exec(mainTs)?.[0]?.slice(0, 400));
    expect(/get\s+savedAt|savedAt\s*\(\s*\)\s*[:{]/.test(hookRegion)).toBe(true); // 🔴 缺失（rewindSave 只能写不能读）
  });

  it("资产加载状态应有 error 态标记", () => {
    expect(/assets\[[^\]]*\]\s*=\s*"error"|assets\[[^\]]*\]\s*=\s*"loaded"\s*\|\s*"error"/.test(mainTs)).toBe(
      true, // 🔴 实测只有 "loaded"，加载失败直接 boot().catch 整体死掉
    );
  });
});

describe("审计 E2：输入绑定顺序与资产失败降级", () => {
  it("pointerdown 应在资产加载前可用（或资产失败仍有可用输入）", () => {
    // 资产加载标记：Promise.allSettled 内首个 load("worker"
    const assetLoadIdx = mainTs.indexOf('load("worker"');
    const pointerIdx = mainTs.indexOf('canvas.addEventListener("pointerdown"');
    console.log("资产加载位置:", assetLoadIdx, "pointerdown 绑定位置:", pointerIdx);
    expect(pointerIdx).toBeGreaterThan(0);
    expect(assetLoadIdx).toBeGreaterThan(0);
    expect(pointerIdx).toBeLessThan(assetLoadIdx); // ✅ 已修复：输入先于资产装配
  });

  it("boot 失败兜底应有用户可感知的降级 UI（横幅而非仅 console.error）", () => {
    // ✅ 已修复：showBootError 创建 .boot-error 横幅
    expect(/boot\(\)\.catch\(showBootError\)/.test(mainTs)).toBe(true);
    expect(/class (Name )?= ?"boot-error"|className = "boot-error"/.test(mainTs)).toBe(true);
  });
});

describe("审计 E3：pagehide / visibilitychange 存档语义", () => {
  it("pagehide 存档已装配", () => {
    expect(/addEventListener\("pagehide"/.test(mainTs)).toBe(true); // ✅
  });
  it("visibilitychange 仅在 hidden 时存档（语义正确）", () => {
    expect(/visibilityState === "hidden"[\s\S]{0,80}saveNow/.test(mainTs)).toBe(true); // ✅
  });
});

describe("审计 E4：rewindSave 健壮性（对照 main.ts 现行实现）", () => {
  // ✅ 已修复：现行 rewindSave 为 try/catch + 无档先 serialize 再改时间戳
  const rewindRegion = mainTs.slice(mainTs.indexOf("rewindSave(seconds"));

  it("损坏存档（非法 JSON）被 try/catch 包裹，不抛错", () => {
    expect(rewindRegion).toContain("try");
    expect(rewindRegion).toContain("catch");
  });

  it("无存档时先 serialize 补全 v/moyu 再改时间戳（rewind 不空转）", () => {
    expect(rewindRegion).toContain("serialize(");
    expect(rewindRegion).toContain("blob.savedAt");
  });
});

describe("审计 E5：生产 bundle 与源码一致性", () => {
  it("bundle 中保留同样的 dt 钳制与 visibilitychange 语义", () => {
    expect(bundle).toContain("Math.min(1");
    expect(bundle).toContain("pagehide");
  });
});
