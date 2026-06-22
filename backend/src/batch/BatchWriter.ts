import { Trie } from '../trie/Trie.js';
import { batchIncrementCounts, batchRecordTrendingHits } from '../db/database.js';
import { CacheManager } from '../cache/CacheManager.js';

/**
 * BatchWriter accumulates search events and flushes them periodically.
 *
 * Instead of writing each /search hit directly to SQLite (which would be
 * slow under load), we queue events in memory and flush them in batches.
 *
 * Flush triggers:
 * - Time-based: every FLUSH_INTERVAL_MS milliseconds
 * - Size-based: when the queue reaches MAX_QUEUE_SIZE
 *
 * Crash semantics:
 * If the process crashes before a flush, all queued events are lost.
 * In production, you'd mitigate this with:
 * - A WAL (write-ahead log) on disk
 * - More frequent flushes (tradeoff: more DB writes)
 * - Accepting eventual consistency (appropriate for a search count signal)
 * - Using a Redis list as the queue (survives app crashes, not Redis crashes)
 * For this assignment, the in-memory approach is acceptable.
 */

interface SearchEvent {
  query: string;
  timestamp: number;
}

export class BatchWriter {
  private queue: SearchEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private trie: Trie;
  private cacheManager: CacheManager | null;

  private readonly FLUSH_INTERVAL_MS: number;
  private readonly MAX_QUEUE_SIZE: number;

  // Metrics
  private totalEventsQueued: number = 0;
  private totalFlushes: number = 0;
  private totalEventsWritten: number = 0;

  constructor(
    trie: Trie,
    cacheManager: CacheManager | null = null,
    flushIntervalMs: number = 5000,
    maxQueueSize: number = 100
  ) {
    this.trie = trie;
    this.cacheManager = cacheManager;
    this.FLUSH_INTERVAL_MS = flushIntervalMs;
    this.MAX_QUEUE_SIZE = maxQueueSize;
  }

  /**
   * Start the background flush timer.
   */
  start(): void {
    this.flushInterval = setInterval(() => {
      this.flush().catch(err => {
        console.error('Batch flush error:', err);
      });
    }, this.FLUSH_INTERVAL_MS);

    console.log(`BatchWriter started (interval=${this.FLUSH_INTERVAL_MS}ms, maxQueue=${this.MAX_QUEUE_SIZE})`);
  }

  /**
   * Stop the background flush timer and flush remaining events.
   */
  async stop(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush();
    console.log('BatchWriter stopped.');
  }

  /**
   * Enqueue a search event. Triggers an immediate flush if queue is full.
   */
  enqueue(query: string): void {
    this.queue.push({ query, timestamp: Date.now() });
    this.totalEventsQueued++;

    if (this.queue.length >= this.MAX_QUEUE_SIZE) {
      this.flush().catch(err => {
        console.error('Batch flush error (size trigger):', err);
      });
    }
  }

  /**
   * Flush all queued events to SQLite and update the trie.
   *
   * Aggregates repeated queries in the batch into a single increment per query,
   * rather than one write per event. This is a key optimization.
   */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    // Snapshot and clear the queue atomically
    const events = this.queue.splice(0);
    const aggregated = new Map<string, number>();
    const trendingHits = new Map<string, Map<string, number>>();

    for (const event of events) {
      const lower = event.query.toLowerCase();
      aggregated.set(lower, (aggregated.get(lower) || 0) + 1);

      // Trending: bucket by hour
      const bucketHour = new Date(event.timestamp).toISOString().slice(0, 13);
      if (!trendingHits.has(lower)) {
        trendingHits.set(lower, new Map());
      }
      const buckets = trendingHits.get(lower)!;
      buckets.set(bucketHour, (buckets.get(bucketHour) || 0) + 1);
    }

    // Batch write to SQLite
    batchIncrementCounts(aggregated);
    batchRecordTrendingHits(trendingHits);

    // Update trie in-memory
    for (const [query, count] of aggregated) {
      this.trie.updateCount(query, count);
    }

    // Invalidate cache for affected prefixes
    if (this.cacheManager) {
      const invalidationPromises: Promise<void>[] = [];
      for (const query of aggregated.keys()) {
        invalidationPromises.push(this.cacheManager.invalidatePrefix(query));
      }
      await Promise.all(invalidationPromises);
    }

    this.totalFlushes++;
    this.totalEventsWritten += events.length;

    if (events.length > 0) {
      console.log(`Flushed ${events.length} events (${aggregated.size} unique queries)`);
    }
  }

  /**
   * Get batch writer metrics.
   */
  getMetrics(): {
    queueSize: number;
    totalEventsQueued: number;
    totalFlushes: number;
    totalEventsWritten: number;
  } {
    return {
      queueSize: this.queue.length,
      totalEventsQueued: this.totalEventsQueued,
      totalFlushes: this.totalFlushes,
      totalEventsWritten: this.totalEventsWritten,
    };
  }
}
