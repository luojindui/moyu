import { describe, it, expect } from "vitest";
import { flavorFor, CLICK_MEMES, MEME_QUOTES, UPGRADE_FLAVOR } from "./flavor";

describe("文案池", () => {
  it("九个升级都有五级彩蛋文案（Lv.1/5/10/20/50）", () => {
    for (const id of Object.keys(UPGRADE_FLAVOR)) {
      expect(flavorFor(id, 1)).toBeTruthy();
      expect(flavorFor(id, 5)).toBeTruthy();
      expect(flavorFor(id, 10)).toBeTruthy();
      expect(flavorFor(id, 20)).not.toBe(flavorFor(id, 10));
      expect(flavorFor(id, 50)).not.toBe(flavorFor(id, 20));
    }
  });

  it("未购买（level 0）与未知 id 无文案", () => {
    expect(flavorFor("coffee", 0)).toBeNull();
    expect(flavorFor("nope", 5)).toBeNull();
  });

  it("点击梗池与丢梗语录非空且都是短句", () => {
    expect(CLICK_MEMES.length).toBeGreaterThan(3);
    for (const m of CLICK_MEMES) expect(m.length).toBeLessThan(8);
    expect(MEME_QUOTES.length).toBeGreaterThanOrEqual(6);
    for (const q of MEME_QUOTES) expect(q.length).toBeLessThanOrEqual(8);
  });
});
