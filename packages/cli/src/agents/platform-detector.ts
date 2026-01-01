/**
 * Platform Detector Agent
 *
 * Uses LLM reasoning + existing tools (glob, grep, read-file) to detect platform(s)
 * instead of hardcoded if-checks. Handles monorepos, multi-language projects, etc.
 */

import type { UnifiedLLMClient } from '../llm/unified-client.js';
import { glob } from '../skills/search.js';
import { logger } from '../utils/logger.js';
import { PLATFORM_DETECTION_PROMPT } from '../context/prompts/platform-detector.js';
import { parseJsonObject } from '../utils/llm-json.js';

export interface PlatformDetectionResult {
  platforms: string[]; // Can be multiple! ['nodejs', 'python', 'rust']
  primary: string; // Best guess for primary platform
  isMonorepo: boolean;
  evidence: {
    files: string[];
    reasoning: string;
  };
  packageManagers: Record<string, string>; // { nodejs: 'pnpm', python: 'poetry' }
  dependencyFiles: Record<string, string[]>; // { nodejs: ['package.json'], python: ['requirements.txt'] }
}

export class PlatformDetector {
  constructor(private llm: UnifiedLLMClient) {}

  /**
   * Detect platform(s) using LLM reasoning over file listings
   */
  async detect(projectRoot: string = process.cwd()): Promise<PlatformDetectionResult> {
    logger.info('[PlatformDetector] Detecting platform using LLM reasoning...');

    // Step 1: Use glob to list all files in project root (non-recursive)
    const rootFiles = await this.listFiles(projectRoot, '*');

    // Step 2: Use glob to detect common patterns (package manifests, monorepo structures)
    const manifestPatterns = [
      'package.json',
      'Cargo.toml',
      'go.mod',
      'requirements.txt',
      'pyproject.toml',
      'Pipfile',
      'pom.xml',
      'build.gradle',
      '*.csproj',
      'Gemfile',
      'composer.json',
      'packages/*/package.json', // Monorepo patterns
      'apps/*',
      'services/*',
    ];

    const manifestFiles: string[] = [];
    for (const pattern of manifestPatterns) {
      try {
        const matches = await this.glob(pattern);
        manifestFiles.push(...matches);
      } catch {
        // Pattern didn't match, skip
      }
    }

    // Step 3: Combine all evidence
    const allFiles = [...new Set([...rootFiles, ...manifestFiles])];

    logger.debug(`[PlatformDetector] Found ${allFiles.length} files to analyze`);

    // Step 4: Ask LLM to analyze
    const fileList = allFiles.slice(0, 100).join('\n'); // Limit to avoid token overflow

    const response = await this.llm.chat([
      {
        role: 'user',
        content: PLATFORM_DETECTION_PROMPT + fileList,
      },
    ]);

    if (!response.content) {
      throw new Error('LLM returned empty response for platform detection');
    }

    // Step 5: Parse LLM response
    try {
      const result = this.parseLLMResponse(response.content);

      logger.info(
        `[PlatformDetector] Detected platforms: ${result.platforms.join(', ')} (primary: ${result.primary})`
      );
      logger.debug(`[PlatformDetector] Reasoning: ${result.evidence.reasoning}`);

      return result;
    } catch (error) {
      logger.error(`[PlatformDetector] Failed to parse LLM response: ${error}`);
      logger.debug(`[PlatformDetector] Raw response: ${response.content}`);

      // Fallback to simple detection
      return this.fallbackDetection(allFiles);
    }
  }

  /**
   * Use glob skill to list files
   */
  private async glob(pattern: string): Promise<string[]> {
    const result = await glob.execute({ pattern });
    return Array.isArray(result) ? result : [];
  }

  /**
   * List files in directory
   */
  private async listFiles(_dir: string, pattern: string): Promise<string[]> {
    try {
      const files = await this.glob(pattern);
      return files;
    } catch {
      return [];
    }
  }

  /**
   * Parse LLM response (expects JSON)
   */
  private parseLLMResponse(content: string): PlatformDetectionResult {
    const parsed = parseJsonObject<Record<string, any>>(content);

    return {
      platforms: parsed.platforms || [],
      primary: parsed.primary || parsed.platforms?.[0] || 'unknown',
      isMonorepo: parsed.isMonorepo || false,
      evidence: {
        files: [],
        reasoning: parsed.reasoning || 'LLM analysis',
      },
      packageManagers: parsed.packageManagers || {},
      dependencyFiles: parsed.dependencyFiles || {},
    };
  }

  /**
   * Fallback detection if LLM fails - returns unknown
   */
  private fallbackDetection(_files: string[]): PlatformDetectionResult {
    logger.error('[PlatformDetector] LLM parsing failed - cannot detect platform without hardcoding');

    return {
      platforms: ['unknown'],
      primary: 'unknown',
      isMonorepo: false,
      evidence: {
        files: [],
        reasoning: 'LLM parsing failed - no fallback heuristics available (by design)',
      },
      packageManagers: {},
      dependencyFiles: {},
    };
  }
}
