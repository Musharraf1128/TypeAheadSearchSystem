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
}
