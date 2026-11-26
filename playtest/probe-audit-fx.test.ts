import { describe, it, expect } from "vitest";
import { Fx } from "../src/render/fx";
import { formatMoyu } from "../src/engine/format";
import { costOf } from "../src/engine/upgrades";

/**
 * 审计探针 F：特效池边界 + 格式化/价格曲线边缘情况（多数为「验证未越界」的阴性结果）。
 */

describe("审计 F：Fx 特效池（验证有界，无内存泄漏）", () => {
  it("连续 100 次飘字后 texts ≤ 24 且 particles ≤ 64", () => {
    const fx = new Fx();
    for (let i = 0; i < 100; i++) fx.floatText(10, 10, "+1");
    fx.update(0.016);
    const texts = (fx as unknown as { texts: unknown[] }).texts;
    const particles = (fx as unknown as { particles: unknown[] }).particles;
    console.log("texts:", texts.length, "particles:", particles.length);
    expect(texts.length).toBeLessThanOrEqual(24); // ✅ 池有界
    expect(particles.length).toBeLessThanOrEqual(64); // ✅ 池有界
  });

  it("update 按 wall-clock 过期文本（隐藏 30 分钟恢复后旧飘字清空）", () => {
    const fx = new Fx();
    fx.floatText(10, 10, "+1");
    // born 用 performance.now()，filter 用同一时钟 → 旧文本在下一次 update 被清掉
    const texts = (fx as unknown as { texts: { born: number }[] }).texts;
    const fakeOld = { ...(texts[0]!) };
    fakeOld.born -= 60_000; // 模拟 60 秒前生成
    texts[0] = fakeOld;
    fx.update(0.016);
    expect((fx as unknown as { texts: unknown[] }).texts.length).toBe(0); // ✅
  });
});

describe("审计 F2：formatMoyu 边界（现状记录）", () => {
  it("规格场景 123450 → 12.35万（符合）", () => {
    expect(formatMoyu(123450)).toBe("12.35万"); // ✅
  });
  it("亿边界内侧 99999999.999 → 10000.00万（而非 1.00亿，边缘情况非 bug）", () => {
    console.log(formatMoyu(99_999_999.999));
    expect(formatMoyu(99_999_999.999)).toBe("10000.00万"); // 现状记录
  });
  it("非有限数不会被格式化为合法读数（依赖存档洞才可达）", () => {
    console.log("NaN →", formatMoyu(NaN), "Infinity →", formatMoyu(Infinity));
    expect(formatMoyu(Infinity)).toBe("Infinity亿"); // 现状记录（配合审计 D 的 Infinity 洞）
  });
});

describe("审计 F3：价格曲线边缘", () => {
  it("首涨因 ceil 变成 15→18（1.2×，规格字面 1.15×）", () => {
    console.log("coffee: lv0 =", costOf("coffee", 0), "lv1 =", costOf("coffee", 1));
    expect(costOf("coffee", 1)).toBe(18); // 现状记录：ceil(15×1.15)=ceil(17.25)=18
  });
  it("超高等级价格溢出为 Infinity 时商品应不可购（防 NaN）", () => {
    const p = costOf("coffee", 10000);
    expect(Number.isNaN(p)).toBe(false); // ✅ Infinity 而非 NaN
    expect(p).toBe(Infinity);
  });
});
