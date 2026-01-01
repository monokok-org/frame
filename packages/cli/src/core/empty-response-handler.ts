/**
 * Empty Response Handler
 *
 * Handles cases where LLM returns empty responses (no content, no tool calls).
 * Implements multiple recovery strategies:
 * 1. Context reduction (if token limit exceeded)
 * 2. Simplified system prompt
 * 3. Message history truncation
 * 4. Fallback to basic exploration tools
 * 5. Emergency mode (force completion)
 */

import type { ChatMessage } from '../llm/unified-client.js';
import { logger } from '../utils/logger.js';
import { getDebugLogger } from '../utils/debug-logger.js';
import {
  EMERGENCY_SYSTEM_PROMPT,
  MINIMAL_SYSTEM_PROMPT,
  SIMPLIFIED_SYSTEM_PROMPT,
} from '../context/prompts/empty-response.js';

export interface EmptyResponseContext {
  consecutiveEmptyCount: number;
  totalTurns: number;
  messageCount: number;
  estimatedTokens: number;
  lastError?: string;
}

export interface RetryStrategy {
  name: string;
  maxRetries: number;
  apply: (messages: ChatMessage[], ctx: EmptyResponseContext) => ChatMessage[];
}

/**
 * Diagnose why we got an empty response
 */
export function diagnoseEmptyResponse(
  messages: ChatMessage[],
  ctx: EmptyResponseContext
): {
  likelyCause: string;
  recommendedStrategy: string;
  diagnostics: Record<string, any>;
} {
  // Calculate rough token count (4 chars ~ 1 token)
  const totalChars = messages.reduce((sum, msg) => {
    const content = msg.content ?? '';
    const toolCallsStr = msg.tool_calls ? JSON.stringify(msg.tool_calls) : '';
    return sum + content.length + toolCallsStr.length;
  }, 0);
  const estimatedTokens = Math.ceil(totalChars / 4);

  const diagnostics = {
    messageCount: messages.length,
    estimatedTokens,
    consecutiveEmptyCount: ctx.consecutiveEmptyCount,
    totalTurns: ctx.totalTurns,
    lastMessageRole: messages[messages.length - 1]?.role,
    lastMessageLength: messages[messages.length - 1]?.content?.length ?? 0,
    hasToolCalls: messages.some((m) => m.tool_calls && m.tool_calls.length > 0),
  };

  let likelyCause = 'unknown';
  let recommendedStrategy = 'context-reduction';

  // Heuristics for diagnosis
  if (estimatedTokens > 8000) {
    likelyCause = 'context-too-large';
    recommendedStrategy = 'aggressive-truncation';
  } else if (ctx.consecutiveEmptyCount >= 3) {
    likelyCause = 'model-stuck';
    recommendedStrategy = 'emergency-mode';
  } else if (messages.length > 20) {
    likelyCause = 'conversation-too-long';
    recommendedStrategy = 'history-truncation';
  } else if (messages[messages.length - 1]?.role === 'tool') {
    likelyCause = 'tool-result-overload';
    recommendedStrategy = 'simplify-prompt';
  } else if (messages.length <= 3 && estimatedTokens < 1200) {
    likelyCause = 'model-error';
    recommendedStrategy = 'simplify-prompt';
  } else {
    likelyCause = 'model-error';
    recommendedStrategy = 'context-reduction';
  }

  return {
    likelyCause,
    recommendedStrategy,
    diagnostics,
  };
}

/**
 * Strategy 1: Reduce context by removing old tool results
 */
export const contextReductionStrategy: RetryStrategy = {
  name: 'context-reduction',
  maxRetries: 2,
  apply: (messages: ChatMessage[], _ctx: EmptyResponseContext) => {
    logger.info('[EmptyResponseHandler] Applying context-reduction strategy');

    // Keep system message, user query, and recent messages
    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsg = messages.find((m) => m.role === 'user');

    if (!systemMsg || !userMsg) {
      return messages;
    }

    // Keep last 10 messages (last 5 turns roughly)
    const recentMessages = messages.slice(-10);

    return [systemMsg, userMsg, ...recentMessages.filter((m) => m.role !== 'system' && m.role !== 'user')];
  },
};

