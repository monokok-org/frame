/**
 * Agent Tools
 *
 * Lightweight wrappers around sub-agents in src/agents.
 * These return concise summaries to keep context small.
 */

import type { MotorSkill } from '@homunculus-live/core';
import { getOllamaClient } from '../llm/index.js';
import { StructureScout } from '../agents/structure-scout.js';
import { PlatformDetector } from '../agents/platform-detector.js';
import { DependencyChecker } from '../agents/dependency-checker.js';
import { ErrorResearcher } from '../agents/error-researcher.js';

const DEFAULT_MAX_TREE_LINES = 80;
const DEFAULT_MAX_TEXT_CHARS = 1200;

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n... [truncated]`;
}

function summarizeList(label: string, items: string[], maxItems: number): string {
  if (!items || items.length === 0) {
    return `${label}: (none)`;
  }
  const shown = items.slice(0, maxItems);
  const extra = items.length - shown.length;
  const suffix = extra > 0 ? ` (+${extra} more)` : '';
  return `${label}: ${shown.join(', ')}${suffix}`;
}

export const structureScoutSkill: MotorSkill<
  { maxDepth?: number; maxTreeLines?: number },
  string
> = {
  id: 'structure-scout',
  name: 'Structure Scout',
  description: 'Scans project structure and returns a compact summary.',

  parameters: {
    type: 'object',
    properties: {
      maxDepth: {
        type: 'number',
        description: 'Max directory depth to scan (default 2).'
      },
      maxTreeLines: {
        type: 'number',
        description: `Maximum lines of tree output (default ${DEFAULT_MAX_TREE_LINES}).`
      }
    },
    required: []
  },

  async execute({ maxDepth = 2, maxTreeLines = DEFAULT_MAX_TREE_LINES } = {}): Promise<string> {
    const scout = new StructureScout();
    const structure = await scout.discover({ maxDepth });

    const treeText = StructureScout.serializeTree(structure.directoryTree);
    const treeLines = treeText.split('\n');
    const treePreview = treeLines.slice(0, maxTreeLines).join('\n');
    const treeSuffix = treeLines.length > maxTreeLines ? '\n... [tree truncated]' : '';

    const lines = [
      `projectType: ${structure.projectType}`,
      `framework: ${structure.framework ?? 'unknown'}`,
      `packageManager: ${structure.packageManager ?? 'unknown'}`,
      summarizeList('configFiles', structure.configFiles, 12),
      summarizeList('entryPoints', structure.entryPoints, 8),
      summarizeList('scripts', Object.keys(structure.availableScripts || {}), 8),
      `env: dev=${structure.environment.devCommand ?? 'n/a'}, test=${structure.environment.testCommand ?? 'n/a'}, build=${structure.environment.buildCommand ?? 'n/a'}, lint=${structure.environment.lintCommand ?? 'n/a'}`,
      'tree:',
      treePreview + treeSuffix,
    ];

    return truncateText(lines.join('\n'), DEFAULT_MAX_TEXT_CHARS);
  }
};

export const platformDetectorSkill: MotorSkill<void, string> = {
  id: 'platform-detector',
  name: 'Platform Detector',
  description: 'Detects platforms and package managers using a lightweight LLM pass.',

  parameters: {
    type: 'object',
    properties: {},
    required: []
  },

  async execute(): Promise<string> {
    const llm = getOllamaClient();
    const detector = new PlatformDetector(llm as any);
    const result = await detector.detect();

    const lines = [
      `platforms: ${result.platforms.join(', ') || 'unknown'}`,
      `primary: ${result.primary}`,
      `monorepo: ${result.isMonorepo ? 'yes' : 'no'}`,
      summarizeList(
        'packageManagers',
        Object.entries(result.packageManagers || {}).map(([k, v]) => `${k}:${v}`),
        8
      ),
      summarizeList(
        'dependencyFiles',
        Object.entries(result.dependencyFiles || {}).flatMap(([k, v]) => v.map((p) => `${k}:${p}`)),
        12
      ),
      truncateText(`reasoning: ${result.evidence.reasoning || 'n/a'}`, 240),
    ];

    return truncateText(lines.join('\n'), DEFAULT_MAX_TEXT_CHARS);
  }
};

export const dependencyCheckerSkill: MotorSkill<
  { dependency: string; manifestPath: string },
  string
> = {
  id: 'dependency-checker',
  name: 'Dependency Checker',
  description: 'Checks whether a dependency is present in a manifest file.',

  parameters: {
    type: 'object',
    properties: {
      dependency: {
        type: 'string',
        description: 'Dependency name to check (e.g., "react", "vite").'
      },
      manifestPath: {
        type: 'string',
        description: 'Path to the manifest file (e.g., package.json, requirements.txt).'
      }
    },
    required: ['dependency', 'manifestPath']
  },

  async execute({ dependency, manifestPath }: { dependency: string; manifestPath: string }): Promise<string> {
    const llm = getOllamaClient();
    const checker = new DependencyChecker(llm as any);
    const result = await checker.check(dependency, manifestPath);

    const lines = [
      `dependency: ${dependency}`,
      `manifest: ${manifestPath}`,
      `installed: ${result.installed ? 'yes' : 'no'}`,
      `location: ${result.location ?? 'n/a'}`,
      `version: ${result.version ?? 'n/a'}`,
      `reasoning: ${result.reasoning}`,
    ];

    return truncateText(lines.join('\n'), DEFAULT_MAX_TEXT_CHARS);
  }
};

export const errorResearcherSkill: MotorSkill<
  { command: string; errorOutput: string; projectType?: string; technology?: string },
  string
> = {
  id: 'error-researcher',
  name: 'Error Researcher',
  description: 'Searches the web for non-trivial command errors and summarizes likely fixes.',

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The command that failed.'
      },
      errorOutput: {
        type: 'string',
        description: 'The error output to research.'
      },
      projectType: {
        type: 'string',
        description: 'Optional project type or stack hint.'
      },
      technology: {
        type: 'string',
        description: 'Optional technology hint (e.g., "vite", "next").'
      }
    },
    required: ['command', 'errorOutput']
  },

  async execute({
    command,
    errorOutput,
    projectType,
    technology
  }: {
    command: string;
    errorOutput: string;
    projectType?: string;
    technology?: string;
  }): Promise<string> {
    const researcher = new ErrorResearcher();
    const result = await researcher.researchError(command, errorOutput, {
      projectType,
      technology
    });

    const lines = [
      `searched: ${result.searched ? 'yes' : 'no'}`,
      `confidence: ${result.confidence.toFixed(2)}`,
      summarizeList('sources', result.sources || [], 3),
    ];

    if (result.solution) {
      lines.push(`solution: ${truncateText(result.solution, 600)}`);
    }

    return truncateText(lines.join('\n'), DEFAULT_MAX_TEXT_CHARS);
  }
};

export const agentTools = [
  structureScoutSkill,
  platformDetectorSkill,
  dependencyCheckerSkill,
  errorResearcherSkill,
];
