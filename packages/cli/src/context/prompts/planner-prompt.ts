/**
 * Planner Prompt
 *
 * Used by Direct Executor in PLAN state.
 * Enhanced with tool capability awareness to prevent hallucination.
 */

import type { ExecutionPlan } from '../../types/executor.js';
import { getDebugLogger } from '../../utils/debug-logger.js';
import { generateToolContextForPlanner } from '../../skills/tool-capabilities.js';
import { parseJsonObject } from '../../utils/llm-json.js';

/**
 * Get base system prompt for planner (with tool capabilities injected)
 */
function getPlannerSystemPrompt(): string {
  const toolContext = generateToolContextForPlanner();

  return `You are a task planner for a coding agent.
Create a JSON execution plan using available tools.

Honesty:
- If unsure, use "uncertainties" or "needsResearch".
- Do not invent packages, commands, or APIs.

${toolContext}

Rules:
1) Paths are relative to Working Directory; never prepend the project folder name.
2) Use exploration findings; keep plan 3-7 steps; one tool per step.
3) Read-file before edit/write; include required args.
4) Commands must be non-interactive (use -y/--yes).
5) On retry/failure, fix root cause first and change the plan.

Output JSON only (no markdown), starting with { and ending with }:
{
  "goal": "One sentence describing the objective",
  "confidence": 0.0-1.0,
  "uncertainties": ["Unknowns, if any"],
  "needsResearch": ["Topics to research, if any"],
  "steps": [
    {
      "step": 1,
      "description": "What this step does",
      "tool": "tool-name",
      "args": {"arg": "value"},
      "expectedOutcome": "What should happen if successful"
    }
  ],
  "successCriteria": ["Measurable end results"],
  "criticalFiles": ["path/to/file - Why this file matters"]
}

Confidence guide: 1.0 confident, 0.8-0.9 standard, 0.6-0.7 some assumptions, <0.5 needs research.
If confidence < 0.5, populate "uncertainties" or "needsResearch".
`;
}

/**
 * System prompt for planner (dynamically generated with tool capabilities)
 */
export const PLANNER_SYSTEM_PROMPT = getPlannerSystemPrompt();

/**
 * Build planner user message
 */
export function buildPlannerMessage(context: string): string {
  return context;
}

/**
 * Parse planner output (JSON)
 */
export function parsePlannerOutput(output: string): ExecutionPlan {
  try {
    const parsed = parseJsonObject<ExecutionPlan>(output);
    const debugLogger = getDebugLogger();
    debugLogger.log(`[Planner] Parsed plan: ${JSON.stringify(parsed)}`);
    // Validate required fields
    if (!parsed.goal || !parsed.steps || !Array.isArray(parsed.steps)) {
      throw new Error('Invalid plan structure: missing goal or steps');
    }

    if (!parsed.successCriteria || !Array.isArray(parsed.successCriteria)) {
      throw new Error('Invalid plan structure: missing successCriteria');
    }

    // Ensure confidence is present (default to 0.5 if missing for backward compatibility)
    if (typeof parsed.confidence !== 'number') {
      parsed.confidence = 0.5;
    }

    // Ensure optional arrays exist
    if (!parsed.criticalFiles) {
      parsed.criticalFiles = [];
    } else if (!Array.isArray(parsed.criticalFiles)) {
      parsed.criticalFiles = [parsed.criticalFiles];
    }

    if (!parsed.uncertainties) {
      parsed.uncertainties = [];
    } else if (!Array.isArray(parsed.uncertainties)) {
      parsed.uncertainties = [parsed.uncertainties];
    }

    if (!parsed.needsResearch) {
      parsed.needsResearch = [];
    } else if (!Array.isArray(parsed.needsResearch)) {
      parsed.needsResearch = [parsed.needsResearch];
    }

    return parsed as ExecutionPlan;
  } catch (error) {
    throw new Error(`Failed to parse planner output: ${error}`);
  }
}

/**
 * Build a prompt to ask LLM to complete a malformed plan
 */
export function buildPlanCompletionPrompt(malformedOutput: string, error: string): string {
  return `The plan you generated was incomplete. Error: ${error}

Your previous output:
${malformedOutput}

Please complete the plan by adding the missing fields. Output the COMPLETE plan as valid JSON.

Required format:
{
  "goal": "One sentence describing the objective",
  "steps": [...],
  "successCriteria": [
    "SPECIFIC, measurable criteria (e.g., 'File src/Login.tsx exists and exports Login component')",
    "NOT vague like 'all steps completed' - be CONCRETE"
  ],
  "criticalFiles": []
}

CRITICAL: successCriteria must be SPECIFIC (file exists, command output contains X, test passes) NOT generic ("task completed", "no errors").`;
}
