import type { GameState } from "../engine/state";
import { CARDS, activeCard } from "../engine/cards";

const RARITY_LABEL: Record<string, string> = { common: "普通", rare: "稀有", event: "剧情" };

/** 每日事件卡弹窗：每天首次打开、未选卡时弹出 */
export class CardPanel {
  private root = document.getElementById("cards")!;
  private body = document.getElementById("cards-body")!;
  private shownAt = 0;

  constructor(
    private onChoose: (id: string) => void,
    private onSkip: () => void,
  ) {
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.onSkip();
    });
    document.getElementById("cards-skip")!.addEventListener("click", () => this.onSkip());
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  /** 有未选卡时自动弹出（首日不拦：需先完成"戳 15 下"这一步；每天只弹一次） */
  maybeShow(state: GameState): void {
    if (this.isOpen) return;
    const cs = state.cards;
    if (!cs || cs.chosen || cs.dismissed) return;
    if (cs.offers.length === 0) return;
    // 首日不拦：先让玩家摸到游戏（戳 8 下），或开页 12 秒后再给决策
    const bootMs = Number(sessionStorage.getItem("moyu-boot-ms") ?? "0");
    const waited = bootMs > 0 && Date.now() - bootMs > 12_000;
    if (state.totalClicks < 8 && !waited) return;
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
        // 防误触：弹窗刚出现的 400ms 内忽略点击（玩家可能正连点屏幕）
        if (performance.now() - this.shownAt < 1200) return; // 1.2s 防误触（玩家连点节奏）
        const id = el.dataset.id!;
        this.onChoose(id);
        this.hide();
      });
    });
    this.root.classList.remove("hidden");
    this.shownAt = performance.now();
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
