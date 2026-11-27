import { describe, it, expect } from "vitest";
import { RANKS, rankFor } from "./titles";

describe("摸鱼段位", () => {
  it("按累计摸鱼值给称号，含当前/下一档/进度", () => {
    const r0 = rankFor(0);
    expect(r0.current).toBe(RANKS[0]!.name);
    expect(r0.next?.at).toBe(RANKS[1]!.at);
    expect(r0.progress).toBe(0);

    const r1 = rankFor(50_000);
    expect(r1.current).toBe(RANKS[1]!.name);
    // 独立推定：(50000-10000)/(100000-10000) = 40000/90000 ≈ 0.4444
    expect(r1.progress).toBeCloseTo(0.4444, 3);
  });

  it("顶档无下一档", () => {
    const top = RANKS.at(-1)!.at;
    const r = rankFor(top * 10);
    expect(r.current).toBe(RANKS.at(-1)!.name);
    expect(r.next).toBeNull();
    expect(r.progress).toBe(1);
  });

  it("R7：14 档续到 3.2e11（补住 D3 打穿后的空窗）", () => {
    expect(RANKS).toHaveLength(14);
    expect(RANKS[5]!.at).toBe(1_000_000_000);
    expect(rankFor(5_500_000_000).current).toBe("带薪摸鱼之神");
    expect(rankFor(6e11).next).toBeNull();
  });

  it("段位单调递增且不重复", () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.at).toBeGreaterThan(RANKS[i - 1]!.at);
    }
    expect(new Set(RANKS.map((r) => r.name)).size).toBe(RANKS.length);
  });
});
