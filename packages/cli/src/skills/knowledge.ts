/**
 * Knowledge Skills
 *
 * Motor skills for querying the local knowledge service.
 */

import type { MotorSkill } from '@homunculus-live/core';
import { LocalKnowledgeService, type KnowledgeQuery } from '../knowledge/index.js';
import type { FramebaseFrame } from '../knowledge/framebase.js';
import { getOllamaClient } from '../llm/index.js';
import { logger } from '../utils/logger.js';

// Singleton knowledge service instance
let knowledgeService: LocalKnowledgeService | null = null;

function getKnowledgeService(): LocalKnowledgeService {
  if (!knowledgeService) {
    const llm = getOllamaClient();
    knowledgeService = new LocalKnowledgeService(
      { chat: llm.chat.bind(llm) },
      { embed: llm.embed.bind(llm) }
    );
  }
  return knowledgeService;
}

/**
 * knowledge-query: Query the knowledge service for current best practices
 */
function trimFrames(frames: FramebaseFrame[], maxFrames = 2, maxChars = 1200) {
  return frames.slice(0, maxFrames).map((frame) => {
    const context = typeof frame.context === 'string' ? frame.context : '';
    if (context.length <= maxChars) {
      return frame;
    }
    return { ...frame, context: `${context.slice(0, maxChars)}...` };
  });
}

export const knowledgeQuerySkill: MotorSkill = {
  id: 'knowledge-query',
  name: 'Knowledge Query',

  description: `Query the knowledge service (Framebase + cache) for current best practices, modern tools, and up-to-date information.

Use this skill when you need to:
- Verify if a tool/framework is current or deprecated
- Learn the modern way to do something (e.g., "how to scaffold react app 2024")
- Compare tools or approaches
- Check current standards for a technology

This skill queries Framebase first, then falls back to web search, and caches results locally.
Include exact versions (node 20, pytest 7.4.2, cuda 12) when relevant.

IMPORTANT: Always use this BEFORE using potentially outdated tools or methods.`,

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you need to know. Be specific. Examples: "how to create react app", "modern nodejs testing framework", "is create-react-app deprecated"'
      },
      category: {
        type: 'string',
        enum: ['best-practice', 'tool-comparison', 'deprecated-check', 'current-standard'],
        description: 'Type of knowledge needed. best-practice: how to do something; tool-comparison: compare options; deprecated-check: verify if something is outdated; current-standard: what is standard now'
      },
      tech_stack: {
        type: 'string',
        description: 'Technology context (e.g., "react", "nodejs", "python", "typescript"). Helps provide more relevant results.'
      },
      source: {
        type: 'string',
        description: 'Optional Framebase source override (e.g., "node", "pytest", "cuda").'
      },
      version: {
        type: 'string',
        description: 'Optional version string for Framebase filters (e.g., "20", "v20.10.0", "7.4.2").'
      },
      versionRange: {
        type: 'string',
        description: 'Optional version range for Framebase queries (e.g., ">=20 <21").'
      },
      filters: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional raw Framebase filters (e.g., "source = \\"node\\"", "version = \\"v20.10.0\\"").'
      },
      limit: {
        type: 'number',
        description: 'Optional Framebase result limit.'
      },
      allowWebFallback: {
        type: 'boolean',
        description: 'When false, only use Framebase and skip web search fallback.'
      }
    },
    required: ['query', 'category']
  } as MotorSkill['parameters'],

  async execute(args: KnowledgeQuery) {
    const { query, category, tech_stack, source, version, versionRange, filters, limit, allowWebFallback } = args;

    logger.info(`[knowledge-query] Querying: "${query}" (${category})`);

    try {
      const service = getKnowledgeService();
      const answer = await service.query({
        query,
        category,
        tech_stack,
        source,
        version,
        versionRange,
        filters,
        limit,
        allowWebFallback,
      });

      const trimmedFrames = answer.frames ? trimFrames(answer.frames) : undefined;

      // Format response for agent consumption
      const response = {
        current_method: answer.current_method,
        deprecated: answer.deprecated,
        rationale: answer.rationale,
        confidence: answer.confidence,
        sources: answer.sources.slice(0, 3), // Top 3 sources
        cached: answer.cached,
        provider: answer.provider,
        filters: answer.filters,
        frames: trimmedFrames
      };

      logger.info(`[knowledge-query] Answer found (confidence: ${answer.confidence.toFixed(2)}, cached: ${answer.cached})`);

      return JSON.stringify(response, null, 2);
    } catch (error) {
      logger.error('[knowledge-query] Query failed:', error);
      return JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
        current_method: 'Unable to retrieve answer',
        deprecated: [],
        rationale: 'Knowledge query failed',
        confidence: 0,
        provider: 'web'
      }, null, 2);
    }
  }
};
