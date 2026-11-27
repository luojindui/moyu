import type { GameState } from "../engine/state";
import { formatMoyu } from "../engine/format";
import { effectOf } from "../engine/upgrades";
import {
  COLLEAGUES,
  MISSIONS,
  MAX_COLLEAGUE_LEVEL,
  canRecruit,
  claimableCount,
  colleagueDef,
  dispatchReward,
  missionDone,
  upgradeCostOf,
} from "../engine/team";
import { TALENTS, canUnlock, branchTier, emptyTalents, talentEffects, type TalentBranch } from "../engine/talents";

const SKILL_LABEL: Record<string, string> = {
  chat: "聊八卦",
  meeting: "开会",
  toilet: "蹲点",
  errand: "跑腿",
  coffee: "买咖啡",
};

export interface TeamCallbacks {
  onRecruit: (id: string) => void;
  onUpgrade: (id: string) => void;
  onDispatch: (id: string, missionId: string) => void;
  onClaim: (id: string) => void;
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
  /** 派单进行中的本地倒计时刷新间隔 */
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
    // 面板打开时每 500ms 刷新倒计时
    this.timer ??= window.setInterval(() => {
      if (this.lastState && this.isOpen) this.render(this.lastState);
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

  /** 外部每 150ms 调用（面板关闭时几乎零开销） */
  refresh(state: GameState): void {
    this.lastState = state;
    // 角标：可领任务数
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

  private render(state: GameState, force = false): void {
    this.lastState = state;
    const now = Date.now();
    if (force && this.isOpen) this.lastAt = 0;
    this.elPoints.textContent = `天赋点 ${state.talents.points}`;
    if (this.tab === "colleagues") this.renderColleagues(state, now);
    else this.renderTalents(state);
  }

  private renderColleagues(state: GameState, nowMs: number): void {
    const idle = effectOf(state).idleRate;
    const parts: string[] = [];
    for (const def of COLLEAGUES) {
      const cur = state.team.colleagues[def.id];
      if (!cur) {
        const affordable = canRecruit(state, def.id);
        parts.push(`<div class="mate locked">
          <div class="mate-top">
            <span class="mate-name">${def.name}</span>
            <span class="mate-role">${def.role}</span>
          </div>
          <div class="mate-skill">擅长：${SKILL_LABEL[def.skill]}（匹配派遣 +50%）</div>
          <div class="mate-actions">
            <button data-act="recruit" data-id="${def.id}" ${affordable ? "" : "disabled"}>
              招募 ${formatMoyu(def.cost)}
            </button>
          </div>
        </div>`);
        continue;
      }
      const upCost = upgradeCostOf(def, cur.level);
      const favor = Math.min(100, cur.favor ?? 0);
      const done = missionDone(state, def.id, nowMs);
      const busy = cur.missionId !== null && !done;
      const remain = busy ? Math.max(0, Math.ceil((cur.endsAt - nowMs) / 1000)) : 0;
      const mm = String(Math.floor(remain / 60)).padStart(2, "0");
      const ss = String(remain % 60).padStart(2, "0");
      const missionName = cur.missionId ? (MISSIONS.find((m) => m.id === cur.missionId)?.name ?? "") : "";

      let actionHtml = "";
      if (done) {
        const reward = dispatchReward(state, def.id, idle);
        actionHtml = `<div class="mate-progress">✅ ${missionName} 完成</div>
          <div class="mate-actions"><button data-act="claim" data-id="${def.id}">领取 +${formatMoyu(reward)}</button></div>`;
      } else if (busy) {
        actionHtml = `<div class="mate-progress">⏳ ${missionName} 进行中 · ${mm}:${ss}</div>`;
      } else {
        const btns = MISSIONS.map((m) => {
          const match = colleagueDef(def.id)?.skill === m.type;
          const mins = m.seconds >= 3600 ? `${Math.round(m.seconds / 3600)}h` : `${Math.round(m.seconds / 60)}m`;
          return `<button data-act="dispatch" data-id="${def.id}" data-mission="${m.id}">
            ${m.name}<br><small>${mins}${match ? " ★" : ""}</small>
          </button>`;
        }).join("");
        actionHtml = `<div class="mate-missions">${btns}</div>`;
      }

      const nextMilestone = favor < 20 ? 20 : favor < 40 ? 40 : favor < 60 ? 60 : favor < 80 ? 80 : favor < 100 ? 100 : 0;
      const milestoneHint =
        nextMilestone > 0
          ? `好感 ${favor}/100 · 再领 ${nextMilestone - favor} 次解锁里程碑`
          : `好感 100/100 · 满级情报`;
      parts.push(`<div class="mate">
        <div class="mate-top">
          <span class="mate-name">${def.name} <span class="mate-lv">Lv.${cur.level}</span></span>
          <span class="mate-role">${def.role}</span>
        </div>
        <div class="mate-skill">挂机 +${formatMoyu(def.idlePerLevel * cur.level)}/秒 · 擅长 ${SKILL_LABEL[def.skill]}</div>
        <div class="mate-favor" title="${milestoneHint}">
          <div class="favor-track"><div class="favor-bar" style="width:${favor}%"></div></div>
          <div style="font-size:10px;color:#a8a493;margin-top:3px">${milestoneHint}</div>
        </div>
        <div class="mate-actions">
          <button data-act="upgrade" data-id="${def.id}" ${cur.level >= MAX_COLLEAGUE_LEVEL || state.moyu < upCost ? "disabled" : ""}>
            升级 Lv.${cur.level + 1} · ${formatMoyu(upCost)}
          </button>
        </div>
        ${actionHtml}
      </div>`);
    }
    this.body.innerHTML = parts.join("");
    this.bindActions();
  }

  private renderTalents(state: GameState): void {
    const eff = talentEffects(state.talents);
    const branches: { key: TalentBranch; name: string; hint: string }[] = [
      { key: "click", name: "点击流 · 手速摸鱼", hint: `点击力 ×${eff.clickMult.toFixed(2)}` },
      { key: "idle", name: "挂机流 · 稳如老狗", hint: `挂机 ×${eff.idleMult.toFixed(2)}` },
      { key: "event", name: "事件流 · 摸鱼情报", hint: `巡逻奖 ×${eff.patrolRewardMult.toFixed(2)}` },
    ];
    const parts: string[] = [];
    for (const b of branches) {
      const tier = branchTier(state.talents, b.key);
      const rows = TALENTS.filter((t) => t.branch === b.key)
        .map((t) => {
          const on = state.talents.unlocked.includes(t.id);
          const can = canUnlock(state.talents, t.id);
          return `<div class="talent ${on ? "on" : ""}">
            <span class="talent-dot">${on ? "✓" : t.tier}</span>
            <span class="talent-info">
              <span class="talent-name">${t.name}</span>
              <span class="talent-desc">${t.desc}</span>
            </span>
            ${on ? "" : `<button data-act="talent" data-id="${t.id}" ${can ? "" : "disabled"}>点亮</button>`}
          </div>`;
        })
        .join("");
      parts.push(`<div class="branch">
        <h3>${b.name} <small style="color:#8f9fd0">（${tier}/5 · ${b.hint}）</small></h3>
        ${rows}
      </div>`);
    }
    parts.push(`<div class="mate-actions">
      <button class="ghost" data-act="reset-talents">重置天赋（返还全部点数）</button>
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
        else if (act === "talent") this.cb.onUnlockTalent(id);
        else if (act === "reset-talents") this.cb.onResetTalents();
      });
    });
  }
}

/** 空天赋（供外部兜底） */
export { emptyTalents };
