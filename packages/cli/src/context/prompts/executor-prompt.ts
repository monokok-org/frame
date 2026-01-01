/**
 * Executor Prompt (Simplified)
 *
 * Used by Direct Executor in EXECUTE state.
 * Uses STATEFUL context (execution history + workspace).
 */

import type { PlanStep, ToolResult } from '../../types/executor.js';
import { parseJsonObject } from '../../utils/llm-json.js';

/**
 * System prompt for executor
 */
export const EXECUTOR_SYSTEM_PROMPT = `You are a tool executor for a coding agent.
Return ONLY JSON tool invocations; you do not execute tools.

Formats:
{"tool":"tool-name","args":{"arg1":"value1"},"reasoning":"short reason"}
{"error":"Why step is impossible","suggestion":"Plan adjustment"}

Rules:
- Use paths relative to Working Directory in context.
- Follow the plan step; bias to action; do not refuse tools.
- Read-file before edit/write.
- write-file requires path+content.
- edit-file requires path + edits array (use replace/insert/delete/replace-between; matchMode defaults to smart).
- Use knowledge-query (Framebase) for up-to-date info before web-search; include exact versions when relevant.
- Use ask-user-question when clarification is needed before proceeding.
- Output valid JSON only.

Available tools: ask-user-question, exec-command, read-file, write-file, edit-file, list-dir, glob, grep, get-cwd, path-exists, web-search, web-fetch, knowledge-query, explore-agent, structure-scout, platform-detector, dependency-checker, error-researcher.
`;

/**
 * Build executor user message
 */
export function buildExecutorMessage(
  step: PlanStep,
  context: string,
  previousResults?: ToolResult[]
): string {
  const sections: string[] = [];

  sections.push('# Current Step');
  sections.push(JSON.stringify(step, null, 2));
  sections.push('');

  if (previousResults && previousResults.length > 0) {
    sections.push('# Previous Step Results');
    previousResults.forEach((result, i) => {
      sections.push(`## Step ${i + 1}: ${result.tool}`);
      sections.push(`Success: ${result.success}`);
      if (result.error) {
        sections.push(`Error: ${result.error}`);
      } else {
        sections.push(`Result: ${JSON.stringify(result.result)}`);
      }
      sections.push('');
    });
  }

  sections.push('# Context');
  sections.push(context);

  return sections.join('\n');
}

/**
 * Parse executor output (JSON)
 */
export function parseExecutorOutput(output: string): {
  tool?: string;
  args?: Record<string, any>;
  reasoning?: string;
  error?: string;
  suggestion?: string;
} {
  try {
    const parsed = parseJsonObject<Record<string, any>>(output);

    // Validate structure (either tool execution or error)
    if (!parsed.tool && !parsed.error) {
      throw new Error('Invalid executor output: must have either "tool" or "error" field');
    }

    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse executor output: ${error}`);
  }
}
