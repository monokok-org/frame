/**
 * Tests for Empty Response Handler
 */

import { describe, it, expect } from 'vitest';
import {
  diagnoseEmptyResponse,
  handleEmptyResponse,
  contextReductionStrategy,
  aggressiveTruncationStrategy,
  simplifyPromptStrategy,
  historyTruncationStrategy,
  emergencyModeStrategy,
  type EmptyResponseContext,
} from './empty-response-handler.js';
import type { ChatMessage } from '../llm/unified-client.js';

describe('Empty Response Handler', () => {
  describe('diagnoseEmptyResponse', () => {
    it('should diagnose context-too-large when estimated tokens > 8000', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'x'.repeat(20000) },
        { role: 'user', content: 'x'.repeat(20000) },
      ];

      const ctx: EmptyResponseContext = {
        consecutiveEmptyCount: 1,
        totalTurns: 10,
        messageCount: messages.length,
        estimatedTokens: 10000,
      };

      const result = diagnoseEmptyResponse(messages, ctx);

      expect(result.likelyCause).toBe('context-too-large');
      expect(result.recommendedStrategy).toBe('aggressive-truncation');
    });

    it('should diagnose model-stuck when consecutive empty count >= 3', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'test' },
      ];

      const ctx: EmptyResponseContext = {
        consecutiveEmptyCount: 3,
        totalTurns: 10,
        messageCount: messages.length,
        estimatedTokens: 1000,
      };

      const result = diagnoseEmptyResponse(messages, ctx);

      expect(result.likelyCause).toBe('model-stuck');
      expect(result.recommendedStrategy).toBe('emergency-mode');
    });

    it('should diagnose conversation-too-long when message count > 20', () => {
      const messages: ChatMessage[] = Array.from({ length: 25 }, (_, i) => ({
        role: (i % 2 === 0 ? 'user' : 'assistant') as any,
        content: `message ${i}`,
      }));

      const ctx: EmptyResponseContext = {
        consecutiveEmptyCount: 1,
        totalTurns: 15,
        messageCount: messages.length,
        estimatedTokens: 2000,
      };

      const result = diagnoseEmptyResponse(messages, ctx);

      expect(result.likelyCause).toBe('conversation-too-long');
      expect(result.recommendedStrategy).toBe('history-truncation');
    });

    it('should diagnose tool-result-overload when last message is tool', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'test' },
        { role: 'tool', content: 'result' },
      ];

      const ctx: EmptyResponseContext = {
        consecutiveEmptyCount: 1,
        totalTurns: 5,
        messageCount: messages.length,
        estimatedTokens: 1000,
      };

      const result = diagnoseEmptyResponse(messages, ctx);

      expect(result.likelyCause).toBe('tool-result-overload');
      expect(result.recommendedStrategy).toBe('simplify-prompt');
    });
  });

  describe('Retry Strategies', () => {
    const ctx: EmptyResponseContext = {
      consecutiveEmptyCount: 1,
      totalTurns: 5,
      messageCount: 10,
      estimatedTokens: 2000,
    };

    describe('contextReductionStrategy', () => {
      it('should keep system, user, and last 10 messages', () => {
        const messages: ChatMessage[] = [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user query' },
          ...Array.from({ length: 15 }, (_, i) => ({
            role: (i % 2 === 0 ? 'assistant' : 'tool') as any,
            content: `message ${i}`,
          })),
        ];

        const result = contextReductionStrategy.apply(messages, ctx);

        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result.length).toBe(12); // system + user + 10 recent
      });
    });

    describe('aggressiveTruncationStrategy', () => {
      it('should keep only system, user, and last 4 messages', () => {
        const messages: ChatMessage[] = [
          { role: 'system', content: 'system prompt' },
          { role: 'user', content: 'user query' },
          ...Array.from({ length: 20 }, (_, i) => ({
            role: (i % 2 === 0 ? 'assistant' : 'tool') as any,
            content: `message ${i}`,
          })),
        ];

        const result = aggressiveTruncationStrategy.apply(messages, ctx);

        expect(result[0].role).toBe('system');
        expect(result[0].content).toContain('You are a coding assistant');
        expect(result[1].role).toBe('user');
        expect(result.length).toBe(6); // minimal system + user + 4 recent
      });

      it('should create minimal system prompt', () => {
        const messages: ChatMessage[] = [
          { role: 'system', content: 'long system prompt '.repeat(100) },
          { role: 'user', content: 'user query' },
        ];

        const result = aggressiveTruncationStrategy.apply(messages, ctx);

        const systemMsg = result.find((m) => m.role === 'system');
        expect(systemMsg).toBeDefined();
        expect(systemMsg!.content).toContain('Call at least one tool');
        expect(systemMsg!.content!.length).toBeLessThan(400);
      });
    });

    describe('simplifyPromptStrategy', () => {
      it('should simplify system prompt and keep last 8 messages', () => {
        const messages: ChatMessage[] = [
          { role: 'system', content: 'complex system prompt '.repeat(50) },
          { role: 'user', content: 'user query' },
          ...Array.from({ length: 15 }, (_, i) => ({
            role: (i % 2 === 0 ? 'assistant' : 'tool') as any,
            content: `message ${i}`,
          })),
        ];

        const result = simplifyPromptStrategy.apply(messages, ctx);

        const systemMsg = result.find((m) => m.role === 'system');
        expect(systemMsg).toBeDefined();
        expect(systemMsg!.content).toContain('Rules:');
        expect(result.length).toBe(10); // simplified system + user + 8 recent
      });
    });

    describe('historyTruncationStrategy', () => {
      it('should keep first 2 turns and last 3 turns', () => {
        const messages: ChatMessage[] = [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'user' },
          ...Array.from({ length: 20 }, (_, i) => ({
            role: (i % 2 === 0 ? 'assistant' : 'tool') as any,
            content: `turn ${i}`,
          })),
        ];

        const result = historyTruncationStrategy.apply(messages, ctx);

        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        // Should have first 4 messages (2 turns) + summary + last 6 messages (3 turns)
        expect(result.length).toBeGreaterThan(10);
        expect(result.some((m) => m.content?.includes('Context truncated'))).toBe(true);
      });
    });

    describe('emergencyModeStrategy', () => {
      it('should create ultra-minimal emergency prompt', () => {
        const messages: ChatMessage[] = [
          { role: 'system', content: 'system' },
          { role: 'user', content: 'user query' },
        ];

        const emergencyCtx: EmptyResponseContext = {
          ...ctx,
          consecutiveEmptyCount: 4,
        };

        const result = emergencyModeStrategy.apply(messages, emergencyCtx);

        expect(result.length).toBe(3); // emergency system + user + status
        expect(result[0].content).toContain('EMERGENCY MODE');
        expect(result[2].content).toContain('4 consecutive empty responses');
      });
    });
  });

  describe('handleEmptyResponse', () => {
    it('should return shouldRetry=false when max retries exceeded', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'test' },
      ];

      const ctx: EmptyResponseContext = {
        consecutiveEmptyCount: 5,
        totalTurns: 10,
        messageCount: messages.length,
        estimatedTokens: 1000,
      };

      const result = handleEmptyResponse(messages, ctx);

      expect(result.shouldRetry).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('5 times');
    });

    it('should return modified messages and strategy when retry allowed', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'test' },
        { role: 'user', content: 'test' },
        ...Array.from({ length: 25 }, (_, i) => ({
          role: (i % 2 === 0 ? 'assistant' : 'tool') as any,
          content: `message ${i}`,
        })),
      ];

      const ctx: EmptyResponseContext = {
        consecutiveEmptyCount: 1,
        totalTurns: 10,
        messageCount: messages.length,
        estimatedTokens: 2000,
      };

      const result = handleEmptyResponse(messages, ctx);

      expect(result.shouldRetry).toBe(true);
      expect(result.modifiedMessages).toBeDefined();
      expect(result.strategy).toBeDefined();
      expect(result.modifiedMessages!.length).toBeLessThan(messages.length);
    });

    it('should select appropriate strategy based on diagnosis', () => {
      // Test context-too-large -> aggressive-truncation
      const largeMessages: ChatMessage[] = [
        { role: 'system', content: 'x'.repeat(20000) },
        { role: 'user', content: 'x'.repeat(20000) },
      ];

      const largeCtx: EmptyResponseContext = {
        consecutiveEmptyCount: 1,
        totalTurns: 5,
        messageCount: largeMessages.length,
        estimatedTokens: 10000,
      };

      const result1 = handleEmptyResponse(largeMessages, largeCtx);
      expect(result1.strategy?.name).toBe('aggressive-truncation');

      // Test model-stuck -> emergency-mode
      const stuckCtx: EmptyResponseContext = {
        consecutiveEmptyCount: 3,
        totalTurns: 10,
        messageCount: 5,
        estimatedTokens: 1000,
      };

      const result2 = handleEmptyResponse([{ role: 'system', content: 'x' }], stuckCtx);
      expect(result2.strategy?.name).toBe('emergency-mode');
    });
  });
});
