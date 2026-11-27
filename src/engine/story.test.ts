import { describe, it, expect } from "vitest";
import { CHAPTERS, chapterFor, zhouLine, bossLine, bossOutcome } from "./story";

describe("最小剧情层", () => {
  it("章节按生涯累计解锁，单调", () => {
    expect(chapterFor(0).id).toBe("c1");
    expect(chapterFor(10_000).id).toBe("c2");
    expect(chapterFor(1e6).id).toBe("c3");
    expect(chapterFor(1.1e8).id).toBe("c4");
    expect(chapterFor(2e10).id).toBe("c5");
    expect(chapterFor(1e12).id).toBe("c6");
    for (let i = 1; i < CHAPTERS.length; i++) expect(CHAPTERS[i]!.at).toBeGreaterThan(CHAPTERS[i - 1]!.at);
  });

  it("角色台词带归属", () => {
    expect(zhouLine("这个需求很简单")).toBe("老周：这个需求很简单");
    expect(bossLine("hold", 8, 0)).toContain("王总");
    expect(bossOutcome(true)).toContain("眼神");
    expect(bossOutcome(false)).toContain("心情不错");
  });

  it("章节配色在 0-3 内", () => {
    for (const c of CHAPTERS) expect(c.palette).toBeGreaterThanOrEqual(0), expect(c.palette).toBeLessThanOrEqual(3);
  });
});
