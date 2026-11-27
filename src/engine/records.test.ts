import { describe, it, expect } from "vitest";
import { emptyRecords, parseRecords, updateRecords } from "./records";

describe("本地生涯纪录", () => {
  it("损坏/缺失返回空纪录", () => {
    expect(parseRecords(null)).toEqual(emptyRecords());
    expect(parseRecords("{oops")).toEqual(emptyRecords());
  });

  it("只增不减，并记录最佳单日日期", () => {
    const a = updateRecords(emptyRecords(), {
      date: "2026-11-27",
      dayEarned: 100,
      streak: 3,
      lifetime: 1000,
      clicks: 50,
      collection: 10,
    });
    expect(a.changed).toBe(true);
    expect(a.records.bestDayEarned).toBe(100);
    expect(a.records.bestDayDate).toBe("2026-11-27");
    const b = updateRecords(a.records, {
      date: "2026-11-28",
      dayEarned: 50,
      streak: 2,
      lifetime: 900,
      clicks: 40,
      collection: 5,
    });
    expect(b.changed).toBe(false);
    expect(b.records.bestDayEarned).toBe(100);
    expect(b.records.maxStreak).toBe(3);
  });

  it("roundtrip 解析", () => {
    const r = { ...emptyRecords(), bestDayEarned: 7, bestDayDate: "2026-01-01" };
    expect(parseRecords(JSON.stringify(r))).toEqual(r);
  });
});
