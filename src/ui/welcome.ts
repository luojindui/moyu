import { formatMoyu } from "../engine/format";

/** 离线收益欢迎面板 */
export class Welcome {
  private root = document.getElementById("welcome")!;
  private elTime = document.getElementById("welcome-time")!;
  private elGain = document.getElementById("welcome-gain")!;

  show(offlineSeconds: number, earned: number, onOk: () => void): void {
    this.elTime.textContent = this.describe(offlineSeconds);
    this.elGain.textContent = formatMoyu(earned);
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