/**
 * Strategy 2: Aggressive truncation (keep only essentials)
 */
export const aggressiveTruncationStrategy: RetryStrategy = {
  name: 'aggressive-truncation',
  maxRetries: 1,
  apply: (messages: ChatMessage[], _ctx: EmptyResponseContext) => {
    logger.info('[EmptyResponseHandler] Applying aggressive-truncation strategy');

    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsg = messages.find((m) => m.role === 'user');

    if (!systemMsg || !userMsg) {
      return messages;
    }

    // Keep only last 4 messages (last 2 turns)
    const recentMessages = messages.slice(-4);

    // Create minimal system prompt
    const minimalSystem: ChatMessage = {
      role: 'system',
      content: MINIMAL_SYSTEM_PROMPT,
    };

    return [minimalSystem, userMsg, ...recentMessages.filter((m) => m.role !== 'system' && m.role !== 'user')];
  },
};

/**
 * Strategy 3: Simplify system prompt
 */
export const simplifyPromptStrategy: RetryStrategy = {
  name: 'simplify-prompt',
  maxRetries: 1,
  apply: (messages: ChatMessage[], _ctx: EmptyResponseContext) => {
    logger.info('[EmptyResponseHandler] Applying simplify-prompt strategy');

    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsg = messages.find((m) => m.role === 'user');

    if (!systemMsg || !userMsg) {
      return messages;
    }

    // Simplified system prompt (remove execution plan, reduce verbosity)
    const simplifiedSystem: ChatMessage = {
      role: 'system',
      content: SIMPLIFIED_SYSTEM_PROMPT,
    };

    // Keep last 8 messages
    const recentMessages = messages.slice(-8);

    return [simplifiedSystem, userMsg, ...recentMessages.filter((m) => m.role !== 'system' && m.role !== 'user')];
  },
};

/**
 * Strategy 4: History truncation (remove middle turns)
 */
export const historyTruncationStrategy: RetryStrategy = {
  name: 'history-truncation',
  maxRetries: 1,
  apply: (messages: ChatMessage[], _ctx: EmptyResponseContext) => {
    logger.info('[EmptyResponseHandler] Applying history-truncation strategy');

    const systemMsg = messages.find((m) => m.role === 'system');
    const userMsg = messages.find((m) => m.role === 'user');

    if (!systemMsg || !userMsg) {
      return messages;
    }

    // Keep first 2 turns and last 3 turns
    const otherMessages = messages.filter((m) => m.role !== 'system' && m.role !== 'user');
    const firstTurns = otherMessages.slice(0, 4); // First 2 turns (2 assistant + 2 tool)
    const lastTurns = otherMessages.slice(-6); // Last 3 turns (3 assistant + 3 tool)

    const truncatedMessages = [...firstTurns, ...lastTurns];

    // Add summary if we removed messages
    if (otherMessages.length > truncatedMessages.length) {
      const summaryMsg: ChatMessage = {
        role: 'user',
        content: `[Context truncated: ${otherMessages.length - truncatedMessages.length} messages removed to reduce token usage]`,
      };
      return [systemMsg, userMsg, ...firstTurns, summaryMsg, ...lastTurns];
    }

    return [systemMsg, userMsg, ...truncatedMessages];
  },
};

/**
 * Strategy 5: Emergency mode (force simple action)
 */
export const emergencyModeStrategy: RetryStrategy = {
  name: 'emergency-mode',
  maxRetries: 1,
  apply: (messages: ChatMessage[], ctx: EmptyResponseContext) => {
    logger.warn('[EmptyResponseHandler] Applying emergency-mode strategy (last resort)');

    const userMsg = messages.find((m) => m.role === 'user');

    if (!userMsg) {
      return messages;
    }

    // Ultra-minimal prompt to force a response
    const emergencySystem: ChatMessage = {
      role: 'system',
      content: EMERGENCY_SYSTEM_PROMPT,
    };

    const statusMsg: ChatMessage = {
      role: 'user',
      content: `[System: Model has returned ${ctx.consecutiveEmptyCount} consecutive empty responses. Forcing basic action.]`,
    };

    return [emergencySystem, userMsg, statusMsg];
  },
};

