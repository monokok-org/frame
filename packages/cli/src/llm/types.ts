/**
 * LLM Types
 * 
 */

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCallMessage[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCallMessage {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatOptions {
  tools?: object[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: ToolCallMessage[];
  finishReason?: 'stop' | 'tool_calls' | 'length';
}

export interface LLMClient {
  chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse>;
  getModel(): string;
}

export interface LLMConfig {
  baseUrl: string;
  model: string;
  timeout?: number;
}
