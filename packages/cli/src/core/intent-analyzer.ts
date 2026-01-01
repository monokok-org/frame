/**
 * Intent Analyzer Integration
 *
 * Uses @homunculus-live/primitives SignalIntentAnalyzer for better intent classification.
 */

import { createSignalIntentAnalyzer } from '@homunculus-live/primitives';
import type { UnifiedLLMClient } from '../llm/unified-client.js';
import { logger } from '../utils/logger.js';

export interface IntentAnalysis {
  actionableGoal: string;
  observations: string;
  context: string;
  keywords: string[];
}

/**
 * Analyze user intent using the SignalIntentAnalyzer primitive
 */
export async function analyzeIntent(
  signal: string,
  llm: UnifiedLLMClient
): Promise<IntentAnalysis> {
  try {
    // Cast to any to make compatible with Homunculus primitives LLMClient interface
    const analyzer = createSignalIntentAnalyzer({ llm: llm as any, debug: false });

    // Create a minimal signal for the analyzer
    const mockSignal = {
      id: 'user-intent',
      thought: signal,
      emittedBy: 'user',
      timestamp: Date.now(),
      pheromone: await llm.embed(signal)
    };

    // Get analysis
    let analysis = '';
    for await (const thought of analyzer.emit(mockSignal)) {
      analysis = thought;
      break; // Take first thought
    }

    // Parse the natural language response
    const parsed = parseIntentResponse(analysis || signal);

    logger.debug('[intent-analyzer] Analyzed: ' + parsed.actionableGoal);

    return parsed;
  } catch (error) {
    logger.warn('[intent-analyzer] Failed, using fallback: ' + String(error));

    // Fallback to simple parsing
    return {
      actionableGoal: signal,
      observations: '',
      context: '',
      keywords: extractKeywords(signal)
    };
  }
}

/**
 * Parse the natural language response from SignalIntentAnalyzer
 */
function parseIntentResponse(analysis: string): IntentAnalysis {
  const keywords = extractKeywords(analysis);

  // Extract structured info from natural language
  let actionableGoal = analysis;
  let observations = '';
  let context = '';

  // Try to extract goal
  const goalMatch = analysis.match(/goal is to ([^.]+)/i);
  if (goalMatch) {
    actionableGoal = goalMatch[1].trim();
  }

  // Try to extract observations
  const obsMatch = analysis.match(/observations?:([^.]+)/i);
  if (obsMatch) {
    observations = obsMatch[1].trim();
  }

  // Try to extract context
  const contextMatch = analysis.match(/context:([^.]+)/i);
  if (contextMatch) {
    context = contextMatch[1].trim();
  }

  return {
    actionableGoal,
    observations,
    context,
    keywords
  };
}

/**
 * Extract keywords from text
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'is', 'are', 'was', 'were']);

  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Return unique keywords
  return Array.from(new Set(words));
}
