import type { GameState } from "../engine/state";
import { UPGRADES, costOf, marginalEffect, milestoneGap, valueScoreOf } from "../engine/upgrades";
import { formatMoyu } from "../engine/format";
import { clickPowerOf } from "../engine/actions";
import { flavorFor } from "../engine/flavor";

/** 展示顺序：点击线与挂机线交错，保证首屏就能看到挂机卡（挂机是核心卖点） */
const DISPLAY_ORDER = ["coffee", "phone", "water", "toilet", "chair", "group", "meeting", "deep", "retire"];

/** 升级商店：卡片 + 可购态刷新 + 性价比提示 + 购买回调 */
export class Shop {
  private container = document.getElementById("shop-cards")!;
  /** 记录已解锁（可用）状态，用于首次可买时的弹入动画 */
  private unlockedOnce = new Map<string, boolean>();
  private buttons = new Map<string, HTMLButtonElement>();
  private costs = new Map<string, HTMLElement>();

  constructor(onBuy: (id: string) => void) {
    // 滑动一次后隐藏「滑动查看」提示
    const hint = document.getElementById("shop-hint");
    if (hint) {
      const hide = (): void => hint.classList.add("hidden");
      this.container.addEventListener("scroll", hide, { once: true, passive: true });
      setTimeout(hide, 8000);
    }
    const ordered = [...UPGRADES].sort(
      (a, b) => DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id),
    );
    for (const u of ordered) {
      const card = document.createElement("button");
      card.className = "shop-card pixel-panel";
      card.dataset.upgrade = u.id;
      const lineTag = u.clickPower ? "点了才赚" : "会自动赚";
      card.innerHTML = `<span class="shop-top"><span class="shop-tag ${u.clickPower ? "tag-click" : "tag-idle"}">${lineTag}</span><span class="shop-name">${u.name}</span></span>
        <span class="shop-next"></span>
        <span class="shop-value"></span>
        <span class="shop-cost"><b>0</b> 摸鱼值</span>
        <span class="shop-remain"></span>
        <span class="shop-level"></span>`;
      card.addEventListener("click", () => onBuy(u.id));
      // disabled 按钮会吞掉 click：用父容器捕获 pointerdown 给「还差」反馈
      card.addEventListener(
        "pointerdown",
        () => {
          if (card.disabled) card.classList.add("shake");
        },
        { passive: true },
      );
      card.addEventListener("animationend", () => card.classList.remove("shake"));
      this.container.appendChild(card);
      this.buttons.set(u.id, card);
      this.costs.set(u.id, card.querySelector(".shop-cost b")!);
    }
  }

  refresh(state: GameState): void {
    // 挂机向性价比最佳项（星标）；点击向与挂机向是两个维度，各自展示
    let bestIdleId: string | null = null;
    let bestIdleScore = 0;
    let bestClickId: string | null = null;
    let bestClickScore = 0;
    for (const u of UPGRADES) {
      const lv = state.levels[u.id] ?? 0;
      const score = valueScoreOf(u.id, lv);
      if (u.idleRate && score.idle > bestIdleScore) {
        bestIdleScore = score.idle;
        bestIdleId = u.id;
      }
      if (u.clickPower && score.click > bestClickScore) {
        bestClickScore = score.click;
        bestClickId = u.id;
      }
    }

    for (const u of UPGRADES) {
      const lv = state.levels[u.id] ?? 0;
      const price = costOf(u.id, lv);
      const btn = this.buttons.get(u.id)!;
      this.costs.get(u.id)!.textContent = formatMoyu(price);
      const lvEl = btn.querySelector(".shop-level")!;
      lvEl.textContent = lv > 0 ? `Lv.${lv}` : "";
      // 彩蛋文案并入 next 行（避免卡片过高）
      const flavor = flavorFor(u.id, lv);
      // 下一级即时增量 + 里程碑进度（效果 ×2 还差 N 级）
      const m = marginalEffect(u.id, lv);
      const inc = m.clickPower > 0 ? `+${m.clickPower} 点击力` : `+${m.idleRate}/秒`;
      const gap = milestoneGap(u.id, lv);
      const gapText = gap <= 5 ? ` · ×2差${gap}级` : ""; // 只在快到时提示（降低噪音）
      btn.querySelector(".shop-next")!.textContent = `${inc}${gapText}${flavor ? ` · ${flavor}` : ""}`;
      // 性价比：星标当前维度最优（黑箱显性化）
      const isBest = u.clickPower ? u.id === bestClickId : u.id === bestIdleId;
      // 性价比改为可懂的说法：这一档「当前最划算」
      const dim = isBest ? "★ 当前最划算" : "";
      btn.querySelector(".shop-value")!.textContent = dim;
      btn.disabled = state.moyu < price;
      const affordable = state.moyu >= price;
      btn.classList.toggle("affordable", affordable);
      if (affordable && this.unlockedOnce.get(u.id) !== true) {
        this.unlockedOnce.set(u.id, true);
        btn.classList.remove("just-unlocked");
        void btn.offsetWidth; // 重启动画
        btn.classList.add("just-unlocked");
      }
      const remain = btn.querySelector(".shop-remain")!;
      if (state.moyu < price) {
        const gapVal = price - state.moyu;
        const perTap = Math.max(1, clickPowerOf(state));
        remain.textContent = u.clickPower ? `再戳 ${Math.ceil(gapVal / perTap)} 下` : `还差 ${formatMoyu(gapVal)}`;
      } else {
        remain.textContent = "";
      }
    }
  }
}
