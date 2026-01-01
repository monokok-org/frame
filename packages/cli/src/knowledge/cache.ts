/**
 * Local Knowledge Cache
 *
 * SQLite-based cache with semantic search capabilities.
 * Stores query-answer pairs with embeddings for similarity matching.
 */

import Database from 'better-sqlite3';
import { mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { cosineSimilarity } from '@homunculus-live/core';
import { logger } from '../utils/logger.js';

export interface CacheEntry {
  id?: number;
  query: string;
  query_embedding: number[];
  answer: any;
  category: string;
  tech_stack?: string;
  sources: string[];
  cached_at: number;
  accessed_at: number;
  access_count: number;
  similarity?: number;
}

export interface CacheSearchOptions {
  threshold?: number;
  limit?: number;
  category?: string;
  tech_stack?: string;
}

export class KnowledgeCache {
  private db!: Database.Database;
  private cachePath: string;
  private enabled = false;

  constructor(cachePath?: string) {
    this.cachePath = cachePath || join(homedir(), '.frame', 'knowledge', 'cache.db');
  }

  async initialize(): Promise<void> {
    // Ensure directory exists
    await mkdir(dirname(this.cachePath), { recursive: true });

    // Open database
    try {
      this.db = new Database(this.cachePath);
    } catch (error) {
      this.enabled = false;
      logger.warn(`[KnowledgeCache] Disabled (failed to open DB): ${error}`);
      return;
    }

    // Enable WAL mode for better concurrent access
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        query_embedding TEXT NOT NULL,  -- JSON array
        answer TEXT NOT NULL,           -- JSON object
        category TEXT NOT NULL,
        tech_stack TEXT,
        sources TEXT NOT NULL,          -- JSON array
        cached_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        access_count INTEGER DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_category ON cache(category);
      CREATE INDEX IF NOT EXISTS idx_tech_stack ON cache(tech_stack);
      CREATE INDEX IF NOT EXISTS idx_cached_at ON cache(cached_at);
    `);

    this.enabled = true;
    logger.debug(`[KnowledgeCache] Initialized at ${this.cachePath}`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Search cache using semantic similarity
   */
  async search(
    queryEmbedding: number[],
    options: CacheSearchOptions = {}
  ): Promise<CacheEntry[]> {
    if (!this.enabled) {
      return [];
    }
    const {
      threshold = 0.8,
      limit = 5,
      category,
      tech_stack
    } = options;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: any[] = [];

    if (category) {
      conditions.push('category = ?');
      params.push(category);
    }

    if (tech_stack) {
      conditions.push('tech_stack = ?');
      params.push(tech_stack);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Get all potentially matching entries
    const stmt = this.db.prepare(`
      SELECT * FROM cache
      ${whereClause}
      ORDER BY accessed_at DESC
      LIMIT 100
    `);

    const rows = stmt.all(...params) as any[];

    // Calculate similarity scores
    const results = rows
      .map(row => {
        const embedding = JSON.parse(row.query_embedding);
        const similarity = cosineSimilarity(queryEmbedding, embedding);

        return {
          ...row,
          query_embedding: embedding,
          answer: JSON.parse(row.answer),
          sources: JSON.parse(row.sources),
          similarity
        };
      })
      .filter(entry => entry.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    if (results.length > 0) {
      logger.debug(`[KnowledgeCache] Found ${results.length} similar entries (best: ${results[0].similarity.toFixed(3)})`);
    }

    return results;
  }

  /**
   * Store a new cache entry
   */
  async store(entry: CacheEntry): Promise<void> {
    if (!this.enabled) {
      return;
    }
    const stmt = this.db.prepare(`
      INSERT INTO cache (
        query, query_embedding, answer, category, tech_stack,
        sources, cached_at, accessed_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.query,
      JSON.stringify(entry.query_embedding),
      JSON.stringify(entry.answer),
      entry.category,
      entry.tech_stack || null,
      JSON.stringify(entry.sources),
      entry.cached_at,
      entry.accessed_at,
      entry.access_count
    );

    logger.debug(`[KnowledgeCache] Stored: "${entry.query}" (${entry.category})`);
  }

  /**
   * Update access timestamp and count
   */
  updateAccess(id: number): void {
    if (!this.enabled) {
      return;
    }
    const stmt = this.db.prepare(`
      UPDATE cache
      SET accessed_at = ?, access_count = access_count + 1
      WHERE id = ?
    `);

    stmt.run(Date.now(), id);
  }

  /**
   * Get cache statistics
   */
  getStats(): { total: number; by_category: Record<string, number> } {
    if (!this.enabled) {
      return { total: 0, by_category: {} };
    }
    const total = this.db.prepare('SELECT COUNT(*) as count FROM cache').get() as { count: number };

    const byCategory = this.db.prepare(`
      SELECT category, COUNT(*) as count
      FROM cache
      GROUP BY category
    `).all() as Array<{ category: string; count: number }>;

    return {
      total: total.count,
      by_category: Object.fromEntries(byCategory.map(c => [c.category, c.count]))
    };
  }

  /**
   * Clear old entries (older than days)
   */
  clearOld(days: number): number {
    if (!this.enabled) {
      return 0;
    }
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);

    const stmt = this.db.prepare('DELETE FROM cache WHERE cached_at < ?');
    const result = stmt.run(cutoff);

    logger.info(`[KnowledgeCache] Cleared ${result.changes} entries older than ${days} days`);
    return result.changes;
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    if (!this.enabled) {
      return;
    }
    this.db.prepare('DELETE FROM cache').run();
    logger.info('[KnowledgeCache] Cleared all entries');
  }

  close(): void {
    if (!this.enabled) {
      return;
    }
    this.db.close();
  }
}
