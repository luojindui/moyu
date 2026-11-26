import type { GameState } from "../engine/state";
import { formatMoyu } from "../engine/format";
import { clickPowerOf } from "../engine/actions";
import { effectOf } from "../engine/upgrades";
import { rankFor } from "../engine/titles";

/** HUD 节流刷新（由主循环 ~150ms 调用一次） */
export class Hud {
  private elMoyu = document.getElementById("hud-moyu")!;
  private elClick = document.getElementById("hud-click")!;
  private elIdle = document.getElementById("hud-idle")!;
  private elRank = document.getElementById("hud-rank")!;

  refresh(state: GameState): void {
    this.elMoyu.textContent = formatMoyu(state.moyu);
    this.elClick.textContent = String(clickPowerOf(state));
    // 底薪 0.2/s 恒存在，不再有"未解锁"态
    this.elIdle.textContent = formatMoyu(effectOf(state).idleRate);
    const rank = rankFor(state.totalEarned);
    this.elRank.textContent = rank.next
      ? `${rank.current}（升 ${rank.next.name} ${(rank.progress * 100).toFixed(0)}%）`
      : rank.current;
  }
}
