import { formatMoyu } from "../engine/format";

/** 离线收益欢迎面板（显性化离线规则：效率与封顶） */
export class Welcome {
  private root = document.getElementById("welcome")!;
  private elTime = document.getElementById("welcome-time")!;
  private elGain = document.getElementById("welcome-gain")!;
  private elRule = document.getElementById("welcome-rule")!;

  show(
    realSeconds: number,
    earned: number,
    rate: number,
    onOk: () => void,
    settledSeconds?: number,
    capHours = 12,
  ): void {
    // 显示真实离开时长；被封顶时标注实际结算时长
    this.elTime.textContent = this.describe(realSeconds);
    this.elGain.textContent = formatMoyu(earned);
    const rateText = rate >= 1 ? "首日全额" : `离线效率 ${Math.round(rate * 100)}%`;
    const capped = settledSeconds !== undefined && settledSeconds < realSeconds - 1;
    this.elRule.textContent = capped
      ? `${rateText}｜超过上限，已按上限结算 ${this.describe(settledSeconds!)}`
      : `${rateText}｜${capHours} 小时封顶`;
    this.root.classList.remove("hidden");
    document.getElementById("welcome-ok")!.onclick = () => {
      this.root.classList.add("hidden");
      onOk();
    };
  }

  private describe(sec: number): string {
    if (sec < 60) return `${Math.floor(sec)} 秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)} 分钟`;
    return `${Math.floor(sec / 3600)} 小时 ${Math.floor((sec % 3600) / 60)} 分`;
  }
}
