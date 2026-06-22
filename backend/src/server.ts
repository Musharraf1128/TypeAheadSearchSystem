import Fastify from 'fastify';
import cors from '@fastify/cors';
import { initSchema, ingestDataset, getAllQueries, closeDb } from './db/database.js';
import { Trie } from './trie/Trie.js';
import { CacheManager, CacheNode } from './cache/CacheManager.js';
import { BatchWriter } from './batch/BatchWriter.js';
import { TrendingEngine } from './trending/TrendingEngine.js';
import { metricsPlugin } from './middleware/metrics.js';
import { registerSuggestRoute } from './routes/suggest.js';
import { registerSearchRoute } from './routes/search.js';
import { registerDebugRoutes } from './routes/debug.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const REDIS_ENABLED = process.env.REDIS_ENABLED !== 'false';

async function main(): Promise<void> {
  console.log('=== TypeAhead Search System ===');
  console.log(`Starting server on ${HOST}:${PORT}...`);

  // ---------- 1. Initialize SQLite + ingest dataset ----------
  console.log('\n[Phase 0] Initializing database...');
  initSchema();
  ingestDataset();

  // ---------- 2. Build Trie from SQLite ----------
  console.log('\n[Phase 1] Loading trie from SQLite...');
  const trie = new Trie();
  const allQueries = getAllQueries();
  for (const row of allQueries) {
    trie.insert(row.query, row.count);
  }
  console.log(`Trie loaded with ${trie.size()} entries.`);

  // ---------- 3. Initialize Cache (Redis) ----------
  let cacheManager: CacheManager | null = null;

  if (REDIS_ENABLED) {
    console.log('\n[Phase 4] Initializing distributed cache...');
    const cacheNodes: CacheNode[] = [
      { id: 'redis-node-1', host: '127.0.0.1', port: 6379 },
      { id: 'redis-node-2', host: '127.0.0.1', port: 6380 },
      { id: 'redis-node-3', host: '127.0.0.1', port: 6381 },
    ];

    cacheManager = new CacheManager(cacheNodes, 60, 150);

    try {
      await cacheManager.connect();
      console.log('Cache connected to all Redis nodes.');
    } catch (err) {
      console.warn('Cache connection failed, running without cache:', (err as Error).message);
      cacheManager = null;
    }
  } else {
    console.log('\n[Cache] Redis disabled (REDIS_ENABLED=false). Running without cache.');
  }

  // ---------- 4. Initialize Trending Engine ----------
  console.log('\n[Phase 6] Starting trending engine...');
  const trendingEngine = new TrendingEngine();
  trendingEngine.start();

  // ---------- 5. Initialize Batch Writer ----------
  console.log('\n[Phase 5] Starting batch writer...');
  const batchWriter = new BatchWriter(trie, cacheManager, 5000, 100);
  batchWriter.start();

  // ---------- 6. Create Fastify server ----------
  const fastify = Fastify({
    logger: {
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
      },
    },
  });

  // CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST'],
  });

  // Metrics plugin
  await fastify.register(metricsPlugin);

  // ---------- 7. Register routes ----------
  // Phase 1: Suggest
  registerSuggestRoute(fastify, trie, cacheManager, trendingEngine);

  // Phase 2: Search
  registerSearchRoute(fastify, batchWriter);

  // Phase 4 + 7: Debug & metrics routes
  registerDebugRoutes(fastify, cacheManager, batchWriter, trendingEngine, trie);

  // Health check
  fastify.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    trieSize: trie.size(),
    cacheEnabled: cacheManager !== null,
  }));

  // ---------- 8. Start server ----------
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n✅ Server listening on http://${HOST}:${PORT}`);
    console.log(`   Suggest:     GET  http://localhost:${PORT}/suggest?q=<prefix>`);
    console.log(`   Search:      POST http://localhost:${PORT}/search`);
    console.log(`   Cache Debug: GET  http://localhost:${PORT}/cache/debug?prefix=<x>`);
    console.log(`   Cache Stats: GET  http://localhost:${PORT}/cache/stats`);
    console.log(`   Metrics:     GET  http://localhost:${PORT}/metrics`);
    console.log(`   Trending:    GET  http://localhost:${PORT}/trending`);
    console.log(`   Health:      GET  http://localhost:${PORT}/health`);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  // ---------- Graceful shutdown ----------
  const shutdown = async () => {
    console.log('\nShutting down...');
    await batchWriter.stop();
    trendingEngine.stop();
    if (cacheManager) {
      await cacheManager.disconnect();
    }
    closeDb();
    await fastify.close();
    console.log('Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
