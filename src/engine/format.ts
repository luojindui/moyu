/** 摸鱼值显示：万以下整数，万/亿缩写保留两位小数 */
export function formatMoyu(n: number): string {
  if (n < 10_000) return String(Math.floor(n));
  if (n < 100_000_000) {
    return `${(n / 10_000).toFixed(2)}万`;
  }
  return `${(n / 100_000_000).toFixed(2)}亿`;
}
