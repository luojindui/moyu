import type { GameState } from "../engine/state";
import { formatMoyu } from "../engine/format";
import { stationIdleScaled } from "../engine/upgrades";
import { DECOR, canBuyDecor, decorCount, decorEffects } from "../engine/decor";
import { ENERGY_ACTIONS, ENERGY_PER_DAY } from "../engine/energy";
import { prestigeMultiplier } from "../engine/prestige";
import {
  COLLEAGUES,
  MISSIONS,
  MAX_COLLEAGUE_LEVEL,
  canRecruit,
  claimableCount,
  claimableTotal,
  colleagueDef,
  dispatchReward,
  missionDone,
  missionSecondsFor,
  teamFixedRate,
  teamShareRatio,
  teamSize,
  upgradeCostOf,
} from "../engine/team";
import {
  TALENTS,
  branchTier,
  canUnlock,
  costOfTalent,
  exclusiveTaken,
  talentEffects,
  type TalentBranch,
} from "../engine/talents";

/** 好感里程碑效果说明（与实现一致） */
const MILESTONE_EFFECT: Record<number, string> = {
  20: "巡逻预警提前 1 秒",
  40: "离线效率 +3%",
  60: "丢梗奖励 +10%",
  80: "团队挂机 +2%/人",
  100: "该同事派遣奖励 ×1.5",
};

const SKILL_LABEL: Record<string, string> = {
  chat: "聊八卦",
  meeting: "开会",
  toilet: "蹲点",
  errand: "跑腿",
  coffee: "买咖啡",
};

function traitLabel(trait: string): string {
  const map: Record<string, string> = {
    派遣速度: "他的任务更快",
    离线效率: "在队时离线更肥",
    罚款减免: "在队时偷点罚得少",
    短任务加成: "1 小时内任务更赚",
    长任务加成: "4 小时以上任务更赚",
  };
  return map[trait] ?? trait;
}

function traitValueText(def: { trait: string; traitValue: number }): string {
  if (def.trait === "派遣速度") return `时长 -${def.traitValue * 100}%`;
  if (def.trait === "短任务加成" || def.trait === "长任务加成") return `奖励 +${def.traitValue * 100}%`;
  return `+${def.traitValue * 100}%`;
}

export interface TeamCallbacks {
  onRecruit: (id: string) => void;
  onUpgrade: (id: string) => void;
  onDispatch: (id: string, missionId: string) => void;
  onClaim: (id: string) => void;
  onClaimAll: () => void;
  onToggleAuto: (id: string, on: boolean) => void;
  onUnlockTalent: (id: string) => void;
  onResetTalents: () => void;
  onBuyDecor: (id: string) => void;
  onUseEnergy: (id: string) => void;
  onUseAllEnergy: () => void;
}

/** 摸鱼小队面板（同事 / 天赋 两页） */
export class TeamPanel {
  private root = document.getElementById("team")!;
  private body = document.getElementById("team-body")!;
  private elPoints = document.getElementById("team-points")!;
  private tabColleagues = document.getElementById("tab-colleagues") as HTMLButtonElement;
  private tabTalents = document.getElementById("tab-talents") as HTMLButtonElement;
  private tabDecor = document.getElementById("tab-decor") as HTMLButtonElement;
  private tab: "colleagues" | "talents" | "decor" = "colleagues";
  private lastState: GameState | null = null;
  private lastAt = 0;
  /** 上次渲染的结构签名（只有结构变化才整块重绘，避免点空） */
  private lastSig = "";
  private lastFocused: HTMLElement | null = null;
  private timer: number | null = null;

