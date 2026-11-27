import { describe, it, expect } from "vitest";
import { initialState, gain } from "./state";
import {
  CARDS,
  CARD_DURATION,
  activeCard,
  cardEffects,
  chooseCard,
  emptyCardState,
  ensureCards,
  rollOffers,
} from "./cards";

const NOW = 1_700_000_000_000;
const TODAY = "2026-11-27";

function withCards(offers: string[] = ["coffee_day", "overtime", "hr_talk"]) {
  return { ...gain(initialState(), 1000), cards: { ...emptyCardState(TODAY), offers } };
}

describe("每日事件卡", () => {
  it("每天抽 3 张不重复", () => {
    for (let s = 0; s < 20; s++) {
      const cs = rollOffers(TODAY, () => (s % 17) / 17);
      expect(cs.offers).toHaveLength(3);
      expect(new Set(cs.offers).size).toBe(3);
      expect(cs.offers.every((id) => CARDS.some((c) => c.id === id))).toBe(true);
    }
  });

  it("剧情链保底卡优先进入卡池", () => {
    const cs = rollOffers(TODAY, () => 0.5, "secret_project");
    expect(cs.offers).toContain("secret_project");
    expect(cs.offers).toHaveLength(3);
  });

  it("选卡：只能选一次、必须在候选里", () => {
    const s = withCards();
    expect(chooseCard(s, "not-offered", NOW)).toBeNull();
    const picked = chooseCard(s, "coffee_day", NOW)!;
    expect(picked.cards!.chosen).toBe("coffee_day");
    expect(picked.cards!.until).toBe(NOW + CARD_DURATION * 1000);
    // 再选失败
    expect(chooseCard(picked, "overtime", NOW)).toBeNull();
  });

  it("卡效果在有效期内生效、过期失效", () => {
    const s = chooseCard(withCards(), "coffee_day", NOW)!;
    expect(activeCard(s, NOW)?.id).toBe("coffee_day");
    expect(cardEffects(s, NOW).idleMult).toBe(1.15);
    // 24h 后失效
    expect(activeCard(s, NOW + CARD_DURATION * 1000)).toBeNull();
    expect(cardEffects(s, NOW + CARD_DURATION * 1000).idleMult).toBe(1);
  });

  it("风险卡同时给增益与惩罚", () => {
    const s = chooseCard(withCards(), "overtime", NOW)!;
    const e = cardEffects(s, NOW);
    expect(e.idleMult).toBe(1.6);
    expect(e.riskPenalty).toBe(0.2);
  });

  it("HR 约谈 → 次日保底剧情卡", () => {
    const s = chooseCard(withCards(), "hr_talk", NOW)!;
    expect(s.cards!.nextDayGuaranteed).toBe("secret_project");
    const next = ensureCards(s, "2026-11-28", () => 0.3);
    expect(next.cards!.offers).toContain("secret_project");
  });

  it("跨日刷新卡池（幂等）", () => {
    const s = withCards();
    const a = ensureCards(s, "2026-11-28", () => 0.3);
    expect(a.cards!.date).toBe("2026-11-28");
    const b = ensureCards(a, "2026-11-28", () => 0.3);
    expect(b).toBe(a); // 同日不重抽
  });
});
