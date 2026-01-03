/**
 * Direct Executor (Claude Code Architecture)
 *
 * Simple, incremental execution without JSON plans:
 * - LLM outputs tool calls directly (OpenAI-style function calling)
 * - One step at a time, verify constantly
 * - Conversation-based (turns), not state machine
 * - Tool calls ARE the plan
 *
 * Flow: User Query -> LLM thinks -> LLM calls tools -> Verify -> Repeat until done
 */

import type { UnifiedLLMClient, ChatMessage } from '../llm/unified-client.js';
import type { ExecutorEvent, ExecutorResult } from '../types/executor.js';
import type { MotorSkill } from '@homunculus-live/core';
import type { KnowledgeQuery } from '../knowledge/index.js';
import { allSkills } from '../skills/index.js';
import { logger } from '../utils/logger.js';
import { getDebugLogger } from '../utils/debug-logger.js';
import {
  handleEmptyResponse,
  type EmptyResponseContext,
} from './empty-response-handler.js';
import { parseTextToolCalls } from '../utils/tool-call-parser.js';
import { parseJsonObject } from '../utils/llm-json.js';
import { buildDirectExecutorSystemPrompt } from '../context/prompts/direct-executor.js';
import {
  KNOWLEDGE_INTENT_SYSTEM_PROMPT,
  buildKnowledgeIntentPrompt,
} from '../context/prompts/knowledge-intent.js';
import {
  KNOWLEDGE_INTENT_SCHEMA,
  KNOWLEDGE_QUERY_REWRITE_SCHEMA,
  KNOWLEDGE_QUERY_GENERATION_SCHEMA,
  KNOWLEDGE_SYNTHESIS_SCHEMA,
} from '../context/prompts/json-schemas.js';
import {
  KNOWLEDGE_QUERY_REWRITE_SYSTEM_PROMPT,
  buildKnowledgeQueryRewritePrompt,
} from '../context/prompts/knowledge-query-rewrite.js';
import {
  KNOWLEDGE_SYNTHESIS_SYSTEM_PROMPT,
  buildKnowledgeSynthesisPrompt,
} from '../context/prompts/knowledge-synthesis.js';
import { getWorkspaceMemory } from './workspace-context.js';
import os from 'os';

type ToolMode = 'full' | 'core' | 'minimal';

const ASK_USER_QUESTION_TOOL_NAME = 'ask-user-question';

const CORE_TOOL_IDS = new Set([
  ASK_USER_QUESTION_TOOL_NAME,
  'read-file',
  'write-file',
  'edit-file',
  'list-dir',
  'get-cwd',
  'path-exists',
  'glob',
  'grep',
  'exec-command',
  'plan-task',
  'explore-agent',
  'structure-scout',
  'platform-detector',
  'dependency-checker',
  'error-researcher',
  'knowledge-query',
  'web-search',
]);

const MINIMAL_TOOL_IDS = new Set([
  'read-file',
  'list-dir',
  'glob',
  'grep',
  'get-cwd',
  'path-exists',
  'structure-scout',
]);

const CLARIFICATION_HINTS = [
  'please provide',
  'please clarify',
  'could you',
  'would you',
  'what kind',
  'what type',
  'do you want',
  'do you need',
  'any preferences',
  'which one'
];

/**
 * Tool call from LLM (Ollama/OpenAI format)
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    index?: number; // Ollama includes this
    name: string;
    arguments: string | Record<string, any>; // Ollama returns object, OpenAI returns string
  };
}

/**
 * Tool call result (Ollama format)
 */
export interface ToolCallResult {
  role: 'tool';
  tool_name: string; // Ollama uses 'tool_name' not 'name'
  tool_call_id?: string; // OpenAI-compatible API uses tool_call_id
  content: string; // Result as string
}

/**
 * Turn (one LLM response + tool execution cycle)
 */
export interface Turn {
  thought: string; // LLM's reasoning
  toolCalls: ToolCall[]; // Tools LLM wants to invoke
  toolResults: ToolCallResult[]; // Results from executing tools
  timestamp: number;
}

/**
 * Execution plan (prevents attention drift)
 */
export interface ExecutionPlan {
  goal: string; // What we're trying to accomplish
  steps: string[]; // Ordered steps to complete
  currentStepIndex: number; // Which step we're on
  explorationComplete: boolean; // Have we explored the codebase?
}

/**
 * Executor context (conversation state)
 */
export interface DirectExecutorContext {
  query: string;
  workingDirectory: string;
  turns: Turn[];
  userMessages: Array<{ afterTurn: number; content: string }>;
  maxTurns: number;
  currentTurn: number;
  status: 'running' | 'done' | 'failed' | 'awaiting_input';
  plan?: ExecutionPlan; // Explicit plan to prevent drift
  finalResult?: string;
  pendingQuestion?: string;
  paused?: boolean;
  error?: string;
  emptyResponseCount: number; // Track consecutive empty responses
  preflight?: {
    toolCalls: ToolCall[];
    toolResults: ToolCallResult[];
    acknowledgment?: string; // Model's response after reading knowledge
  };
}

/**
 * Direct Executor Configuration
 */
export interface DirectExecutorConfig {
  llm: UnifiedLLMClient;
  workingDirectory: string;
  maxTurns?: number;
  onEvent?: (event: ExecutorEvent) => void;
}

/**
 * Direct Executor (Claude Code style)
 */
export class DirectExecutor {
  private static readonly RECENT_TURNS_TO_KEEP = 2;
  private static readonly MAX_TOOL_RESULT_RECENT_CHARS = 4000;
  private static readonly MAX_TOOL_RESULT_OLD_CHARS = 800;
  private static readonly MAX_HISTORY_SUMMARY_CHARS = 2000;
  private static readonly MAX_SUMMARY_LINE_CHARS = 160;
  private static readonly DEFAULT_TOOL_MODE: ToolMode = 'core';

  private llm: UnifiedLLMClient;
  private workingDirectory: string;
  private maxTurns: number;
  private pendingContext: DirectExecutorContext | null = null;
  private pauseRequested: boolean = false;
  private eventHandler?: (event: ExecutorEvent) => void;

  private static readonly PAUSE_QUESTION =
    'Paused. Press Esc to continue or type a new instruction.';

  constructor(config: DirectExecutorConfig) {
    this.llm = config.llm;
    this.workingDirectory = config.workingDirectory;
    this.maxTurns = config.maxTurns ?? 0; // 0 = no limit
    this.eventHandler = config.onEvent;
  }

  /**
   * Execute a task (main entry point)
   */
  async execute(query: string): Promise<ExecutorResult> {
    if (this.pendingContext) {
      this.pendingContext = null;
    }

    this.pauseRequested = false;
    this.emitEvent({
      type: 'start',
      message: 'Starting task',
      detail: query,
      level: 'info',
    });
    const ctx: DirectExecutorContext = {
      query,
      workingDirectory: this.workingDirectory,
      turns: [],
      userMessages: [],
      maxTurns: this.maxTurns,
      currentTurn: 0,
      status: 'running',
      paused: false,
      emptyResponseCount: 0,
    };

    logger.info(`[DirectExecutor] Starting: "${query}"`);
    return this.run(ctx);
  }