  constructor(private cb: TeamCallbacks) {
    document.getElementById("btn-team")!.addEventListener("click", () => this.toggle());
    document.getElementById("team-close")!.addEventListener("click", () => this.hide());
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    this.tabColleagues.addEventListener("click", () => this.setTab("colleagues"));
    this.tabTalents.addEventListener("click", () => this.setTab("talents"));
    this.tabDecor.addEventListener("click", () => this.setTab("decor"));
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(): void {
    this.root.classList.remove("hidden");
    try {
      localStorage.setItem("moyu-team-seen", "1");
    } catch {
      /* 忽略 */
    }
    // 焦点进入面板（aria-modal 要求），关闭时归还
    this.lastFocused = document.activeElement as HTMLElement | null;
    setTimeout(() => {
      (this.root.querySelector(".team-tabs .tab.active") as HTMLElement | null)?.focus();
    }, 30);
    if (this.lastState) this.render(this.lastState, true);
    this.timer ??= window.setInterval(() => {
      if (this.lastState && this.isOpen) this.refresh(this.lastState);
    }, 500);
  }

  hide(): void {
    this.root.classList.add("hidden");
    this.lastFocused?.focus?.();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setTab(tab: "colleagues" | "talents" | "decor"): void {
    this.tab = tab;
    this.tabColleagues.classList.toggle("active", tab === "colleagues");
    this.tabTalents.classList.toggle("active", tab === "talents");
    this.tabDecor.classList.toggle("active", tab === "decor");
    this.tabColleagues.setAttribute("aria-selected", String(tab === "colleagues"));
    this.tabTalents.setAttribute("aria-selected", String(tab === "talents"));
    this.tabDecor.setAttribute("aria-selected", String(tab === "decor"));
    if (this.lastState) this.render(this.lastState, true);
  }

  /** 面板内浮动提示（不会被全屏遮罩挡住） */
  flash(text: string): void {
    const el = document.createElement("div");
    el.className = "team-flash";
    el.textContent = text;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  /** 动作后立即刷新（绕过节流）；会尝试把焦点还给同一控件 */
  refreshNow(state: GameState): void {
    const active = document.activeElement as HTMLElement | null;
    const act = active?.dataset?.act;
    const id = active?.dataset?.id;
    this.lastState = state;
    this.lastAt = 0;
    this.lastSig = "";
    if (this.isOpen) this.render(state, true);
    else this.refresh(state);
    // 焦点恢复：渲染后找同一 act+id 的控件（找不到就落在当前 tab）
    if (act) {
      const sel = id ? `[data-act="${act}"][data-id="${id}"]` : `[data-act="${act}"]`;
      const el = this.body.querySelector<HTMLElement>(sel) ?? (this.root.querySelector(".team-tabs .tab.active") as HTMLElement | null);
      el?.focus?.();
    }
  }

  /** 主循环调用：更新角标 + 面板内容（结构变化才重绘） */
  refresh(state: GameState): void {
    this.lastState = state;
    const btn = document.getElementById("btn-team");
    if (btn) {
      const n = claimableCount(state, Date.now());
      const energyLeft = state.energy.left > 0 && state.energy.used.length < 3;
      let badge = btn.querySelector(".badge") as HTMLElement | null;
      if (n > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "badge";
          btn.appendChild(badge);
        }
        badge.textContent = String(n);
      } else if (badge) {
        badge.remove();
      }
      let energyBadge = btn.querySelector<HTMLElement>(".energy-badge");
      if (energyLeft) {
        if (!energyBadge) {
          energyBadge = document.createElement("span");
          energyBadge.className = "energy-badge";
          btn.appendChild(energyBadge);
        }
        energyBadge.textContent = `精力 ${state.energy.left}`;
      } else if (energyBadge) {
        energyBadge.remove();
      }
      btn.setAttribute(
        "aria-label",
        n > 0 ? `摸鱼小队，${n} 个任务可领取` : energyLeft ? `摸鱼小队，还有精力 ${state.energy.left}` : "摸鱼小队",
      );
    }
    if (!this.isOpen) return;
    const now = performance.now();
    if (now - this.lastAt < 400) return;
    this.lastAt = now;
    this.render(state);
  }

  private signature(state: GameState): string {
    const cols = COLLEAGUES.map((d) => {
      const c = state.team.colleagues[d.id];
      return c ? `${d.id}:${c.level}:${c.missionId ?? "-"}:${c.autoRepeat ? 1 : 0}:${Math.floor(c.favor / 5)}` : "-";
    }).join("|");
    return [
      this.tab,
      cols,
      state.talents.points,
      state.talents.unlocked.join(","),
      state.decor.join(","),
      `${state.energy.left}:${state.energy.used.join(",")}`,
      claimableCount(state, Date.now()),
      Math.floor(state.totalClicks / 300),
      state.patrolSurvives,
    ].join("#");
  }

  private render(state: GameState, force = false): void {
    this.lastState = state;
    const sig = this.signature(state);
    if (!force && sig === this.lastSig) {
      this.updateCountdowns(state);
      return;
    }
    this.lastSig = sig;
    this.elPoints.textContent = `天赋点 ${state.talents.points}`;
    if (this.tab === "colleagues") this.renderColleagues(state, Date.now());
    else if (this.tab === "talents") this.renderTalents(state);
    else this.renderDecor(state);
  }

  /** 只更新倒计时文本与按钮可用态（不重绘 DOM，避免按钮被替换导致点空） */
  private updateCountdowns(state: GameState): void {
    const now = Date.now();
    // 按钮可用态（买了新同事/钱够了时从禁用变可用，但不重建 DOM）
    this.body.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
      const id = btn.dataset.id ?? "";
      // 工位家具 / 精力：余额或精力变化时实时更新可用态（不重建 DOM）
      if (btn.dataset.act === "decor") {
        const d = DECOR.find((x) => x.id === id);
        if (!d) return;
        const owned = state.decor.includes(id);
        const can = !owned && state.moyu >= d.cost;
        if (btn.disabled === can) btn.disabled = !can;
        const row = btn.closest<HTMLElement>(".row-tap");
        if (row) row.dataset.disabled = String(owned || !can);
        return;
      }
      if (btn.dataset.act === "energy") {
        const a = ENERGY_ACTIONS.find((x) => x.id === id);
        if (!a) return;
        const used = state.energy.used.includes(id as never);
        const can = !used && state.energy.left >= a.cost;
        if (btn.disabled === can) btn.disabled = !can;
        return;
      }
      if (btn.dataset.act === "energy-all") {
        const canAll = state.energy.left >= ENERGY_ACTIONS.reduce((s, a) => s + a.cost, 0);
        btn.disabled = !canAll;
        return;
      }
      const def = COLLEAGUES.find((x) => x.id === id);
      if (!def) return;
      if (btn.dataset.act === "recruit") {
        const ok = canRecruit(state, id);
        btn.disabled = !ok;
        const next = ok ? `招募 ${formatMoyu(def.cost)}` : `攒够再招 ${formatMoyu(def.cost)}`;
        if (btn.textContent?.trim() !== next) btn.textContent = next;
      } else if (btn.dataset.act === "upgrade") {
        const cur = state.team.colleagues[id];
        if (!cur) return;
        btn.disabled = cur.level >= MAX_COLLEAGUE_LEVEL || state.moyu < upgradeCostOf(def, cur.level);
      }
    });
    for (const def of COLLEAGUES) {
      const cur = state.team.colleagues[def.id];
      if (!cur || cur.missionId === null) continue;
      const el = this.body.querySelector<HTMLElement>(`[data-countdown="${def.id}"]`);
      if (!el) continue;
      const remain = Math.max(0, Math.ceil((cur.endsAt - now) / 1000));
      el.textContent = remain > 0 ? `⏳ ${missionName(cur.missionId)} 进行中 · ${fmtRemain(remain)}` : "✅ 任务完成，可领取";
    }
  }

