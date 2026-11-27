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

  draw(ctx: CanvasRenderingContext2D, scale: number, viewW = 240, viewH = 160): void {
    ctx.textAlign = "center";
    for (const t of this.texts) {
      ctx.globalAlpha = Math.max(0, t.alpha);
      ctx.font = `bold ${10 * scale}px system-ui`;
      ctx.fillStyle = "#fff8e1";
      // 长文本按宽度折成两行，避免在手机上被左右裁切
      // canvas 未做整体缩放：坐标是虚拟单位，需乘 scale 转成像素
      const maxW = (viewW - 8) * scale;
      const lines: string[] = [];
      let cur = "";
      for (const ch of t.text) {
        if (ctx.measureText(cur + ch).width > maxW && cur.length > 0) {
          lines.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) lines.push(cur);
      const shown = lines.slice(0, 2);
      // 水平钳制：保证文字块不出画布
      const halfMax = (Math.max(...shown.map((l) => ctx.measureText(l).width), 0) / 2) + 2;
      const cx = Math.max(halfMax, Math.min(viewW * scale - halfMax, t.x * scale));
      const cy = Math.max(14 * scale, Math.min(viewH * scale - 4 * scale, t.y * scale));
      shown.forEach((line, i) => {
        ctx.fillText(line, cx, cy + i * 11 * scale);
      });
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2 * scale, p.y - 2 * scale, 4 * scale, 4 * scale);
    }
    ctx.globalAlpha = 1;
  }
}