  async resume(userInput: string): Promise<ExecutorResult> {
    if (!this.pendingContext) {
      throw new Error('No pending question to resume');
    }

    const ctx = this.pendingContext;
    this.pendingContext = null;
    this.pauseRequested = false;
    this.emitEvent({
      type: 'resume',
      message: 'Resuming task',
      detail: userInput.trim() || undefined,
      level: 'info',
    });

    const trimmed = userInput.trim();
    if (trimmed.length > 0) {
      ctx.userMessages.push({
        afterTurn: Math.max(0, ctx.turns.length - 1),
        content: userInput,
      });
    }

    ctx.pendingQuestion = undefined;
    ctx.paused = false;
    ctx.status = 'running';

    return this.run(ctx);
  }

  hasPending(): boolean {
    return this.pendingContext !== null;
  }

  cancelPending(): boolean {
    if (!this.pendingContext) {
      return false;
    }
    this.pendingContext = null;
    return true;
  }

  requestPause(): boolean {
    if (this.pauseRequested) {
      return false;
    }
    this.pauseRequested = true;
    return true;
  }

  setEventHandler(handler?: (event: ExecutorEvent) => void): void {
    this.eventHandler = handler;
  }

  private async run(ctx: DirectExecutorContext): Promise<ExecutorResult> {
    // Main loop: LLM thinks -> calls tools -> verify -> repeat
    const hasTurnLimit = ctx.maxTurns > 0;

    while (ctx.status === 'running' && (!hasTurnLimit || ctx.currentTurn < ctx.maxTurns)) {
      if (this.pauseRequested) {
        this.pauseRequested = false;
        ctx.status = 'awaiting_input';
        ctx.pendingQuestion = DirectExecutor.PAUSE_QUESTION;
        ctx.paused = true;
        break;
      }

      ctx.currentTurn++;
      const maxTurnsLabel = ctx.maxTurns > 0 ? ctx.maxTurns.toString() : 'inf';
      logger.info(`[DirectExecutor] Turn ${ctx.currentTurn}/${maxTurnsLabel}`);

      try {
        await this.processTurn(ctx);
      } catch (error) {
        logger.error(`[DirectExecutor] Error in turn ${ctx.currentTurn}: ${error}`);
        ctx.error = String(error);
        ctx.status = 'failed';
        break;
      }

      if (this.pauseRequested && ctx.status === 'running') {
        this.pauseRequested = false;
        ctx.status = 'awaiting_input';
        ctx.pendingQuestion = DirectExecutor.PAUSE_QUESTION;
        ctx.paused = true;
      }
    }

    if (hasTurnLimit && ctx.currentTurn >= ctx.maxTurns && ctx.status === 'running') {
      logger.warn('[DirectExecutor] Max turns reached');
      ctx.status = 'failed';
      ctx.error = 'Maximum turns exceeded - task too complex or unclear goal';
    }

    logger.info(`[DirectExecutor] Complete: ${ctx.status}`);

    if (ctx.status === 'awaiting_input') {
      this.pendingContext = ctx;
    }

    if (ctx.status === 'awaiting_input' && ctx.pendingQuestion) {
      this.emitEvent({
        type: 'awaiting_input',
        message: ctx.paused ? 'Paused' : 'Awaiting input',
        detail: ctx.pendingQuestion,
        pause: ctx.paused,
        level: ctx.paused ? 'warn' : 'info',
      });
    }

    if (ctx.status === 'done') {
      this.emitEvent({
        type: 'done',
        message: 'Task complete',
        detail: ctx.finalResult,
        level: 'success',
      });
    } else if (ctx.status === 'failed') {
      this.emitEvent({
        type: 'distress',
        message: 'Task failed',
        detail: ctx.error,
        level: 'error',
      });
    }

    return {
      status: ctx.status === 'done' ? 'DONE' : ctx.status === 'awaiting_input' ? 'ASK' : 'DISTRESS',
      result: ctx.status === 'awaiting_input' ? ctx.pendingQuestion : ctx.finalResult,
      question: ctx.pendingQuestion,
      pause: ctx.status === 'awaiting_input' ? ctx.paused : false,
      error: ctx.error,
    };
  }

  private emitEvent(event: ExecutorEvent): void {
    if (!this.eventHandler) {
      return;
    }
    try {
      this.eventHandler(event);
    } catch (error) {
      logger.warn(`[DirectExecutor] Event handler error: ${error}`);
    }
  }

