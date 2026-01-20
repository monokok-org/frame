/**
 * Tool Registry
 * 
 */

import type { Tool, ToolCall, ToolResult } from './types.js';
import { findTool } from './find.js';
import { editTool } from './edit.js';
import { runTool } from './run.js';
import { knowledgeTool } from './knowledge.js';
import { doneTool } from './done.js';
import { askTool } from './ask.js';

// All tools
export const tools: Tool[] = [
  findTool,
  editTool,
  runTool,
  knowledgeTool,
  doneTool,
  askTool
];

// Tool lookup map
const toolMap = new Map<string, Tool>(
  tools.map(t => [t.name, t])
);

/**
 * Get tool by name
 */
export function getTool(name: string): Tool | undefined {
  return toolMap.get(name);
}

/**
 * Execute a tool call
 */
export async function executeTool(call: ToolCall): Promise<ToolResult> {
  const tool = getTool(call.name);
  
  if (!tool) {
    return {
      toolCallId: call.id,
      content: `Unknown tool: ${call.name}`,
      isError: true
    };
  }

  try {
    const result = await tool.execute(call.arguments);
    return {
      toolCallId: call.id,
      content: typeof result === 'string' ? result : JSON.stringify(result, null, 2)
    };
  } catch (error) {
    return {
      toolCallId: call.id,
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      isError: true
    };
  }
}

/**
 * Generate tool definitions for LLM
 * Format: OpenAI function calling style
 */
export function getToolDefinitions(): object[] {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

// Re-export types
export type { Tool, ToolCall, ToolResult } from './types.js';
