import crypto from 'crypto';

/**
 * Consistent Hash Ring implementation for distributing cache keys
 * across multiple Redis nodes.
 *
 * How it works:
 * 1. Each physical node gets mapped to multiple "virtual nodes" on a hash ring
 *    (0 to 2^32 - 1). This ensures even key distribution.
 * 2. To find which node owns a key, hash the key and walk clockwise on the ring
 *    until hitting a virtual node — that virtual node's physical node owns the key.
 *
 * Why virtual nodes:
 * - With only 3 physical nodes on the ring, key distribution would be very uneven.
 * - Virtual nodes (100-150 per physical) spread each physical node's "territory"
 *   across many points on the ring, giving near-uniform distribution.
 * - When a node is added/removed, only ~1/N of keys need to be remapped (minimal
 *   disruption), rather than the ~50% you'd see with modulo hashing.
 */

interface VirtualNode {
  hash: number;
  physicalNode: string;
}

export class ConsistentHashRing {
  private ring: VirtualNode[] = [];
  private virtualNodesPerNode: number;
  private physicalNodes: Set<string> = new Set();

  constructor(virtualNodesPerNode: number = 150) {
    this.virtualNodesPerNode = virtualNodesPerNode;
  }

  /**
   * Hash a string to a 32-bit integer using MD5.
   * We take the first 4 bytes of the MD5 digest.
   */
  private hash(key: string): number {
    const digest = crypto.createHash('md5').update(key).digest();
    // Read first 4 bytes as unsigned 32-bit integer
    return digest.readUInt32BE(0);
  }

  /**
   * Add a physical node to the ring.
   * Creates `virtualNodesPerNode` virtual nodes for even distribution.
   */
  addNode(nodeId: string): void {
    if (this.physicalNodes.has(nodeId)) return;

    this.physicalNodes.add(nodeId);

    for (let i = 0; i < this.virtualNodesPerNode; i++) {
      const virtualKey = `${nodeId}:vnode:${i}`;
      const h = this.hash(virtualKey);
      this.ring.push({ hash: h, physicalNode: nodeId });
    }

    // Keep ring sorted by hash for binary search
    this.ring.sort((a, b) => a.hash - b.hash);
  }

  /**
   * Remove a physical node and all its virtual nodes from the ring.
   */
  removeNode(nodeId: string): void {
    if (!this.physicalNodes.has(nodeId)) return;

    this.physicalNodes.delete(nodeId);
    this.ring = this.ring.filter(vn => vn.physicalNode !== nodeId);
  }

  /**
   * Find the physical node that owns a given key.
   * Walks clockwise from the key's hash position on the ring.
   */
  getNode(key: string): string {
    if (this.ring.length === 0) {
      throw new Error('No nodes in the hash ring');
    }

    const keyHash = this.hash(key);

    // Binary search for the first virtual node with hash >= keyHash
    let low = 0;
    let high = this.ring.length - 1;
    let result = 0; // Default to first node (wrap around)

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (this.ring[mid].hash >= keyHash) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    // If keyHash is greater than all hashes, wrap around to the first node
    if (low > this.ring.length - 1) {
      result = 0;
    }

    return this.ring[result].physicalNode;
  }

  /**
   * Get the hash value for a key (useful for debugging).
   */
  getKeyHash(key: string): number {
    return this.hash(key);
  }

  /**
   * Get all physical nodes in the ring.
   */
  getNodes(): string[] {
    return Array.from(this.physicalNodes);
  }

  /**
   * Get the total number of virtual nodes in the ring.
   */
  getRingSize(): number {
    return this.ring.length;
  }

  /**
   * Get distribution stats — how many virtual nodes each physical node has.
   */
  getDistribution(): Map<string, number> {
    const dist = new Map<string, number>();
    for (const vn of this.ring) {
      dist.set(vn.physicalNode, (dist.get(vn.physicalNode) || 0) + 1);
    }
    return dist;
  }
}
