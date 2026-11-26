import { formatMoyu } from "../engine/format";

/** 离线收益欢迎面板（显性化离线规则：效率与封顶） */
export class Welcome {
  private root = document.getElementById("welcome")!;
  private elTime = document.getElementById("welcome-time")!;
  private elGain = document.getElementById("welcome-gain")!;
  private elRule = document.getElementById("welcome-rule")!;

  show(offlineSeconds: number, earned: number, rate: number, onOk: () => void): void {
    this.elTime.textContent = this.describe(offlineSeconds);
    this.elGain.textContent = formatMoyu(earned);
    const rateText = rate >= 1 ? "首日全额" : `离线效率 ${Math.round(rate * 100)}%`;
    this.elRule.textContent = `${rateText}｜8 小时封顶`;
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
