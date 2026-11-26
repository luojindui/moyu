import { describe, it, expect } from "vitest";
import { flavorFor, CLICK_MEMES, UPGRADE_FLAVOR } from "./flavor";

describe("文案池", () => {
  it("六个升级都有三级彩蛋文案", () => {
    for (const id of Object.keys(UPGRADE_FLAVOR)) {
      expect(flavorFor(id, 1)).toBeTruthy();
      expect(flavorFor(id, 5)).toBeTruthy();
      expect(flavorFor(id, 10)).not.toBe(flavorFor(id, 5));
    }
  });

  it("未购买（level 0）与未知 id 无文案", () => {
    expect(flavorFor("coffee", 0)).toBeNull();
    expect(flavorFor("nope", 5)).toBeNull();
  });

  it("点击梗池非空且都是短句", () => {
    expect(CLICK_MEMES.length).toBeGreaterThan(3);
    for (const m of CLICK_MEMES) expect(m.length).toBeLessThan(8);
  });
});
