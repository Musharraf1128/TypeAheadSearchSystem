# TypeAhead Search System

A full-stack, production-style typeahead/autocomplete search system featuring a Trie-based suggestion engine, distributed Redis cache with consistent hashing, batch writes with in-memory queue aggregation, trending search ranking with exponential decay, and a premium React frontend.

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        React Frontend                            │
│         (Vite + TypeScript, debounced input, keyboard nav)       │
└────────────────────────────────┬─────────────────────────────────┘
                                 │ HTTP (fetch)
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Fastify Server (Node.js)                     │
│  ┌───────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐    │
│  │ /suggest  │  │ /search  │  │ /cache/* │  │ /metrics      │    │
│  │ (GET)     │  │ (POST)   │  │ (debug)  │  │ /trending     │    │
│  └─────┬─────┘  └─────┬────┘  └──────────┘  └───────────────┘    │
│        │              │                                          │
│  ┌─────▼─────────┐  ┌─▼──────────────┐  ┌───────────────────┐    │
│  │ Cache-Aside   │  │ Batch Writer   │  │ Trending Engine   │    │
│  │ (Redis hash)  │  │ (queue+flush)  │  │ (exp. decay)      │    │
│  └───────┬───────┘  └───────┬────────┘  └───────────────────┘    │
│          │                  │                                    │
│  ┌───────▼───────┐  ┌───────▼───────┐                            │
│  │   Trie        │  │   SQLite      │                            │
│  │  (in-memory)  │  │  (durable)    │                            │
│  └───────────────┘  └───────────────┘                            │
└──────────────────────────────────────────────────────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
            ┌──────────┐    ┌──────────┐    ┌──────────┐
            │ Redis    │    │ Redis    │    │ Redis    │
            │ :6379    │    │ :6380    │    │ :6381    │
            └──────────┘    └──────────┘    └──────────┘
        Consistent Hash Ring (150 virtual nodes/physical)
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js + TypeScript + Fastify |
| Database | SQLite (better-sqlite3, WAL mode) |
| Cache | 3× Redis 7 (Docker, consistent hashing) |
| Frontend | React + Vite + TypeScript |
| Dataset | 150,000 English words (wordfreq package) |

## Quick Start

### Prerequisites
- Node.js ≥ 18
- Docker & Docker Compose
- Python 3 (for dataset generation only)

### 1. Generate Dataset
```bash
pip install wordfreq --break-system-packages
python3 scripts/generate-dataset.py
```

### 2. Start Redis Nodes
```bash
docker-compose up -d
```

### 3. Start Backend
```bash
cd backend
npm install
npm run dev
```
The backend starts on `http://localhost:3000`.

### 4. Start Frontend
```bash
cd frontend
npm install
npm run dev
```
The frontend starts on `http://localhost:5173`.

> **Note:** If Redis is not running, the server starts in degraded mode (no caching). Set `REDIS_ENABLED=false` to explicitly disable cache.

## API Documentation

### `GET /suggest?q=<prefix>`
Returns top-10 autocomplete suggestions for a prefix.

**Request:**
```
GET /suggest?q=hel
```

**Response:**
```json
{
  "suggestions": [
    { "query": "hello", "count": 12500, "trendingScore": 3.2 },
    { "query": "help", "count": 11200, "trendingScore": 0.8 },
    { "query": "helmet", "count": 4300, "trendingScore": 0 }
  ],
  "cached": true,
  "node": "redis-node-2"
}
```

### `POST /search`
Records a search event (batched write).

**Request:**
```json
{ "query": "hello world" }
```

**Response:**
```json
{ "message": "Searched", "query": "hello world" }
```

### `GET /cache/debug?prefix=<x>`
Shows which Redis node owns a prefix key and whether it's cached.

**Response:**
```json
{
  "prefix": "hel",
  "node": "redis-node-2",
  "keyHash": 2847162905,
  "ringSize": 450,
  "availableNodes": ["redis-node-1", "redis-node-2", "redis-node-3"],
  "hit": true,
  "value": [...]
}
```

### `GET /cache/stats`
Returns cache hit/miss statistics.

### `GET /metrics`
Returns API performance metrics including p50/p95/p99 latencies.

### `GET /trending`
Returns top trending queries with recency scores.

### `GET /suggest/compare?q=<prefix>`
Compares basic (count-only) vs enhanced (trending-aware) ranking for the same prefix. Demonstrates the difference between the two ranking approaches.

### `GET /batch/stats`
Shows batch write reduction evidence — how many search events were aggregated into how many DB writes.

### `GET /health`
Health check endpoint.

## Project Structure

```
TypeAheadSearchSystem/
├── docker-compose.yml          # 3 Redis instances
├── PROJECT_REPORT.md           # Full project report (architecture, API, design, perf)
├── DESIGN.md                   # Viva preparation document
├── scripts/
│   └── generate-dataset.py     # Dataset generation (wordfreq)
├── data/
│   └── dataset.csv             # 150k rows (query, count)
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── server.ts           # Entry point — wires everything
│       ├── db/
│       │   └── database.ts     # SQLite schema, ingestion, queries
│       ├── trie/
│       │   └── Trie.ts         # Trie data structure
│       ├── cache/
│       │   ├── ConsistentHash.ts   # Hash ring implementation
│       │   └── CacheManager.ts     # Cache-aside over Redis
│       ├── batch/
│       │   └── BatchWriter.ts  # Queue + aggregated flush
│       ├── trending/
│       │   └── TrendingEngine.ts   # Recency scoring
│       ├── routes/
│       │   ├── suggest.ts      # GET /suggest
│       │   ├── search.ts       # POST /search
│       │   └── debug.ts        # Debug, metrics, compare, batch routes
│       └── middleware/
│           └── metrics.ts      # p95 latency, counters
└── frontend/
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.tsx             # Main search + trending section
        ├── api.ts              # API client
        ├── types.ts            # TypeScript interfaces
        ├── hooks/              # Custom hooks (debounce, etc.)
        └── components/         # UI components
```

## Design & Performance

See [PROJECT_REPORT.md](PROJECT_REPORT.md) for the full project report covering architecture, design choices, trade-offs, and performance analysis.

See [DESIGN.md](DESIGN.md) for detailed viva preparation material.
