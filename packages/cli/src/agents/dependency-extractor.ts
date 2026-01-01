/**
 * Dependency Extractor Agent
 *
 * Uses LLM reasoning + file reading to extract dependency lists.
 * NO hardcoded parsing - let the LLM figure out the manifest format!
 */

import type { UnifiedLLMClient } from '../llm/unified-client.js';
import { readFile } from '../skills/filesystem.js';
import { logger } from '../utils/logger.js';
import { DEPENDENCY_EXTRACT_PROMPT } from '../context/prompts/dependency-extractor.js';
import { parseJsonObject } from '../utils/llm-json.js';

export interface ExtractedDependency {
  name: string;
  version: string | null;
  type: 'dependency' | 'devDependency';
}

export interface DependencyExtractionResult {
  dependencies: ExtractedDependency[];
  reasoning: string;
}

export class DependencyExtractor {
  constructor(private llm: UnifiedLLMClient) {}

  /**
   * Extract dependency list by reading manifest and asking LLM
   */
  async extract(manifestPath: string): Promise<DependencyExtractionResult> {
    logger.info(`[DependencyExtractor] Extracting dependencies from ${manifestPath}`);

    let manifestContent: string;
    try {
      manifestContent = await this.readFile(manifestPath);
    } catch (error) {
      logger.warn(`[DependencyExtractor] Failed to read ${manifestPath}: ${error}`);
      return {
        dependencies: [],
        reasoning: `Could not read manifest file: ${error}`,
      };
    }

    const prompt = DEPENDENCY_EXTRACT_PROMPT.replace(
      '{MANIFEST_CONTENT}',
      manifestContent.slice(0, 8000)
    );

    const response = await this.llm.chat([
      {
        role: 'user',
        content: prompt,
      },
    ]);

    if (!response.content) {
      throw new Error('LLM returned empty response for dependency extraction');
    }

    try {
      const result = this.parseLLMResponse(response.content);
      logger.info(
        `[DependencyExtractor] Found ${result.dependencies.length} dependencies in ${manifestPath}`
      );
      return result;
    } catch (error) {
      logger.error(`[DependencyExtractor] Failed to parse LLM response: ${error}`);
      return {
        dependencies: [],
        reasoning: 'LLM parsing failed',
      };
    }
  }

  /**
   * Read file using read-file skill
   */
  private async readFile(path: string): Promise<string> {
    const result = await readFile.execute({ path });
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  /**
   * Parse and normalize LLM response
   */
  private parseLLMResponse(content: string): DependencyExtractionResult {
    const parsed = parseJsonObject<Record<string, any>>(content);
    const rawDependencies = Array.isArray(parsed.dependencies) ? parsed.dependencies : [];
    const dependencies = this.normalizeDependencies(rawDependencies);

    return {
      dependencies,
      reasoning: parsed.reasoning || 'LLM analysis',
    };
  }

  private normalizeDependencies(rawDependencies: Array<Record<string, any>>): ExtractedDependency[] {
    const seen = new Map<string, ExtractedDependency>();

    for (const dep of rawDependencies) {
      if (!dep || typeof dep !== 'object') {
        continue;
      }

      const name = typeof dep.name === 'string' ? dep.name.trim() : '';
      if (!name) {
        continue;
      }

      const version =
        typeof dep.version === 'string' && dep.version.trim().length > 0
          ? dep.version.trim()
          : null;
      const type = this.normalizeType(dep.type);
      const key = name.toLowerCase();

      const existing = seen.get(key);
      if (existing) {
        const resolvedType = this.preferDependency(existing.type, type);
        const resolvedVersion = existing.version ?? version;
        seen.set(key, {
          name: existing.name,
          version: resolvedVersion ?? null,
          type: resolvedType
        });
        continue;
      }

      seen.set(key, { name, version, type });
    }

    return Array.from(seen.values());
  }

  private normalizeType(value: unknown): 'dependency' | 'devDependency' {
    const normalized = String(value || '').toLowerCase();
    if (
      normalized.includes('dev') ||
      normalized.includes('test') ||
      normalized.includes('build') ||
      normalized.includes('optional')
    ) {
      return 'devDependency';
    }
    return 'dependency';
  }

  private preferDependency(
    current: 'dependency' | 'devDependency',
    incoming: 'dependency' | 'devDependency'
  ): 'dependency' | 'devDependency' {
    if (current === 'dependency' || incoming === 'dependency') {
      return 'dependency';
    }
    return 'devDependency';
  }
}
