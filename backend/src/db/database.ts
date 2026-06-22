import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', '..', 'typeahead.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  return db;
}

export function initSchema(): void {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS queries (
      query TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_queries_count ON queries(count DESC);
  `);

  // Trending: hourly buckets for last 48h
  database.exec(`
    CREATE TABLE IF NOT EXISTS trending_buckets (
      query TEXT NOT NULL,
      bucket_hour TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (query, bucket_hour)
    );

    CREATE INDEX IF NOT EXISTS idx_trending_bucket ON trending_buckets(bucket_hour);
  `);
}

export function ingestDataset(): void {
  const database = getDb();
  const csvPath = path.join(__dirname, '..', '..', '..', 'data', 'dataset.csv');

  if (!fs.existsSync(csvPath)) {
    console.error(`Dataset not found at ${csvPath}. Run: python3 scripts/generate-dataset.py`);
    process.exit(1);
  }

  const rowCount = database.prepare('SELECT COUNT(*) as cnt FROM queries').get() as { cnt: number };
  if (rowCount.cnt > 0) {
    console.log(`Database already has ${rowCount.cnt} rows. Skipping ingestion.`);
    return;
  }

  console.log(`Ingesting dataset from ${csvPath}...`);
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  const insert = database.prepare('INSERT OR IGNORE INTO queries (query, count) VALUES (?, ?)');
  const insertMany = database.transaction((rows: [string, number][]) => {
    for (const [query, count] of rows) {
      insert.run(query, count);
    }
  });

  const batch: [string, number][] = [];
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const lastComma = line.lastIndexOf(',');
    if (lastComma === -1) continue;
    const query = line.substring(0, lastComma).trim();
    const count = parseInt(line.substring(lastComma + 1).trim(), 10);
    if (query && !isNaN(count)) {
      batch.push([query, count]);
    }

    if (batch.length >= 5000) {
      insertMany(batch);
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    insertMany(batch);
  }

  const finalCount = database.prepare('SELECT COUNT(*) as cnt FROM queries').get() as { cnt: number };
  console.log(`Ingested ${finalCount.cnt} rows into SQLite.`);
}

export function getAllQueries(): { query: string; count: number }[] {
  const database = getDb();
  return database.prepare('SELECT query, count FROM queries ORDER BY count DESC').all() as { query: string; count: number }[];
}

export function incrementQueryCount(query: string, amount: number = 1): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO queries (query, count) VALUES (?, ?)
    ON CONFLICT(query) DO UPDATE SET count = count + ?
  `).run(query, amount, amount);
}

export function batchIncrementCounts(updates: Map<string, number>): void {
  const database = getDb();
  const upsert = database.prepare(`
    INSERT INTO queries (query, count) VALUES (?, ?)
    ON CONFLICT(query) DO UPDATE SET count = count + ?
  `);

  const batchUpdate = database.transaction((entries: [string, number][]) => {
    for (const [query, count] of entries) {
      upsert.run(query, count, count);
    }
  });

  batchUpdate(Array.from(updates.entries()));
}

// Trending bucket operations
export function recordTrendingHit(query: string, bucketHour: string): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO trending_buckets (query, bucket_hour, count) VALUES (?, ?, 1)
    ON CONFLICT(query, bucket_hour) DO UPDATE SET count = count + 1
  `).run(query, bucketHour);
}

export function batchRecordTrendingHits(hits: Map<string, Map<string, number>>): void {
  const database = getDb();
  const upsert = database.prepare(`
    INSERT INTO trending_buckets (query, bucket_hour, count) VALUES (?, ?, ?)
    ON CONFLICT(query, bucket_hour) DO UPDATE SET count = count + ?
  `);

  const batchInsert = database.transaction((entries: [string, string, number][]) => {
    for (const [query, bucket, count] of entries) {
      upsert.run(query, bucket, count, count);
    }
  });

  const flat: [string, string, number][] = [];
  for (const [query, buckets] of hits) {
    for (const [bucket, count] of buckets) {
      flat.push([query, bucket, count]);
    }
  }
  batchInsert(flat);
}

export function getTrendingBuckets(hoursAgo: number = 48): { query: string; bucket_hour: string; count: number }[] {
  const database = getDb();
  const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"

  return database.prepare(`
    SELECT query, bucket_hour, count
    FROM trending_buckets
    WHERE bucket_hour >= ?
    ORDER BY bucket_hour DESC
  `).all(cutoffStr) as { query: string; bucket_hour: string; count: number }[];
}

export function cleanOldBuckets(hoursToKeep: number = 48): void {
  const database = getDb();
  const cutoff = new Date(Date.now() - hoursToKeep * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 13);
  database.prepare('DELETE FROM trending_buckets WHERE bucket_hour < ?').run(cutoffStr);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