  private preview(text: string, maxChars: number = 500): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) {
      return compact;
    }
    return `${compact.slice(0, maxChars)}…`;
  }

  private formatToolStartEvent(call: ToolCall): ExecutorEvent {
    const args = this.getToolArgs(call);
    const { message, detail } = this.describeTool(call.function.name, args, 'start');

    return {
      type: 'tool_start',
      tool: call.function.name,
      message,
      detail: detail ? this.preview(detail) : undefined,
      level: 'info',
    };
  }

  private formatToolResultEvent(call: ToolCall, result: string, isError: boolean): ExecutorEvent {
    const args = this.getToolArgs(call);
    const { message } = this.describeTool(call.function.name, args, 'result');

    return {
      type: 'tool_result',
      tool: call.function.name,
      message,
      detail: result ? this.preview(result) : undefined,
      level: isError ? 'error' : 'info',
    };
  }

  private describeTool(
    toolName: string,
    args: Record<string, any>,
    phase: 'start' | 'result'
  ): { message: string; detail?: string } {
    switch (toolName) {
      case 'read-file': {
        const range = args.startLine || args.endLine
          ? ` (${args.startLine ?? 1}-${args.endLine ?? 'end'})`
          : '';
        return {
          message: phase === 'start' ? 'Reading file' : 'Read file',
          detail: args.path ? `${args.path}${range}` : undefined,
        };
      }
      case 'write-file':
        return {
          message: phase === 'start' ? 'Writing file' : 'Wrote file',
          detail: args.path,
        };
      case 'edit-file':
        return {
          message: phase === 'start' ? 'Editing file' : 'Edited file',
          detail: args.path,
        };
      case 'list-dir':
        return {
          message: phase === 'start' ? 'Listing directory' : 'Listed directory',
          detail: args.path || args.dir,
        };
      case 'glob':
        return {
          message: phase === 'start' ? 'Scanning files' : 'Scanned files',
          detail: args.pattern,
        };
      case 'grep':
        return {
          message: phase === 'start' ? 'Searching text' : 'Search results',
          detail: args.pattern,
        };
      case 'exec-command':
        return {
          message: phase === 'start' ? 'Running command' : 'Command output',
          detail: args.command,
        };
      case 'get-cwd':
        return {
          message: phase === 'start' ? 'Checking working directory' : 'Working directory',
        };
      case 'path-exists':
        return {
          message: phase === 'start' ? 'Checking path' : 'Path check',
          detail: args.path,
        };
      case 'structure-scout':
        return {
          message: phase === 'start' ? 'Scanning project structure' : 'Structure scan',
        };
      case 'explore-agent':
        return {
          message: phase === 'start' ? 'Exploring context' : 'Exploration results',
          detail: args.query,
        };
      case 'plan-task':
        return {
          message: phase === 'start' ? 'Planning steps' : 'Plan ready',
          detail: args.goal,
        };
      case ASK_USER_QUESTION_TOOL_NAME:
        return {
          message: phase === 'start' ? 'Requesting clarification' : 'Clarification requested',
          detail: args.question,
        };
      case 'dependency-checker':
        return {
          message: phase === 'start' ? 'Checking dependencies' : 'Dependency check',
        };
      case 'error-researcher':
        return {
          message: phase === 'start' ? 'Analyzing error' : 'Error analysis',
          detail: args.error || args.message,
        };
      case 'web-search':
        return {
          message: phase === 'start' ? 'Searching the web' : 'Web search results',
          detail: args.query,
        };
      case 'platform-detector':
        return {
          message: phase === 'start' ? 'Detecting platform' : 'Platform detected',
        };
      default:
        return {
          message: phase === 'start' ? `Using ${toolName}` : `${toolName} result`,
          detail: this.formatArgsPreview(args),
        };
    }
  }

  private formatArgsPreview(args: Record<string, any>): string {
    try {
      return JSON.stringify(args);
    } catch {
      return '';
    }
  }

  private async maybeRunKnowledgePreflight(ctx: DirectExecutorContext): Promise<void> {
    if (ctx.preflight) {
      return;
    }

    const intent = await this.classifyKnowledgeIntent(ctx.query);
    if (!intent.needsKnowledge) {
      return;
    }

    const category = intent.category === 'none' ? 'current-standard' : intent.category;
    logger.info(`[DirectExecutor] Knowledge preflight triggered (category: ${category})`);

    try {
      // Use sub-agent to query Framebase and synthesize knowledge
      logger.info('[DirectExecutor] Invoking knowledge synthesis sub-agent');
      const synthesis = await this.synthesizeKnowledge(ctx.query, category);

      ctx.preflight = {
        toolCalls: [],
        toolResults: [],
        acknowledgment: synthesis,
      };

      logger.info(`[DirectExecutor] Knowledge preflight complete. Synthesis: ${synthesis.substring(0, 150)}...`);

      // Emit synthesis event so user sees it
      if (synthesis) {
        this.emitEvent({
          type: 'tool_result',
          tool: 'knowledge-synthesis',
          message: 'Knowledge recipe ready',
          detail: synthesis,
          level: 'info',
        });
      }
    } catch (error) {
      logger.warn(`[DirectExecutor] Knowledge preflight failed: ${error}`);
    }
  }

  private async classifyKnowledgeIntent(query: string): Promise<{
    needsKnowledge: boolean;
    category: KnowledgeQuery['category'] | 'none';
    reason: string;
  }> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { needsKnowledge: false, category: 'none', reason: 'Empty query' };
    }

    // Trust the LLM to classify - no heuristics
    const prompt = buildKnowledgeIntentPrompt(trimmed);

    try {
      const response = await this.llm.chat(
        [
          { role: 'system', content: KNOWLEDGE_INTENT_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { format: KNOWLEDGE_INTENT_SCHEMA }
      );

      const content = response.content || '{}';
      const parsed = parseJsonObject<Record<string, unknown>>(content);

      const needsKnowledge =
        typeof parsed.needs_knowledge === 'boolean' ? parsed.needs_knowledge : true;
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided';
      const category = this.normalizeKnowledgeCategory(parsed.category, needsKnowledge);

      return { needsKnowledge, category, reason };
    } catch (error) {
      logger.warn(`[DirectExecutor] Knowledge intent classification failed: ${error}`);
      // FAIL SAFE: Default to running knowledge query
      return {
        needsKnowledge: true,
        category: 'current-standard',
        reason: 'Classification failed - defaulting to knowledge query',
      };
    }
  }

  /**
   * Synthesize knowledge using sub-agent (TWO-PHASE)
   * Phase 1: Sub-agent generates Framebase query
   * Phase 2: Sub-agent analyzes frames and creates recipe
   */
  private async synthesizeKnowledge(
    userQuery: string,
    category: KnowledgeQuery['category']
  ): Promise<string> {
    try {
      const environment = this.buildKnowledgeRewriteEnvironment();
      const handoffContext = this.buildHandoffContext(userQuery, category);

      // PHASE 1: Get Framebase query from sub-agent
      logger.info('[DirectExecutor] Sub-agent Phase 1: Generating Framebase query');

      const queryPrompt = buildKnowledgeSynthesisPrompt({
        userQuery,
        category,
        environment,
        handoffContext,
      });

      const queryResponse = await this.llm.chat(
        [
          { role: 'system', content: KNOWLEDGE_SYNTHESIS_SYSTEM_PROMPT },
          { role: 'user', content: queryPrompt },
        ],
        { format: KNOWLEDGE_QUERY_GENERATION_SCHEMA }
      );

      const fbQuery = parseJsonObject<{
        q: string;
        filters?: string[];
        limit?: number;
        reasoning?: string;
      }>(queryResponse.content || '{}');

      if (!fbQuery.q) {
        logger.warn('[DirectExecutor] Sub-agent failed to generate Framebase query');
        logger.warn(`[DirectExecutor] Raw response: ${queryResponse.content}`);
        return 'Failed to generate knowledge query.';
      }

      // Validate query is concise (Meilisearch has 10-word limit)
      const wordCount = fbQuery.q.trim().split(/\s+/).length;
      if (wordCount > 5) {
        logger.warn(`[DirectExecutor] Query too verbose (${wordCount} words): "${fbQuery.q}"`);
        // Try to truncate to first 3-4 essential words
        const truncated = fbQuery.q.trim().split(/\s+/).slice(0, 4).join(' ');
        logger.info(`[DirectExecutor] Truncated to: "${truncated}"`);
        fbQuery.q = truncated;
      }

      logger.info(`[DirectExecutor] Sub-agent query: "${fbQuery.q}" with filters: ${JSON.stringify(fbQuery.filters || [])}`);

      // PHASE 2: Execute Framebase query
      const { FramebaseClient } = await import('../knowledge/framebase.js');
      const framebaseClient = new FramebaseClient();

      const framebaseResponse = await framebaseClient.query({
        q: fbQuery.q,
        filters: fbQuery.filters,
        limit: fbQuery.limit || 5,
      });

      const frames = framebaseResponse.frames || [];
      logger.info(`[DirectExecutor] Framebase returned ${frames.length} frames`);

      if (frames.length === 0) {
        return 'No relevant knowledge found in Framebase for this query.';
      }

      // PHASE 3: Sub-agent analyzes frames and creates recipe
      logger.info('[DirectExecutor] Sub-agent Phase 2: Analyzing frames and creating recipe');

      const analysisPrompt = this.buildFrameAnalysisPrompt(frames, handoffContext);

      const analysisResponse = await this.llm.chat(
        [
          { role: 'system', content: KNOWLEDGE_SYNTHESIS_SYSTEM_PROMPT },
          { role: 'user', content: analysisPrompt },
        ],
        { format: KNOWLEDGE_SYNTHESIS_SCHEMA }
      );

      const synthesis = parseJsonObject<{
        no_relevant_info?: boolean;
        recipe?: {
          summary: string;
          steps: string[];
          key_points?: string[];
          deprecated?: string[];
        };
        confidence: number;
        reason: string;
      }>(analysisResponse.content || '{}');

      // If no relevant info, return early
      if (synthesis.no_relevant_info) {
        logger.info('[DirectExecutor] Sub-agent found no relevant information in frames');
        return `Checked ${frames.length} knowledge frames but found no relevant information. Reason: ${synthesis.reason}`;
      }

      // Format recipe for main agent
      if (!synthesis.recipe) {
        logger.warn('[DirectExecutor] Sub-agent returned no recipe');
        return 'Knowledge synthesis incomplete.';
      }

      const recipe = synthesis.recipe;
      const parts: string[] = [];

      parts.push(`📋 ${recipe.summary}`);
      parts.push('');
      parts.push('Steps:');
      recipe.steps.forEach((step, i) => parts.push(`${i + 1}. ${step}`));

      if (recipe.key_points && recipe.key_points.length > 0) {
        parts.push('');
        parts.push('Key Points:');
        recipe.key_points.forEach(point => parts.push(`• ${point}`));
      }

      if (recipe.deprecated && recipe.deprecated.length > 0) {
        parts.push('');
        parts.push('⚠️  Avoid (Deprecated):');
        recipe.deprecated.forEach(item => parts.push(`• ${item}`));
      }

      parts.push('');
      parts.push(`Confidence: ${(synthesis.confidence * 100).toFixed(0)}%`);

      const formatted = parts.join('\n');
      logger.info(`[DirectExecutor] Knowledge synthesized (confidence: ${synthesis.confidence.toFixed(2)})`);

      return formatted;
    } catch (error) {
      logger.error(`[DirectExecutor] Knowledge synthesis failed: ${error}`);
      return `Knowledge synthesis error: ${error}`;
    }
  }

  /**
   * Build prompt for frame analysis (Phase 2 of synthesis)
   */
  private buildFrameAnalysisPrompt(
    frames: Array<{ metadata?: any; context?: string; content?: string }>,
    handoffContext: string
  ): string {
    const framesSummary = frames
      .map((frame, i) => {
        const meta = frame.metadata;
        const content = frame.context || frame.content || '';
        const metaStr = meta?.source
          ? `[${meta.source}${meta.version ? `@${meta.version}` : ''}${meta.score ? ` score=${meta.score.toFixed(2)}` : ''}]`
          : '';

        return `## Frame ${i + 1} ${metaStr}\n${content.substring(0, 800)}`;
      })
      .join('\n\n');

    return `# Task Handoff

${handoffContext}

# Framebase Results (${frames.length} frames)

${framesSummary}

---

Now analyze these frames and create a concise recipe for the main agent. Include specific versions, commands, and steps. If frames aren't helpful, set "no_relevant_info": true.

Your synthesis:`;
  }

  /**
   * Build natural language handoff context for sub-agents
   */
  private buildHandoffContext(userQuery: string, category: string): string {
    const memory = getWorkspaceMemory()?.get();

    const parts: string[] = [];

    // What we're trying to do
    parts.push(`I'm working on the user's request: "${userQuery}"`);
    parts.push('');

    // Why we need knowledge
    const whyMap: Record<string, string> = {
      'best-practice': 'I need to know the current best practice so I don\'t use outdated approaches.',
      'tool-comparison': 'I need to understand which tool/approach is recommended right now.',
      'deprecated-check': 'I need to verify if this approach is still current or if it\'s been deprecated.',
      'current-standard': 'I need to know the modern, standard way to do this.',
    };
    parts.push(whyMap[category] || 'I need up-to-date information about this.');
    parts.push('');

    // Project context if available
    if (memory?.packageManager) {
      parts.push(`We're using ${memory.packageManager} as the package manager.`);
    }

    if (memory?.lastProjectCreated) {
      const proj = memory.lastProjectCreated;
      parts.push(`The project is ${proj.type}${proj.framework ? ` with ${proj.framework}` : ''}.`);
    }

    parts.push('');
    parts.push('Can you analyze the knowledge frames below and give me:');
    parts.push('- The specific current method/command to use');
    parts.push('- Any version requirements or gotchas');
    parts.push('- What deprecated approaches to avoid');
    parts.push('');
    parts.push('If the frames don\'t contain relevant info for this specific task, just let me know.');

    return parts.join('\n');
  }

  private normalizeKnowledgeCategory(
    category: unknown,
    needsKnowledge: boolean
  ): KnowledgeQuery['category'] | 'none' {
    const allowed = new Set([
      'best-practice',
      'tool-comparison',
      'deprecated-check',
      'current-standard',
      'none',
    ]);

    if (typeof category === 'string' && allowed.has(category)) {
      return category as KnowledgeQuery['category'] | 'none';
    }

    return needsKnowledge ? 'current-standard' : 'none';
  }

  private async rewriteKnowledgeQuery(
    query: string,
    category: KnowledgeQuery['category'] | 'none'
  ): Promise<{ query: string; techStack?: string; source?: string; filters?: string[] }> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return { query: trimmed };
    }

    const prompt = buildKnowledgeQueryRewritePrompt({
      query: trimmed,
      category,
      environment: this.buildKnowledgeRewriteEnvironment(),
    });

    try {
      const response = await this.llm.chat(
        [
          { role: 'system', content: KNOWLEDGE_QUERY_REWRITE_SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        { format: KNOWLEDGE_QUERY_REWRITE_SCHEMA }
      );

      const content = response.content || '{}';
      const parsed = parseJsonObject<Record<string, unknown>>(content);
      const rewrittenQuery =
        typeof parsed.query === 'string' ? parsed.query.trim() : '';
      const techStack =
        typeof parsed.tech_stack === 'string' && parsed.tech_stack.trim().length > 0
          ? parsed.tech_stack.trim()
          : undefined;
      const source =
        typeof parsed.source === 'string' && parsed.source.trim().length > 0
          ? parsed.source.trim()
          : undefined;
      const filters = Array.isArray(parsed.filters)
        ? parsed.filters.filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
        : undefined;

      if (rewrittenQuery.length === 0) {
        return { query: trimmed, techStack, source, filters };
      }

      return { query: rewrittenQuery, techStack, source, filters };
    } catch (error) {
      logger.warn(`[DirectExecutor] Knowledge query rewrite failed: ${error}`);
      return { query: trimmed };
    }
  }

  private buildKnowledgeRewriteEnvironment(): Record<string, unknown> {
    const memory = getWorkspaceMemory()?.get();
    const lastProject = memory?.lastProjectCreated
      ? {
          type: memory.lastProjectCreated.type,
          framework: memory.lastProjectCreated.framework,
        }
      : undefined;

    return {
      os: this.describePlatform(os.platform()),
      arch: os.arch(),
      nodeVersion: process.version,
      packageManager: memory?.packageManager,
      lastProject,
      workingDirectory: this.workingDirectory,
    };
  }

  private describePlatform(platform: string): string {
    switch (platform) {
      case 'darwin':
        return 'macos';
      case 'win32':
        return 'windows';
      case 'linux':
        return 'linux';
      default:
        return platform;
    }
  }

  private async maybeRewriteKnowledgeArgs(args: Record<string, any>): Promise<void> {
    if (!args || typeof args !== 'object') {
      return;
    }
    const rawQuery = typeof args.query === 'string' ? args.query.trim() : '';
    if (rawQuery.length === 0) {
      return;
    }

    const rawCategory = typeof args.category === 'string' ? args.category : 'current-standard';
    const normalized = this.normalizeKnowledgeCategory(rawCategory, true);
    const effectiveCategory = normalized === 'none' ? 'current-standard' : normalized;
    const rewrite = await this.rewriteKnowledgeQuery(rawQuery, effectiveCategory);

    if (rewrite.query && rewrite.query.length > 0) {
      args.query = rewrite.query;
    }
    if (!args.tech_stack && rewrite.techStack) {
      args.tech_stack = rewrite.techStack;
    }
    if (!args.source && rewrite.source) {
      args.source = rewrite.source;
    }
    if ((!args.filters || args.filters.length === 0) && rewrite.filters && rewrite.filters.length > 0) {
      args.filters = rewrite.filters;
    }
    if (normalized !== rawCategory) {
      args.category = effectiveCategory;
    }
  }

  /**
   * Process one turn (LLM thinks + calls tools)
   */
  private async processTurn(ctx: DirectExecutorContext): Promise<void> {
    if (ctx.turns.length === 0) {
      await this.maybeRunKnowledgePreflight(ctx);
    }

    // Build conversation messages
    let messages = this.buildMessages(ctx);
    const isFirstTurn = ctx.turns.length === 0;

    this.emitEvent({
      type: 'thinking',
      message: 'Thinking',
      detail: `Turn ${ctx.currentTurn}`,
      level: 'info',
    });

    // Call LLM with tools (OpenAI function calling)
    let toolMode: ToolMode = DirectExecutor.DEFAULT_TOOL_MODE;
    let tools = this.getAvailableTools(toolMode);
    const debugLogger = getDebugLogger();
    debugLogger.log(`[DirectExecutor] Generated ${tools.length} tool definitions`);
    if (tools.length === 0) {
      logger.error('[DirectExecutor] ERROR: No tools available! Check allSkills import');
    } else {
      debugLogger.log(`[DirectExecutor] First 3 tools: ${tools.slice(0, 3).map(t => t.function.name).join(', ')}`);
    }

    let response = await this.llm.chat(messages, {
      tools,
    });

    debugLogger.log(`[DirectExecutor] LLM response - content length: ${response.content?.length || 0}, tool_calls: ${response.tool_calls?.length || 0}`);

    // Handle empty responses with retry logic
    if (!response.content && !response.tool_calls) {
      ctx.emptyResponseCount++;

      const emptyResponseCtx: EmptyResponseContext = {
        consecutiveEmptyCount: ctx.emptyResponseCount,
        totalTurns: ctx.currentTurn,
        messageCount: messages.length,
        estimatedTokens: this.estimateTokens(messages),
      };

      const handlerResult = handleEmptyResponse(messages, emptyResponseCtx);

      if (!handlerResult.shouldRetry) {
        throw new Error(handlerResult.error ?? 'LLM returned empty response');
      }

      // Retry with modified messages
      logger.info(`[DirectExecutor] Retrying with ${handlerResult.strategy?.name} strategy`);
      messages = handlerResult.modifiedMessages!;
      toolMode = this.selectToolModeForRetry(handlerResult.strategy?.name, ctx.emptyResponseCount);
      tools = this.getAvailableTools(toolMode);

      response = await this.llm.chat(messages, { tools });

      debugLogger.log(`[DirectExecutor] Retry response - content length: ${response.content?.length || 0}, tool_calls: ${response.tool_calls?.length || 0}`);

      // If still empty, fail (or fallback on first turn)
      if (!response.content && !response.tool_calls) {
        ctx.emptyResponseCount++;
        if (isFirstTurn || ctx.emptyResponseCount <= 2) {
          logger.warn('[DirectExecutor] Empty response after retry; using fallback tools');
        } else {
          throw new Error(`LLM returned empty response even after retry (strategy: ${handlerResult.strategy?.name})`);
        }
      } else {
        // Reset counter on success
        logger.info('[DirectExecutor] Retry successful, reset empty response counter');
        ctx.emptyResponseCount = 0;
      }
    } else {
      // Reset counter on successful response
      ctx.emptyResponseCount = 0;
    }

    let thought = response.content || '';
    let toolCalls = response.tool_calls || [];
    let usedFallback = false;

    // FALLBACK: Parse text-based tool calls if model outputs them as text
    if (toolCalls.length === 0 && thought.length > 0) {
      const parsed = parseTextToolCalls(thought);
      if (parsed.toolCalls.length > 0) {
        logger.warn(`[DirectExecutor] Model output tool calls as text, parsed ${parsed.toolCalls.length} calls`);
        toolCalls = parsed.toolCalls;
        thought = parsed.cleanedText;
      }
    }

    // FALLBACK: First turn must have tool calls
    if (toolCalls.length === 0 && (isFirstTurn || ctx.emptyResponseCount > 0)) {
      toolCalls = this.buildFallbackToolCalls();
      thought = '';
      usedFallback = true;
      logger.warn('[DirectExecutor] LLM skipped tools; running fallback exploration tools');
    }

    logger.info(`[DirectExecutor] Thought: ${thought.substring(0, 150)}${thought.length > 150 ? '...' : ''}`);
    logger.info(`[DirectExecutor] Tool calls: ${toolCalls.length}`);

    // Execute tool calls
    const toolResults: ToolCallResult[] = [];
    if (toolCalls.length > 0) {
      for (const call of toolCalls) {
        const result = await this.executeToolCall(call, ctx);
        toolResults.push(result);
      }
    }

    // Record turn
    const turn: Turn = {
      thought,
      toolCalls,
      toolResults,
      timestamp: Date.now(),
    };
    ctx.turns.push(turn);

    // Check for step progression (if we have a plan)
    if (ctx.plan) {
      // Check if current step is complete
      const stepComplete = this.isStepComplete(thought, ctx.plan);
      if (stepComplete && ctx.plan.currentStepIndex < ctx.plan.steps.length - 1) {
        ctx.plan.currentStepIndex++;
        logger.info(`[DirectExecutor] Step ${ctx.plan.currentStepIndex} complete`);
        logger.info(`[DirectExecutor] Moving to step ${ctx.plan.currentStepIndex + 1}: ${ctx.plan.steps[ctx.plan.currentStepIndex]}`);
      }
    }

    const requestedClarification = toolCalls.some(
      (call) => call.function.name === ASK_USER_QUESTION_TOOL_NAME
    );

    // Check if task is complete
    if (requestedClarification && ctx.pendingQuestion) {
      ctx.status = 'awaiting_input';
      logger.info('[DirectExecutor] Awaiting user clarification');
    } else if (this.isTaskComplete(thought, toolCalls, ctx)) {
      ctx.status = 'done';
      ctx.finalResult = this.extractFinalResult(ctx);
      logger.info('[DirectExecutor] Task completed');
    } else if (!usedFallback && this.isClarificationRequest(thought) && this.hasExplored(ctx)) {
      // CRITICAL: If we used fallback, DON'T stop - model hasn't seen results yet!
      ctx.status = 'awaiting_input';
      ctx.pendingQuestion = this.extractClarification(thought);
      logger.info('[DirectExecutor] Awaiting user clarification');
    } else if (toolCalls.length === 0 && ctx.currentTurn > 1) {
      // LLM didn't call any tools - this is problematic
      if (thought.length === 0) {
        // Empty response
        ctx.status = 'failed';
        ctx.error = 'LLM stopped responding (empty response)';
      }
      // Otherwise, let it continue (might be thinking out loud before next turn)
    }
  }

  /**
   * Build conversation messages for LLM
   */
  private buildMessages(ctx: DirectExecutorContext): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // System prompt (mirrors Claude Code)
    messages.push({
      role: 'system',
      content: this.buildSystemPrompt(ctx),
    });

    // User's original query
    messages.push({
      role: 'user',
      content: ctx.query,
    });

    if (ctx.preflight?.acknowledgment) {
      // IMPORTANT: Only show the synthesis to main agent, NOT raw frames
      // The sub-agent already filtered/synthesized the knowledge
      messages.push({
        role: 'assistant',
        content: `I queried the knowledge base for current best practices. Here's what I found:\n\n${ctx.preflight.acknowledgment}`,
      });
    }

    const recentStart = Math.max(0, ctx.turns.length - DirectExecutor.RECENT_TURNS_TO_KEEP);

    if (recentStart > 0) {
      const summary = this.buildHistorySummary(ctx, recentStart);
      if (summary) {
        messages.push({
          role: 'assistant',
          content: summary,
        });
      }
    }

    // Conversation history (recent turns)
    for (let i = recentStart; i < ctx.turns.length; i++) {
      const turn = ctx.turns[i];
      const isRecent = i >= recentStart;
      // Assistant's thought + tool calls
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: turn.thought,
      };

      if (turn.toolCalls.length > 0) {
        assistantMsg.tool_calls = turn.toolCalls;
      }

      messages.push(assistantMsg);

      // Tool results
      for (let j = 0; j < turn.toolResults.length; j++) {
        const result = turn.toolResults[j];
        const content = this.formatToolResultForContext(result, isRecent);

        messages.push({
          role: 'tool',
          tool_name: result.tool_name,
          tool_call_id: result.tool_call_id,
          content,
        } as any);
      }

      const userReplies = ctx.userMessages.filter((msg) => msg.afterTurn === i);
      for (const reply of userReplies) {
        messages.push({
          role: 'user',
          content: reply.content,
        });
      }
    }

    return messages;
  }

  private buildHistorySummary(ctx: DirectExecutorContext, upToTurn: number): string {
    const lines: string[] = ['Summary of earlier turns:'];

    for (let i = 0; i < upToTurn; i++) {
      const turn = ctx.turns[i];
      const toolSummaries: string[] = [];

      for (let j = 0; j < turn.toolCalls.length; j++) {
        const call = turn.toolCalls[j];
        const result = turn.toolResults[j];
        toolSummaries.push(this.formatToolSummary(call, result));
      }

      if (toolSummaries.length > 0) {
        lines.push(`- Turn ${i + 1}: ${toolSummaries.join(' | ')}`);
      }

      const userReplies = ctx.userMessages.filter((msg) => msg.afterTurn === i);
      for (const reply of userReplies) {
        lines.push(`  User: ${this.compactOneLine(reply.content, DirectExecutor.MAX_SUMMARY_LINE_CHARS)}`);
      }
    }

    const summary = lines.join('\n');
    return this.truncateText(summary, DirectExecutor.MAX_HISTORY_SUMMARY_CHARS);
  }

  private formatToolSummary(call: ToolCall | undefined, result: ToolCallResult | undefined): string {
    if (!call || !result) {
      return 'tool';
    }

    const toolName = call.function.name;
    const args = this.getToolArgs(call);
    const argLabel = this.formatToolArgsForSummary(toolName, args);
    const resultPreview = this.compactOneLine(result.content || '', DirectExecutor.MAX_SUMMARY_LINE_CHARS);

    if (argLabel && resultPreview) {
      return `${toolName} ${argLabel} -> ${resultPreview}`;
    }
    if (argLabel) {
      return `${toolName} ${argLabel}`;
    }
    if (resultPreview) {
      return `${toolName} -> ${resultPreview}`;
    }
    return toolName;
  }

  private formatToolArgsForSummary(toolName: string, args: Record<string, any>): string {
    if (toolName === 'read-file' || toolName === 'write-file' || toolName === 'edit-file') {
      if (typeof args.path === 'string') {
        return args.path;
      }
    }

    if (toolName === 'glob' && typeof args.pattern === 'string') {
      return args.pattern;
    }

    if (toolName === 'grep' && typeof args.pattern === 'string') {
      return args.pattern;
    }

    if (toolName === 'exec-command' && typeof args.command === 'string') {
      return this.compactOneLine(args.command, 80);
    }

    if (toolName === 'explore-agent' && typeof args.query === 'string') {
      return this.compactOneLine(args.query, 80);
    }

    return '';
  }

  private formatToolResultForContext(result: ToolCallResult, isRecent: boolean): string {
    const maxChars = isRecent
      ? DirectExecutor.MAX_TOOL_RESULT_RECENT_CHARS
      : DirectExecutor.MAX_TOOL_RESULT_OLD_CHARS;

    const content = result.content || '';
    if (content.length <= maxChars) {
      return content;
    }

    const trimmed = this.truncateMiddle(content, maxChars);
    if (result.tool_name === 'read-file') {
      return `${trimmed}\n... [truncated; use read-file startLine/endLine/maxChars]`;
    }

    return `${trimmed}\n... [truncated]`;
  }

  private getToolArgs(call: ToolCall): Record<string, any> {
    if (!call) {
      return {};
    }
    if (typeof call.function.arguments === 'string') {
      try {
        return JSON.parse(call.function.arguments);
      } catch {
        return {};
      }
    }
    return call.function.arguments || {};
  }

  private truncateText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, maxChars)}\n... [truncated]`;
  }

  private truncateMiddle(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }
    const headSize = Math.max(0, Math.floor(maxChars * 0.7));
    const tailSize = Math.max(0, maxChars - headSize);
    const head = text.slice(0, headSize).trimEnd();
    const tail = tailSize > 0 ? text.slice(-tailSize).trimStart() : '';
    return tail ? `${head}\n...\n${tail}` : head;
  }

  private compactOneLine(text: string, maxChars: number): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxChars) {
      return compact;
    }
    return `${compact.slice(0, maxChars)}...`;
  }

  /**
   * Build system prompt (mirrors Claude Code's instructions)
   */
  private buildSystemPrompt(ctx: DirectExecutorContext): string {
    return buildDirectExecutorSystemPrompt(ctx, ASK_USER_QUESTION_TOOL_NAME);
  }

  private hasExplored(ctx: DirectExecutorContext): boolean {
    return ctx.turns.some((turn) => turn.toolCalls.length > 0);
  }

  private isClarificationRequest(thought: string): boolean {
    if (!thought) {
      return false;
    }

    if (thought.includes('?')) {
      return true;
    }

    const normalized = this.normalizeSearchText(thought);
    return CLARIFICATION_HINTS.some((hint) => normalized.includes(hint));
  }

  private normalizeSearchText(text: string): string {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private extractClarification(thought: string): string {
    const lines = thought
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const questionLines = lines.filter((line) => line.includes('?'));
    if (questionLines.length > 0) {
      return questionLines.slice(0, 2).join('\n');
    }

    return thought.trim();
  }

  private buildFallbackToolCalls(): ToolCall[] {
    const suffix = Date.now().toString(36);
    return [
      {
        id: `auto_structure_scout_${suffix}`,
        type: 'function',
        function: {
          name: 'structure-scout',
          arguments: { maxDepth: 2, maxTreeLines: 60 },
        },
      },
    ];
  }

  /**
   * Estimate token count for messages (rough approximation: 4 chars ~ 1 token)
   */
  private estimateTokens(messages: ChatMessage[]): number {
    const totalChars = messages.reduce((sum, msg) => {
      const content = msg.content ?? '';
      const toolCallsStr = msg.tool_calls ? JSON.stringify(msg.tool_calls) : '';
      return sum + content.length + toolCallsStr.length;
    }, 0);
    return Math.ceil(totalChars / 4);
  }

  /**
   * Get available tools in OpenAI function format
   */
  private getAvailableTools(mode: ToolMode = 'full'): any[] {
    const skills = this.selectSkillsForMode(mode);
    return skills.map((skill) => {
      const schema = skill.parameters || {
        type: 'object',
        properties: {},
        required: [],
      };
      const properties = schema.properties || {};
      const compactProps: Record<string, any> = {};

      for (const [name, propSchema] of Object.entries(properties)) {
        const prop = propSchema as { type?: string; enum?: string[] };
        const compact: { type?: string; enum?: string[] } = {};
        if (prop.type) {
          compact.type = prop.type;
        } else {
          compact.type = 'string';
        }
        if (prop.enum) {
          compact.enum = prop.enum;
        }
        compactProps[name] = compact;
      }

      return {
        type: 'function',
        function: {
          name: skill.id, // Use ID (e.g., "read-file") not name (e.g., "Read File")
          description: skill.name,
          parameters: {
            type: 'object',
            properties: compactProps,
            required: schema.required || [],
          },
        },
      };
    });
  }

  /**
   * Execute a tool call
   */
  private async executeToolCall(call: ToolCall, ctx?: DirectExecutorContext): Promise<ToolCallResult> {
    try {
      const skillName = call.function.name;

      // Parse arguments - Ollama returns arguments as object, not string
      let args: any;
      if (typeof call.function.arguments === 'string') {
        args = JSON.parse(call.function.arguments);
      } else {
        args = call.function.arguments;
      }

      if (skillName === 'knowledge-query') {
        await this.maybeRewriteKnowledgeArgs(args);
        call.function.arguments = args;
      }

      logger.info(`[DirectExecutor] Executing: ${skillName}(${JSON.stringify(args).substring(0, 100)})`);

      // CRITICAL: Validate parameters before execution
      const skill = allSkills.find((s) => s.id === skillName);
      if (!skill) {
        throw new Error(`Unknown tool: ${skillName}`);
      }

      this.emitEvent(this.formatToolStartEvent(call));

      const validationError = this.validateToolParameters(skillName, args, skill);
      if (validationError) {
        throw new Error(validationError);
      }

      // SPECIAL HANDLING: ask-user-question tool pauses for user input
      if (skillName === ASK_USER_QUESTION_TOOL_NAME && ctx) {
        const question = typeof args.question === 'string' ? args.question.trim() : '';
        const content = question || 'Need more details to continue.';
        ctx.status = 'awaiting_input';
        ctx.pendingQuestion = content;
        logger.info('[DirectExecutor] Awaiting user clarification');
        this.emitEvent(this.formatToolResultEvent(call, content, false));

        return {
          role: 'tool',
          tool_name: skillName,
          tool_call_id: call.id,
          content,
        };
      }

      // SPECIAL HANDLING: plan-task tool updates context
      if (skillName === 'plan-task' && ctx) {
        // Parse steps - model may send as JSON string or array
        let steps: string[] = [];

        if (Array.isArray(args.steps)) {
          steps = args.steps;
        } else if (typeof args.steps === 'string') {
          try {
            // Try parsing as JSON array
            const parsed = JSON.parse(args.steps);
            if (Array.isArray(parsed)) {
              steps = parsed;
            }
          } catch {
            // If parsing fails, split by comma or newline
            steps = args.steps.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean);
          }
        }

        ctx.plan = {
          goal: args.goal,
          steps: steps,
          currentStepIndex: 0,
          explorationComplete: false,
        };
        logger.info(`[DirectExecutor] Plan created/updated: ${args.goal}`);
        logger.info(`[DirectExecutor] Steps: ${steps.join(' -> ')}`);

        const content = `Plan created successfully:\nGoal: ${args.goal}\nSteps: ${steps.join(', ')}`;
        this.emitEvent(this.formatToolResultEvent(call, content, false));

        return {
          role: 'tool',
          tool_name: skillName,
          tool_call_id: call.id,
          content,
        };
      }

      // Execute skill (already found above during validation)
      const result = await skill.execute(args);

      // Format result as string
      let resultStr: string;
      if (typeof result === 'string') {
        resultStr = result;
      } else if (result && typeof result === 'object') {
        // If result has specific fields, format nicely
        if ('content' in result && typeof result.content === 'string') {
          resultStr = result.content;
        } else {
          resultStr = JSON.stringify(result, null, 2);
        }
      } else {
        resultStr = String(result);
      }

      // Truncate very long results
      if (resultStr.length > 10000) {
        resultStr = resultStr.substring(0, 10000) + '\n\n... (truncated, result too long)';
      }

      // Return in Ollama format: { role: 'tool', tool_name: 'name', content: 'result' }
      this.emitEvent(this.formatToolResultEvent(call, resultStr, false));
      return {
        role: 'tool',
        tool_name: skillName,
        tool_call_id: call.id,
        content: resultStr,
      };
    } catch (error) {
      logger.error(`[DirectExecutor] Tool error (${call.function.name}): ${error}`);
      this.emitEvent(this.formatToolResultEvent(call, String(error), true));

      // Return error in Ollama format
      return {
        role: 'tool',
        tool_name: call.function.name,
        tool_call_id: call.id,
        content: `Error: ${String(error)}`,
      };
    }
  }

  /**
   * Validate tool parameters against schema (CRITICAL: prevents undefined parameter errors)
   */
  private validateToolParameters(toolName: string, args: Record<string, any>, skill: MotorSkill<any, any>): string | null {
    const schema = skill.parameters;
    if (!schema || !schema.properties) {
      return null; // No validation needed
    }

    const required = (schema.required || []) as string[];
    const properties = schema.properties as Record<string, any>;

    // Check required parameters
    for (const param of required) {
      if (args[param] === undefined || args[param] === null || args[param] === '') {
        const paramSchema = properties[param];
        const desc = paramSchema?.description || '';

        // Provide helpful error message with common mistakes
        if (toolName === 'write-file' && param === 'content') {
          return `Missing REQUIRED parameter "${param}". write-file requires both "path" and "content". Did you mean to use edit-file instead for modifying existing files?`;
        }

        if (toolName === 'edit-file' && param === 'edits') {
          return `Missing REQUIRED parameter "${param}". edit-file requires: path and edits (array of replace/insert/delete operations).`;
        }

        return `Missing REQUIRED parameter "${param}" for ${toolName}. Description: ${desc}`;
      }
    }

    // Special validation for file operations
    if (toolName === 'write-file') {
      if (typeof args.content !== 'string') {
        return `Parameter "content" must be a string, got ${typeof args.content}. Make sure you're passing the file content as a string.`;
      }
    }

    if (toolName === 'edit-file') {
      if (!Array.isArray(args.edits) || args.edits.length === 0) {
        return `Parameter "edits" must be a non-empty array of edit operations.`;
      }

      const allowedTypes = new Set(['replace', 'delete', 'insert', 'replace-between']);
      const allowedPositions = new Set(['before', 'after']);
      const allowedMatchModes = new Set(['exact', 'normalized', 'smart']);

      for (let i = 0; i < args.edits.length; i += 1) {
        const edit = args.edits[i];
        if (!edit || typeof edit !== 'object') {
          return `edit-file edits[${i}] must be an object.`;
        }
        if (!edit.type || typeof edit.type !== 'string') {
          return `edit-file edits[${i}] is missing required field "type".`;
        }
        if (!allowedTypes.has(edit.type)) {
          return `edit-file edits[${i}] has unsupported type "${edit.type}".`;
        }

        if (edit.matchMode && (typeof edit.matchMode !== 'string' || !allowedMatchModes.has(edit.matchMode))) {
          return `edit-file edits[${i}] has invalid matchMode "${edit.matchMode}".`;
        }

        switch (edit.type) {
          case 'replace':
            if (typeof edit.match !== 'string' || edit.match.length === 0) {
              return `edit-file edits[${i}] type "replace" requires non-empty "match" string.`;
            }
            if (typeof edit.replace !== 'string') {
              return `edit-file edits[${i}] type "replace" requires "replace" string.`;
            }
            break;
          case 'delete':
            if (typeof edit.match !== 'string' || edit.match.length === 0) {
              return `edit-file edits[${i}] type "delete" requires non-empty "match" string.`;
            }
            break;
          case 'insert':
            if (typeof edit.anchor !== 'string' || edit.anchor.length === 0) {
              return `edit-file edits[${i}] type "insert" requires non-empty "anchor" string.`;
            }
            if (!allowedPositions.has(edit.position)) {
              return `edit-file edits[${i}] type "insert" requires position "before" or "after".`;
            }
            if (typeof edit.content !== 'string') {
              return `edit-file edits[${i}] type "insert" requires "content" string.`;
            }
            break;
          case 'replace-between':
            if (typeof edit.start !== 'string' || edit.start.length === 0) {
              return `edit-file edits[${i}] type "replace-between" requires non-empty "start" anchor.`;
            }
            if (typeof edit.end !== 'string' || edit.end.length === 0) {
              return `edit-file edits[${i}] type "replace-between" requires non-empty "end" anchor.`;
            }
            if (typeof edit.replace !== 'string') {
              return `edit-file edits[${i}] type "replace-between" requires "replace" string.`;
            }
            break;
          default:
            break;
        }
      }
    }

    return null; // Validation passed
  }

  private selectSkillsForMode(mode: ToolMode): MotorSkill<any, any>[] {
    if (mode === 'full') {
      return allSkills;
    }

    const allowList = mode === 'core' ? CORE_TOOL_IDS : MINIMAL_TOOL_IDS;
    return allSkills.filter((skill) => allowList.has(skill.id));
  }

  private selectToolModeForRetry(strategyName: string | undefined, emptyCount: number): ToolMode {
    if (strategyName === 'emergency-mode' || strategyName === 'aggressive-truncation' || emptyCount >= 3) {
      return 'minimal';
    }

    return 'core';
  }

  /**
   * Check if current step is complete
   */
  private isStepComplete(thought: string, _plan: ExecutionPlan): boolean {
    // Look for completion signals
    const completionSignals = [
      'step complete',
      'step done',
      'finished',
      'created',
      'added',
      'modified',
      'updated',
      'implemented',
    ];

    const thoughtLower = thought.toLowerCase();
    return completionSignals.some((signal) => thoughtLower.includes(signal));
  }

  /**
   * Check if task is complete
   */
  private isTaskComplete(thought: string, toolCalls: ToolCall[], ctx: DirectExecutorContext): boolean {
    // Explicit completion signal
    if (thought.includes('TASK COMPLETED')) {
      return true;
    }

    // Plan-based completion: all steps done
    if (ctx.plan && ctx.plan.currentStepIndex >= ctx.plan.steps.length - 1) {
      // Check if final step is complete
      if (this.isStepComplete(thought, ctx.plan)) {
        return true;
      }
    }

    // Heuristic: LLM stops calling tools after a few turns (might be done)
    if (toolCalls.length === 0 && ctx.turns.length >= 2) {
      const lastTwoTurns = ctx.turns.slice(-2);
      const allEmpty = lastTwoTurns.every((t) => t.toolCalls.length === 0);
      if (allEmpty) {
        // LLM has nothing more to do
        return true;
      }
    }

    return false;
  }

  /**
   * Extract final result from conversation
   */
  private extractFinalResult(ctx: DirectExecutorContext): string {
    const lastTurn = ctx.turns[ctx.turns.length - 1];
    if (!lastTurn) {
      return 'Task completed';
    }

    // Remove "TASK COMPLETED" marker from thought
    let result = lastTurn.thought.replace(/TASK COMPLETED/gi, '').trim();

    if (!result) {
      result = 'Task completed successfully';
    }

    return result;
  }
}
