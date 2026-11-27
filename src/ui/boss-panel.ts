import type { EventState } from "../engine/events";
import { CHOICES, CHOICE_SECONDS, personalityDef, type BossChoice } from "../engine/boss-choice";

/** 回合制老板：限时 3 选 1 的 DOM 弹层 */
export class BossChoicePanel {
  private root = document.getElementById("boss-choice")!;
  private elTell = document.getElementById("boss-tell")!;
  private elOpts = document.getElementById("boss-opts")!;
  private elTimer = document.getElementById("boss-timer")!;
  private timer: number | null = null;
  private shown = false;
  private shownAt = 0;

  constructor(private onPick: (choice: BossChoice) => void) {}

  /** 就地显示结果（选中行变色 + 台词），180ms 后收起 */
  showResult(correct: boolean, text: string): void {
    if (!this.shown) return;
    const el = document.createElement("div");
    el.className = "boss-result";
    el.style.color = correct ? "#8be28b" : "#ff8a8a";
    el.textContent = text;
    this.elOpts.appendChild(el);
    setTimeout(() => this.hide(), 220);
  }

  get isOpen(): boolean {
    return this.shown;
  }

  /** 每帧调用：根据事件状态显示/隐藏 */
  sync(es: EventState): void {
    const active = es.bossVariant === "choice" && es.bossUntil > 0 && !es.bossChoiceDone;
    if (active && !this.shown) this.show(es);
    else if (!active && this.shown) this.hide();
  }

  private show(es: EventState): void {
    const p = personalityDef(es.bossPersonality);
    // 只给"观察到的行为"，不直接报性格名，让玩家真的要推断
    this.elTell.textContent = `有人过来了——${p.tell}`;
    this.elOpts.innerHTML = CHOICES.map(
      (c) => `<button data-choice="${c.id}">${c.label}</button>`,
    ).join("");
    this.elOpts.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      // pointerdown 结算：比 click（touchend）更快、手感和误触都更好
      b.addEventListener("pointerdown", (e) => {
        // 只接受落在按钮本身上的按下（绕开 touch-adjust 吸附到间隙）
        if (!(e.target as HTMLElement).closest("button")) return;
        if (performance.now() - this.shownAt < 150) {
          // 守卫期被吞：给一次可见反馈，而不是静默
          b.classList.add("shake");
          setTimeout(() => b.classList.remove("shake"), 200);
          return;
        }
        b.classList.add("picked");
        this.onPick(b.dataset.choice as BossChoice);
        // 不在这里 hide：由 showResult 负责（保证结果可见）
      });
    });
    this.root.classList.remove("hidden");
    document.body.classList.add("choice-open");
    this.shown = true;
    this.shownAt = performance.now();
    // 倒计时条
    const start = performance.now();
    const total = CHOICE_SECONDS * 1000;
    if (this.timer !== null) cancelAnimationFrame(this.timer);
    const tick = (): void => {
      if (!this.shown) return;
      const left = Math.max(0, 1 - (performance.now() - start) / total);
      this.elTimer.innerHTML = `<i style="width:${(left * 100).toFixed(1)}%"></i>`;
      if (left > 0) this.timer = requestAnimationFrame(tick);
    };
    this.timer = requestAnimationFrame(tick);
  }

  hide(): void {
    this.root.classList.add("hidden");
    document.body.classList.remove("choice-open");
    this.shown = false;
    if (this.timer !== null) {
      cancelAnimationFrame(this.timer);
      this.timer = null;
    }
  }
}
