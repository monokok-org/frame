/**
 * Motor Skills for File Search Operations
 *
 * glob - Find files by pattern
 * grep - Search file contents
 */

import { glob as globSearch } from 'glob';
import fs from 'fs';
import path from 'path';
import type { MotorSkill } from '@homunculus-live/core';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { isTextFile } from '../utils/file-utils.js';

const EXCLUDE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  '.aga-v2/**',
  'coverage/**'
];

// Simple cache for glob results (10 second TTL)
const globCache = new Map<string, { files: string[]; timestamp: number }>();
const CACHE_TTL_MS = 10000;

/**
 * Find files matching a glob pattern
 */
export const glob: MotorSkill<{ pattern: string; path?: string }, string[]> = {
  id: 'glob',
  name: 'Find Files',
  description: `Searches for files matching a glob pattern.

IMPORTANT: The "pattern" parameter is the glob pattern, NOT a path!
- CORRECT: glob(pattern="src/**/*.tsx")
- WRONG: glob(path="src/**/*.tsx") - this searches for pattern "undefined" in directory "src/**/*.tsx"

CRITICAL PATH RULES:
- Searches relative to CURRENT WORKING DIRECTORY (use get-cwd first)
- If CWD is "/path/to/project", pattern "src/**/*.ts" searches /path/to/project/src/**/*.ts
- NEVER prepend the project directory name to patterns

Usage:
- Fast file pattern matching with 10-second result cache
- Supports patterns like "**/*.js", "src/**/*.tsx", "components/ui/**"
- Prefer this tool over bash commands (find/ls)`,

  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match (REQUIRED - e.g., "src/**/*.ts", "**/*.tsx")'
      },
      path: {
        type: 'string',
        description: 'Optional base directory to search from (defaults to CWD). Usually not needed.'
      }
    },
    required: ['pattern']
  },

  async execute(input: { pattern: string; path?: string }): Promise<string[]> {
    const pattern = input.pattern;

    if (!pattern) {
      throw new Error('glob requires a "pattern" parameter. Did you mean to use pattern="..." instead of path="..."?');
    }

    try {
      const projectRoot = input.path || process.cwd();

      // Check cache
      const cached = globCache.get(pattern);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        logger.debug(`[glob] Cache hit for pattern: ${pattern}`);
        return cached.files;
      }

      const files = await globSearch(pattern, {
        cwd: projectRoot,
        ignore: EXCLUDE_PATTERNS,
        nodir: true,
        dot: false
      });

      // Update cache
      globCache.set(pattern, { files, timestamp: Date.now() });

      logger.debug(`[glob] Found ${files.length} files matching pattern: ${pattern}`);
      return files;
    } catch (error) {
      const message = `Failed to glob pattern ${pattern}: ${getErrorMessage(error)}`;
      logger.error(`[glob] ${message}`);
      throw new Error(message);
    }
  }
};

export interface GrepResult {
  file: string;
  line: number;
  content: string;
}

/**
 * Search file contents for a pattern
 */
export const grep: MotorSkill<{ pattern: string; path?: string }, GrepResult[]> = {
  id: 'grep',
  name: 'Search Contents',
  description: `Searches for text patterns within files (supports regex).

CRITICAL PATH RULES:
- Searches relative to CURRENT WORKING DIRECTORY (use get-cwd first)
- Optional path parameter is a GLOB PATTERN (like "**/*.ts"), not a directory path
- If CWD is "/path/to/project", path="src/**/*.ts" searches /path/to/project/src/**/*.ts

Usage notes:
- Full regex support (e.g., "log.*Error", "function\\s+\\w+")
- Case-insensitive by default
- Returns file path, line number, and matching line content
- Prefer this tool over bash commands (grep/rg)
- For open-ended searches, use the EXPLORE state instead of direct tool calls`,

  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'Regex pattern or literal text to search for'
      },
      path: {
        type: 'string',
        description: 'Optional glob pattern to filter files (e.g., "**/*.ts")'
      }
    },
    required: ['pattern']
  },

  async execute({
    pattern,
    path: searchPath = '**/*'
  }: {
    pattern: string;
    path?: string;
  }): Promise<GrepResult[]> {
    try {
      const projectRoot = process.cwd();
      const results: GrepResult[] = [];

      // Convert pattern to regex
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'i'); // Case-insensitive
      } catch (error) {
        // If pattern is not valid regex, escape it and treat as literal
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        regex = new RegExp(escaped, 'i');
      }

      // Find files to search
      const files = await globSearch(searchPath, {
        cwd: projectRoot,
        ignore: EXCLUDE_PATTERNS,
        nodir: true,
        dot: false
      });

      // Search each file
      for (const file of files) {
        const absolutePath = path.join(projectRoot, file);

        // Only search text files
        if (!isTextFile(absolutePath)) {
          continue;
        }

        try {
          const content = fs.readFileSync(absolutePath, 'utf8');
          const lines = content.split('\n');

          lines.forEach((line, index) => {
            if (regex.test(line)) {
              results.push({
                file,
                line: index + 1,
                content: line.trim()
              });
            }
          });
        } catch (error) {
          // Skip files that can't be read
          logger.debug(`[grep] Skipping unreadable file: ${file}`);
        }
      }

      logger.debug(`[grep] Found ${results.length} matches for pattern: ${pattern}`);
      return results;
    } catch (error) {
      const message = `Failed to grep pattern ${pattern}: ${getErrorMessage(error)}`;
      logger.error(`[grep] ${message}`);
      throw new Error(message);
    }
  }
};

export const searchSkills = [glob, grep];
