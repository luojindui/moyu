import type { GameState } from "../engine/state";
import { UPGRADES, costOf } from "../engine/upgrades";
import { formatMoyu } from "../engine/format";

/** 升级商店：卡片 + 可购态刷新 + 购买回调 */
export class Shop {
  private container = document.getElementById("shop-cards")!;
  private buttons = new Map<string, HTMLButtonElement>();
  private costs = new Map<string, HTMLElement>();

  constructor(onBuy: (id: string) => void) {
    for (const u of UPGRADES) {
      const card = document.createElement("button");
      card.className = "shop-card pixel-panel";
      card.dataset.upgrade = u.id;
      card.innerHTML = `<span class="shop-name">${u.name}</span>
        <span class="shop-desc">${u.desc}</span>
        <span class="shop-cost"><b>0</b> 摸鱼值</span>
        <span class="shop-level"></span>`;
      card.addEventListener("click", () => onBuy(u.id));
      this.container.appendChild(card);
      this.buttons.set(u.id, card);
      this.costs.set(u.id, card.querySelector(".shop-cost b")!);
    }
  }

  refresh(state: GameState): void {
    for (const u of UPGRADES) {
      const lv = state.levels[u.id] ?? 0;
      const price = costOf(u.id, lv);
      const btn = this.buttons.get(u.id)!;
      this.costs.get(u.id)!.textContent = formatMoyu(price);
      const lvEl = btn.querySelector(".shop-level")!;
      lvEl.textContent = lv > 0 ? `Lv.${lv}` : "";
      btn.disabled = state.moyu < price;
      btn.classList.toggle("affordable", state.moyu >= price);
    }
  }
}