/**
 * All available strategies in order of preference
 */
export const ALL_STRATEGIES: RetryStrategy[] = [
  contextReductionStrategy,
  simplifyPromptStrategy,
  historyTruncationStrategy,
  aggressiveTruncationStrategy,
  emergencyModeStrategy,
];

/**
 * Select best strategy based on diagnosis
 */
export function selectStrategy(recommendedStrategy: string): RetryStrategy {
  const strategy = ALL_STRATEGIES.find((s) => s.name === recommendedStrategy);
  return strategy ?? contextReductionStrategy;
}

/**
 * Handle empty response with progressive retry strategies
 */
export function handleEmptyResponse(
  messages: ChatMessage[],
  ctx: EmptyResponseContext
): {
  shouldRetry: boolean;
  modifiedMessages?: ChatMessage[];
  strategy?: RetryStrategy;
  error?: string;
} {
  // Diagnose the issue
  const diagnosis = diagnoseEmptyResponse(messages, ctx);

  // Log to debug file for detailed analysis
  const debugLogger = getDebugLogger();
  debugLogger.logEmptyResponse({
    attemptNumber: ctx.consecutiveEmptyCount,
    strategy: diagnosis.recommendedStrategy,
    diagnostics: diagnosis.diagnostics,
    messagesBeforeRetry: messages.length,
    messagesAfterRetry: 0, // Will be updated below
  });

  logger.warn(`[EmptyResponseHandler] Model returned empty response (attempt ${ctx.consecutiveEmptyCount}/5)`);
  debugLogger.log(`[EmptyResponseHandler] Cause: ${diagnosis.likelyCause.replace(/-/g, ' ')}`);
  debugLogger.log(`[EmptyResponseHandler] Debug log: ${debugLogger.getLogPath()}`);

  // If we've retried too many times, give up
  if (ctx.consecutiveEmptyCount >= 5) {
    logger.error('[EmptyResponseHandler] Max retries exceeded (5), giving up');
    return {
      shouldRetry: false,
      error: `Model returned empty responses ${ctx.consecutiveEmptyCount} times. Possible causes: ${diagnosis.likelyCause}. Try a different model or reduce task complexity.`,
    };
  }

  // Select strategy
  const strategy = selectStrategy(diagnosis.recommendedStrategy);

  logger.info(`[EmptyResponseHandler] Applying strategy: ${strategy.name} (attempt ${ctx.consecutiveEmptyCount}/${strategy.maxRetries})`);

  // Apply strategy
  let modifiedMessages = strategy.apply(messages, ctx);
  let effectiveStrategy = strategy;

  const originalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  let modifiedChars = modifiedMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);

  if (
    strategy.name === 'context-reduction' &&
    modifiedMessages.length === messages.length &&
    modifiedChars === originalChars
  ) {
    logger.info('[EmptyResponseHandler] Context reduction made no change; falling back to simplify-prompt');
    modifiedMessages = simplifyPromptStrategy.apply(messages, ctx);
    effectiveStrategy = simplifyPromptStrategy;
    modifiedChars = modifiedMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  }

  // Log token reduction
  const reduction = ((1 - modifiedChars / originalChars) * 100).toFixed(1);

  logger.info(`[EmptyResponseHandler] Context reduced by ${reduction}% (${originalChars} -> ${modifiedChars} chars)`);
  logger.info(`[EmptyResponseHandler] Messages reduced: ${messages.length} -> ${modifiedMessages.length}`);

  return {
    shouldRetry: true,
    modifiedMessages,
    strategy: effectiveStrategy,
  };
}
