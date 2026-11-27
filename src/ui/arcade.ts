import type { GameState } from "../engine/state";
import {
  ARCADE_DAILY_LIMIT,
  GAMES,
  arcadeLeft,
  coffeeScore,
  findScore,
  genBeats,
  genDrops,
  judgeBeat,
  judgeCatch,
  type GameId,
} from "../engine/minigames";

/** 摸鱼站：3 个 30 秒小游戏的 DOM 实现 */
export class Arcade {
  private root = document.getElementById("arcade")!;
  private body = document.getElementById("arcade-body")!;
  private elTitle = document.getElementById("arcade-title")!;
  private elLeft = document.getElementById("arcade-left")!;
  private play: { raf: number; cleanup: () => void; score?: () => number } | null = null;
  private lastState: GameState | null = null;
  private currentGame: GameId | null = null;

  constructor(private onFinish: (game: GameId, score: number) => void) {
    document.getElementById("btn-arcade")!.addEventListener("click", () => this.toggle());
    document.getElementById("arcade-close")!.addEventListener("click", () => this.close());
    this.root.addEventListener("click", (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(): void {
    this.root.classList.remove("hidden");
    this.renderMenu();
  }

  close(): void {
    // 中途退出：按当前分数结算并消耗次数（防"Esc 重开无限刷"）
    if (this.play) {
      const partial = this.play.score ? this.play.score() : 0;
      const game = this.currentGame;
      this.stopPlay();
      if (game) this.onFinish(game, Math.max(0, Math.floor(partial)));
      this.currentGame = null;
    }
    this.root.classList.add("hidden");
  }

  refresh(state: GameState): void {
    this.lastState = state;
    if (this.isOpen) this.elLeft.textContent = `今天还能玩 ${arcadeLeft(state)}/${ARCADE_DAILY_LIMIT} 次`;
  }

  private stopPlay(): void {
    if (this.play) {
      cancelAnimationFrame(this.play.raf);
      this.play.cleanup();
      this.play = null;
    }
  }

  private renderMenu(): void {
    this.stopPlay();
    this.elTitle.textContent = "摸鱼站";
    const state = this.lastState;
    const left = state ? arcadeLeft(state) : ARCADE_DAILY_LIMIT;
    this.elLeft.textContent = `今天还能玩 ${left}/${ARCADE_DAILY_LIMIT} 次`;
    this.body.innerHTML = GAMES.map((g) => {
      const best = state?.arcade.best[g.id] ?? 0;
      const can = left > 0;
      return `<div class="arcade-card ${can ? "" : "locked"}">
        <div class="arcade-name">${g.name} <small>最高 ${best}</small></div>
        <div class="arcade-desc">${g.desc}</div>
        <button data-game="${g.id}" ${can ? "" : "disabled"}>开始（${g.duration} 秒）</button>
      </div>`;
    }).join("");
    this.body.querySelectorAll<HTMLButtonElement>("button[data-game]").forEach((b) => {
      b.addEventListener("click", () => this.startGame(b.dataset.game as GameId));
    });
  }

  private startGame(game: GameId): void {
    this.currentGame = game;
    const def = GAMES.find((g) => g.id === game)!;
    this.elTitle.textContent = def.name;
    const startAt = performance.now();
    const rng = Math.random;

    if (game === "coffee") {
      const drops = genDrops(def.duration, rng);
      let caught = 0;
      let missed = 0;
      let combo = 0;
      let maxCombo = 0;
      const resolved = new Set<number>();
      const els = new Map<number, HTMLElement>();
      this.body.innerHTML = `<div class="arcade-play" id="play-area">
        <div class="arcade-timer" id="play-timer"></div>
        <div class="arcade-score" id="play-score">0</div>
        <div class="arcade-hint">咖啡落到杯口时点它 ☕</div>
        <div class="arcade-drops" id="play-drops"></div>
        <div class="cup-line"></div>
      </div>`;
      const area = document.getElementById("play-area")!;
      const dropsEl = document.getElementById("play-drops")!;
      const scoreEl = document.getElementById("play-score")!;
      const timerEl = document.getElementById("play-timer")!;
      const DROP_SECONDS = 3; // 从顶部落到杯口的时长
      const onTap = (e: PointerEvent): void => {
        const rect = area.getBoundingClientRect();
        const tapAt = (performance.now() - startAt) / 1000;
        const tapX = (e.clientX - rect.left) / rect.width;
        const { hit } = judgeCatch(drops, tapAt, tapX);
        if (hit && !resolved.has(hit.id)) {
          resolved.add(hit.id);
          caught++;
          combo++;
          maxCombo = Math.max(maxCombo, combo);
          const el = els.get(hit.id);
          if (el) {
            el.classList.add("caught");
            setTimeout(() => el.remove(), 180);
          }
          scoreEl.textContent = String(coffeeScore(caught, missed, maxCombo));
        } else {
          combo = 0;
        }
      };
      area.addEventListener("pointerdown", onTap);
      const tick = (): void => {
        const elapsed = (performance.now() - startAt) / 1000;
        const leftS = Math.max(0, def.duration - elapsed);
        timerEl.textContent = `${leftS.toFixed(1)}s`;
        // 逐帧更新所有掉落位置（顶部 → 杯口 = 88%）
        for (const d of drops) {
          const dt = d.at - elapsed;
          if (dt > DROP_SECONDS) continue; // 还没出现
          let el = els.get(d.id);
          if (!el) {
            el = document.createElement("div");
            el.className = "drop";
            el.style.left = `${d.x * 100}%`;
            dropsEl.appendChild(el);
            els.set(d.id, el);
          }
          if (dt >= 0) {
            // 下落中：0%（顶）→ 88%（杯口）
            el.style.top = `${88 - (dt / DROP_SECONDS) * 88}%`;
            el.classList.remove("landed");
          } else {
            // 已过杯口：落地
            el.style.top = "88%";
            el.classList.add("landed");
            if (!resolved.has(d.id) && dt < -0.4) {
              resolved.add(d.id);
              missed++;
              combo = 0;
              setTimeout(() => el!.remove(), 200);
            }
          }
          if (resolved.has(d.id) && dt < -0.6) {
            el.remove();
            els.delete(d.id);
          }
        }
        scoreEl.textContent = String(coffeeScore(caught, missed, maxCombo));
        if (leftS > 0) this.play!.raf = requestAnimationFrame(tick);
        else {
          area.removeEventListener("pointerdown", onTap);
          for (const el of els.values()) el.remove();
          this.finish(def, coffeeScore(caught, missed, maxCombo), { caught, missed, maxCombo });
        }
      };
      this.play = {
        raf: requestAnimationFrame(tick),
        cleanup: () => {
          area.removeEventListener("pointerdown", onTap);
          for (const el of els.values()) el.remove();
        },
        score: () => coffeeScore(caught, missed, maxCombo),
      };
      return;
    }

    if (game === "findboss") {
      // 30 秒内尽可能多找：轮次不限，时间到才结束
      let correct = 0;
      let wrong = 0;
      let idx = 0;
      const genRound = (): number => Math.floor(rng() * 9);
      let bossAt = genRound();
      const renderRound = (): void => {
        this.body.innerHTML = `<div class="arcade-play">
          <div class="arcade-timer" id="play-timer">${def.duration.toFixed(1)}s</div>
          <div class="arcade-score" id="play-score">0</div>
          <div class="arcade-hint">找出王总（红色「王」）· 已找 ${correct}</div>
          <div class="arcade-grid" id="play-grid">
            ${Array.from({ length: 9 }, (_, i) => `<button class="face ${i === bossAt ? "boss" : ""}" data-i="${i}">${i === bossAt ? "王" : "员"}</button>`).join("")}
          </div>
        </div>`;
        const grid = document.getElementById("play-grid")!;
        const scoreEl = document.getElementById("play-score")!;
        grid.querySelectorAll<HTMLButtonElement>("button.face").forEach((b) => {
          b.addEventListener("click", () => {
            if (idx === undefined) return;
            const ok = Number(b.dataset.i) === bossAt;
            if (ok) correct++;
            else wrong++;
            idx++;
            scoreEl.textContent = String(findScore(correct, wrong, Math.max(0, def.duration - (performance.now() - startAt) / 1000)));
            bossAt = genRound();
            renderRound();
          });
        });
      };
      renderRound();
      const tick = (): void => {
        const elapsed = (performance.now() - startAt) / 1000;
        const leftS = Math.max(0, def.duration - elapsed);
        const timerEl = document.getElementById("play-timer");
        if (timerEl) timerEl.textContent = `${leftS.toFixed(1)}s`;
        if (leftS > 0) {
          this.play!.raf = requestAnimationFrame(tick);
        } else {
          this.finish(def, findScore(correct, wrong, 0), { caught: correct, missed: wrong });
        }
      };
      this.play = { raf: requestAnimationFrame(tick), cleanup: () => undefined, score: () => findScore(correct, wrong, 0) };
      return;
    }

    // rhythm
    const beats = genBeats(def.duration, 120, 0.6);
    const usedBeats = new Set<number>();
    let score = 0;
    let perfect = 0;
    this.body.innerHTML = `<div class="arcade-play" id="play-area">
      <div class="arcade-timer" id="play-timer">${def.duration}s</div>
      <div class="arcade-score" id="play-score">0</div>
      <div class="arcade-hint">跟着节拍点！</div>
      <div class="beat-row" id="beat-row"></div>
    </div>`;
    const area = document.getElementById("play-area")!;
    const row = document.getElementById("beat-row")!;
    const scoreEl = document.getElementById("play-score")!;
    const timerEl = document.getElementById("play-timer")!;
    row.innerHTML = beats.map((_, i) => `<span class="beat" data-b="${i}"></span>`).join("");
    const onTap = (): void => {
      const tapAt = (performance.now() - startAt) / 1000;
      const res = judgeBeat(beats, tapAt, usedBeats);
      if (res.kind !== "miss" && res.index >= 0) {
        usedBeats.add(res.index);
        score += res.score;
        if (res.kind === "perfect") perfect++;
        const el = row.querySelector<HTMLElement>(`[data-b="${res.index}"]`);
        if (el) el.className = `beat ${res.kind}`;
      } else {
        // 乱点惩罚：无节拍可对应时扣 5 分（防"狂点拿保底"）
        score = Math.max(0, score - 5);
      }
      scoreEl.textContent = String(score);
    };
    area.addEventListener("pointerdown", onTap);
    const tick = (): void => {
      const elapsed = (performance.now() - startAt) / 1000;
      const leftS = Math.max(0, def.duration - elapsed);
      timerEl.textContent = `${leftS.toFixed(1)}s`;
      // 高亮最近的节拍
      beats.forEach((b, i) => {
        const el = row.querySelector<HTMLElement>(`[data-b="${i}"]`);
        if (!el || usedBeats.has(i)) return;
        el.className = Math.abs(b - elapsed) < 0.1 ? "beat on" : "beat";
      });
      if (leftS > 0) this.play!.raf = requestAnimationFrame(tick);
      else {
        area.removeEventListener("pointerdown", onTap);
        this.finish(def, score, { caught: perfect, missed: 0 });
      }
    };
    this.play = {
      raf: requestAnimationFrame(tick),
      cleanup: () => area.removeEventListener("pointerdown", onTap),
      score: () => score,
    };
  }

  private finish(def: (typeof GAMES)[number], score: number, detail?: Record<string, number>): void {
    this.stopPlay();
    this.currentGame = null;
    this.onFinish(def.id, Math.max(0, Math.floor(score)));
    // 显示结算
    const state = this.lastState;
    const best = state?.arcade.best[def.id] ?? 0;
    const record = Math.floor(score) > best;
    const detailText = detail
      ? Object.entries(detail)
          .map(([k, v]) => `${k === "caught" ? "接住" : k === "missed" ? "漏接" : "最高连击"} ${v}`)
          .join(" · ")
      : "";
    this.body.innerHTML = `<div class="arcade-play">
      <div class="arcade-name">${def.name} 结束</div>
      <div class="arcade-score">${Math.floor(score)} 分</div>
      ${record ? `<div class="arcade-record">🎉 新纪录！（旧 ${best}）</div>` : `<div class="arcade-hint">历史最高 ${best}</div>`}
      ${detailText ? `<div class="arcade-hint">${detailText}</div>` : ""}
      <button class="ghost arcade-back-btn" id="arcade-back">返回摸鱼站</button>
    </div>`;
    document.getElementById("arcade-back")!.addEventListener("click", () => this.renderMenu());
  }
}
