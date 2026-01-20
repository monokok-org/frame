/**
 * Debug Logger
 *
 */

import fs from 'fs';
import path from 'path';

export interface InteractionTrack {
  id: string;
  parentId?: string;
  type: 'user' | 'system' | 'llm' | 'tool' | 'executor';
}

export type LogEventType =
  | 'input'
  | 'output'
  | 'llm-request'
  | 'llm-response'
  | 'tool-start'
  | 'tool-end'
  | 'state-change'
  | 'error'
  | 'info';

export interface LogEvent {
  trackId: string;
  type: LogEventType;
  data: any;
  timestamp?: string; // ISO string
}

export class DebugLogger {
  private logPath: string;
  private sessionId: string;
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
    this.sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

    // Create .frame directory if it doesn't exist
    const frameDir = path.join(process.cwd(), '.frame');
    if (!fs.existsSync(frameDir)) {
      fs.mkdirSync(frameDir, { recursive: true });
    }

    // Create session JSONL file
    this.logPath = path.join(frameDir, `debug-${this.sessionId}.jsonl`);

    if (this.enabled) {
      this.logSystemEvent({
        event: 'session_start',
        sessionId: this.sessionId,
        timestamp: new Date().toISOString()
      });
    }
  }

  private append(event: LogEvent): void {
    if (!this.enabled) return;

    try {
      const entry = {
        timestamp: event.timestamp || new Date().toISOString(),
        sessionId: this.sessionId,
        ...event
      };
      fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
    } catch (error) {
      console.error('[DebugLogger] Failed to write to debug log:', error);
    }
  }

  /**
   * Log a structured event
   */
  logEvent(event: LogEvent): void {
    this.append(event);
  }

  /**
   * Helper for system events (no specific track)
   */
  logSystemEvent(data: any): void {
    this.logEvent({
      trackId: 'system',
      type: 'info',
      data
    });
  }

  /**
   * Legacy method support - redirected to structured log
   */
  log(message: string): void {
    this.logSystemEvent({ message });
  }

  /**
   * Log LLM request
   */
  logLLMRequest(params: {
    trackId: string;
    url: string;
    model: string;
    messageCount: number;
    toolCount: number;
    systemPromptLength: number;
    fullRequest: any;
  }): void {
    this.logEvent({
      trackId: params.trackId,
      type: 'llm-request',
      data: {
        url: params.url,
        model: params.model,
        stats: {
          messages: params.messageCount,
          tools: params.toolCount,
          systemPrompt: params.systemPromptLength
        },
        body: params.fullRequest
      }
    });
  }

  /**
   * Log LLM response
   */
  logLLMResponse(params: {
    trackId: string;
    statusCode: number;
    contentLength: number;
    toolCallsCount: number;
    fullResponse: any;
    parsedContent?: string;
    error?: string;
  }): void {
    this.logEvent({
      trackId: params.trackId,
      type: 'llm-response',
      data: {
        status: params.statusCode,
        stats: {
          contentLength: params.contentLength,
          toolCalls: params.toolCallsCount
        },
        error: params.error,
        parsed: params.parsedContent,
        body: params.fullResponse
      }
    });
  }

  /**
   * Log executor state
   */
  logExecutorState(params: {
    trackId: string;
    turn: number;
    status: string;
    thoughtLength: number;
    toolCallsCount: number;
    plan?: any;
  }): void {
    this.logEvent({
      trackId: params.trackId,
      type: 'state-change',
      data: {
        turn: params.turn,
        status: params.status,
        stats: {
          thought: params.thoughtLength,
          toolCalls: params.toolCallsCount
        },
        plan: params.plan
      }
    });
  }

  /**
   * Get log file path (for user to view)
   */
  getLogPath(): string {
    return this.logPath;
  }
}

// Global instance
let globalDebugLogger: DebugLogger | null = null;

export function getDebugLogger(): DebugLogger {
  if (!globalDebugLogger) {
    // Check if debug logging is enabled via env var
    const enabled = process.env.FRAME_DEBUG !== 'false'; // Default: enabled
    globalDebugLogger = new DebugLogger(enabled);
  }
  return globalDebugLogger;
}

