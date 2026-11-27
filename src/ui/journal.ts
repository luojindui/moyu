import type { GameState } from "../engine/state";
import { DAILY_GOAL_TEMPLATES, dailyAllDone, dailyReward } from "../engine/daily";
import { collectionCount, collectionRows, TOTAL_ITEMS } from "../engine/collection";
import { MEME_QUOTES, UPGRADE_FLAVOR } from "../engine/flavor";
import { UPGRADES } from "../engine/upgrades";
import { formatMoyu } from "../engine/format";
import { CLICK_MEMES } from "../engine/flavor";
import { clickPowerOf } from "../engine/actions";
import { canPrestige, prestigeGain, prestigeMultiplier, prestigeThreshold } from "../engine/prestige";
import { computeStats } from "../engine/stats";
import { APP_VERSION, APP_UPDATED_AT } from "../version";
import { RECORDS_KEY, parseRecords, emptyRecords } from "../engine/records";

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
  private elStats = document.getElementById("stats-list")!;
  private gridRendered = false;
  private gridRenderedCount = -1;
  /** 最近一次刷新的状态：面板打开时立即重绘用 */
  private lastState: GameState | null = null;
  /** 上一次刷新时间（节流：面板关闭时零开销） */
  private lastRefreshAt = 0;

  private elPrestigeBtn = document.getElementById("prestige-btn") as HTMLButtonElement;
  private elPrestigeInfo = document.getElementById("prestige-info")!;

  constructor(
    private onClaim: () => void,
    private onExportCode: () => string,
    private onImportCode: (code: string) => { ok: boolean; message: string },
    private onPrestige: () => void,
  ) {
    document.getElementById("journal-close")!.addEventListener("click", () => this.hide());
    // 点遮罩空白处也能关（中老年找不到 ✕ 的兜底）
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    this.elClaim.addEventListener("click", () => this.onClaim());
    this.elPrestigeBtn.addEventListener("click", () => this.onPrestige());
    // 导出存档 JSON（生产可用：直接读 localStorage，不依赖调试钩子）
    // 存档码：生成/复制 + 导入
    document.getElementById("savecode-copy")!.addEventListener("click", () => {
      const ta = document.getElementById("savecode") as HTMLTextAreaElement;
      const code = this.onExportCode();
      ta.value = code;
      ta.select();
      const msg = document.getElementById("savecode-msg")!;
      try {
        void navigator.clipboard?.writeText(code);
        msg.textContent = `已生成并复制（${code.length} 字符）`;
      } catch {
        msg.textContent = "已生成，请手动复制上面的文本";
      }
    });
    document.getElementById("savecode-import")!.addEventListener("click", () => {
      const ta = document.getElementById("savecode") as HTMLTextAreaElement;
      const msg = document.getElementById("savecode-msg")!;
      const r = this.onImportCode(ta.value);
      msg.textContent = r.message;
    });

    document.getElementById("stats-export")!.addEventListener("click", () => {
      try {
        const raw = localStorage.getItem("moyu-save") ?? "{}";
        const blob = new Blob([raw], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `moyu-save-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } catch {
        /* 忽略 */
      }
    });
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

    // 关于：版本号 + 更新日志（静态，零后端）
    document.getElementById("about-version")!.textContent = `v${APP_VERSION} · ${APP_UPDATED_AT}`;
    const notes = document.getElementById("about-notes")!;
    if (!notes.textContent) {
      void fetch("./updates.json")
        .then((r) => r.json())
        .then((j: { notes?: string[] }) => {
          notes.textContent = (j.notes ?? []).slice(0, 4).join("；");
        })
        .catch(() => {
          notes.textContent = "更新日志暂不可用";
        });
    }
    // 今日工位梗（每天轮换，零存档字段）
    const pool = [...CLICK_MEMES, ...MEME_QUOTES];
    const dayIdx = Math.floor(Date.now() / 86_400_000) % pool.length;
    document.getElementById("about-today")!.textContent = `今日工位梗：${pool[dayIdx]}`;

    // 数据统计（全部由现有字段推导）
    let rec = emptyRecords();
    try {
      rec = parseRecords(localStorage.getItem(RECORDS_KEY));
    } catch {
      /* 忽略 */
    }
    const st = computeStats(state, rec);
    const rows: [string, string][] = [
      ["生涯总收入", formatMoyu(st.lifetime)],
      ["本局 / 往期", `${formatMoyu(st.run)} / ${formatMoyu(st.previous)}`],
      ["当前余额", formatMoyu(st.balance)],
      ["累计投入", formatMoyu(st.invested)],
      ["点击力 / 挂机", `${clickPowerOf(state).toFixed(0)} / ${formatMoyu(st.idleRate)}每秒`],
      ["累计点击", String(st.totalClicks)],
      ["今日回访", `${st.visits}/3（离线效率 ${Math.round((0.7 + Math.min(3, st.visits) * 0.1) * 100)}%）`],
      ["连续日报", `${st.streak} 天`],
      ["图鉴", `${st.collection}/${st.collectionTotal}`],
      ["转生", `${st.prestige} 点（×${st.prestigeMult.toFixed(2)}）`],
      ["纪录·最佳单日", `${formatMoyu(st.records.bestDayEarned)}${st.records.bestDayDate ? `（${st.records.bestDayDate}）` : ""}`],
      ["纪录·最长连签", `${st.records.maxStreak} 天`],
      ["纪录·最多点击", String(st.records.maxClicks)],
    ];
    this.elStats.innerHTML = rows
      .map(([k, v]) => `<div class="stat-row"><span>${k}</span><b>${v}</b></div>`)
      .join("");
    document.getElementById("stats-rank")!.textContent = st.rank;

    // 转生信息
    const gain = prestigeGain(state);
    const unlocked = canPrestige(state);
    this.elPrestigeBtn.disabled = !unlocked;
    this.elPrestigeBtn.textContent = unlocked
      ? `离职再就业：+${gain} 点（永久 ×${prestigeMultiplier(state.prestige + gain).toFixed(2)}）`
      : `未解锁（本局累计 ${formatMoyu(state.totalEarned)} / 需 ${formatMoyu(prestigeThreshold(state))}）`;
    this.elPrestigeInfo.textContent =
      state.prestige > 0 ? `已有 ${state.prestige} 点 · 当前 ×${prestigeMultiplier(state.prestige).toFixed(2)}` : "";

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
