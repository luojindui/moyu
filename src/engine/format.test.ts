import { describe, it, expect } from "vitest";
import { formatMoyu } from "./format";

describe("formatMoyu 中文单位缩写", () => {
  it("小于一万显示整数", () => {
    expect(formatMoyu(0)).toBe("0");
    expect(formatMoyu(999)).toBe("999");
  });

  it("一万到一亿之间显示万并保留两位", () => {
    // 期望值由 node 独立推定: (12345/10000).toFixed(2) === "1.23"
    expect(formatMoyu(12345)).toBe("1.23万");
    expect(formatMoyu(123450)).toBe("12.35万");
  });

  it("超过一亿显示亿并保留两位", () => {
    // 期望值由 node 独立推定: (150000000/100000000).toFixed(2) === "1.50"
    expect(formatMoyu(150_000_000)).toBe("1.50亿");
  });
});
