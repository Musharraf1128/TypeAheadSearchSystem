import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

/**
 * Metrics middleware for tracking API performance and cache behavior.
 *
 * Tracks:
 * - Request count per route
 * - Response time histogram (for p50, p95, p99 calculation)
 * - DB read/write counts
 */

interface RouteMetrics {
  requestCount: number;
  responseTimes: number[]; // Store last N response times for percentile calc
}

const MAX_STORED_TIMES = 1000; // Keep last 1000 response times for percentile computation

class MetricsCollector {
  private routes: Map<string, RouteMetrics> = new Map();
  private dbReads: number = 0;
  private dbWrites: number = 0;
  private startTime: number = Date.now();

  recordRequest(route: string, responseTimeMs: number): void {
    if (!this.routes.has(route)) {
      this.routes.set(route, { requestCount: 0, responseTimes: [] });
    }

    const metrics = this.routes.get(route)!;
    metrics.requestCount++;
    metrics.responseTimes.push(responseTimeMs);

    // Sliding window: keep only last N
    if (metrics.responseTimes.length > MAX_STORED_TIMES) {
      metrics.responseTimes.shift();
    }
  }

  incrementDbReads(count: number = 1): void {
    this.dbReads += count;
  }

  incrementDbWrites(count: number = 1): void {
    this.dbWrites += count;
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  getRouteStats(route: string): {
    requestCount: number;
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  } | null {
    const metrics = this.routes.get(route);
    if (!metrics) return null;

    const times = metrics.responseTimes;
    const avg = times.length > 0 ? times.reduce((a, b) => a + b, 0) / times.length : 0;

    return {
      requestCount: metrics.requestCount,
      p50: this.percentile(times, 50),
      p95: this.percentile(times, 95),
      p99: this.percentile(times, 99),
      avg: Math.round(avg * 100) / 100,
    };
  }

  getSummary(): {
    uptime: number;
    dbReads: number;
    dbWrites: number;
    routes: Record<string, ReturnType<MetricsCollector['getRouteStats']>>;
  } {
    const routeStats: Record<string, ReturnType<MetricsCollector['getRouteStats']>> = {};
    for (const route of this.routes.keys()) {
      routeStats[route] = this.getRouteStats(route);
    }

    return {
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      dbReads: this.dbReads,
      dbWrites: this.dbWrites,
      routes: routeStats,
    };
  }
}

// Singleton instance
export const metrics = new MetricsCollector();

/**
 * Fastify plugin that registers onRequest/onResponse hooks
 * for automatic latency tracking.
 */
export async function metricsPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    (request as any).startTime = process.hrtime.bigint();
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = (request as any).startTime as bigint;
    if (startTime) {
      const elapsed = Number(process.hrtime.bigint() - startTime) / 1_000_000; // Convert ns to ms
      const route = `${request.method} ${request.routeOptions?.url || request.url}`;
      metrics.recordRequest(route, elapsed);
    }
  });
}
