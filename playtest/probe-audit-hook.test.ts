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
    const lastAwait = mainTs.lastIndexOf('await load("cooler"');
    const pointerIdx = mainTs.indexOf('canvas.addEventListener("pointerdown"');
    console.log("最后一个资产 await 位置:", lastAwait, "pointerdown 绑定位置:", pointerIdx);
    expect(pointerIdx).toBeLessThan(lastAwait); // 🔴 实测 pointerdown 在三张精灵图 await 之后
  });

  it("boot 失败兜底应不止 console.error（用户可感知）", () => {
    expect(/boot\(\)\.catch/.test(mainTs)).toBe(false); // 🔴 实测只有 console.error，页面静默死掉
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

describe("审计 E4：rewindSave 健壮性（复刻 main.ts 第 162-166 行）", () => {
  function rewindSaveReplica(getItem: () => string | null, seconds: number): void {
    // ↓ 与 src/main.ts rewindSave 逐字一致的逻辑
    const blob = JSON.parse(getItem() ?? "{}");
    blob.savedAt = Date.now() - seconds * 1000;
    localStorageSetItemReplica(JSON.stringify(blob));
  }
  let written: string | null = null;
  function localStorageSetItemReplica(v: string): void {
    written = v;
  }

  it("损坏存档（非法 JSON）时不应抛错", () => {
    expect(() => rewindSaveReplica(() => "{oops not json", 3600)).not.toThrow(); // 🔴 实测 SyntaxError 未捕获
  });

  it("无存档时 rewindSave 写出的 blob 缺 v/moyu，restore 会静默丢弃（rewind 空转）", () => {
    rewindSaveReplica(() => null, 3600);
    const blob = JSON.parse(written ?? "{}") as Record<string, unknown>;
    console.log("无存档时 rewindSave 写出:", blob);
    expect(blob.v).toBe(1); // 🔴 实测 undefined → restore 判版本不符直接丢弃，离线模拟静默无效
  });
});

describe("审计 E5：生产 bundle 与源码一致性", () => {
  it("bundle 中保留同样的 dt 钳制与 visibilitychange 语义", () => {
    expect(bundle).toContain("Math.min(1");
    expect(bundle).toContain("pagehide");
  });
});