  private renderColleagues(state: GameState, nowMs: number): void {
    const station = stationIdleScaled(state);
    const claimable = claimableTotal(state, nowMs, station);
    const size = teamSize(state);
    const mult = prestigeMultiplier(state.prestige);
    const parts: string[] = [];

    // 顶部汇总 + 一键领取
    parts.push(`<div class="team-summary">
      <span>已招募 ${size}/5 · 小队挂机 +${formatMoyu(Math.round(teamFixedRate(state) + station * teamShareRatio(state)))}/秒</span>
      ${claimable > 0 ? `<button data-act="claim-all">一键领取 +${formatMoyu(claimable)}</button>` : ""}
      <span style="width:100%;font-size:10px;color:#8f9fd0">自动重复：完成后自动领取并续班（离线回来最多补 1 轮）</span>
    </div>`);

    // 新号引导
    const cheapest = Math.min(...COLLEAGUES.map((x) => x.cost));
    if (size === 0 && state.moyu < cheapest) {
      parts.push(`<div class="team-hint">
        还没有同事。戳屏幕攒够 <b>${formatMoyu(cheapest)}</b> 就能招募第一位「老周」，
        他会帮你自动赚，还能派出去做任务。
        <br>当前余额：<b>${formatMoyu(state.moyu)}</b>
      </div>`);
    }

    // 排序：可领 → 空闲 → 派遣中；未招募的排最后
    const order = [...COLLEAGUES].sort((a, b) => {
      const ca = state.team.colleagues[a.id];
      const cb = state.team.colleagues[b.id];
      const rank = (x: typeof ca): number => {
        if (!x) return 3;
        if (x.missionId === null) return 1;
        return missionDone(state, x === ca ? a.id : b.id, Date.now()) ? 0 : 2;
      };
      return rank(ca) - rank(cb);
    });
    // 首日折叠：一个同事都没有时，只展示第一位（避免一上来 5 张高价卡造成信息过载）
    const firstOnly = teamSize(state) === 0;
    let lockedShown = 0;
    for (const def of order) {
      const cur = state.team.colleagues[def.id];
      if (!cur) {
        lockedShown += 1;
        if (firstOnly && lockedShown > 1) continue;
        const affordable = canRecruit(state, def.id);
        parts.push(`<div class="mate locked">
          <div class="mate-top">
            <span class="mate-name">${def.name}</span>
            <span class="mate-role">${def.role}</span>
          </div>
          <div class="mate-skill">擅长：${SKILL_LABEL[def.skill]}（匹配的派遣 +50%）</div>
          <div class="mate-skill" style="color:#8be28b">被动：${traitLabel(def.trait)}（${traitValueText(def)}）</div>
          <div class="mate-actions">
            <button data-act="recruit" data-id="${def.id}" ${affordable ? "" : "disabled"}>
              ${affordable ? "招募" : "攒够再招"} ${formatMoyu(def.cost)}
            </button>
          </div>
        </div>`);
        continue;
      }

      const upCost = upgradeCostOf(def, cur.level);
      const done = missionDone(state, def.id, nowMs);
      const busy = cur.missionId !== null && !done;
      const remain = busy ? Math.max(0, Math.ceil((cur.endsAt - nowMs) / 1000)) : 0;
      const favor = Math.min(100, cur.favor ?? 0);
      const nextMilestone = favor < 20 ? 20 : favor < 40 ? 40 : favor < 60 ? 60 : favor < 80 ? 80 : favor < 100 ? 100 : 0;
      const favorHint =
        nextMilestone > 0
          ? `好感 ${favor}/100 · 再领 ${Math.ceil((nextMilestone - favor) / 2)} 次到 ${nextMilestone}（${MILESTONE_EFFECT[nextMilestone] ?? ""}）`
          : "好感 100/100 · 派遣奖励 ×1.5";

      let actionHtml = "";
      if (done) {
        const reward = cur.rewardSnapshot > 0 ? cur.rewardSnapshot : dispatchReward(state, def.id, station);
        actionHtml = `<div class="mate-progress">✅ ${missionName(cur.missionId!)} 完成</div>
          <div class="mate-actions"><button data-act="claim" data-id="${def.id}">领取 +${formatMoyu(reward)}</button></div>`;
      } else if (busy) {
        actionHtml = `<div class="mate-progress" data-countdown="${def.id}">⏳ ${missionName(cur.missionId!)} 进行中 · ${fmtRemain(remain)}</div>`;
      } else {
        const btns = MISSIONS.map((m) => {
          const match = def.skill === m.type;
          const secs = missionSecondsFor(def.id, m.id);
          const probe: GameState = {
            ...state,
            team: { colleagues: { ...state.team.colleagues, [def.id]: { ...cur, missionId: m.id } } },
          };
          const est = dispatchReward(probe, def.id, station);
          const perHour = secs > 0 ? est / (secs / 3600) : 0;
          // 净收益 = 毛收益/小时 − 该同事本人的离岗损失/小时（(-15%) × 他的挂机贡献）
          const colIdlePerSec =
            (def.idlePerLevel * cur.level * mult + station * def.sharePerLevel * cur.level) * 0.15;
          const lostPerHour = colIdlePerSec * 3600;
          const netPerHour = perHour - lostPerHour;
          const durText = secs >= 3600 ? `${Math.round(secs / 3600)}h` : `${Math.round(secs / 60)}m`;
          return `<button data-act="dispatch" data-id="${def.id}" data-mission="${m.id}">
            ${m.name}${match ? " ★" : ""}<br><small>${durText} · +${formatMoyu(est)} · 净 ${netPerHour >= 0 ? "+" : ""}${formatMoyu(netPerHour)}/h</small>
          </button>`;
        }).join("");
        actionHtml = `<div class="mate-missions">${btns}</div>`;
      }

      const idlePart = Math.round(def.idlePerLevel * cur.level * mult);
      parts.push(`<div class="mate">
        <div class="mate-top">
          <span class="mate-name">${def.name} <span class="mate-lv">Lv.${cur.level}</span></span>
          <span class="mate-role">${def.role}</span>
        </div>
        <div class="mate-skill">
          挂机 +${formatMoyu(idlePart)}/秒 + 工位 ${(def.sharePerLevel * cur.level * 100).toFixed(1)}%
          ${busy ? "（派遣中 -15%）" : ""} · 擅长 ${SKILL_LABEL[def.skill]}
        </div>
        <div class="mate-skill" style="color:#8be28b">被动：${traitLabel(def.trait)}（${traitValueText(def)}）</div>
        <div class="mate-favor" title="${favorHint}">
          <div class="favor-track"><div class="favor-bar" style="width:${favor}%"></div></div>
          <div style="font-size:10px;color:#a8a493;margin-top:3px">${favorHint}</div>
        </div>
        <div class="mate-actions">
          <button data-act="upgrade" data-id="${def.id}" ${cur.level >= MAX_COLLEAGUE_LEVEL || state.moyu < upCost ? "disabled" : ""}>
            ${cur.level >= MAX_COLLEAGUE_LEVEL ? "已满级 Lv.5" : `升级 Lv.${cur.level + 1} · ${formatMoyu(upCost)}`}
          </button>
          <button class="ghost" data-act="auto" data-id="${def.id}" data-on="${cur.autoRepeat ? "1" : "0"}">
            ${cur.autoRepeat ? "自动重复：开" : "自动重复：关"}
          </button>
        </div>
        ${actionHtml}
      </div>`);
    }
    if (firstOnly) {
      parts.push(`<div class="team-hint" style="font-size:12px">还有 ${COLLEAGUES.length - 1} 位同事，攒够钱陆续解锁。</div>`);
    }
    this.body.innerHTML = parts.join("");
    this.bindActions();
  }

