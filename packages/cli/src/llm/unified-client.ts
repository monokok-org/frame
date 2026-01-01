/**
 * Unified LLM Client
 *
 * Single client for all LLM operations with support for:
 * - Ollama native API
 * - OpenAI-compatible API
 * - Structured outputs (JSON schema)
 * - Embeddings
 * - Tool calling
 */

import { getDebugLogger } from '../utils/debug-logger.js';

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    index?: number; // Ollama includes this
    name: string;
    arguments: string | Record<string, any>; // Ollama returns object, OpenAI returns string
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters?: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ChatMessage {
  role: ChatMessageRole;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface LLMClientConfig {
  baseURL: string;
  apiKey?: string;
  model: string;
  embeddingModel?: string;
}

export interface ChatOptions {
  tools?: Tool[];
  format?: Record<string, unknown>; // JSON schema for structured output
  signal?: AbortSignal;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
}

interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: ToolCall[];
  };
  done: boolean;
}

interface OllamaEmbedResponse {
  embedding: number[];
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ToolCall[];
    };
  }>;
}

interface OpenAIEmbeddingResponse {
  data?: Array<{ embedding?: number[] }>;
}

/**
 * Unified LLM Client
 * Automatically chooses between Ollama native API and OpenAI-compatible API
 */
export class UnifiedLLMClient {
  private readonly config: Required<LLMClientConfig>;
  private readonly useNativeAPI: boolean;
  private readonly apiReason: string;
  private readonly forceNativeTools: boolean;

  constructor(config: LLMClientConfig) {
    const debugLogger = getDebugLogger();
    this.config = {
      ...config,
      embeddingModel: config.embeddingModel ?? config.model,
      apiKey: config.apiKey ?? 'x',
    };

    const normalizedBaseURL = this.config.baseURL.replace(/\/+$/, '');
    const usesOpenAICompat = normalizedBaseURL.endsWith('/v1');
    this.useNativeAPI = !usesOpenAICompat;
    this.forceNativeTools = usesOpenAICompat && this.shouldForceNativeTools(normalizedBaseURL);
    this.apiReason = this.useNativeAPI
      ? 'Base URL has no /v1 suffix; using Ollama native /api endpoints'
      : 'Base URL ends with /v1; using OpenAI-compatible endpoints';

    debugLogger.log(`[UnifiedLLM] Model: ${config.model}`);
    debugLogger.log(`[UnifiedLLM] Using ${this.useNativeAPI ? 'NATIVE' : 'OpenAI-compatible'} API`);
    debugLogger.log(`[UnifiedLLM] Reason: ${this.apiReason}`);
    if (!this.useNativeAPI && this.forceNativeTools) {
      debugLogger.log('[UnifiedLLM] Tool calls will use Ollama native /api/chat for compatibility');
    }
  }

  /**
   * Chat completion
   */
  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatMessage> {
    if (!this.useNativeAPI && this.forceNativeTools && options.tools && options.tools.length > 0) {
      return this.chatNative(messages, options);
    }
    if (this.useNativeAPI) {
      return this.chatNative(messages, options);
    } else {
      return this.chatOpenAI(messages, options);
    }
  }

