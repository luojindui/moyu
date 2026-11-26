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
    const idle = effectOf(state).idleRate;
    // 前期 0/秒 像坏了：明确标注未解锁
    this.elIdle.textContent = idle > 0 ? formatMoyu(idle) : "未解锁";
    const rank = rankFor(state.totalEarned);
    this.elRank.textContent = rank.next
      ? `${rank.current}（升 ${rank.next.name} ${(rank.progress * 100).toFixed(0)}%）`
      : rank.current;
  }
}
