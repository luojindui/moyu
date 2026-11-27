import { describe, it, expect } from "vitest";
import { initialState } from "../src/engine/state";
import { chooseCard, ensureCards, activeCard, emptyCardState } from "../src/engine/cards";

const DAY1 = "2026-11-27";
const DAY2 = "2026-11-28";
const T1 = Date.UTC(2026, 10, 27, 14, 0);
const T2 = Date.UTC(2026, 10, 28, 9, 0); // 次日（旧卡仍有效）
const T3 = Date.UTC(2026, 10, 28, 16, 0); // 次日 19h 后（旧卡将过期）
const rng = () => 0.42;

function day1State() {
  let s = { ...initialState(), cards: emptyCardState() };
  s = ensureCards(s, DAY1, rng, T1);
  const offer = s.cards!.offers[0]!;
  s = chooseCard(s, offer, T1)!;
  return s;
}

describe("每日卡跨天行为（P1-A 回归）", () => {
  it("次日：新卡池刷新，但旧卡 buff 在 24h 内仍生效", () => {
    let s = day1State();
    const oldChosen = s.cards!.chosen;
    s = ensureCards(s, DAY2, rng, T2);
    expect(s.cards!.date).toBe(DAY2);
    expect(s.cards!.offers).toHaveLength(3); // 次日必须抽新卡
    expect(new Set(s.cards!.offers).size).toBe(3);
    expect(s.cards!.chosen).toBe(oldChosen); // 旧卡仍生效
    expect(activeCard(s, T2)?.id).toBe(oldChosen);
    expect(s.cards!.dismissed).toBe(false); // 新的一天可以重新选
  });

  it("次日可以再次选卡（覆盖昨天的卡）", () => {
    let s = day1State();
    s = ensureCards(s, DAY2, rng, T2);
    const nextOffer = s.cards!.offers[0]!;
    const picked = chooseCard(s, nextOffer, T2)!;
    expect(picked.cards!.chosen).toBe(nextOffer);
    expect(picked.cards!.chosenDate).toBe(DAY2);
  });

  it("同一天不能选两次", () => {
    let s = day1State();
    const other = s.cards!.offers[1]!;
    expect(chooseCard(s, other, T1)).toBeNull();
  });

  it("剧情链：hr_talk 的保底卡在次日出现（不是第三天）", () => {
    let s = { ...initialState(), cards: emptyCardState() };
    s = ensureCards(s, DAY1, rng, T1);
    // 强制选 hr_talk
    s = { ...s, cards: { ...s.cards!, offers: ["hr_talk", ...s.cards!.offers.slice(0, 2)] } };
    s = chooseCard(s, "hr_talk", T1)!;
    s = ensureCards(s, DAY2, rng, T2);
    expect(s.cards!.offers).toContain("secret_project");
  });

  it("旧卡过期后：buff 失效、可重新选卡、卡池刷新", () => {
    let s = day1State();
    const expired = s.cards!.chosen;
    s = ensureCards(s, DAY2, rng, T3);
    // 过期后不再有生效卡
    expect(activeCard(s, T3)).toBeNull();
    // 但仍可重新选卡（不会被"昨天已选"卡死）
    const picked = chooseCard(s, s.cards!.offers[1]!, T3);
    expect(picked).not.toBeNull();
    expect(picked!.cards!.chosen).not.toBe(expired);
  });
});