  /**
   * Ollama native API chat
   */
  private async chatNative(messages: ChatMessage[], options: ChatOptions): Promise<ChatMessage> {
    const url = `${this.config.baseURL.replace(/\/v1$/, '')}/api/chat`;
    const debugLogger = getDebugLogger();
    const systemMsg = messages.find(m => m.role === 'system');

    // Convert messages to Ollama format
    const ollamaMessages: OllamaMessage[] = messages.map(msg => {
      // For tool messages, convert to user message with context
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: msg.content ?? '',
        };
      }

      return {
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content ?? '',
        tool_calls: msg.tool_calls,
      };
    });

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: ollamaMessages,
      stream: false,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
      // Note: think=true only works with models that support it (qwen, llama3.1, etc)
      // Devstral does not support thinking, so omit it
      // body.think = true;
      debugLogger.log(`[UnifiedLLM] Sending ${options.tools.length} tools to Ollama native API`);
      debugLogger.log(`[UnifiedLLM] First tool: ${options.tools[0].function.name}`);
      debugLogger.log(`[UnifiedLLM] Sample tool schema: ${JSON.stringify(options.tools[0], null, 2)}`);
    } else {
      debugLogger.log('[UnifiedLLM] WARNING: No tools provided to native API');
    }

    // Add structured output format if provided
    if (options.format) {
      body.format = options.format;
    }

    debugLogger.logLLMRequest({
      url,
      model: this.config.model,
      messageCount: messages.length,
      toolCount: options.tools?.length || 0,
      systemPromptLength: systemMsg?.content?.length || 0,
      fullRequest: body,
    });

    // Debug: Log request body (truncated)
    const bodyStr = JSON.stringify(body);
    this.logRequestBody('Ollama native chat', body);
    debugLogger.log(`[UnifiedLLM] Request body size: ${bodyStr.length} chars`);
    debugLogger.log(`[UnifiedLLM] Request contains tools: ${!!body.tools}`);
    debugLogger.log(`[UnifiedLLM] Request URL: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new LLMError(`Chat request failed with status ${response.status}: ${text}`, response.status);
    }

    const data = await response.json() as OllamaChatResponse;

    if (!data.message) {
      debugLogger.logLLMResponse({
        statusCode: response.status,
        contentLength: 0,
        toolCallsCount: 0,
        fullResponse: data,
        error: 'Chat response missing message',
      });
      throw new LLMError('Chat response missing message');
    }

    debugLogger.logLLMResponse({
      statusCode: response.status,
      contentLength: data.message.content?.length || 0,
      toolCallsCount: data.message.tool_calls?.length || 0,
      fullResponse: data,
      parsedContent: data.message.content?.substring(0, 200),
    });

    // Debug: Log tool calls if present
    if (data.message.tool_calls && data.message.tool_calls.length > 0) {
      debugLogger.log(`[UnifiedLLM] Received ${data.message.tool_calls.length} tool calls from Ollama`);
      debugLogger.log(`[UnifiedLLM] First tool call: ${JSON.stringify(data.message.tool_calls[0], null, 2)}`);
    } else {
      debugLogger.log('[UnifiedLLM] No tool calls in response');
    }

    return {
      role: 'assistant',
      content: data.message.content ?? null,
      tool_calls: data.message.tool_calls,
    };
  }

  /**
   * OpenAI-compatible API chat
   */
  private async chatOpenAI(messages: ChatMessage[], options: ChatOptions): Promise<ChatMessage> {
    const url = `${this.config.baseURL}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.normalizeOpenAIMessages(messages),
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }

    // Note: OpenAI-compatible API doesn't support format parameter
    // Structured outputs work via system prompt instead

    // Debug log the full request
    const debugLogger = getDebugLogger();
    const systemMsg = messages.find(m => m.role === 'system');
    debugLogger.logLLMRequest({
      url,
      model: this.config.model,
      messageCount: messages.length,
      toolCount: options.tools?.length || 0,
      systemPromptLength: systemMsg?.content?.length || 0,
      fullRequest: body,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new LLMError(`Chat request failed with status ${response.status}: ${text}`, response.status);
    }

    const data = await response.json() as OpenAIChatResponse;

    if (!data.choices?.[0]?.message) {
      const error = 'Chat response missing message';
      debugLogger.logLLMResponse({
        statusCode: response.status,
        contentLength: 0,
        toolCallsCount: 0,
        fullResponse: data,
        error,
      });
      throw new LLMError(error);
    }

    const message = data.choices[0].message;

    // Debug log the response
    debugLogger.logLLMResponse({
      statusCode: response.status,
      contentLength: message.content?.length || 0,
      toolCallsCount: message.tool_calls?.length || 0,
      fullResponse: data,
      parsedContent: message.content?.substring(0, 200),
    });

    return {
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    };
  }

  private normalizeOpenAIMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        const toolCallId = msg.tool_call_id ?? (msg as { tool_call_id?: string }).tool_call_id;

        return {
          role: 'tool',
          content: msg.content ?? '',
          tool_call_id: toolCallId,
        };
      }

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        return {
          ...msg,
          tool_calls: this.normalizeOpenAIToolCalls(msg.tool_calls),
        };
      }

      return msg;
    });
  }

  private normalizeOpenAIToolCalls(toolCalls: ToolCall[]): ToolCall[] {
    return toolCalls.map((call) => {
      const args = call.function.arguments;
      const argumentsStr = typeof args === 'string' ? args : JSON.stringify(args ?? {});

      return {
        id: call.id,
        type: 'function',
        function: {
          name: call.function.name,
          arguments: argumentsStr,
        },
      };
    });
  }

  private shouldForceNativeTools(baseURL: string): boolean {
    const env = process.env.OLLAMA_NATIVE_TOOLS;
    if (env === 'true') {
      return true;
    }
    if (env === 'false') {
      return false;
    }

    try {
      const parsed = new URL(baseURL);
      return parsed.port === '11434';
    } catch {
      return baseURL.includes(':11434');
    }
  }

  private logRequestBody(label: string, body: Record<string, unknown>): void {
    if (process.env.LLM_DEBUG_REQUESTS !== 'true') {
      return;
    }

    const debugLogger = getDebugLogger();
    debugLogger.log(`[UnifiedLLM] ${label} body: ${JSON.stringify(body, null, 2)}`);
  }

  /**
   * Generate embeddings
   */
  async embed(text: string, options: { signal?: AbortSignal } = {}): Promise<number[]> {
    if (this.useNativeAPI) {
      return this.embedNative(text, options);
    } else {
      return this.embedOpenAI(text, options);
    }
  }

  /**
   * Ollama native API embeddings
   */
  private async embedNative(text: string, options: { signal?: AbortSignal }): Promise<number[]> {
    const url = `${this.config.baseURL.replace(/\/v1$/, '')}/api/embeddings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        prompt: text,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new LLMError(`Embedding request failed with status ${response.status}: ${text}`, response.status);
    }

    const data = await response.json() as OllamaEmbedResponse;
    if (!Array.isArray(data.embedding)) {
      throw new LLMError('Embedding response missing embedding vector');
    }
    return data.embedding;
  }

  /**
   * OpenAI-compatible API embeddings
   */
  private async embedOpenAI(text: string, options: { signal?: AbortSignal }): Promise<number[]> {
    const url = `${this.config.baseURL}/embeddings`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: this.config.embeddingModel,
        input: text,
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown error');
      throw new LLMError(`Embedding request failed with status ${response.status}: ${text}`, response.status);
    }

    const data = await response.json() as OpenAIEmbeddingResponse;

    if (!data.data?.[0]?.embedding) {
      throw new LLMError('Embedding response missing embedding vector');
    }

    return data.data[0].embedding;
  }

  /**
   * Transform data using LLM
   */
  async transform(prompt: string, data: unknown): Promise<unknown> {
    const rendered = `${prompt}\n\nData:\n${typeof data === 'string' ? data : JSON.stringify(data)}`;
    const response = await this.chat([{ role: 'user', content: rendered }]);
    return response.content ?? '';
  }
}
