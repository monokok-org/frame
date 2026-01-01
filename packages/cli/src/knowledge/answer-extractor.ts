/**
 * Answer Extractor
 *
 * Uses LLM to extract structured answers from web search results.
 * Focuses on current best practices and deprecation warnings.
 */

import type { SearchResult } from './web-search.js';
import { logger } from '../utils/logger.js';
import { ANSWER_EXTRACTION_SCHEMA } from '../context/prompts/json-schemas.js';
import {
  ANSWER_EXTRACTION_SYSTEM_PROMPT,
  buildAnswerExtractionPrompt,
} from '../context/prompts/answer-extractor.js';

export interface ExtractedAnswer {
  current_method: string;
  deprecated?: string[];
  rationale: string;
  confidence: number;
}

export interface LLMClient {
  chat(
    messages: Array<{ role: string; content: string | null }>,
    options?: { format?: Record<string, unknown> }
  ): Promise<{ content: string | null }>;
}

export class AnswerExtractor {
  constructor(private llm: LLMClient) {}

  /**
   * Extract actionable answer from search results
   */
  async extract(
    query: string,
    searchResults: SearchResult[],
    options: {
      category?: string;
      tech_stack?: string;
    } = {}
  ): Promise<ExtractedAnswer> {
    const { category, tech_stack } = options;

    // Build context from search results
    const context = this.buildContext(searchResults);

    // Build extraction prompt
    const prompt = buildAnswerExtractionPrompt(query, context, category, tech_stack);

    logger.debug(`[AnswerExtractor] Extracting answer for: "${query}"`);

    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: ANSWER_EXTRACTION_SYSTEM_PROMPT
        },
        {
          role: 'user',
          content: prompt
        }
      ], { format: ANSWER_EXTRACTION_SCHEMA });

      const content = response.content || '{}';

      // Parse JSON response (should be valid from structured output)
      const parsed = JSON.parse(content.trim());

      // Validate and structure the answer
      const answer: ExtractedAnswer = {
        current_method: parsed.current_method || parsed.answer || '',
        deprecated: Array.isArray(parsed.deprecated) ? parsed.deprecated : [],
        rationale: parsed.rationale || parsed.reason || '',
        confidence: this.calculateConfidence(parsed, searchResults)
      };

      logger.debug(`[AnswerExtractor] Extracted answer (confidence: ${answer.confidence.toFixed(2)})`);

      return answer;
    } catch (error) {
      logger.error('[AnswerExtractor] Extraction failed:', error);

      // Fallback: return basic answer from first result
      return {
        current_method: searchResults[0]?.snippet || 'No answer found',
        deprecated: [],
        rationale: 'Extracted from search results',
        confidence: 0.3
      };
    }
  }

  /**
   * Build context from search results
   */
  private buildContext(results: SearchResult[]): string {
    return results
      .slice(0, 5) // Top 5 results
      .map((result, i) => {
        return `[Result ${i + 1}] ${result.title}\nURL: ${result.url}\n${result.snippet}`;
      })
      .join('\n\n');
  }

  /**
   * Calculate confidence score based on result consistency
   */
  private calculateConfidence(answer: any, results: SearchResult[]): number {
    let confidence = 0.5; // Base confidence

    // Boost if answer is specific (has commands, version numbers)
    if (answer.current_method?.includes('npm') || answer.current_method?.includes('create')) {
      confidence += 0.2;
    }

    // Boost if multiple results mention similar approach
    if (results.length >= 3) {
      confidence += 0.1;
    }

    // Boost if recent year is mentioned
    const currentYear = new Date().getFullYear();
    if (answer.current_method?.includes(currentYear.toString())) {
      confidence += 0.1;
    }

    // Boost if deprecation info is provided
    if (answer.deprecated && answer.deprecated.length > 0) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }
}
