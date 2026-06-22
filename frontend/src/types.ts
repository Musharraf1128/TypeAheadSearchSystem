export interface Suggestion {
  query: string;
  count: number;
  trendingScore?: number;
}

export interface SuggestResponse {
  suggestions: Suggestion[];
}

export interface SearchResponse {
  message: string;
}

export interface CacheDebugResponse {
  prefix: string;
  node: string;
  hit: boolean;
  value: unknown;
}
