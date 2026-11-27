/**
 * 零素材音效（WebAudio 程序化）：节奏党需要的"点中"反馈。
 * - 每击一个 blip，音高随连击升高（330Hz → 一个八度）
 * - 6/12/20 连加双音；断连闷响
 * - iOS 需在首次手势里 resume；失败静默（不影响游戏）
 */
let ctx: AudioContext | null = null;
let muted = false;
let lastAt = 0;

const MUTE_KEY = "moyu-muted";

export function initAudio(): void {
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    /* 忽略 */
  }
  // 预热：先把 AudioContext 建好（suspended），避免首次点击时才创建导致 ~140ms 长任务
  if (!muted) {
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) ctx = new Ctor();
    } catch {
      /* 忽略 */
    }
  }
}

/** 首次用户手势时调用：把预热的 AudioContext 恢复运行 */
export function resumeAudio(): void {
  try {
    if (ctx && ctx.state === "suspended") void ctx.resume();
  } catch {
    /* 忽略 */
  }
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* 忽略 */
  }
  return muted;
}

function ensureCtx(): AudioContext | null {
  if (muted) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function blip(freq: number, dur = 0.05, gain = 0.05, type: OscillatorType = "square"): void {
  const c = ensureCtx();
  if (!c) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g).connect(c.destination);
  osc.start(now);
  osc.stop(now + dur + 0.01);
}

/** 点击音：连击越高音越高（330Hz 起，20 连翻一个八度） */
export function playClick(combo: number): void {
  const c = ensureCtx();
  if (!c) return;
  const nowMs = performance.now();
  if (nowMs - lastAt < 22) return; // 防 8cps 以上爆音
  lastAt = nowMs;
  const freq = 330 * Math.pow(2, Math.min(combo, 20) / 20);
  blip(freq, 0.05, 0.045);
  if (combo === 6 || combo === 12 || combo === 20) blip(freq * 1.5, 0.09, 0.04, "triangle");
}

/** 断连闷响 */
export function playBreak(): void {
  blip(110, 0.12, 0.05, "sine");
}

/** 事件成功（巡逻安然/冲刺达标）双音上行 */
export function playSuccess(): void {
  blip(660, 0.08, 0.05, "triangle");
  setTimeout(() => blip(880, 0.1, 0.05, "triangle"), 90);
}
