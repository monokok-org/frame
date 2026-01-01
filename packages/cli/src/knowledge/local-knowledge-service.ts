/**
 * Local Knowledge Service
 *
 * Main service that coordinates cache, web search, and answer extraction.
 * Provides just-in-time knowledge retrieval for agents.
 */

import { KnowledgeCache, type CacheEntry } from './cache.js';
import { WebSearchClient } from './web-search.js';
import { FramebaseClient, type FramebaseFrame } from './framebase.js';
import { AnswerExtractor, type ExtractedAnswer, type LLMClient } from './answer-extractor.js';
import {
  parseTechStack,
  normalizeSource,
  isKnownSource,
  detectSourceFromQuery,
  extractVersionFromQuery,
  normalizeVersion,
} from './tech-stack.js';
import { logger } from '../utils/logger.js';

export interface KnowledgeQuery {
  query: string;
  category: 'best-practice' | 'tool-comparison' | 'deprecated-check' | 'current-standard';
  tech_stack?: string;
  source?: string;
  version?: string;
  versionRange?: string;
  filters?: string[];
  limit?: number;
  allowWebFallback?: boolean;
}

export interface KnowledgeAnswer extends ExtractedAnswer {
  sources: string[];
  cached: boolean;
  fresh: boolean;
  provider: 'framebase' | 'web';
  frames?: FramebaseFrame[];
  filters?: string[];
}

export interface KnowledgeServiceConfig {
  cachePath?: string;
  cacheTTLDays?: number;
  similarityThreshold?: number;
  framebaseUrl?: string;
  framebaseTimeoutMs?: number;
  framebaseDefaultLimit?: number;
  framebaseMaxFrameChars?: number;
  framebaseEnabled?: boolean;
}

const DEFAULT_TTL_DAYS: Record<string, number> = {
  'best-practice': 30,
  'tool-comparison': 14,
  'deprecated-check': 7,
  'current-standard': 30,
};

export class LocalKnowledgeService {
  private cache: KnowledgeCache;
  private webSearch: WebSearchClient;
  private framebase: FramebaseClient;
  private extractor: AnswerExtractor;
  private config: Required<KnowledgeServiceConfig>;
  private initialized = false;

  constructor(
    llm: LLMClient,
    embedder: { embed(text: string): Promise<number[]> },
    config: KnowledgeServiceConfig = {}
  ) {
    this.config = {
      cachePath: config.cachePath || undefined!,
      cacheTTLDays: config.cacheTTLDays || 30,
      similarityThreshold: config.similarityThreshold || 0.8,
      framebaseUrl: config.framebaseUrl || undefined!,
      framebaseTimeoutMs: config.framebaseTimeoutMs || 3000,
      framebaseDefaultLimit: config.framebaseDefaultLimit || 5,
      framebaseMaxFrameChars: config.framebaseMaxFrameChars || 3000,
      framebaseEnabled: config.framebaseEnabled ?? true,
    };

    this.cache = new KnowledgeCache(this.config.cachePath);
    this.webSearch = new WebSearchClient();
    this.framebase = new FramebaseClient({
      baseUrl: this.config.framebaseUrl,
      timeoutMs: this.config.framebaseTimeoutMs,
      defaultLimit: this.config.framebaseDefaultLimit,
      maxFrameChars: this.config.framebaseMaxFrameChars,
      enabled: this.config.framebaseEnabled,
    });
    this.extractor = new AnswerExtractor(llm);
    this.embedder = embedder;
  }

  private embedder: { embed(text: string): Promise<number[]> };

