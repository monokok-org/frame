/**
 * KnowledgeLearner Sub-Agent
 *
 * Extracts actionable knowledge from errors, deprecations, and successes.
 * Stores insights in workspace.db knowledge_cache for future queries.
 */

import type { WorkspaceDB } from '../db/workspace-db.js';
import type { ToolResult } from '../types/executor.js';
import { logger } from '../utils/logger.js';

export interface ErrorInsight {
  category: 'deprecation' | 'command-syntax' | 'missing-dependency' | 'configuration' | 'other';
  oldMethod?: string;
  newMethod?: string;
  rationale: string;
  sources: string[];
  confidence: number;
}

export class KnowledgeLearner {
  private workspaceDB: WorkspaceDB;
  private readonly deprecationKeywords = [
    'deprecated',
    'deprecation',
    'obsolete',
    'no longer supported',
    'no longer maintained',
    'removed',
    'sunset',
    'end of life',
    'eol',
  ];

  constructor(workspaceDB: WorkspaceDB) {
    this.workspaceDB = workspaceDB;
  }

  /**
   * Learn from an executor error (when LLM refuses to execute a step)
   */
  async learnFromExecutorError(
    executorError: string,
    suggestion: string,
    context: {
      tool: string;
      args: Record<string, any>;
      projectType?: string;
    }
  ): Promise<ErrorInsight | null> {
    // Detect deprecation patterns
    const deprecationMatch = this.detectDeprecation(executorError, suggestion);
    if (deprecationMatch) {
      const oldMethod = deprecationMatch.oldMethod || 'unknown';
      const newMethod = deprecationMatch.newMethod || 'unknown';
      const query = deprecationMatch.technology
        ? `How to use ${deprecationMatch.technology}`
        : 'How to replace deprecated usage';

      logger.info(
        `[KnowledgeLearner] Detected deprecation: ${oldMethod} → ${newMethod}`
      );

      // Store in knowledge cache
      await this.storeKnowledge({
        query,
        category: 'deprecation',
        tech_stack: context.projectType,
        answer: JSON.stringify({
          oldMethod: deprecationMatch.oldMethod,
          newMethod: deprecationMatch.newMethod,
          rationale: deprecationMatch.rationale,
          deprecated: true,
        }),
        sources: deprecationMatch.sources,
        confidence: 0.9, // High confidence from direct error observation
      });

      return {
        category: 'deprecation',
        oldMethod: deprecationMatch.oldMethod,
        newMethod: deprecationMatch.newMethod,
        rationale: deprecationMatch.rationale,
        sources: deprecationMatch.sources,
        confidence: 0.9,
      };
    }

    // Detect command syntax errors
    const syntaxMatch = this.detectCommandSyntax(executorError, suggestion, context);
    if (syntaxMatch) {
      logger.info(`[KnowledgeLearner] Detected command syntax issue: ${syntaxMatch.oldMethod}`);

      await this.storeKnowledge({
        query: `Correct syntax for ${context.tool}`,
        category: 'command-syntax',
        tech_stack: context.projectType,
        answer: JSON.stringify({
          oldMethod: syntaxMatch.oldMethod,
          newMethod: syntaxMatch.newMethod,
          rationale: syntaxMatch.rationale,
        }),
        sources: syntaxMatch.sources,
        confidence: 0.8,
      });

      return {
        category: 'command-syntax',
        oldMethod: syntaxMatch.oldMethod,
        newMethod: syntaxMatch.newMethod,
        rationale: syntaxMatch.rationale,
        sources: syntaxMatch.sources,
        confidence: 0.8,
      };
    }

    return null;
  }

  /**
   * Learn from a tool execution failure
   */
  async learnFromToolFailure(
    tool: string,
    args: Record<string, any>,
    result: ToolResult,
    context: { projectType?: string }
  ): Promise<ErrorInsight | null> {
    if (!result.error) return null;

    // Check for deprecation warnings in stderr/stdout
    if (result.result && typeof result.result === 'object') {
      const execResult = result.result as any;
      const output = `${execResult.stdout || ''}\n${execResult.stderr || ''}`;

      const deprecationMatch = this.detectDeprecationFromOutput(output, tool, args);
      if (deprecationMatch) {
        const oldMethod = deprecationMatch.oldMethod || 'unknown';
        const query = deprecationMatch.technology
          ? `How to use ${deprecationMatch.technology}`
          : 'How to replace deprecated usage';

        logger.info(
          `[KnowledgeLearner] Learned from tool output: ${oldMethod} is deprecated`
        );

        await this.storeKnowledge({
          query,
          category: 'deprecation',
          tech_stack: context.projectType,
          answer: JSON.stringify({
            oldMethod: deprecationMatch.oldMethod,
            newMethod: deprecationMatch.newMethod,
            rationale: deprecationMatch.rationale,
            deprecated: true,
          }),
          sources: ['execution-error'],
          confidence: 0.85,
        });

        return {
          category: 'deprecation',
          oldMethod: deprecationMatch.oldMethod,
          newMethod: deprecationMatch.newMethod,
          rationale: deprecationMatch.rationale,
          sources: ['execution-error'],
          confidence: 0.85,
        };
      }
    }

    return null;
  }

