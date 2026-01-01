/**
 * Verifier Prompt (Simplified)
 *
 * Used by Direct Executor in VERIFY state.
 * Checks success criteria and performs root cause analysis on failure.
 */

import type { VerificationResult, ExecutionPlan, ToolResult } from '../../types/executor.js';
import { logger } from '../../utils/logger.js';
import { parseJsonObject } from '../../utils/llm-json.js';

/**
 * System prompt for verifier
 */
export const VERIFIER_SYSTEM_PROMPT = `You are a verification and diagnostics specialist for a coding agent.
Verify success criteria against tool results; if failed, diagnose why and suggest fixes.

Root cause categories: missing-dependency, missing-file, missing-directory, syntax-error, configuration-error, permission-denied, network-error, environment-error, unknown.

Output JSON only.

Success:
{
  "success": true,
  "criteria": [{"criterion": "...", "satisfied": true, "reason": "..."}],
  "overallReason": "Summary"
}

Failure (rootCause required):
{
  "success": false,
  "criteria": [{"criterion": "...", "satisfied": false, "reason": "..."}],
  "overallReason": "Summary",
  "rootCause": {
    "category": "missing-dependency",
    "diagnosis": "What went wrong",
    "evidence": ["Exact error messages or tool output"],
    "suggestedFixes": [
      {
        "description": "What this fix does",
        "confidence": 0.9,
        "steps": [
          {"step": 1, "description": "...", "tool": "exec-command", "args": {...}, "expectedOutcome": "..."}
        ]
      }
    ]
  }
}

Rules:
- Use evidence from tool results; quote errors.
- Accept success if core functionality is proven; no visual/manual checks.
`;

/**
 * Build verifier user message
 */
export function buildVerifierMessage(
  plan: ExecutionPlan,
  toolResults: ToolResult[]
): string {
  const sections: string[] = [];

  sections.push('# Plan Goal');
  sections.push(plan.goal);
  sections.push('');

  sections.push('# Success Criteria');
  plan.successCriteria.forEach((criterion, i) => {
    sections.push(`${i + 1}. ${criterion}`);
  });
  sections.push('');

  sections.push('# Tool Execution Results');
  toolResults.forEach((result, i) => {
    sections.push(`## Step ${i + 1}: ${result.tool}`);
    sections.push(`Success: ${result.success}`);
    sections.push(`Args: ${JSON.stringify(result.args)}`);

    if (result.error) {
      sections.push(`Error: ${result.error}`);
    } else {
      const resultStr = typeof result.result === 'string'
        ? result.result.slice(0, 500) // Truncate long outputs
        : JSON.stringify(result.result);
      sections.push(`Result: ${resultStr}`);
    }
    sections.push('');
  });

  return sections.join('\n');
}

/**
 * Parse verifier output (JSON)
 */
export function parseVerifierOutput(output: string): VerificationResult {
  try {
    const parsed = parseJsonObject<VerificationResult>(output);

    // Validate structure
    if (typeof parsed.success !== 'boolean') {
      throw new Error('Invalid verification result: missing or invalid "success" field');
    }

    if (!parsed.criteria || !Array.isArray(parsed.criteria)) {
      throw new Error('Invalid verification result: missing or invalid "criteria" field');
    }

    if (!parsed.overallReason) {
      throw new Error('Invalid verification result: missing "overallReason" field');
    }

    // Validate root cause (if present)
    if (parsed.rootCause) {
      if (!parsed.rootCause.category || !parsed.rootCause.diagnosis) {
        throw new Error('Invalid root cause: missing category or diagnosis');
      }

      if (!parsed.rootCause.evidence || !Array.isArray(parsed.rootCause.evidence)) {
        throw new Error('Invalid root cause: missing or invalid evidence array');
      }

      // suggestedFixes is optional but must be array if present
      if (parsed.rootCause.suggestedFixes && !Array.isArray(parsed.rootCause.suggestedFixes)) {
        throw new Error('Invalid root cause: suggestedFixes must be an array');
      }
    }

    // If verification failed but no root cause provided, warn (but don't fail)
    if (!parsed.success && !parsed.rootCause) {
      logger.warn('[verifier] Verification failed but no root cause analysis provided');
    }

    return parsed as VerificationResult;
  } catch (error) {
    throw new Error(`Failed to parse verifier output: ${error}`);
  }
}
