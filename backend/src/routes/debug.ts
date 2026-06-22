import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CacheManager } from '../cache/CacheManager.js';
import { BatchWriter } from '../batch/BatchWriter.js';
import { TrendingEngine } from '../trending/TrendingEngine.js';
import { Trie } from '../trie/Trie.js';
import { metrics } from '../middleware/metrics.js';

interface CacheDebugQuery {
  prefix?: string;
}

export function registerDebugRoutes(
  fastify: FastifyInstance,
  cacheManager: CacheManager | null,
  batchWriter: BatchWriter,
  trendingEngine: TrendingEngine,
  trie: Trie
): void {

  /**
   * GET /cache/debug?prefix=<x>
   * Shows which Redis node owns the prefix, and whether it's a cache hit or miss.
   */
  fastify.get('/cache/debug', async (
    request: FastifyRequest<{ Querystring: CacheDebugQuery }>,
    reply: FastifyReply
  ) => {
    const prefix = request.query.prefix?.trim().toLowerCase() || '';

    if (!prefix) {
      return reply.status(400).send({ error: 'Missing required param: prefix' });
    }

    if (!cacheManager) {
      return reply.send({
        prefix,
        cacheEnabled: false,
        message: 'Cache is not enabled (Redis not connected)',
      });
    }

    const debugInfo = cacheManager.getDebugInfo(prefix);
    const cacheResult = await cacheManager.get(prefix);

    return reply.send({
      prefix,
      node: debugInfo.node,
      keyHash: debugInfo.keyHash,
      ringSize: debugInfo.ringSize,
      availableNodes: debugInfo.nodes,
      hit: cacheResult.hit,
      value: cacheResult.hit ? JSON.parse(cacheResult.value!) : null,
    });
  });

  /**
   * GET /cache/stats
   * Returns cache hit/miss statistics.
   */
  fastify.get('/cache/stats', async (_request, reply) => {
    if (!cacheManager) {
      return reply.send({ cacheEnabled: false });
    }

    const stats = cacheManager.getStats();
    return reply.send({
      cacheEnabled: true,
      totalRequests: stats.totalRequests,
      hits: stats.hits,
      misses: stats.misses,
      hitRate: `${(stats.hitRate * 100).toFixed(1)}%`,
      nodeStats: Object.fromEntries(stats.nodeStats),
    });
  });

  /**
   * GET /metrics
   * Returns overall API performance metrics.
   */
  fastify.get('/metrics', async (_request, reply) => {
    const summary = metrics.getSummary();
    const batchMetrics = batchWriter.getMetrics();
    const trendingStats = trendingEngine.getStats();

    return reply.send({
      ...summary,
      batch: batchMetrics,
      trending: trendingStats,
      trie: {
        totalEntries: trie.size(),
      },
    });
  });

  /**
   * GET /trending
   * Returns top trending queries.
   */
  fastify.get('/trending', async (
    request: FastifyRequest<{ Querystring: { limit?: string } }>,
    reply: FastifyReply
  ) => {
    const limit = parseInt(request.query.limit || '10', 10);
    const trending = trendingEngine.getTopTrending(limit);
    return reply.send({ trending });
  });

  /**
   * GET /suggest/compare?q=<prefix>
   * Demonstrates the difference between basic (count-only) and
   * enhanced (recency-aware) ranking for the same prefix.
   * Required by assignment §7: "Students should demonstrate the difference
   * between the two ranking approaches using sample data or logs."
   */
  fastify.get('/suggest/compare', async (
    request: FastifyRequest<{ Querystring: { q?: string } }>,
    reply: FastifyReply
  ) => {
    const prefix = request.query.q?.trim().toLowerCase() || '';
    if (!prefix) {
      return reply.status(400).send({ error: 'Missing query param: q' });
    }

    // Basic ranking: sorted purely by all-time count (descending)
    const basicResults = trie.search(prefix, 10);

    // Enhanced ranking: augmented with trending scores, sorted by blended score
    const enhancedResults = trendingEngine.augmentResults(trie.search(prefix, 10));
    enhancedResults.sort((a, b) => {
      const scoreA = a.count + (a.trendingScore * 1000);
      const scoreB = b.count + (b.trendingScore * 1000);
      return scoreB - scoreA;
    });

    return reply.send({
      prefix,
      basicRanking: {
        description: 'Sorted by all-time count only',
        results: basicResults.map((r, i) => ({
          rank: i + 1,
          query: r.query,
          count: r.count,
        })),
      },
      enhancedRanking: {
        description: 'Sorted by blended score (count + recency-weighted trending)',
        results: enhancedResults.map((r, i) => ({
          rank: i + 1,
          query: r.query,
          count: r.count,
          trendingScore: r.trendingScore,
          blendedScore: r.count + (r.trendingScore * 1000),
        })),
      },
    });
  });

  /**
   * GET /batch/stats
   * Shows batch write reduction evidence.
   * Required by assignment §8: "Students should show how batch writes
   * reduce the number of database writes."
   */
  fastify.get('/batch/stats', async (_request, reply) => {
    const batchMetrics = batchWriter.getMetrics();
    const reduction = batchMetrics.totalEventsQueued > 0
      ? ((1 - batchMetrics.totalDbWrites / batchMetrics.totalEventsQueued) * 100).toFixed(1)
      : '0.0';

    return reply.send({
      totalSearchEvents: batchMetrics.totalEventsQueued,
      totalDbWrites: batchMetrics.totalDbWrites,
      totalFlushes: batchMetrics.totalFlushes,
      writeReductionPercent: `${reduction}%`,
      explanation: `${batchMetrics.totalEventsQueued} search events were aggregated into ${batchMetrics.totalDbWrites} DB writes across ${batchMetrics.totalFlushes} flushes, reducing writes by ${reduction}%.`,
      currentQueueSize: batchMetrics.queueSize,
    });
  });
}
