/**
 * LearnedFrameStore - SQLite storage for LearnedFrames
 *
 * Wraps WorkspaceDB and provides high-level operations for LearnedFrames
 */

import { WorkspaceDB, LearnedPattern } from './workspace-db.js';
import {
  LearnedFrame,
  FrameSearchQuery,
  FrameSearchResult,
  Prerequisite,
  VerificationCheck,
} from '../types/learned-frames.js';
import { logger } from '../utils/logger.js';

export class LearnedFrameStore {
  constructor(private db: WorkspaceDB) {}

  /**
   * Search for matching frames based on query and context
   */
  async search(query: FrameSearchQuery): Promise<FrameSearchResult[]> {
    const { query: searchQuery, context = [], category, threshold = 0.5 } = query;

    // Get all patterns matching category and confidence threshold
    const patterns = this.db.searchPatterns({
      category,
      minConfidence: threshold,
      limit: 10,
    });

    // Convert to LearnedFrames and calculate relevance scores
    const results: FrameSearchResult[] = [];

    for (const pattern of patterns) {
      const frame = this.patternToFrame(pattern);
      const score = this.calculateRelevance(frame, searchQuery, context);

      if (score >= threshold) {
        const matchedKeywords = this.getMatchedKeywords(frame, searchQuery);
        results.push({ frame, score, matchedKeywords });
      }
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    logger.debug(
      `[LearnedFrameStore] Found ${results.length} matching frames for query: ${searchQuery}`
    );

    return results;
  }

  /**
   * Store a new frame or update existing
   */
  async store(frame: LearnedFrame): Promise<void> {
    const pattern = this.frameToPattern(frame);
    this.db.storePattern(pattern);

    logger.info(`[LearnedFrameStore] Stored frame: ${frame.id}`);
  }

  /**
   * Get a specific frame by ID
   */
  async get(id: string): Promise<LearnedFrame | null> {
    const pattern = this.db.getPattern(id);
    return pattern ? this.patternToFrame(pattern) : null;
  }

  /**
   * Update frame confidence after successful execution
   */
  async updateSuccess(frameId: string): Promise<void> {
    this.db.updatePatternSuccess(frameId);
    logger.debug(`[LearnedFrameStore] Updated success for frame: ${frameId}`);
  }

  /**
   * Update frame confidence after failed execution
   */
  async updateFailure(frameId: string): Promise<void> {
    this.db.updatePatternFailure(frameId);
    logger.debug(`[LearnedFrameStore] Updated failure for frame: ${frameId}`);
  }

  /**
   * Add a new prerequisite learned from failure
   */
  async addPrerequisite(frameId: string, prereq: Prerequisite): Promise<void> {
    const frame = await this.get(frameId);
    if (!frame) {
      logger.warn(`[LearnedFrameStore] Frame not found: ${frameId}`);
      return;
    }

    // Add prerequisite
    frame.prerequisites.push(prereq);

    // Store updated frame
    await this.store(frame);

    logger.info(
      `[LearnedFrameStore] Added prerequisite to frame ${frameId}: ${prereq.description}`
    );
  }

  /**
   * Add a verification check learned from failure
   */
  async addVerificationCheck(
    frameId: string,
    check: VerificationCheck
  ): Promise<void> {
    const frame = await this.get(frameId);
    if (!frame) {
      logger.warn(`[LearnedFrameStore] Frame not found: ${frameId}`);
      return;
    }

    // Add verification check
    frame.verification.checks.push(check);

    // Store updated frame
    await this.store(frame);

    logger.info(
      `[LearnedFrameStore] Added verification check to frame ${frameId}: ${check.expectation}`
    );
  }

  // ============================================================
  // PRIVATE: Conversion between LearnedFrame and LearnedPattern
  // ============================================================

  private frameToPattern(frame: LearnedFrame): LearnedPattern {
    return {
      id: frame.id,
      category: frame.category,
      keywords: JSON.stringify(frame.triggers.keywords),
      context_tags: JSON.stringify(frame.triggers.context),
      prerequisites: JSON.stringify(frame.prerequisites),
      verification: JSON.stringify(frame.verification),
      confidence: frame.confidence,
      applied_count: frame.appliedCount,
      success_count: Math.floor(frame.appliedCount * frame.confidence), // Estimate
      created_at: frame.createdAt,
      last_success: frame.lastSuccess,
      pattern_embedding: undefined, // TODO: Add embeddings later
    };
  }

  private patternToFrame(pattern: LearnedPattern): LearnedFrame {
    return {
      id: pattern.id,
      category: pattern.category as any,
      triggers: {
        keywords: JSON.parse(pattern.keywords),
        context: JSON.parse(pattern.context_tags),
      },
      prerequisites: JSON.parse(pattern.prerequisites),
      verification: JSON.parse(pattern.verification),
      confidence: pattern.confidence,
      appliedCount: pattern.applied_count,
      lastSuccess: pattern.last_success,
      createdAt: pattern.created_at,
    };
  }

  // ============================================================
  // PRIVATE: Relevance scoring
  // ============================================================

  private calculateRelevance(
    frame: LearnedFrame,
    query: string,
    context: string[]
  ): number {
    const queryLower = query.toLowerCase();
    let score = 0;

    // Keyword matching (50% weight)
    const keywordMatches = frame.triggers.keywords.filter((kw) =>
      queryLower.includes(kw.toLowerCase())
    );
    const keywordScore = keywordMatches.length / frame.triggers.keywords.length;
    score += keywordScore * 0.5;

    // Context matching (30% weight)
    if (frame.triggers.context.length > 0) {
      const contextMatches = frame.triggers.context.filter((ctx) =>
        context.some((c) => c.toLowerCase().includes(ctx.toLowerCase()))
      );
      const contextScore = contextMatches.length / frame.triggers.context.length;
      score += contextScore * 0.3;
    } else {
      // No context requirement = always match
      score += 0.3;
    }

    // Confidence (20% weight)
    score += frame.confidence * 0.2;

    return score;
  }

  private getMatchedKeywords(frame: LearnedFrame, query: string): string[] {
    const queryLower = query.toLowerCase();
    return frame.triggers.keywords.filter((kw) =>
      queryLower.includes(kw.toLowerCase())
    );
  }
}
