/**
 * Debug Logger
 *
 * Writes detailed LLM request/response logs to a debug file
 * Keeps UI clean while providing deep debugging capability
 */

import fs from 'fs';
import path from 'path';

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

    // Create session log file
    this.logPath = path.join(frameDir, `debug-${this.sessionId}.log`);

    if (this.enabled) {
      this.writeHeader();
    }
  }

  private writeHeader(): void {
    const header = `
${'='.repeat(80)}
Frame Debug Log
Session: ${this.sessionId}
Started: ${new Date().toISOString()}
${'='.repeat(80)}

`;
    this.append(header);
  }

  private append(content: string): void {
    if (!this.enabled) return;

    try {
      fs.appendFileSync(this.logPath, content);
    } catch (error) {
      console.error('[DebugLogger] Failed to write to debug log:', error);
    }
  }

  /**
   * Log LLM request
   */
  logLLMRequest(params: {
    url: string;
    model: string;
    messageCount: number;
    toolCount: number;
    systemPromptLength: number;
    fullRequest: any;
  }): void {
    const timestamp = new Date().toISOString();
    const content = `
${'-'.repeat(80)}
[${timestamp}] LLM REQUEST
${'-'.repeat(80)}
URL: ${params.url}
Model: ${params.model}
Messages: ${params.messageCount}
Tools: ${params.toolCount}
System Prompt Length: ${params.systemPromptLength} chars

Full Request:
${JSON.stringify(params.fullRequest, null, 2)}

`;
    this.append(content);
  }

  /**
   * Log LLM response
   */
  logLLMResponse(params: {
    statusCode: number;
    contentLength: number;
    toolCallsCount: number;
    fullResponse: any;
    parsedContent?: string;
    error?: string;
  }): void {
    const timestamp = new Date().toISOString();
    const content = `
${'-'.repeat(80)}
[${timestamp}] LLM RESPONSE
${'-'.repeat(80)}
Status: ${params.statusCode}
Content Length: ${params.contentLength} chars
Tool Calls: ${params.toolCallsCount}
${params.error ? `Error: ${params.error}\n` : ''}
${params.parsedContent ? `Parsed Content: ${params.parsedContent}\n` : ''}

Full Response:
${JSON.stringify(params.fullResponse, null, 2)}

`;
    this.append(content);
  }

  /**
   * Log empty response issue
   */
  logEmptyResponse(params: {
    attemptNumber: number;
    strategy: string;
    diagnostics: any;
    messagesBeforeRetry: number;
    messagesAfterRetry: number;
  }): void {
    const timestamp = new Date().toISOString();
    const content = `
${'!'.repeat(80)}
[${timestamp}] EMPTY RESPONSE DETECTED
${'!'.repeat(80)}
Attempt: ${params.attemptNumber}
Strategy: ${params.strategy}
Messages Before Retry: ${params.messagesBeforeRetry}
Messages After Retry: ${params.messagesAfterRetry}

Diagnostics:
${JSON.stringify(params.diagnostics, null, 2)}

`;
    this.append(content);
  }

  /**
   * Log executor state
   */
  logExecutorState(params: {
    turn: number;
    status: string;
    thoughtLength: number;
    toolCallsCount: number;
    plan?: any;
  }): void {
    const timestamp = new Date().toISOString();
    const content = `
[${timestamp}] EXECUTOR STATE - Turn ${params.turn}
Status: ${params.status}
Thought Length: ${params.thoughtLength} chars
Tool Calls: ${params.toolCallsCount}
${params.plan ? `Plan: ${JSON.stringify(params.plan, null, 2)}\n` : ''}
`;
    this.append(content);
  }

  /**
   * Log general debug info
   */
  log(message: string): void {
    const timestamp = new Date().toISOString();
    this.append(`[${timestamp}] ${message}\n`);
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
