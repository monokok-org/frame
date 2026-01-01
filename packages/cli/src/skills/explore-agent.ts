/**
 * Explore Agent Skill
 *
 * Runs a short, read-only exploration sub-agent and returns a concise summary.
 * The sub-agent gets compressed tool outputs to keep context small.
 */

import type { MotorSkill } from '@homunculus-live/core';
import type { ChatMessage, Tool, ToolCall } from '../llm/unified-client.js';
import { getOllamaClient } from '../llm/index.js';
import { logger } from '../utils/logger.js';
import { parseTextToolCalls } from '../utils/tool-call-parser.js';
import { readFile, listDir, getCwd, pathExists } from './filesystem.js';
import { glob, grep, type GrepResult } from './search.js';
import {
  EXPLORE_AGENT_SYSTEM_PROMPT,
  EXPLORE_AGENT_SUMMARY_PROMPT,
} from '../context/prompts/explore-agent.js';

const MAX_TOOL_CALLS = 5;
const MAX_RESULT_CHARS = 1400;
const MAX_LIST_ITEMS = 40;
const MAX_GREP_MATCHES = 15;

const ALLOWED_SKILLS = [readFile, listDir, getCwd, pathExists, glob, grep];

function compactToolSchema(skill: MotorSkill<any, any>): Tool {
  const properties = skill.parameters?.properties || {};
  const required = (skill.parameters?.required || []) as string[];

  const compactProps: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(properties)) {
    const type = (schema as { type?: string }).type || 'string';
    compactProps[name] = { type };
  }

  return {
    type: 'function',
    function: {
      name: skill.id,
      description: skill.name,
      parameters: {
        type: 'object',
        properties: compactProps,
        required,
      },
    },
  };
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function summarizeList(label: string, items: string[], maxItems: number): string {
  if (items.length === 0) {
    return `${label}: (empty)`;
  }
  const shown = items.slice(0, maxItems);
  const extra = items.length - shown.length;
  const suffix = extra > 0 ? ` (+${extra} more)` : '';
  return `${label}: ${shown.join(', ')}${suffix}`;
}

function summarizeGrepResults(results: GrepResult[]): string {
  if (!Array.isArray(results) || results.length === 0) {
    return 'grep: no matches';
  }
  const shown = results.slice(0, MAX_GREP_MATCHES);
  const lines = shown.map((r) => `${r.file}:${r.line} ${r.content}`);
  const extra = results.length - shown.length;
  const suffix = extra > 0 ? `\n(+${extra} more matches)` : '';
  return `grep matches:\n${lines.join('\n')}${suffix}`;
}

function summarizeToolResult(toolName: string, args: Record<string, any>, result: unknown): string {
  if (toolName === 'read-file' && typeof result === 'string') {
    const path = typeof args.path === 'string' ? args.path : '(unknown)';
    const snippet = truncateText(result, MAX_RESULT_CHARS);
    return `read-file ${path}:\n${snippet}`;
  }

  if ((toolName === 'list-dir' || toolName === 'glob') && Array.isArray(result)) {
    return summarizeList(toolName, result.map(String), MAX_LIST_ITEMS);
  }

  if (toolName === 'grep') {
    return summarizeGrepResults(result as GrepResult[]);
  }

  if (typeof result === 'string') {
    return truncateText(result, MAX_RESULT_CHARS);
  }

  if (typeof result === 'boolean') {
    return `${toolName}: ${result ? 'true' : 'false'}`;
  }

  return truncateText(JSON.stringify(result), MAX_RESULT_CHARS);
}

async function executeToolCall(call: ToolCall): Promise<string> {
  const toolName = call.function.name;
  const skill = ALLOWED_SKILLS.find((s) => s.id === toolName);

  if (!skill) {
    return `Error: tool not allowed: ${toolName}`;
  }

  let args: any = {};
  try {
    if (typeof call.function.arguments === 'string') {
      args = JSON.parse(call.function.arguments);
    } else {
      args = call.function.arguments || {};
    }
  } catch (error) {
    return `Error: invalid tool arguments for ${toolName}`;
  }

  try {
    const result = await skill.execute(args);
    return summarizeToolResult(toolName, args, result);
  } catch (error) {
    return `Error: ${String(error)}`;
  }
}

export const exploreAgent: MotorSkill<{ query: string; maxToolCalls?: number }, string> = {
  id: 'explore-agent',
  name: 'Explore Agent',
  description: 'Runs a short, read-only exploration sub-agent and returns a concise summary.',

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to explore or find in the codebase.'
      },
      maxToolCalls: {
        type: 'number',
        description: `Maximum tool calls for the sub-agent (default ${MAX_TOOL_CALLS}).`
      }
    },
    required: ['query']
  },

  async execute({ query, maxToolCalls = MAX_TOOL_CALLS }: { query: string; maxToolCalls?: number }): Promise<string> {
    const llm = getOllamaClient();
    const tools = ALLOWED_SKILLS.map(compactToolSchema);
    const messages: ChatMessage[] = [
      { role: 'system', content: EXPLORE_AGENT_SYSTEM_PROMPT },
      { role: 'user', content: query }
    ];

    let usedToolCalls = 0;

    while (usedToolCalls < maxToolCalls) {
      const response = await llm.chat(messages, { tools });
      let content = response.content ?? '';
      let toolCalls = response.tool_calls ?? [];

      if (toolCalls.length === 0 && content) {
        const parsed = parseTextToolCalls(content);
        if (parsed.toolCalls.length > 0) {
          toolCalls = parsed.toolCalls;
          content = parsed.cleanedText;
        }
      }

      if (toolCalls.length === 0) {
        const final = content.trim();
        return final ? final : 'No findings.';
      }

      messages.push({
        role: 'assistant',
        content,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        if (usedToolCalls >= maxToolCalls) {
          break;
        }
        const result = await executeToolCall(call);
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result,
        });
        usedToolCalls += 1;
      }
    }

    messages.push({
      role: 'user',
      content: EXPLORE_AGENT_SUMMARY_PROMPT,
    });

    try {
      const final = await llm.chat(messages);
      const text = final.content?.trim() || 'No findings.';
      return truncateText(text, MAX_RESULT_CHARS);
    } catch (error) {
      logger.warn(`[explore-agent] Failed to summarize: ${error}`);
      return 'Exploration completed, but summary failed.';
    }
  }
};
