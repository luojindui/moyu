import type { GameState } from "../engine/state";
import { formatMoyu } from "../engine/format";
import { stationIdleScaled } from "../engine/upgrades";
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
  exclusiveTaken,
  talentEffects,
  type TalentBranch,
} from "../engine/talents";

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
}

/** 摸鱼小队面板（同事 / 天赋 两页） */
export class TeamPanel {
  private root = document.getElementById("team")!;
  private body = document.getElementById("team-body")!;
  private elPoints = document.getElementById("team-points")!;
  private tabColleagues = document.getElementById("tab-colleagues") as HTMLButtonElement;
  private tabTalents = document.getElementById("tab-talents") as HTMLButtonElement;
  private tab: "colleagues" | "talents" = "colleagues";
  private lastState: GameState | null = null;
  private lastAt = 0;
  /** 上次渲染的结构签名（只有结构变化才整块重绘，避免点空） */
  private lastSig = "";
  private timer: number | null = null;

  constructor(private cb: TeamCallbacks) {
    document.getElementById("btn-team")!.addEventListener("click", () => this.toggle());
    document.getElementById("team-close")!.addEventListener("click", () => this.hide());
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.hide();
    });
    this.tabColleagues.addEventListener("click", () => this.setTab("colleagues"));
    this.tabTalents.addEventListener("click", () => this.setTab("talents"));
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
    if (this.lastState) this.render(this.lastState, true);
    this.timer ??= window.setInterval(() => {
      if (this.lastState && this.isOpen) this.refresh(this.lastState);
    }, 500);
  }

  hide(): void {
    this.root.classList.add("hidden");
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setTab(tab: "colleagues" | "talents"): void {
    this.tab = tab;
    this.tabColleagues.classList.toggle("active", tab === "colleagues");
    this.tabTalents.classList.toggle("active", tab === "talents");
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

  /** 动作后立即刷新（绕过节流） */
  refreshNow(state: GameState): void {
    this.lastState = state;
    this.lastAt = 0;
    this.lastSig = "";
    if (this.isOpen) this.render(state, true);
    else this.refresh(state);
  }

  /** 主循环调用：更新角标 + 面板内容（结构变化才重绘） */
  refresh(state: GameState): void {
    this.lastState = state;
    const btn = document.getElementById("btn-team");
    if (btn) {
      const n = claimableCount(state, Date.now());
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
      btn.setAttribute("aria-label", n > 0 ? `摸鱼小队，${n} 个任务可领取` : "摸鱼小队");
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
      Math.floor(state.moyu),
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
    else this.renderTalents(state);
  }

  /** 只更新倒计时文本（不重绘 DOM，避免按钮被替换导致点空） */
  private updateCountdowns(state: GameState): void {
    const now = Date.now();
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

    for (const def of COLLEAGUES) {
      const cur = state.team.colleagues[def.id];
      if (!cur) {
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
          ? `好感 ${favor}/100 · 再领 ${Math.ceil((nextMilestone - favor) / 2)} 次到 ${nextMilestone}`
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
          const durText = secs >= 3600 ? `${Math.round(secs / 3600)}h` : `${Math.round(secs / 60)}m`;
          return `<button data-act="dispatch" data-id="${def.id}" data-mission="${m.id}">
            ${m.name}${match ? " ★" : ""}<br><small>${durText} · +${formatMoyu(est)} · ${formatMoyu(perHour)}/h</small>
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
          ${busy ? "（派遣中只算一半）" : ""} · 擅长 ${SKILL_LABEL[def.skill]}
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
    this.body.innerHTML = parts.join("");
    this.bindActions();
  }

  private renderTalents(state: GameState): void {
    if (state.talents.points === 0 && state.talents.unlocked.length === 0) {
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
    for (const b of branches) {
      const tier = branchTier(state.talents, b.key);
      const taken = state.talents.unlocked.find((id) => TALENTS.find((t) => t.id === id)?.exclusive?.startsWith(b.key));
      const rows = TALENTS.filter((t) => t.branch === b.key)
        .map((t) => {
          const on = state.talents.unlocked.includes(t.id);
          const can = canUnlock(state.talents, t.id);
          const need = t.tier >= 5 ? 2 : 1;
          const lockedByExclusive = t.exclusive && exclusiveTaken(state.talents, t.exclusive) && !on;
          return `<div class="talent ${on ? "on" : ""}">
            <span class="talent-dot">${on ? "✓" : t.tier}</span>
            <span class="talent-info">
              <span class="talent-name">${t.name}${t.tier >= 5 ? "（终极·2点）" : ""}</span>
              <span class="talent-desc">${t.desc}${lockedByExclusive ? " · 与另一个终极互斥" : ""}</span>
            </span>
            ${on ? "" : `<button data-act="talent" data-id="${t.id}" ${can ? "" : "disabled"}>${need === 2 ? "点亮 2" : "点亮"}</button>`}
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
      <div style="color:#a8a493">天赋点：每次转生 +1；段位 3/5/7/9/11/13 档各 +1（上限 18）</div>
    </div>`);
    this.body.innerHTML = parts.join("");
    this.bindActions();
  }

  private bindActions(): void {
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
