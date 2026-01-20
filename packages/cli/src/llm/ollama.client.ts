import { Ollama } from 'ollama';
import type {
    LLMClient,
    LLMConfig,
    Message,
    ChatOptions,
    ChatResponse,
    ToolCallMessage
} from './types.js';
import { logger } from '../utils/logger.js';

export class OllamaClient implements LLMClient {
    private client: Ollama;
    private model: string;

    constructor(config: LLMConfig) {
        this.model = config.model;
        // Ollama library expects 'host' (e.g. 'http://127.0.0.1:11434')
        this.client = new Ollama({
            host: config.baseUrl
        });
    }

    getModel(): string {
        return this.model;
    }

    async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
        const ollamaMessages = this.convertMessages(messages);

        const requestOptions: any = {
            temperature: options?.temperature,
            num_predict: options?.maxTokens
        };

        // Remove undefined values
        Object.keys(requestOptions).forEach(key =>
            requestOptions[key] === undefined && delete requestOptions[key]
        );

        try {
            logger.debug('Ollama request', {
                data: ollamaMessages.map(i => JSON.stringify(i)).join("\n"),
                model: this.model,
                messageCount: ollamaMessages.length,
                hasTools: !!options?.tools?.length
            });

            const response = await this.client.chat({
                model: this.model,
                messages: ollamaMessages,
                tools: options?.tools as any, // Cast to avoid strict type checks on complex tool types
                options: requestOptions,
                stream: false
            });

            return this.parseResponse(response);
        } catch (error: any) {
            logger.error('Ollama request failed', { error: error.message });
            throw new Error(`Ollama API error: ${error.message}`);
        }
    }

    private convertMessages(messages: Message[]): any[] {
        return messages.map(msg => {
            const ollamaMsg: any = {
                role: msg.role,
                content: msg.content
            };

            if (msg.toolCalls) {
                ollamaMsg.tool_calls = msg.toolCalls.map(tc => ({
                    function: {
                        name: tc.name,
                        arguments: tc.arguments
                    }
                }));
            }
            return ollamaMsg;
        });
    }

    private parseResponse(response: any): ChatResponse {
        const message = response.message;
        const toolCalls: ToolCallMessage[] = [];

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                toolCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, 
                    name: tc.function.name,
                    arguments: tc.function.arguments 
                });
            }
        }

        return {
            content: message.content || '',
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop'
        };
    }
}
