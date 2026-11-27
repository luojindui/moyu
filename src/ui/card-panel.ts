import type { GameState } from "../engine/state";
import { CARDS, activeCard } from "../engine/cards";

const RARITY_LABEL: Record<string, string> = { common: "普通", rare: "稀有", event: "剧情" };

/** 每日事件卡弹窗：每天首次打开、未选卡时弹出 */
export class CardPanel {
  private root = document.getElementById("cards")!;
  private body = document.getElementById("cards-body")!;

  constructor(private onChoose: (id: string) => void) {
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** 有未选卡时自动弹出 */
  maybeShow(state: GameState): void {
    if (this.isOpen) return;
    if (!state.cards || state.cards.chosen) return;
    if (state.cards.offers.length === 0) return;
    this.show(state);
  }

  show(state: GameState): void {
    const cards = state.cards!.offers
      .map((id) => CARDS.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    this.body.innerHTML = cards
      .map(
        (c) => `<div class="card ${c.rarity}" data-id="${c.id}">
          <span class="card-rarity">${RARITY_LABEL[c.rarity] ?? ""}</span>
          <div class="card-name">${c.name}</div>
          <div class="card-desc">${c.desc}</div>
          <div class="card-flavor">${c.flavor}</div>
        </div>`,
      )
      .join("");
    this.body.querySelectorAll<HTMLElement>(".card").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.id!;
        this.onChoose(id);
        this.hide();
      });
    });
    this.root.classList.remove("hidden");
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  /** 今日已生效的卡（可选展示在 HUD） */
  activeLabel(state: GameState, nowMs: number): string {
    const c = activeCard(state, nowMs);
    if (!c) return "";
    return `${c.name}：${c.desc}`;
  }
}