  private renderTalents(state: GameState): void {
    if (state.talents.points === 0 && state.talents.unlocked.length === 0 && (state.talents.overflow ?? 0) === 0) {
      this.body.innerHTML = `<div class="team-hint">
        还没有天赋点。<br>
        获取方式：<b>每次转生 +1</b>；生涯段位第 3/5/7/9/11/13 档各 +1（共 6 点）。<br>
        <span style="color:#a8a493">转到「摸鱼学徒（1 万）」后不久就有第一个点。</span>
      </div>`;
      return;
    }
    const eff = talentEffects(state.talents);
    const branches: { key: TalentBranch; name: string; hint: string }[] = [
      { key: "click", name: "点击流 · 手速摸鱼", hint: `点击力 ×${eff.clickMult.toFixed(2)}` },
      { key: "idle", name: "挂机流 · 稳如老狗", hint: `挂机 ×${eff.idleMult.toFixed(2)}` },
      { key: "event", name: "事件流 · 摸鱼情报", hint: `巡逻奖 ×${eff.patrolRewardMult.toFixed(2)}` },
    ];
    const parts: string[] = [];
    const collapsed = state.talents.points < 3 && state.talents.unlocked.length === 0;
    for (const [bi, b] of branches.entries()) {
      if (collapsed && bi > 0) {
        parts.push(`<div class="team-hint" style="font-size:12px">${b.name}：攒到 3 点后展开</div>`);
        continue;
      }
      const tier = branchTier(state.talents, b.key);
      const taken = state.talents.unlocked.find((id) => TALENTS.find((t) => t.id === id)?.exclusive?.startsWith(b.key));
      const rows = TALENTS.filter((t) => t.branch === b.key)
        .map((t) => {
          const on = state.talents.unlocked.includes(t.id);
          const can = canUnlock(state.talents, t.id);
          const need = costOfTalent(t.id);
          const lockedByExclusive = t.exclusive && exclusiveTaken(state.talents, t.exclusive) && !on;
          return `<div class="talent ${on ? "on" : ""}">
            <span class="talent-dot">${on ? "✓" : t.tier}</span>
            <span class="talent-info">
              <span class="talent-name">${t.name}${t.tier >= 5 ? `（终极·${need}点）` : need > 1 ? `（${need}点）` : ""}</span>
              <span class="talent-desc">${t.desc}${lockedByExclusive ? " · 与另一个终极互斥" : ""}</span>
            </span>
            ${on ? "" : `<button data-act="talent" data-id="${t.id}" ${can ? "" : "disabled"}>${`点亮 ${need}`}</button>`}
          </div>`;
        })
        .join("");
      parts.push(`<div class="branch">
        <h3>${b.name} <small style="color:#8f9fd0">（${tier}/5 · ${b.hint}${taken ? " · 已选终极" : ""}）</small></h3>
        ${rows}
      </div>`);
    }
    parts.push(`<div class="mate-actions">
      <button class="ghost" data-act="reset-talents">重置天赋（返还全部点数）</button>
    </div>`);
    parts.push(`<div class="talent-progress">
      <div>点击转化：${Math.min(10500, state.totalClicks)}/10500 次（当前 +${(Math.min(0.35, Math.floor(state.totalClicks / 300) * 0.01) * 100).toFixed(0)}%）</div>
      <div>安然转化：${Math.min(30, state.patrolSurvives)}/30 次（当前 +${(Math.min(0.3, state.patrolSurvives * 0.01) * 100).toFixed(0)}%）</div>
      <div>溢出转化：${state.talents.overflow ?? 0}/30 点（当前 +${(((state.talents.overflow ?? 0) * 0.005) * 100).toFixed(1)}% 挂机，封顶 +15%）</div>
      <div style="color:#a8a493">天赋点：每次转生 +1；段位 3/5/7/9/11/13 档各 +1；每日首开 +1（上限 24，满树需 27 点 → 终局必须放弃一条流派）</div>
    </div>`);
    this.body.innerHTML = parts.join("");
    this.bindActions();
  }

