/**
 * Format large numbers for display.
 *  - 1_200_000 → "1.2M"
 *  - 45_300    → "45.3K"
 *  - 800       → "800"
 */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString();
}

/**
 * Determine if a suggestion is "trending" based on its trendingScore.
 */
export function isTrending(trendingScore?: number): boolean {
  return typeof trendingScore === 'number' && trendingScore > 50;
}
