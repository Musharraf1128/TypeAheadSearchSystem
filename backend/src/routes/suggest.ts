import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Trie } from '../trie/Trie.js';
import { CacheManager } from '../cache/CacheManager.js';
import { TrendingEngine } from '../trending/TrendingEngine.js';
import { metrics } from '../middleware/metrics.js';

interface SuggestQuery {
  q?: string;
}

export function registerSuggestRoute(
  fastify: FastifyInstance,
  trie: Trie,
  cacheManager: CacheManager | null,
  trendingEngine: TrendingEngine
): void {

  fastify.get('/suggest', async (
    request: FastifyRequest<{ Querystring: SuggestQuery }>,
    reply: FastifyReply
  ) => {
    const prefix = request.query.q?.trim().toLowerCase() || '';

    if (!prefix) {
      return reply.send({ suggestions: [], cached: false });
    }

    // Phase 4: Cache-aside pattern
    if (cacheManager) {
      try {
        const cacheResult = await cacheManager.get(prefix);

        if (cacheResult.hit && cacheResult.value) {
          metrics.incrementDbReads(0); // Cached — no DB read
          const cached = JSON.parse(cacheResult.value);
          console.log(`[Cache] prefix="${prefix}" → node=${cacheResult.node} → HIT`);
          return reply.send({ suggestions: cached, cached: true, node: cacheResult.node });
        }
        console.log(`[Cache] prefix="${prefix}" → node=${cacheResult.node} → MISS`);
      } catch {
        // Cache miss or error — fall through to trie
      }
    }

    // Trie lookup
    metrics.incrementDbReads(1);
    const results = trie.search(prefix, 10);

    // Phase 6: Augment with trending scores
    const augmented = trendingEngine.augmentResults(results);

    // Sort by blended score: trending items get a boost
    augmented.sort((a, b) => {
      const scoreA = a.count + (a.trendingScore * 1000);
      const scoreB = b.count + (b.trendingScore * 1000);
      return scoreB - scoreA;
    });

    // Write back to cache
    if (cacheManager) {
      try {
        await cacheManager.set(prefix, JSON.stringify(augmented));
      } catch {
        // Cache write failure is non-fatal
      }
    }

    return reply.send({ suggestions: augmented, cached: false });
  });
}