  /** 工位页：装修 + 每日精力 */
  private renderDecor(state: GameState): void {
    const eff = decorEffects(state);
    const parts: string[] = [];
    parts.push(`<div class="team-summary">
      <span>已装修 ${decorCount(state)}/8 · 挂机 ×${eff.idleMult.toFixed(2)} · 点击 ×${eff.clickMult.toFixed(2)} · 离线 +${(eff.offlineBonus * 100).toFixed(0)}%</span>
    </div>`);

    // 每日精力
    const energy = state.energy;
    parts.push(`<div class="branch">
      <h3>今日精力 <small style="color:#8f9fd0">（剩 ${energy.left}/${ENERGY_PER_DAY}）</small></h3>
      ${ENERGY_ACTIONS.map((a) => {
        const used = energy.used.includes(a.id);
        const can = !used && energy.left >= a.cost;
        return `<div class="talent row-tap ${used ? "on" : ""}" data-act="energy" data-id="${a.id}" data-disabled="${can ? "0" : "1"}">
          <span class="talent-dot" aria-hidden="true">${used ? "✓" : a.cost}</span>
          <span class="talent-info">
            <span class="talent-name">${a.name}</span>
            <span class="talent-desc">${a.desc} · 花 ${a.cost} 精力</span>
            ${used ? '<span class="sr-only">已使用</span>' : ""}
          </span>
          ${used ? "" : `<button data-act="energy" data-id="${a.id}" aria-label="使用：${a.name}（消耗 ${a.cost} 精力，${a.desc}）" ${can ? "" : "disabled"}>使用</button>`}
        </div>`;
      }).join("")}
      <div class="mate-actions" style="margin-top:8px">
        <button class="ghost" data-act="energy-all" ${energy.left >= ENERGY_ACTIONS.reduce((s, a) => s + a.cost, 0) && energy.used.length === 0 ? "" : "disabled"}>省心组合：摸鱼+假装工作+社交（100 精力）</button>
      </div>
      <div style="font-size:11px;color:#a8a493;margin-top:6px">每天 100 点；4 项合计 145，必须放弃至少 1 项（含「专注点击」45 点时只剩 55）</div>
    </div>`);

    // 家具（标题 + 列表语义，便于读屏跳转）
    parts.push(`<h3 style="margin-top:10px">工位家具 <small style="color:#8f9fd0">（已装修 ${decorCount(state)}/8）</small></h3>`);
    for (const d of DECOR) {
      const owned = state.decor.includes(d.id);
      const can = canBuyDecor(state, d.id);
      parts.push(`<div class="talent row-tap ${owned ? "on" : ""}" data-act="decor" data-id="${d.id}" data-disabled="${owned || !can ? "1" : "0"}">
        <span class="talent-dot" aria-hidden="true">${owned ? "✓" : ""}</span>
        <span class="talent-info">
          <span class="talent-name">${d.name}</span>
          <span class="talent-desc">${d.desc}</span>
          ${owned ? '<span class="sr-only">已装修</span>' : ""}
        </span>
        ${owned ? "" : `<button data-act="decor" data-id="${d.id}" aria-label="购买：${d.name}，${formatMoyu(d.cost)}，效果${d.desc}" ${can ? "" : "disabled"}>${formatMoyu(d.cost)}</button>`}
      </div>`);
    }
    this.body.innerHTML = parts.join("");
    this.bindActions();
  }