  /**
   * Detect deprecation from executor error message
   */
  private detectDeprecation(
    errorMsg: string,
    suggestion: string
  ): {
    technology?: string;
    oldMethod?: string;
    newMethod?: string;
    rationale: string;
    sources: string[];
  } | null {
    const deprecationLine =
      this.findLineWithKeywords(
        this.getNonEmptyLines(errorMsg),
        this.deprecationKeywords
      ) ||
      this.findLineWithKeywords(
        this.getNonEmptyLines(suggestion),
        this.deprecationKeywords
      );

    if (!deprecationLine) {
      return null;
    }

    const rawOldMethod =
      this.extractDeprecatedSubject(deprecationLine) ||
      this.extractSnippet(errorMsg);
    const rawNewMethod =
      this.extractReplacementHint(suggestion) ||
      this.extractReplacementHint(deprecationLine);
    const oldMethod = this.normalizeOptional(rawOldMethod);
    const newMethod = this.normalizeOptional(rawNewMethod);

    if (!oldMethod && !newMethod) {
      return null;
    }

    return {
      technology: this.inferTechnology(oldMethod, newMethod),
      oldMethod,
      newMethod,
      rationale: 'Deprecated usage detected in executor error',
      sources: ['executor-error'],
    };
  }

  /**
   * Detect command syntax issues
   */
  private detectCommandSyntax(
    _errorMsg: string,
    suggestion: string,
    context: { tool: string; args: Record<string, any> }
  ): {
    oldMethod: string;
    newMethod: string;
    rationale: string;
    sources: string[];
  } | null {
    const currentCommand =
      typeof context.args.command === 'string' ? (context.args.command as string) : null;
    if (!currentCommand) {
      return null;
    }

    const suggestionLower = suggestion.toLowerCase();
    const mentionsCommand =
      suggestionLower.includes('command') ||
      suggestionLower.includes('syntax') ||
      suggestionLower.includes('use ') ||
      suggestionLower.includes('run ');

    if (!mentionsCommand) {
      return null;
    }

    const newCommand =
      this.extractSnippet(suggestion) || this.extractCommandFromLines(suggestion);

    if (!newCommand) {
      return null;
    }

    return {
      oldMethod: currentCommand,
      newMethod: newCommand,
      rationale: 'Corrected command syntax based on error',
      sources: ['executor-suggestion'],
    };
  }

  /**
   * Detect deprecation from command output
   */
  private detectDeprecationFromOutput(
    output: string,
    _tool: string,
    _args: Record<string, any>
  ): {
    technology?: string;
    oldMethod?: string;
    newMethod?: string;
    rationale: string;
  } | null {
    const deprecationLine = this.findLineWithKeywords(
      this.getNonEmptyLines(output),
      this.deprecationKeywords
    );

    if (!deprecationLine) {
      return null;
    }

    const rawOldMethod =
      this.extractDeprecatedSubject(deprecationLine) ||
      this.extractSnippet(output);
    const rawNewMethod =
      this.extractReplacementHint(deprecationLine) ||
      this.extractReplacementHint(output);
    const oldMethod = this.normalizeOptional(rawOldMethod);
    const newMethod = this.normalizeOptional(rawNewMethod);

    if (!oldMethod && !newMethod) {
      return null;
    }

    return {
      technology: this.inferTechnology(oldMethod, newMethod),
      oldMethod,
      newMethod,
      rationale: 'Deprecated usage detected in tool output',
    };
  }

