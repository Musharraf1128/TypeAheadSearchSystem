/**
 * Trie data structure for efficient prefix-based autocomplete.
 *
 * Each node in the trie corresponds to a character. Terminal nodes
 * store the full query string and its frequency count. Prefix lookups
 * walk to the prefix node and then collect all descendant terminal nodes,
 * returning the top-K by count (descending).
 *
 * Time complexity:
 *   - insert: O(L) where L = length of the query string
 *   - search: O(P + N) where P = prefix length, N = number of descendants
 *
 * Why a trie over sorted-array + binary search:
 *   - Trie gives O(prefix length) lookup to the prefix node
 *   - Binary search on a sorted array also gives O(P·log(N)) but collecting
 *     all matches requires scanning forward, and insertion requires shifting
 *   - Trie naturally groups all strings sharing a prefix under the same subtree
 */

export interface TrieResult {
  query: string;
  count: number;
  trendingScore?: number;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  query: string | null;
  count: number;
}

function createNode(): TrieNode {
  return {
    children: new Map(),
    isEnd: false,
    query: null,
    count: 0,
  };
}

export class Trie {
  private root: TrieNode;
  private totalEntries: number = 0;

  constructor() {
    this.root = createNode();
  }

  /**
   * Insert a query string with its frequency count into the trie.
   */
  insert(query: string, count: number): void {
    let node = this.root;
    const lowerQuery = query.toLowerCase();

    for (const char of lowerQuery) {
      if (!node.children.has(char)) {
        node.children.set(char, createNode());
      }
      node = node.children.get(char)!;
    }

    node.isEnd = true;
    node.query = query; // Store original case
    node.count = count;
    this.totalEntries++;
  }

  /**
   * Search for suggestions matching a prefix.
   * Returns top-K results sorted by count descending.
   */
  search(prefix: string, topK: number = 10): TrieResult[] {
    if (!prefix || prefix.trim().length === 0) {
      return [];
    }

    const lowerPrefix = prefix.toLowerCase().trim();
    let node = this.root;

    // Walk to the prefix node
    for (const char of lowerPrefix) {
      if (!node.children.has(char)) {
        return []; // No matches
      }
      node = node.children.get(char)!;
    }

    // Collect all descendants
    const results: TrieResult[] = [];
    this.collectDescendants(node, results);

    // Sort by count descending, take top K
    results.sort((a, b) => b.count - a.count);
    return results.slice(0, topK);
  }

  /**
   * Update the count for an existing query or insert it if new.
   */
  updateCount(query: string, increment: number = 1): void {
    let node = this.root;
    const lowerQuery = query.toLowerCase();

    for (const char of lowerQuery) {
      if (!node.children.has(char)) {
        node.children.set(char, createNode());
      }
      node = node.children.get(char)!;
    }

    if (node.isEnd) {
      node.count += increment;
    } else {
      node.isEnd = true;
      node.query = query;
      node.count = increment;
      this.totalEntries++;
    }
  }

  /**
   * Get count for a specific query (exact match).
   */
  getCount(query: string): number {
    let node = this.root;
    const lowerQuery = query.toLowerCase();

    for (const char of lowerQuery) {
      if (!node.children.has(char)) {
        return 0;
      }
      node = node.children.get(char)!;
    }

    return node.isEnd ? node.count : 0;
  }

  /**
   * Total number of entries in the trie.
   */
  size(): number {
    return this.totalEntries;
  }

  /**
   * Recursively collect all terminal descendants of a node.
   */
  private collectDescendants(node: TrieNode, results: TrieResult[]): void {
    if (node.isEnd && node.query) {
      results.push({ query: node.query, count: node.count });
    }

    for (const child of node.children.values()) {
      this.collectDescendants(child, results);
    }
  }
}