  private bindActions(): void {
    // 整行可点（小按钮太小，碎片党点不准）
    this.body.querySelectorAll<HTMLElement>(".row-tap[data-act]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (row.dataset.disabled === "1") return;
        if ((e.target as HTMLElement).closest("button")) return; // 按钮自己处理
        const act = row.dataset.act;
        const id = row.dataset.id ?? "";
        if (act === "energy") this.cb.onUseEnergy(id);
        else if (act === "decor") this.cb.onBuyDecor(id);
      });
    });
    this.body.querySelectorAll<HTMLButtonElement>("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        const id = btn.dataset.id ?? "";
        if (act === "recruit") this.cb.onRecruit(id);
        else if (act === "upgrade") this.cb.onUpgrade(id);
        else if (act === "dispatch") this.cb.onDispatch(id, btn.dataset.mission ?? "");
        else if (act === "claim") this.cb.onClaim(id);
        else if (act === "claim-all") this.cb.onClaimAll();
        else if (act === "auto") this.cb.onToggleAuto(id, btn.dataset.on !== "1");
        else if (act === "talent") this.cb.onUnlockTalent(id);
        else if (act === "reset-talents") this.cb.onResetTalents();
        else if (act === "decor") this.cb.onBuyDecor(id);
        else if (act === "energy") this.cb.onUseEnergy(id as never);
        else if (act === "energy-all") this.cb.onUseAllEnergy();
      });
    });
  }
}

function missionName(id: string): string {
  return MISSIONS.find((m) => m.id === id)?.name ?? id;
}

function fmtRemain(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** 供外部兜底（未使用但保留接口一致性） */
export function colleagueSkillLabel(id: string): string {
  const skill = colleagueDef(id)?.skill;
  return skill ? SKILL_LABEL[skill] ?? skill : "";
}
