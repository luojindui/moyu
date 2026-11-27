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

  it("R4 扩充：7 档，覆盖 1e9/2.5e9（nurture #3：终局真空）", () => {
    expect(RANKS.map((r) => r.at)).toEqual([0, 10_000, 100_000, 1_000_000, 100_000_000, 1_000_000_000, 2_500_000_000]);
    expect(rankFor(1_100_000_000).current).toBe("摸鱼之神");
    expect(rankFor(1_100_000_000).next?.at).toBe(2_500_000_000);
  });

  it("段位单调递增且不重复", () => {
    for (let i = 1; i < RANKS.length; i++) {
      expect(RANKS[i]!.at).toBeGreaterThan(RANKS[i - 1]!.at);
    }
    expect(new Set(RANKS.map((r) => r.name)).size).toBe(RANKS.length);
  });
});