  /**
   * Initialize the service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.cache.initialize();
    this.initialized = true;

    logger.info('[KnowledgeService] Initialized');
  }

  /**
   * Query knowledge service
   */
  async query(params: KnowledgeQuery): Promise<KnowledgeAnswer> {
    if (!this.initialized) {
      await this.initialize();
    }

    const { query, category, tech_stack } = params;
    const allowWebFallback = params.allowWebFallback !== false;

    logger.info(`[KnowledgeService] Query: "${query}" (${category})`);

    const resolved = this.resolveFramebaseParams(params);
    const cacheQuery = resolved.cacheQuery;
    const cacheTechStack = resolved.tech_stack || tech_stack;

    let cacheEnabled = this.cache.isEnabled();
    let queryEmbedding: number[] | null = null;
    let cachedResults: CacheEntry[] = [];

    if (cacheEnabled) {
      try {
        queryEmbedding = await this.embedder.embed(cacheQuery);
        cachedResults = await this.cache.search(queryEmbedding, {
          threshold: this.config.similarityThreshold,
          limit: 1,
          category,
          tech_stack: cacheTechStack,
        });
      } catch (error) {
        cacheEnabled = false;
        logger.warn(`[KnowledgeService] Cache disabled for this query: ${error}`);
      }
    }

    if (cachedResults.length > 0) {
      const cached = cachedResults[0];
      const cachedProvider = cached.answer?.provider === 'framebase' ? 'framebase' : 'web';

      if (!allowWebFallback && cachedProvider === 'web') {
        logger.debug('[KnowledgeService] Skipping cached web answer (Framebase-only mode)');
      } else {
        // Check if cached answer is stale
        const isStale = this.isStale(cached, category);

        if (!isStale) {
          logger.info(`[KnowledgeService] Cache hit (similarity: ${cached.similarity?.toFixed(3)})`);

          // Update access time
          this.cache.updateAccess(cached.id!);

          return {
            ...cached.answer,
            sources: cached.sources,
            cached: true,
            fresh: true,
            provider: cachedProvider,
          };
        } else {
          logger.debug('[KnowledgeService] Cached answer is stale, refreshing...');
        }
      }
    }

    // 2. Cache miss or stale - try Framebase first
    if (this.framebase.isEnabled) {
      try {
        logger.info('[KnowledgeService] Cache miss, querying Framebase...');

        const framebaseResult = await this.framebase.query({
          q: query,
          filters: resolved.filters,
          versionRange: resolved.versionRange,
          limit: params.limit,
        });

        if (framebaseResult.frames.length > 0) {
          const summary = this.summarizeFrames(framebaseResult.frames);
          const answer = {
            current_method: summary,
            deprecated: [],
            rationale: 'Retrieved from Framebase',
            confidence: 0.85,
            provider: 'framebase' as const,
            frames: framebaseResult.frames,
            filters: resolved.filters,
          };

          const sources = [this.framebase.baseUrl];

          if (cacheEnabled && queryEmbedding) {
            await this.cache.store({
              query: cacheQuery,
              query_embedding: queryEmbedding,
              answer,
              category,
              tech_stack: cacheTechStack,
              sources,
              cached_at: Date.now(),
              accessed_at: Date.now(),
              access_count: 1,
            });
          }

          logger.info('[KnowledgeService] Framebase answer cached');

          return {
            ...answer,
            sources,
            cached: false,
            fresh: true,
          };
        }
        if (!allowWebFallback) {
          return {
            current_method: 'No Framebase frames found.',
            deprecated: [],
            rationale: 'Framebase query returned no frames.',
            confidence: 0.1,
            sources: [this.framebase.baseUrl],
            cached: false,
            fresh: true,
            provider: 'framebase',
            frames: [],
            filters: resolved.filters,
          };
        }
      } catch (error) {
        logger.warn(`[KnowledgeService] Framebase query failed: ${error}`);
        if (!allowWebFallback) {
          return {
            current_method: 'Framebase query failed.',
            deprecated: [],
            rationale: 'Framebase request failed in Framebase-only mode.',
            confidence: 0.1,
            sources: [this.framebase.baseUrl],
            cached: false,
            fresh: true,
            provider: 'framebase',
            frames: [],
            filters: resolved.filters,
          };
        }
      }
    }

    if (!allowWebFallback) {
      return {
        current_method: 'Framebase is disabled.',
        deprecated: [],
        rationale: 'Framebase-only mode without an enabled Framebase client.',
        confidence: 0.1,
        sources: [],
        cached: false,
        fresh: true,
        provider: 'framebase',
        frames: [],
        filters: resolved.filters,
      };
    }

    // 3. Cache miss or stale - perform web search
    logger.info('[KnowledgeService] Cache miss, searching web...');

    const searchQuery = this.webSearch.buildTechnicalQuery(query, {
      category,
      tech_stack: resolved.source || tech_stack,
    });

    const searchResults = await this.webSearch.search(searchQuery, {
      maxResults: 10,
    });

    if (searchResults.length === 0) {
      logger.warn('[KnowledgeService] No search results found');
      throw new Error('No search results found');
    }

    // 3. Extract answer from search results
    const extractedAnswer = await this.extractor.extract(query, searchResults, {
      category,
      tech_stack,
    });

    // 4. Cache the answer
    const sources = searchResults.slice(0, 5).map(r => r.url);

    if (cacheEnabled && queryEmbedding) {
      await this.cache.store({
        query: cacheQuery,
        query_embedding: queryEmbedding,
        answer: {
          ...extractedAnswer,
          provider: 'web',
          filters: resolved.filters,
        },
        category,
        tech_stack: cacheTechStack,
        sources,
        cached_at: Date.now(),
        accessed_at: Date.now(),
        access_count: 1,
      });
    }

    logger.info('[KnowledgeService] Answer extracted and cached');

    return {
      current_method: extractedAnswer.current_method,
      deprecated: extractedAnswer.deprecated,
      rationale: extractedAnswer.rationale,
      confidence: extractedAnswer.confidence,
      sources,
      cached: false,
      fresh: true,
      provider: 'web',
      filters: resolved.filters,
    };
  }

