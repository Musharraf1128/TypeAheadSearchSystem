import type { SuggestResponse, SearchResponse } from './types';

const BASE_URL = '';

export async function fetchSuggestions(prefix: string, signal?: AbortSignal): Promise<SuggestResponse> {
  const res = await fetch(`${BASE_URL}/suggest?q=${encodeURIComponent(prefix)}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch suggestions: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function postSearch(query: string): Promise<SearchResponse> {
  const res = await fetch(`${BASE_URL}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}
