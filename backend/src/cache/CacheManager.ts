import Redis from 'ioredis';
import { ConsistentHashRing } from './ConsistentHash.js';

/**
 * CacheManager implements a cache-aside pattern over multiple Redis instances,
 * using consistent hashing to route keys to the correct node.
 *
 * Cache-aside flow:
 * 1. Hash the key → determine owning Redis node via consistent hash ring
 * 2. Check that Redis node for cached value
 * 3. On hit: return cached value
 * 4. On miss: compute from primary store, write to cache with TTL, return
 */

export interface CacheNode {
  id: string;
  host: string;
  port: number;
}

export interface CacheLookupResult {
  node: string;
  hit: boolean;
  value: string | null;
}

export interface CacheStats {
  totalRequests: number;
  hits: number;
  misses: number;
  hitRate: number;
  nodeStats: Map<string, { hits: number; misses: number }>;
}

export class CacheManager {
  private ring: ConsistentHashRing;
  private clients: Map<string, Redis> = new Map();
  private defaultTTL: number;

  // Metrics
  private totalRequests: number = 0;
  private totalHits: number = 0;
  private totalMisses: number = 0;
  private nodeMetrics: Map<string, { hits: number; misses: number }> = new Map();

  constructor(nodes: CacheNode[], ttlSeconds: number = 60, virtualNodes: number = 150) {
    this.ring = new ConsistentHashRing(virtualNodes);
    this.defaultTTL = ttlSeconds;

    for (const node of nodes) {
      this.addNode(node);
    }
  }

  /**
   * Add a Redis node to the cache cluster.
   */
  private addNode(node: CacheNode): void {
    const client = new Redis({
      host: node.host,
      port: node.port,
      retryStrategy: (times: number) => {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 200, 2000);
      },
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      lazyConnect: true,
    });

    client.on('error', (err) => {
      console.error(`Redis node ${node.id} error:`, err.message);
    });

    this.clients.set(node.id, client);
    this.ring.addNode(node.id);
    this.nodeMetrics.set(node.id, { hits: 0, misses: 0 });
  }

  /**
   * Connect to all Redis nodes.
   */
  async connect(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [id, client] of this.clients) {
      promises.push(
        client.connect().then(() => {
          console.log(`Connected to Redis node: ${id}`);
        }).catch((err) => {
          console.warn(`Failed to connect to Redis node ${id}: ${err.message}`);
        })
      );
    }
    await Promise.all(promises);
  }

  /**
   * Get a cached value. Returns the node it was routed to, hit/miss, and value.
   */
  async get(key: string): Promise<CacheLookupResult> {
    const nodeId = this.ring.getNode(key);
    const client = this.clients.get(nodeId);
    this.totalRequests++;

    if (!client) {
      this.totalMisses++;
      return { node: nodeId, hit: false, value: null };
    }

    try {
      const value = await client.get(`ta:${key}`);
      const hit = value !== null;

      if (hit) {
        this.totalHits++;
        const nm = this.nodeMetrics.get(nodeId)!;
        nm.hits++;
      } else {
        this.totalMisses++;
        const nm = this.nodeMetrics.get(nodeId)!;
        nm.misses++;
      }

      return { node: nodeId, hit, value };
    } catch {
      this.totalMisses++;
      return { node: nodeId, hit: false, value: null };
    }
  }

  /**
   * Set a cached value with TTL.
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    const nodeId = this.ring.getNode(key);
    const client = this.clients.get(nodeId);

    if (!client) return;

    try {
      await client.setex(`ta:${key}`, ttl || this.defaultTTL, value);
    } catch (err) {
      console.error(`Cache set error on ${nodeId}:`, (err as Error).message);
    }
  }

  /**
   * Invalidate a cached key.
   */
  async invalidate(key: string): Promise<void> {
    const nodeId = this.ring.getNode(key);
    const client = this.clients.get(nodeId);

    if (!client) return;

    try {
      await client.del(`ta:${key}`);
    } catch (err) {
      console.error(`Cache invalidate error on ${nodeId}:`, (err as Error).message);
    }
  }

  /**
   * Invalidate all keys matching a pattern prefix.
   * Used when search counts change and cached suggestions may be stale.
   */
  async invalidatePrefix(prefix: string): Promise<void> {
    // Invalidate keys for all substrings of the prefix
    // e.g., if someone searches "hello", invalidate cache for "h", "he", "hel", "hell", "hello"
    for (let i = 1; i <= prefix.length; i++) {
      const sub = prefix.substring(0, i).toLowerCase();
      await this.invalidate(sub);
    }
  }

  /**
   * Debug info for a specific key.
   */
  getDebugInfo(key: string): { node: string; keyHash: number; ringSize: number; nodes: string[] } {
    return {
      node: this.ring.getNode(key),
      keyHash: this.ring.getKeyHash(key),
      ringSize: this.ring.getRingSize(),
      nodes: this.ring.getNodes(),
    };
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    return {
      totalRequests: this.totalRequests,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate: this.totalRequests > 0 ? this.totalHits / this.totalRequests : 0,
      nodeStats: new Map(this.nodeMetrics),
    };
  }

  /**
   * Disconnect all Redis clients.
   */
  async disconnect(): Promise<void> {
    for (const [id, client] of this.clients) {
      try {
        await client.quit();
        console.log(`Disconnected Redis node: ${id}`);
      } catch {
        console.warn(`Error disconnecting Redis node: ${id}`);
      }
    }
  }
}
