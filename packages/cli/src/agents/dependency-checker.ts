/**
 * Dependency Checker Agent
 *
 * Uses LLM reasoning + file reading to check if dependencies are installed.
 * NO hardcoded parsing - let the LLM figure out the manifest format!
 */

import type { UnifiedLLMClient } from '../llm/unified-client.js';
import { readFile } from '../skills/filesystem.js';
import { logger } from '../utils/logger.js';
import { DEPENDENCY_CHECK_PROMPT } from '../context/prompts/dependency-checker.js';
import { parseJsonObject } from '../utils/llm-json.js';

export interface DependencyCheckResult {
  installed: boolean;
  location?: string; // Where it was found
  version?: string;
  reasoning: string;
}

export class DependencyChecker {
  constructor(private llm: UnifiedLLMClient) {}

  /**
   * Check if dependency is installed by reading manifest and asking LLM
   */
  async check(
    dependency: string,
    manifestPath: string
  ): Promise<DependencyCheckResult> {
    logger.info(`[DependencyChecker] Checking if "${dependency}" is in ${manifestPath}`);

    // Step 1: Read the manifest file using read-file skill
    let manifestContent: string;
    try {
      manifestContent = await this.readFile(manifestPath);
    } catch (error) {
      logger.warn(`[DependencyChecker] Failed to read ${manifestPath}: ${error}`);
      return {
        installed: false,
        reasoning: `Could not read manifest file: ${error}`,
      };
    }

    // Step 2: Ask LLM to analyze
    const prompt = DEPENDENCY_CHECK_PROMPT.replace('{DEPENDENCY}', dependency).replace(
      '{MANIFEST_CONTENT}',
      manifestContent.slice(0, 5000) // Limit content to avoid token overflow
    );

    const response = await this.llm.chat([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    if (!response.content) {
      throw new Error('LLM returned empty response for dependency check');
    }

    // Step 3: Parse LLM response
    try {
      const result = this.parseLLMResponse(response.content);

      logger.info(
        `[DependencyChecker] "${dependency}" ${result.installed ? 'IS' : 'IS NOT'} installed`
      );
      if (result.installed) {
        logger.debug(`[DependencyChecker] Found at: ${result.location}, version: ${result.version || 'N/A'}`);
      }

      return result;
    } catch (error) {
      logger.error(`[DependencyChecker] Failed to parse LLM response: ${error}`);

      // Fallback: simple string search
      return this.fallbackCheck(dependency, manifestContent);
    }
  }

  /**
   * Check multiple manifest files (for monorepos)
   */
  async checkMultiple(
    dependency: string,
    manifestPaths: string[]
  ): Promise<DependencyCheckResult> {
    for (const path of manifestPaths) {
      const result = await this.check(dependency, path);
      if (result.installed) {
        return result; // Found in one of the manifests
      }
    }

    return {
      installed: false,
      reasoning: `Not found in any of ${manifestPaths.length} manifest files`,
    };
  }

  /**
   * Read file using read-file skill
   */
  private async readFile(path: string): Promise<string> {
    const result = await readFile.execute({ path });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /**
   * Parse LLM response
   */
  private parseLLMResponse(content: string): DependencyCheckResult {
    const parsed = parseJsonObject<Record<string, any>>(content);

    return {
      installed: parsed.installed || false,
      location: parsed.location,
      version: parsed.version,
      reasoning: parsed.reasoning || 'LLM analysis',
    };
  }

  /**
   * Fallback if LLM parsing fails (simple string search)
   */
  private fallbackCheck(
    dependency: string,
    manifestContent: string
  ): DependencyCheckResult {
    logger.warn('[DependencyChecker] Using fallback string search');

    const found = manifestContent.toLowerCase().includes(dependency.toLowerCase());

    return {
      installed: found,
      reasoning: found
        ? `Found "${dependency}" via string search (fallback)`
        : `Not found via string search (fallback)`,
    };
  }
}
