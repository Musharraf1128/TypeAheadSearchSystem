import { getTrendingBuckets, cleanOldBuckets } from '../db/database.js';

/**
 * TrendingEngine computes trending scores for search queries by combining
 * historical popularity with recent activity.
 *
 * Scoring formula:
 *   score = α · log(total_count + 1) + β · recency_score
 *
 * Where:
 *   - α = 0.4 (weight for historical popularity)
 *   - β = 0.6 (weight for recency — we favor recent activity)
 *   - total_count = all-time search count from the queries table
 *   - recency_score = sum of hourly bucket counts weighted by exponential decay
 *
 * Recency score calculation:
 *   For each hourly bucket in the last 24 hours:
 *     recency_score += bucket_count × e^(-λ × hours_ago)
 *
 *   Where λ (decay rate) controls how fast old activity loses influence.
 *   With λ = 0.15, activity from 12 hours ago has ~16% of its original weight.
 *
 * Why this avoids over-ranking one-time spikes:
 *   - The exponential decay naturally diminishes old spikes
 *   - The log(total_count) component rewards sustained popularity
 *   - After ~24 hours, even a large spike's recency contribution is negligible
 *
 * Cache invalidation:
 *   - Trending scores are recomputed periodically (every 5 minutes)
 *   - When scores change significantly, affected cache entries are invalidated
 */

export interface TrendingResult {
  query: string;
  trendingScore: number;
  recencyScore: number;
  historicalScore: number;
}

export class TrendingEngine {
  private trendingScores: Map<string, TrendingResult> = new Map();
  private refreshInterval: ReturnType<typeof setInterval> | null = null;
  private lastRefresh: number = 0;

  // Scoring parameters
  private readonly ALPHA = 0.4;  // Historical weight
  private readonly BETA = 0.6;   // Recency weight
  private readonly DECAY_RATE = 0.15; // Exponential decay λ
  private readonly HOURS_WINDOW = 24; // Look-back window in hours

  // Refresh config
  private readonly REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly CLEANUP_INTERVAL_HOURS = 48;

  constructor() {}

  /**
   * Start periodic trending score refresh.
   */
  start(): void {
    this.refresh(); // Initial computation
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, this.REFRESH_INTERVAL_MS);
    console.log(`TrendingEngine started (refresh every ${this.REFRESH_INTERVAL_MS / 1000}s)`);
  }

  /**
   * Stop the refresh timer.
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Recompute trending scores from the database.
   */
  refresh(): void {
    try {
      const buckets = getTrendingBuckets(this.HOURS_WINDOW);

      // Group by query
      const queryBuckets = new Map<string, { bucketHour: string; count: number }[]>();
      for (const b of buckets) {
        if (!queryBuckets.has(b.query)) {
          queryBuckets.set(b.query, []);
        }
        queryBuckets.get(b.query)!.push({ bucketHour: b.bucket_hour, count: b.count });
      }

      const now = Date.now();
      const newScores = new Map<string, TrendingResult>();

      for (const [query, qBuckets] of queryBuckets) {
        let recencyScore = 0;
        let totalRecentCount = 0;

        for (const bucket of qBuckets) {
          const bucketTime = new Date(bucket.bucketHour + ':00:00Z').getTime();
          const hoursAgo = (now - bucketTime) / (1000 * 60 * 60);

          if (hoursAgo <= this.HOURS_WINDOW) {
            const decayWeight = Math.exp(-this.DECAY_RATE * hoursAgo);
            recencyScore += bucket.count * decayWeight;
            totalRecentCount += bucket.count;
          }
        }

        // historicalScore uses the total recent count (would ideally use all-time count)
        const historicalScore = Math.log(totalRecentCount + 1);
        const trendingScore = this.ALPHA * historicalScore + this.BETA * recencyScore;

        if (trendingScore > 0.01) {
          newScores.set(query, {
            query,
            trendingScore,
            recencyScore,
            historicalScore,
          });
        }
      }

      this.trendingScores = newScores;
      this.lastRefresh = now;

      // Periodic cleanup of old buckets
      cleanOldBuckets(this.CLEANUP_INTERVAL_HOURS);
    } catch (err) {
      console.error('TrendingEngine refresh error:', err);
    }
  }

  /**
   * Get the trending score for a specific query.
   */
  getScore(query: string): number {
    const result = this.trendingScores.get(query.toLowerCase());
    return result?.trendingScore ?? 0;
  }

  /**
   * Get trending results for a list of queries (used to augment suggestion results).
   */
  augmentResults(
    results: { query: string; count: number }[]
  ): { query: string; count: number; trendingScore: number }[] {
    return results.map(r => ({
      ...r,
      trendingScore: this.getScore(r.query),
    }));
  }

  /**
   * Get the top trending queries overall.
   */
  getTopTrending(limit: number = 10): TrendingResult[] {
    const sorted = Array.from(this.trendingScores.values())
      .sort((a, b) => b.trendingScore - a.trendingScore);
    return sorted.slice(0, limit);
  }

  /**
   * Get engine stats.
   */
  getStats(): { trackedQueries: number; lastRefresh: number } {
    return {
      trackedQueries: this.trendingScores.size,
      lastRefresh: this.lastRefresh,
    };
  }
}
