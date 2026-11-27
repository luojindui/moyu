import type { GameState } from "../engine/state";
import { DAILY_GOAL_TEMPLATES, dailyAllDone, dailyReward } from "../engine/daily";
import { collectionCount, collectionRows, TOTAL_ITEMS } from "../engine/collection";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "../engine/flavor";
import { UPGRADES } from "../engine/upgrades";
import { formatMoyu } from "../engine/format";

/** 日报 + 图鉴面板（收集党：差距可见、每日有仪式） */
export class Journal {
  private root = document.getElementById("journal")!;
  private elDate = document.getElementById("journal-date")!;
  private elStreak = document.getElementById("journal-streak")!;
  private elGoals = document.getElementById("journal-goals")!;
  private elClaim = document.getElementById("journal-claim") as HTMLButtonElement;
  private elQuote = document.getElementById("journal-quote")!;
  private elFlavor = document.getElementById("journal-flavor")!;
  private elLatest = document.getElementById("journal-latest")!;
  private elGrid = document.getElementById("journal-grid");
  private gridRendered = false;
  private gridRenderedCount = -1;
  /** 最近一次刷新的状态：面板打开时立即重绘用 */
  private lastState: GameState | null = null;
  /** 上一次刷新时间（节流：面板关闭时零开销） */
  private lastRefreshAt = 0;

  constructor(private onClaim: () => void) {
    document.getElementById("journal-close")!.addEventListener("click", () => this.hide());
    this.elClaim.addEventListener("click", () => this.onClaim());
    document.getElementById("btn-journal")!.addEventListener("click", () => this.toggle());
  }

  toggle(): void {
    this.root.classList.toggle("hidden");
    if (this.isOpen && this.lastState) this.refresh(this.lastState, true);
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  refresh(state: GameState, force = false): void {
    this.lastState = state;
    // 面板关闭时零 DOM 开销；打开时节流 400ms（避免每帧重建列表）
    if (!this.isOpen) return;
    const now = performance.now();
    if (!force && now - this.lastRefreshAt < 400) return;
    this.lastRefreshAt = now;
    const d = state.daily;
    if (!d) return;
    this.elDate.textContent = d.date;
    this.elStreak.textContent = d.claimed ? `🔥 连续 ${d.streak} 天` : `🔥 连续 ${d.streak} 天（今天未领）`;

    this.elGoals.innerHTML = "";
    for (const g of d.goals) {
      const tpl = DAILY_GOAL_TEMPLATES.find((t) => t.id === g.id);
      if (!tpl) continue;
      const li = document.createElement("li");
      li.className = g.done ? "goal done" : "goal";
      li.innerHTML = `<span class="goal-mark">${g.done ? "✓" : "○"}</span>
        <span class="goal-desc">${tpl.desc}</span>
        <span class="goal-progress">${Math.min(g.progress, g.target)}/${g.target}</span>`;
      this.elGoals.appendChild(li);
    }

    const allDone = dailyAllDone(d);
    this.elClaim.disabled = !allDone || d.claimed;
    this.elClaim.textContent = d.claimed
      ? "今日已领"
      : allDone
        ? `领取 +${formatMoyu(dailyReward(state))}`
        : `完成 ${d.goals.filter((g) => g.done).length}/${d.goals.length}`;

    // 图鉴进度
    const quotes = state.collected.quotes.length;
    const flavors = state.collected.flavors.length;
    this.elQuote.textContent = `${quotes}/${MEME_QUOTES.length}`;
    this.elFlavor.textContent = `${flavors}/${UPGRADES.length * 5}`;
    document.getElementById("journal-total")!.textContent = `${collectionCount(state)}/${TOTAL_ITEMS}`;

    // 55 格可浏览图鉴（未解锁 ???），首次打开或收集数变化时重绘
    const unlockedRows = state.collected.quotes.length + state.collected.flavors.length;
    if (this.elGrid && (this.gridRendered !== true || this.gridRenderedCount !== unlockedRows)) {
      this.gridRendered = true;
      this.gridRenderedCount = unlockedRows;
      this.elGrid.innerHTML = collectionRows(state)
        .map(
          (r) =>
            `<div class="c-item ${r.unlocked ? "on" : "off"}" title="${r.unlocked ? r.label : "未解锁"}">
               <span class="c-label">${r.unlocked ? r.label : "???"}</span>
               <span class="c-text">${r.unlocked ? r.text : ""}</span>
             </div>`,
        )
        .join("");
    }

    // 最新收集（彩蛋优先展示文本）
    const latestFlavor = state.collected.flavors.at(-1);
    if (latestFlavor !== undefined) {
      const up = UPGRADES[Math.floor(latestFlavor / 5)];
      const tier = latestFlavor % 5;
      const line = up ? UPGRADE_FLAVOR[up.id]?.[tier] : "";
      this.elLatest.textContent = up && line ? `最新彩蛋「${up.name}」：${line}` : "";
    } else {
      this.elLatest.textContent = "买升级、收线索，开始收集摸鱼彩蛋";
    }
  }
}
