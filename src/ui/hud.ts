import type { GameState } from "../engine/state";
import { formatMoyu } from "../engine/format";
import { clickPowerOf } from "../engine/actions";
import { effectOf } from "../engine/upgrades";
import { rankFor } from "../engine/titles";
import { dailyAllDone } from "../engine/daily";

/** HUD 节流刷新（由主循环 ~150ms 调用一次） */
export class Hud {
  private elMoyu = document.getElementById("hud-moyu")!;
  private elClick = document.getElementById("hud-click")!;
  private elIdle = document.getElementById("hud-idle")!;
  private elRank = document.getElementById("hud-rank")!;
  private elJournal = document.getElementById("btn-journal")!;
  private elStreak = document.getElementById("hud-streak")!;

  refresh(state: GameState): void {
    this.elMoyu.textContent = formatMoyu(state.moyu);
    this.elClick.textContent = String(clickPowerOf(state));
    // 底薪 0.2/s 恒存在，不再有"未解锁"态
    this.elIdle.textContent = formatMoyu(effectOf(state).idleRate);
    const rank = rankFor(state.totalEarned);
    this.elRank.textContent = rank.next
      ? `${rank.current}（升 ${rank.next.name} ${(rank.progress * 100).toFixed(0)}%）`
      : rank.current;
    // 📔 可领角标：日报 3/3 完成且未领
    const claimable = !!state.daily && !state.daily.claimed && dailyAllDone(state.daily);
    this.elJournal.classList.toggle("has-reward", claimable);
    this.elJournal.title = claimable ? "日报奖励可领取" : "日报与图鉴";
    // 安然连胜（挑战党长期目标，入档持久化）
    if (state.surviveStreak > 0) {
      this.elStreak.textContent = `🔥连胜 ${state.surviveStreak}`;
      this.elStreak.classList.remove("hidden");
    } else {
      this.elStreak.classList.add("hidden");
    }
  }
}
