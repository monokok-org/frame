/**
 * Tool Call Parser
 *
 * Fallback parser for models that output tool calls as text instead of using proper function calling.
 * Detects patterns like: [tool-name arg1="value" arg2="value"]
 */

import type { ToolCall } from '../llm/unified-client.js';
import { TOOL_CAPABILITIES } from '../skills/tool-capabilities.js';

/**
 * Parse text-based tool calls from model output
 *
 * Supports formats:
 * - [tool-name arg="value"]
 * - [tool-name {"arg": "value"}]
 * - tool-name(arg="value")
 */
export function parseTextToolCalls(text: string): { toolCalls: ToolCall[]; cleanedText: string } {
  const toolCalls: ToolCall[] = [];
  let cleanedText = text;

  // Pattern 1: [tool-name arg="value" arg2="value"]
  const bracketPattern = /\[([a-z-]+)\s+([^\]]+)\]/gi;
  let match;

  while ((match = bracketPattern.exec(text)) !== null) {
    const toolName = match[1];
    const argsStr = match[2];

    // Parse arguments
    const args = parseArguments(argsStr);

    if (args) {
      toolCalls.push({
        id: `parsed_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: args,
        },
      });

      // Remove from text
      cleanedText = cleanedText.replace(match[0], '').trim();
    }
  }

  // Pattern 2: tool-name(args)
  const parenPattern = /([a-z-]+)\(([^)]+)\)/gi;

  while ((match = parenPattern.exec(text)) !== null) {
    const toolName = match[1];
    const argsStr = match[2];

    // Parse arguments
    const args = parseArguments(argsStr);

    if (args && isValidToolName(toolName)) {
      toolCalls.push({
        id: `parsed_${Date.now()}_${toolCalls.length}`,
        type: 'function',
        function: {
          name: toolName,
          arguments: args,
        },
      });

      // Remove from text
      cleanedText = cleanedText.replace(match[0], '').trim();
    }
  }

  return { toolCalls, cleanedText };
}

/**
 * Parse arguments from various formats
 */
function parseArguments(argsStr: string): Record<string, any> | null {
  // Try JSON first
  if (argsStr.trim().startsWith('{')) {
    try {
      return JSON.parse(argsStr);
    } catch {
      // Not valid JSON, continue
    }
  }

  // Parse key="value" format
  const args: Record<string, any> = {};
  const argPattern = /(\w+)=["']([^"']+)["']/g;
  let match;
  let foundAny = false;

  while ((match = argPattern.exec(argsStr)) !== null) {
    args[match[1]] = match[2];
    foundAny = true;
  }

  // Also try key=value without quotes
  const unquotedPattern = /(\w+)=([^\s,]+)/g;
  while ((match = unquotedPattern.exec(argsStr)) !== null) {
    if (!args[match[1]]) { // Don't override quoted values
      args[match[1]] = match[2];
      foundAny = true;
    }
  }

  return foundAny ? args : null;
}

/**
 * Check if a name looks like a valid tool name
 */
const EXTRA_TOOL_IDS = ['plan-task'];
const VALID_TOOL_NAMES = new Set([
  ...TOOL_CAPABILITIES.map((tool) => tool.id),
  ...EXTRA_TOOL_IDS,
]);

function isValidToolName(name: string): boolean {
  return VALID_TOOL_NAMES.has(name);
}
