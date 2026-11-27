import type { GameState } from "../engine/state";
import {
  ARCADE_DAILY_LIMIT,
  GAMES,
  arcadeLeft,
  coffeeScore,
  findScore,
  genBeats,
  genDrops,
  genFindRounds,
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
  private play: { raf: number; cleanup: () => void } | null = null;
  private lastState: GameState | null = null;

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
    this.stopPlay();
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
    const def = GAMES.find((g) => g.id === game)!;
    this.elTitle.textContent = def.name;
    const startAt = performance.now();
    const total = def.duration * 1000;
    const rng = Math.random;

    if (game === "coffee") {
      const drops = genDrops(def.duration, rng);
      let caught = 0;
      let missed = 0;
      let combo = 0;
      let maxCombo = 0;
      const used = new Set<number>();
      this.body.innerHTML = `<div class="arcade-play" id="play-area">
        <div class="arcade-timer" id="play-timer"></div>
        <div class="arcade-score" id="play-score">0</div>
        <div class="arcade-hint">点屏幕接住咖啡 ☕</div>
        <div class="arcade-drops" id="play-drops"></div>
      </div>`;
      const area = document.getElementById("play-area")!;
      const dropsEl = document.getElementById("play-drops")!;
      const scoreEl = document.getElementById("play-score")!;
      const timerEl = document.getElementById("play-timer")!;
      let lastIdx = -1;
      const onTap = (e: PointerEvent): void => {
        const rect = area.getBoundingClientRect();
        const tapAt = (performance.now() - startAt) / 1000;
        const tapX = (e.clientX - rect.left) / rect.width;
        const { hit } = judgeCatch(drops, tapAt, tapX);
        if (hit && !used.has(hit.id)) {
          used.add(hit.id);
          caught++;
          combo++;
          maxCombo = Math.max(maxCombo, combo);
        } else {
          combo = 0;
        }
        scoreEl.textContent = String(coffeeScore(caught, missed, maxCombo));
      };
      area.addEventListener("pointerdown", onTap);
      const tick = (): void => {
        const elapsed = (performance.now() - startAt) / 1000;
        const leftS = Math.max(0, def.duration - elapsed);
        timerEl.textContent = `${leftS.toFixed(1)}s`;
        // 掉落渲染（只显示 3 秒内的）
        const visible = drops.filter((d) => d.at > elapsed - 0.4 && d.at < elapsed + 3);
        for (const d of visible) {
          if (used.has(d.id) || d.id <= lastIdx) continue;
          const left = (d.at - elapsed) / 3;
          if (left < 0) {
            if (!used.has(d.id)) {
              used.add(d.id);
              missed++;
              combo = 0;
            }
            continue;
          }
          const el = document.createElement("div");
          el.className = "drop";
          el.style.left = `${d.x * 100}%`;
          el.style.top = `${Math.max(0, left * 100)}%`;
          dropsEl.appendChild(el);
          setTimeout(() => el.remove(), 400);
        }
        if (visible.length) lastIdx = Math.max(lastIdx, visible[visible.length - 1]!.id);
        scoreEl.textContent = String(coffeeScore(caught, missed, maxCombo));
        if (leftS > 0) this.play!.raf = requestAnimationFrame(tick);
        else {
          const score = coffeeScore(caught, missed, maxCombo);
          area.removeEventListener("pointerdown", onTap);
          this.finish(def, score);
        }
      };
      this.play = { raf: requestAnimationFrame(tick), cleanup: () => area.removeEventListener("pointerdown", onTap) };
      return;
    }

    if (game === "findboss") {
      const rounds = genFindRounds(5, 3, rng);
      let idx = 0;
      let correct = 0;
      let wrong = 0;
      const roundStart: number[] = [];
      const renderRound = (): void => {
        const r = rounds[idx]!;
        roundStart[idx] = performance.now();
        this.body.innerHTML = `<div class="arcade-play">
          <div class="arcade-timer" id="play-timer">第 ${idx + 1}/${rounds.length} 轮</div>
          <div class="arcade-grid" id="play-grid">
            ${Array.from({ length: 9 }, (_, i) => `<button class="face ${i === r.bossAt ? "boss" : ""}" data-i="${i}">${i === r.bossAt ? "王" : "员"}</button>`).join("")}
          </div>
        </div>`;
        const grid = document.getElementById("play-grid")!;
        grid.querySelectorAll<HTMLButtonElement>("button.face").forEach((b) => {
          b.addEventListener("click", () => {
            const ok = Number(b.dataset.i) === r.bossAt;
            if (ok) correct++;
            else wrong++;
            idx++;
            if (idx >= rounds.length) {
              const leftSec = Math.max(0, (total - (performance.now() - startAt)) / 1000);
              this.finish(def, findScore(correct, wrong, leftSec));
            } else renderRound();
          });
        });
      };
      // 30 秒总限时
      const deadline = setTimeout(() => {
        const leftSec = 0;
        this.finish(def, findScore(correct, wrong, leftSec));
      }, total);
      this.play = { raf: 0, cleanup: () => clearTimeout(deadline) };
      renderRound();
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
      }
      scoreEl.textContent = String(score + perfect * 5);
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
        this.finish(def, score + perfect * 5);
      }
    };
    this.play = { raf: requestAnimationFrame(tick), cleanup: () => area.removeEventListener("pointerdown", onTap) };
  }

  private finish(def: (typeof GAMES)[number], score: number): void {
    this.stopPlay();
    this.onFinish(def.id, Math.max(0, Math.floor(score)));
    // 显示结算
    const state = this.lastState;
    const best = state?.arcade.best[def.id] ?? 0;
    this.body.innerHTML = `<div class="arcade-play">
      <div class="arcade-name">${def.name} 结束</div>
      <div class="arcade-score">${Math.floor(score)} 分</div>
      <div class="arcade-hint">历史最高 ${best}</div>
      <button class="ghost" id="arcade-back">返回摸鱼站</button>
    </div>`;
    document.getElementById("arcade-back")!.addEventListener("click", () => this.renderMenu());
  }
}
