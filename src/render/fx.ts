/** 飘字与点击粒子（场景内特效池，容量有界） */

interface FloatText {
  x: number;
  y: number;
  vy: number;
  alpha: number;
  text: string;
  born: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
}

const MAX_TEXTS = 14;
const MAX_PARTICLES = 64;
const TEXT_LIFE = 0.65;

export class Fx {
  private texts: FloatText[] = [];
  private particles: Particle[] = [];

  floatText(x: number, y: number, text: string): void {
    // 轻微错位，避免高 cps 时相邻飘字完全重叠
    const jitterX = (Math.random() - 0.5) * 26;
    const jitterY = (Math.random() - 0.5) * 18;
    this.texts.push({ x: x + jitterX, y: y + jitterY, vy: -34, alpha: 1, text, born: performance.now() });
    if (this.texts.length > MAX_TEXTS) this.texts.shift();
    for (let i = 0; i < 5; i++) {
      this.particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 60,
        vy: -Math.random() * 70 - 20,
        alpha: 1,
        color: ["#ffd76e", "#8be28b", "#7ec8ff", "#ff9e9e"][Math.floor(Math.random() * 4)]!,
      });
    }
    if (this.particles.length > MAX_PARTICLES) this.particles.splice(0, this.particles.length - MAX_PARTICLES);
  }

  /** 由场景循环每帧调用；dt 秒 */
  update(dt: number): void {
    const now = performance.now();
    this.texts = this.texts.filter((t) => (now - t.born) / 1000 < TEXT_LIFE);
    for (const t of this.texts) {
      t.y += t.vy * dt;
      t.alpha = 1 - (now - t.born) / 1000 / TEXT_LIFE;
    }
    this.particles = this.particles.filter((p) => p.alpha > 0.05);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 160 * dt; // 重力
      p.alpha -= dt * 1.6;
    }
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.textAlign = "center";
    for (const t of this.texts) {
      ctx.globalAlpha = Math.max(0, t.alpha);
      ctx.font = `bold ${10 * scale}px system-ui`;
      ctx.fillStyle = "#fff8e1";
      ctx.fillText(t.text, t.x, t.y);
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2 * scale, p.y - 2 * scale, 4 * scale, 4 * scale);
    }
    ctx.globalAlpha = 1;
  }
}
