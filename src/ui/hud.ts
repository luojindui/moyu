import type { GameState } from "../engine/state";
import { formatMoyu } from "../engine/format";
import { clickPowerOf } from "../engine/actions";
import { effectOf } from "../engine/upgrades";

/** HUD 节流刷新（由主循环 ~150ms 调用一次） */
export class Hud {
  private elMoyu = document.getElementById("hud-moyu")!;
  private elClick = document.getElementById("hud-click")!;
  private elIdle = document.getElementById("hud-idle")!;

  refresh(state: GameState): void {
    this.elMoyu.textContent = formatMoyu(state.moyu);
    this.elClick.textContent = String(clickPowerOf(state));
    this.elIdle.textContent = formatMoyu(effectOf(state).idleRate);
  }
}
