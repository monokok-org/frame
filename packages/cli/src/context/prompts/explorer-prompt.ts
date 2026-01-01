/**
 * Explorer Prompt
 *
 * Used by Direct Executor in EXPLORE state.
 * Explores codebase BEFORE planning to discover context and patterns.
 */

import type { ExplorationFindings } from '../../types/executor.js';
import { parseJsonObject } from '../../utils/llm-json.js';

/**
 * System prompt for explorer
 */
export const EXPLORER_SYSTEM_PROMPT = `You are a codebase explorer for a coding agent.
Output ONLY valid JSON.

Read-only: no write-file/edit-file/exec-command. Allowed tools: glob, grep, read-file, list-dir, get-cwd, path-exists.

Workflow:
1) Call get-cwd first.
2) Use list-dir and targeted glob/grep to locate relevant files; avoid repo-wide scans.
3) Read the minimum number of files (prefer 1-3) and only when needed.
4) After ~3-6 tools, return findings.

Tool call JSON:
{"tool":"tool-name","args":{"arg1":"value1"},"reasoning":"short reason"}

Final findings JSON:
{
  "projectContext": {
    "cwd": "/absolute/path/to/project",
    "projectType": "Type determined from markers (react|python|go|ruby|etc)",
    "markers": ["Key evidence identifying project type"],
    "documentation": [
      {"path": "README.md", "summary": "Key points from docs"}
    ],
    "structure": "Top-level directory layout"
  },
  "patterns": ["Code patterns observed"],
  "similarFeatures": ["path/to/file - What it does"],
  "criticalFiles": ["path/to/file - Why relevant"],
  "recommendations": ["Implementation guidance"]
}

Rules:
- All fields required (use [] when empty).
- Paths in output are relative to the CWD.
- Be language-agnostic; infer project type from markers you saw.
`;

/**
 * Build explorer user message
 */
export function buildExplorerMessage(context: string): string {
  return context;
}

/**
 * Parse explorer output (JSON)
 */
export function parseExplorerOutput(output: string): ExplorationFindings {
  try {
    const parsed = parseJsonObject<ExplorationFindings>(output);

    // Validate projectContext (mandatory)
    if (!parsed.projectContext || typeof parsed.projectContext !== 'object') {
      throw new Error('Invalid exploration output: missing projectContext');
    }

    if (!parsed.projectContext.cwd || !parsed.projectContext.projectType) {
      throw new Error('Invalid projectContext: missing cwd or projectType');
    }

    if (!parsed.projectContext.markers || !Array.isArray(parsed.projectContext.markers)) {
      throw new Error('Invalid projectContext: missing or invalid markers array');
    }

    if (!parsed.projectContext.documentation || !Array.isArray(parsed.projectContext.documentation)) {
      throw new Error('Invalid projectContext: missing or invalid documentation array');
    }

    // Validate other fields
    if (!parsed.patterns || !Array.isArray(parsed.patterns)) {
      throw new Error('Invalid exploration output: missing patterns array');
    }

    if (!parsed.similarFeatures || !Array.isArray(parsed.similarFeatures)) {
      throw new Error('Invalid exploration output: missing similarFeatures array');
    }

    if (!parsed.criticalFiles || !Array.isArray(parsed.criticalFiles)) {
      throw new Error('Invalid exploration output: missing criticalFiles array');
    }

    if (!parsed.recommendations || !Array.isArray(parsed.recommendations)) {
      throw new Error('Invalid exploration output: missing recommendations array');
    }

    return parsed as ExplorationFindings;
  } catch (error) {
    throw new Error(`Failed to parse explorer output: ${error}`);
  }
}
