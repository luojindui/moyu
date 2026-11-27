/** 摸鱼段位（按累计摸鱼值） */
export interface Rank {
  name: string;
  at: number;
}

export const RANKS: Rank[] = [
  { name: "摸鱼实习生", at: 0 },
  { name: "摸鱼学徒", at: 10_000 },
  { name: "资深摸鱼", at: 100_000 },
  { name: "摸鱼大师", at: 1_000_000 },
  { name: "带薪摸鱼传说", at: 100_000_000 },
  { name: "摸鱼之神", at: 1_000_000_000 },
  { name: "摸鱼宇宙尽头", at: 2_500_000_000 },
];

export interface RankInfo {
  current: string;
  next: Rank | null;
  /** 0..1 当前档内进度 */
  progress: number;
}

export function rankFor(totalEarned: number): RankInfo {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (totalEarned >= RANKS[i]!.at) idx = i;
  }
  const current = RANKS[idx]!;
  const next = idx + 1 < RANKS.length ? RANKS[idx + 1]! : null;
  const progress = next ? (totalEarned - current.at) / (next.at - current.at) : 1;
  return { current: current.name, next, progress: Math.min(1, Math.max(0, progress)) };
}