  private getNonEmptyLines(text: string): string[] {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  private findLineWithKeywords(lines: string[], keywords: string[]): string | null {
    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          return line;
        }
      }
    }

    return null;
  }

  private extractSnippet(text: string): string | null {
    const delimiters: Array<[string, string]> = [
      ['`', '`'],
      ['"', '"'],
      ["'", "'"],
    ];

    for (const [open, close] of delimiters) {
      const start = text.indexOf(open);
      if (start === -1) continue;
      const end = text.indexOf(close, start + open.length);
      if (end === -1) continue;
      const snippet = text.slice(start + open.length, end).trim();
      if (snippet) return snippet;
    }

    return null;
  }

  private extractCommandFromLines(text: string): string | null {
    const lines = this.getNonEmptyLines(text);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('$') || trimmed.startsWith('>')) {
        const candidate = trimmed.slice(1).trim();
        if (candidate) return candidate;
      }
    }

    return null;
  }

  private extractDeprecatedSubject(line: string): string | null {
    return (
      this.extractSnippet(line) ||
      this.extractTokenAfterKeyword(line, 'deprecated') ||
      this.extractTokenBeforeKeyword(line, 'deprecated')
    );
  }

  private extractReplacementHint(text: string): string | null {
    const hints = [
      'use ',
      'use:',
      'replace with ',
      'replace ',
      'switch to ',
      'migrate to ',
      'instead use ',
      'instead ',
    ];
    const lower = text.toLowerCase();

    for (const hint of hints) {
      const index = lower.indexOf(hint);
      if (index === -1) continue;
      const after = text.slice(index + hint.length).trim();
      const candidate = this.extractSnippet(after) || this.extractFirstToken(after);
      if (candidate) return candidate;
    }

    return this.extractSnippet(text);
  }

  private extractTokenAfterKeyword(text: string, keyword: string): string | null {
    const lower = text.toLowerCase();
    const index = lower.indexOf(keyword.toLowerCase());
    if (index === -1) return null;
    const after = text.slice(index + keyword.length).trim();
    return this.extractFirstToken(after);
  }

  private extractTokenBeforeKeyword(text: string, keyword: string): string | null {
    const lower = text.toLowerCase();
    const index = lower.indexOf(keyword.toLowerCase());
    if (index === -1) return null;
    const before = text.slice(0, index).trim();
    const tokens = this.splitOnWhitespace(before);

    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const candidate = this.trimDelimiters(tokens[i]);
      if (candidate) return candidate;
    }

    return null;
  }

  private extractFirstToken(text: string): string | null {
    const tokens = this.splitOnWhitespace(text);
    for (const token of tokens) {
      const candidate = this.trimDelimiters(token);
      if (candidate) return candidate;
    }

    return null;
  }

  private splitOnWhitespace(text: string): string[] {
    const tokens: string[] = [];
    let current = '';

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === ' ' || char === '\n' || char === '\t' || char === '\r') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  private trimDelimiters(value: string): string {
    const stripChars = ".,;:()[]{}<>|\"'";
    let start = 0;
    let end = value.length;

    while (start < end && stripChars.includes(value[start])) {
      start += 1;
    }

    while (end > start && stripChars.includes(value[end - 1])) {
      end -= 1;
    }

    return value.slice(start, end);
  }

  private inferTechnology(
    oldMethod?: string,
    newMethod?: string
  ): string | undefined {
    const candidate = oldMethod || newMethod;
    if (!candidate) return undefined;
    const token = this.extractSpecificToken(candidate);
    return token || undefined;
  }

  private extractSpecificToken(text: string): string | null {
    const tokens = this.splitOnWhitespace(text)
      .map((token) => this.trimDelimiters(token))
      .filter((token) => token.length > 0 && !token.startsWith('-'));

    if (tokens.length === 0) {
      return null;
    }

    const special = tokens.find(
      (token) => token.includes('@') || token.includes('/') || token.includes('.')
    );

    if (special) {
      return special;
    }

    return tokens[tokens.length - 1] || null;
  }

  private normalizeOptional(value: string | null): string | undefined {
    if (!value) return undefined;
    return value;
  }

  /**
   * Store knowledge in database
   */
  private async storeKnowledge(entry: {
    query: string;
    category: string;
    tech_stack?: string;
    answer: string;
    sources: string[];
    confidence: number;
  }): Promise<void> {
    // Check if similar knowledge already exists
    const existing = this.workspaceDB.searchKnowledge({
      category: entry.category,
      tech_stack: entry.tech_stack,
      limit: 1,
    });

    if (existing.length > 0) {
      // Update confidence
      this.workspaceDB.updateKnowledgeSuccess(existing[0].id!);
      logger.debug(
        `[KnowledgeLearner] Updated existing knowledge entry (id: ${existing[0].id})`
      );
    } else {
      // Create new entry
      this.workspaceDB.storeKnowledge({
        query: entry.query,
        query_embedding: JSON.stringify([]), // TODO: Add embedding
        answer: entry.answer,
        category: entry.category,
        tech_stack: entry.tech_stack,
        sources: JSON.stringify(entry.sources),
        confidence: entry.confidence,
        success_count: 0,
        failure_count: 0,
        cached_at: Date.now(),
        accessed_at: Date.now(),
        ttl_days: 30,
      });
      logger.info(`[KnowledgeLearner] Stored new knowledge: ${entry.query}`);
    }
  }

  /**
   * Get relevant knowledge for a query
   */
  async getRelevantKnowledge(
    _query: string,
    projectType?: string
  ): Promise<Array<{ category: string; answer: any; confidence: number }>> {
    const results = this.workspaceDB.searchKnowledge({
      tech_stack: projectType,
      minConfidence: 0.5,
      limit: 5,
    });

    return results.map((r) => ({
      category: r.category,
      answer: JSON.parse(r.answer),
      confidence: r.confidence,
    }));
  }
}