  /**
   * Check if cached entry is stale based on TTL
   */
  private isStale(entry: CacheEntry, category: string): boolean {
    const ttlDays = DEFAULT_TTL_DAYS[category] || this.config.cacheTTLDays;
    const ttlMs = ttlDays * 24 * 60 * 60 * 1000;
    const age = Date.now() - entry.cached_at;

    return age > ttlMs;
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Clear old cache entries
   */
  clearOld(days?: number): number {
    return this.cache.clearOld(days || this.config.cacheTTLDays);
  }

  /**
   * Clear all cache
   */
  clearAll(): void {
    this.cache.clearAll();
  }

  /**
   * Close the service
   */
  close(): void {
    this.cache.close();
  }

  private resolveFramebaseParams(params: KnowledgeQuery): {
    source?: string;
    version?: string;
    versionRange?: string;
    filters: string[];
    cacheQuery: string;
    tech_stack?: string;
  } {
    const parsedTech = parseTechStack(params.tech_stack);
    const explicitSource = params.source ? normalizeSource(params.source) : undefined;
    const derivedSource = normalizeSource(parsedTech.source || detectSourceFromQuery(params.query));
    const source = explicitSource || (derivedSource && isKnownSource(derivedSource) ? derivedSource : undefined);

    const versionRange = params.versionRange?.trim() || undefined;
    const explicitVersion = params.version || (!versionRange ? parsedTech.version : undefined);
    const inferredVersion = versionRange ? undefined : extractVersionFromQuery(params.query, source);
    const version = normalizeVersion(explicitVersion || inferredVersion, source);

    const filters = this.buildFilters(params.filters, source, version, versionRange);
    const cacheParts = [params.query];
    if (filters.length > 0) {
      cacheParts.push(...filters);
    }
    if (versionRange) {
      cacheParts.push(`versionRange = "${versionRange}"`);
    }
    const cacheQuery = cacheParts.join(' | ');
    const techStack = source
      ? versionRange
        ? `${source}@${versionRange}`
        : version
          ? `${source}@${version}`
          : source
      : params.tech_stack;

    return {
      source,
      version,
      versionRange,
      filters,
      cacheQuery,
      tech_stack: techStack,
    };
  }

  private buildFilters(
    filters: string[] | undefined,
    source?: string,
    version?: string,
    versionRange?: string
  ): string[] {
    const result = new Set<string>();
    if (source) {
      result.add(`source = "${source}"`);
    }
    if (version && !versionRange) {
      result.add(`version = "${version}"`);
    }
    if (filters) {
      filters.filter(Boolean).forEach((filter) => result.add(filter));
    }
    return Array.from(result);
  }

  private summarizeFrames(frames: FramebaseFrame[]): string {
    const context = typeof frames[0]?.context === 'string' ? frames[0].context.trim() : '';
    if (!context) {
      return 'Framebase returned context frames.';
    }
    if (context.length <= 240) {
      return context;
    }
    return `${context.slice(0, 240)}...`;
  }
}
