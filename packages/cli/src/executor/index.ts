/**
 * Simple Executor
 * 
 */

import type { LLMClient } from '../llm/types.js';
import { getToolDefinitions, executeTool } from '../tools/index.js';
import type { ToolCall } from '../tools/types.js';
import {
  type ExecutorState,
  type ExecutorResult,
  type Message,
  createInitialState,
  getNextPhase,
  shouldContinue
} from './state.js';
import { buildSystemPrompt, buildResumePrompt } from './prompt.js';

export interface ExecutorConfig {
  llm: LLMClient;
  maxTurns?: number;
  onTurn?: (turn: TurnInfo) => void;
}

export interface TurnInfo {
  turn: number;
  phase: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: string;
  thought?: string;
  status?: string;
}

const DEFAULT_MAX_TURNS = 20;

export class Executor {
  private llm: LLMClient;
  private maxTurns: number;
  private onTurn?: (turn: TurnInfo) => void;
  private state: ExecutorState | null = null;

  constructor(config: ExecutorConfig) {
    this.llm = config.llm;
    this.maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
    this.onTurn = config.onTurn;
  }

  /**
   * Execute a task from start to completion
   */
  async execute(task: string): Promise<ExecutorResult> {
    this.state = createInitialState();

    // Add system and user messages
    this.state.messages.push({
      role: 'system',
      content: buildSystemPrompt()
    });

    this.state.messages.push({
      role: 'user',
      content: task
    });

    return this.runLoop();
  }

  /**
   * Resume after user provides input
   */
  async resume(userInput: string): Promise<ExecutorResult> {
    if (!this.state) {
      return { status: 'error', error: 'No active task to resume' };
    }

    // Add user response
    this.state.messages.push({
      role: 'user',
      content: buildResumePrompt(userInput)
    });

    this.state.phase = 'understand';
    return this.runLoop();
  }

  /**
   * Check if awaiting user input
   */
  isAwaiting(): boolean {
    return this.state?.phase === 'ask';
  }

  /**
   * Main execution loop
   */
  private async runLoop(): Promise<ExecutorResult> {
    if (!this.state) {
      return { status: 'error', error: 'No state initialized' };
    }

    while (shouldContinue(this.state, this.maxTurns)) {
      this.state.turnCount++;

      try {
        const result = await this.executeTurn();

        if (result) {
          return result;
        }
      } catch (error) {
        return {
          status: 'error',
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }

    // Check final state
    if (this.state.phase === 'done') {
      const lastMessage = this.state.messages[this.state.messages.length - 1];
      return {
        status: 'done',
        summary: lastMessage?.content || 'Task completed'
      };
    }

    if (this.state.phase === 'ask') {
      // Find the ask tool result
      const askMessage = [...this.state.messages].reverse().find(
        m => m.role === 'tool' && m.content.includes('"awaiting":true')
      );

      let question = 'Need input to continue';
      if (askMessage) {
        try {
          const parsed = JSON.parse(askMessage.content);
          question = parsed.question || question;
        } catch { /* ignore */ }
      }

      return { status: 'ask', question };
    }

    return {
      status: 'max_turns',
      error: `Reached maximum turns (${this.maxTurns})`
    };
  }

  /**
   * Execute a single turn
   */
  private async executeTurn(): Promise<ExecutorResult | null> {
    if (!this.state) return null;

    // Emit thinking status
    this.emitTurn({
      turn: this.state.turnCount,
      phase: this.state.phase,
      status: 'Consulting model...'
    });

    // Call LLM
    const response = await this.llm.chat(
      this.state.messages,
      { tools: getToolDefinitions() }
    );

    // Handle response
    const thought = response.content || '';
    const toolCalls = response.toolCalls || [];

    // Extract status from thought
    let status = '';
    const actionMatch = thought.match(/^Action:\s*(.+)$/m);
    if (actionMatch) {
      status = actionMatch[1].trim();
    } else {
      // Fallback: use first line or sentence if no Action: prefix
      status = thought.split('\n')[0].split('.')[0].slice(0, 50);
    }

    // Add assistant message
    const assistantMessage: Message = {
      role: 'assistant',
      content: thought
    };

    if (toolCalls.length > 0) {
      assistantMessage.toolCalls = toolCalls.map(tc => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments
      }));
    }

    this.state.messages.push(assistantMessage);

    // If no tool calls, we might be done or stuck
    if (toolCalls.length === 0) {
      if (thought.trim()) {
        // Model gave a response without tool call - treat as done
        return {
          status: 'done',
          summary: thought
        };
      }
      // Empty response - stuck
      return {
        status: 'error',
        error: 'Model produced no output'
      };
    }

    // Execute tool calls (one at a time for simplicity)
    for (const toolCall of toolCalls) {
      // Emit turn info
      this.emitTurn({
        turn: this.state.turnCount,
        phase: this.state.phase,
        toolName: toolCall.name,
        toolArgs: toolCall.arguments,
        thought,
        status
      });

      // Execute tool
      const result = await executeTool(toolCall);

      // Add tool result to messages
      this.state.messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        name: toolCall.name,
        content: result.content
      });

      // Emit result
      this.emitTurn({
        turn: this.state.turnCount,
        phase: this.state.phase,
        toolName: toolCall.name,
        toolArgs: toolCall.arguments,
        toolResult: result.content.slice(0, 1000)
      });

      // Update phase
      this.state.phase = getNextPhase(this.state.phase, toolCall.name);

      // Handle terminal tools
      if (toolCall.name === 'done') {
        try {
          const parsed = JSON.parse(result.content);
          return { status: 'done', summary: parsed.summary };
        } catch {
          return { status: 'done', summary: result.content };
        }
      }

      if (toolCall.name === 'ask') {
        try {
          const parsed = JSON.parse(result.content);
          return { status: 'ask', question: parsed.question };
        } catch {
          return { status: 'ask', question: result.content };
        }
      }

      // Update context based on tool results
      this.updateContext(toolCall, result.content);
    }

    return null; // Continue loop
  }

  /**
   * Update context from tool results
   */
  private updateContext(toolCall: ToolCall, result: string): void {
    if (!this.state) return;

    // Track target file from find results
    if (toolCall.name === 'find') {
      try {
        const parsed = JSON.parse(result);
        if (parsed.results?.[0]?.path) {
          this.state.context.targetFile = parsed.results[0].path;
        }
      } catch { /* ignore */ }
    }

    // Track edited file
    if (toolCall.name === 'edit' && toolCall.arguments.path) {
      this.state.context.targetFile = toolCall.arguments.path as string;
    }
  }

  private emitTurn(info: TurnInfo): void {
    if (this.onTurn) {
      this.onTurn(info);
    }
  }
}

export { createInitialState, type ExecutorState, type ExecutorResult } from './state.js';
