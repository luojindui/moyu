import type { GameState } from "../engine/state";

/**
 * 新手目标链（R7-rage 建议）：不挡屏、目标+进度常驻 HUD，每 10-20 秒兑现一次"新东西"。
 * 纯 UI 状态，不入存档（重开从第一步开始，只在前 2 分钟出现）。
 */
interface Step {
  id: string;
  text: (state?: unknown) => string;
  /** 判定是否完成：基于状态与上一帧状态 */
  done: (state: GameState, prev: GameState | null) => boolean;
  /** 进度 0..1 */
  progress: (state: GameState, prev: GameState | null) => number;
}

export class Quest {
  private root = document.getElementById("quest")!;
  private elText = document.getElementById("quest-text")!;
  private elBar = document.getElementById("quest-bar") as HTMLElement;
  private idx = 0;
  private base: GameState | null = null;
  private steps: Step[] = [
    {
      id: "click10",
      // 用真实差价换算"还差几下"，与商店卡显示一致（避免 10 vs 15 冲突）
      text: (s?: unknown) => {
        const st = s as GameState | undefined;
        if (!st) return "戳屏幕攒摸鱼值，攒够就能买「咖啡续命」";
        const gap = Math.max(0, 15 - st.moyu);
        const taps = Math.ceil(gap / Math.max(1, 1 + 0));
        return gap > 0 ? `再戳 ${taps} 下 → 解锁「咖啡续命」` : "买下点亮的「咖啡续命」卡片";
      },
      done: (s) => s.totalClicks - (this.base?.totalClicks ?? 0) >= 10 || s.moyu >= 15,
      progress: (s) =>
        Math.min(1, Math.max((s.totalClicks - (this.base?.totalClicks ?? 0)) / 10, s.moyu / 15)),
    },
    {
      id: "buyCoffee",
      text: () => "买下点亮的「咖啡续命」卡片",
      done: (s) => (s.levels["coffee"] ?? 0) > 0,
      progress: (s) => ((s.levels["coffee"] ?? 0) > 0 ? 1 : 0),
    },
    {
      id: "click25",
      text: () => "攒够 50 摸鱼值 → 解锁「刷手机」（每秒自动 +1）",
      done: (s) => s.totalClicks - (this.base?.totalClicks ?? 0) >= 25,
      progress: (s) => Math.min(1, (s.totalClicks - (this.base?.totalClicks ?? 0)) / 25),
    },
    {
      id: "buyPhone",
      text: () => "买下「刷手机」：之后每秒自动赚钱",
      done: (s) => (s.levels["phone"] ?? 0) > 0,
      progress: (s) => ((s.levels["phone"] ?? 0) > 0 ? 1 : 0),
    },
    {
      id: "idle",
      text: () => "什么都不点，等 10 秒看挂机收益",
      done: (s) => s.totalEarned - (this.base?.totalEarned ?? 0) >= 10 * Math.max(1, s.levels["phone"] ?? 1),
      progress: (s, prev) =>
        Math.min(1, (s.totalEarned - (prev?.totalEarned ?? s.totalEarned)) / Math.max(1, 10 * Math.max(1, s.levels["phone"] ?? 1))),
    },
  ];

  constructor(private onComplete: (text: string) => void) {}

  /** 每 150ms 调用；state 为当前，prev 为上一帧 */
  tick(state: GameState, prev: GameState | null): void {
    // 已进阶（转生过/本局累计很高）则不再显示新手目标
    if (state.prestige > 0 || state.lifetimeEarned > 1e6) {
      this.root.classList.add("hidden");
      return;
    }
    if (this.idx >= this.steps.length) {
      this.root.classList.add("hidden");
      return;
    }
    const step = this.steps[this.idx]!;
    if (this.base === null) this.base = { ...state };
    if (step.done(state, prev)) {
      this.onComplete(`✓ ${step.text(state)}`);
      this.idx += 1;
      this.base = { ...state }; // 下一步进度从此刻算
      if (this.idx >= this.steps.length) {
        this.root.classList.add("hidden");
        return;
      }
    }
    const cur = this.steps[this.idx]!;
    this.root.classList.remove("hidden");
    this.elText.textContent = cur.text(state);
    this.elBar.style.width = `${(cur.progress(state, prev) * 100).toFixed(0)}%`;
  }
}
