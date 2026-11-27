import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { chooseCard, ensureCards, emptyCardState, shouldPromptCards, activeCard } from "../src/engine/cards";

const T1 = Date.UTC(2026, 10, 27, 14);
const T2 = Date.UTC(2026, 10, 28, 9);
const DAY1 = "2026-11-27";
const DAY2 = "2026-11-28";
const rng = () => 0.37;

describe("每日卡弹窗门槛（P1 回归：每天可再选一次必须 UI 可达）", () => {
  it("昨天选过卡、旧 buff 仍有效 → 今天仍应弹窗", () => {
    let s = { ...initialState(), cards: emptyCardState() };
    s = ensureCards(s, DAY1, rng, T1);
    s = chooseCard(s, s.cards!.offers[0]!, T1)!;
    expect(shouldPromptCards(s.cards, DAY1)).toBe(false); // 今天已选

    s = ensureCards(s, DAY2, rng, T2);
    expect(s.cards!.date).toBe(DAY2);
    expect(activeCard(s, T2)).not.toBeNull(); // 旧 buff 仍生效
    expect(shouldPromptCards(s.cards, DAY2)).toBe(true); // 但今天应再弹一次
  });

  it("跳过后当天不再弹，次日恢复", () => {
    let s = { ...initialState(), cards: emptyCardState() };
    s = ensureCards(s, DAY1, rng, T1);
    s = { ...s, cards: { ...s.cards!, dismissed: true } };
    expect(shouldPromptCards(s.cards, DAY1)).toBe(false);
    s = ensureCards(s, DAY2, rng, T2);
    expect(s.cards!.dismissed).toBe(false);
    expect(shouldPromptCards(s.cards, DAY2)).toBe(true);
  });

  it("同日 buff 过期 → 清理选择并重新可提示", () => {
    let s = { ...initialState(), cards: emptyCardState() };
    s = ensureCards(s, DAY1, rng, T1);
    s = chooseCard(s, s.cards!.offers[0]!, T1)!;
    const later = T1 + 25 * 3600_000; // 同日但已过期（模拟长时间在线跨过 24h）
    const s2 = ensureCards(s, DAY1, rng, later);
    expect(s2.cards!.chosen).toBeNull();
    expect(s2.cards!.until).toBe(0);
  });
});
