/**
 * Tool System Types
 * 
 * Minimal type definitions for the 6-tool architecture.
 */

export interface Tool<TInput = any, TOutput = any> {
  name: string;
  description: string;
  parameters: JsonSchema;
  execute: (input: TInput) => Promise<TOutput>;
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, PropertySchema>;
  required?: string[];
}

export interface PropertySchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: string[];
  items?: PropertySchema;
  default?: unknown;
  properties?: Record<string, PropertySchema>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}
