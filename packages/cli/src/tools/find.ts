/**
 * Find Tool - Unified Code Discovery
 * 
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import type { Tool } from './types.js';
import { getProjectRoot } from '../utils/config.js';

interface FindInput {
  query: string;
  mode: 'search' | 'read' | 'list';
  path?: string;
  maxResults?: number;
}

interface FindResult {
  path: string;
  content?: string;
  matches?: Array<{ line: number; content: string }>;
  entries?: string[];
  totalLines?: number;
}

interface FindOutput {
  results: FindResult[];
  error?: string;
}

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_RESULTS = 20;
const MAX_CONTENT_LENGTH = 10000;

function isWithinRoot(targetPath: string, root: string): boolean {
  const resolved = path.resolve(root, targetPath);
  return resolved.startsWith(path.resolve(root));
}

function truncate(content: string, max: number): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + '\n... [truncated]';
}

async function searchCode(query: string, searchPath: string, maxResults: number): Promise<FindResult[]> {
  try {
    // Use ripgrep if available, fallback to grep
    const cmd = `rg --json -m ${maxResults} -e "${query.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null || grep -rn "${query.replace(/"/g, '\\"')}" "${searchPath}" 2>/dev/null | head -${maxResults}`;
    
    const output = execSync(cmd, { 
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      cwd: searchPath 
    });

    const results: Map<string, FindResult> = new Map();
    
    // Try parsing as ripgrep JSON first
    const lines = output.trim().split('\n').filter(Boolean);
    
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === 'match') {
          const filePath = parsed.data.path.text;
          const existing: FindResult = results.get(filePath) || { path: filePath, matches: [] };
          existing.matches = existing.matches || [];
          existing.matches.push({
            line: parsed.data.line_number,
            content: parsed.data.lines.text.trim()
          });
          results.set(filePath, existing);
        }
      } catch {
        // Fallback: grep format "file:line:content"
        const match = line.match(/^([^:]+):(\d+):(.*)$/);
        if (match) {
          const [, filePath, lineNum, content] = match;
          const existing: FindResult = results.get(filePath) || { path: filePath, matches: [] };
          existing.matches = existing.matches || [];
          existing.matches.push({
            line: parseInt(lineNum, 10),
            content: content.trim()
          });
          results.set(filePath, existing);
        }
      }
    }

    return Array.from(results.values()).slice(0, maxResults);
  } catch {
    return [];
  }
}

/**
 * Add line numbers to content for editing reference
 */
function addLineNumbers(content: string): string {
  const lines = content.split('\n');
  const padding = String(lines.length).length;
  
  return lines.map((line, i) => {
    const lineNum = String(i + 1).padStart(padding, ' ');
    return `${lineNum} │ ${line}`;
  }).join('\n');
}

async function readFile(filePath: string, root: string): Promise<FindResult | null> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
  
  if (!isWithinRoot(absolutePath, root)) {
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const stats = fs.statSync(absolutePath);
  
  if (stats.isDirectory()) {
    return null;
  }

  if (stats.size > MAX_FILE_SIZE) {
    return {
      path: filePath,
      content: `[File too large: ${Math.round(stats.size / 1024)}KB. Use search to find specific content.]`,
      totalLines: 0
    };
  }

  const content = fs.readFileSync(absolutePath, 'utf8');
  const lines = content.split('\n');
  const numbered = addLineNumbers(content);
  
  return {
    path: filePath,
    content: truncate(numbered, MAX_CONTENT_LENGTH),
    totalLines: lines.length
  };
}

async function listDir(dirPath: string, root: string): Promise<FindResult | null> {
  const absolutePath = path.isAbsolute(dirPath) ? dirPath : path.join(root, dirPath);
  
  if (!isWithinRoot(absolutePath, root)) {
    return null;
  }

  if (!fs.existsSync(absolutePath)) {
    return null;
  }

  const stats = fs.statSync(absolutePath);
  
  if (!stats.isDirectory()) {
    return null;
  }

  const entries = fs.readdirSync(absolutePath).map(entry => {
    const entryPath = path.join(absolutePath, entry);
    const isDir = fs.statSync(entryPath).isDirectory();
    return isDir ? `${entry}/` : entry;
  });

  return {
    path: dirPath || '.',
    entries
  };
}

export const findTool: Tool<FindInput, FindOutput> = {
  name: 'find',
  description: `Unified code discovery tool.
Modes:
- search: Find code matching pattern (uses ripgrep)
- read: Read file content
- list: List directory contents

Examples:
- find({ mode: "search", query: "function auth" })
- find({ mode: "read", query: "src/index.ts" })
- find({ mode: "list", query: "src/components" })`,

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search pattern, file path, or directory path'
      },
      mode: {
        type: 'string',
        enum: ['search', 'read', 'list'],
        description: 'Operation mode'
      },
      path: {
        type: 'string',
        description: 'Scope for search (default: current directory)'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum results for search mode (default: 20)'
      }
    },
    required: ['query', 'mode']
  },

  async execute(input: FindInput): Promise<FindOutput> {
    const root = getProjectRoot();
    const searchPath = input.path ? path.join(root, input.path) : root;
    const maxResults = input.maxResults ?? MAX_RESULTS;

    try {
      switch (input.mode) {
        case 'search': {
          const results = await searchCode(input.query, searchPath, maxResults);
          if (results.length === 0) {
            return { results: [], error: `No matches found for "${input.query}"` };
          }
          return { results };
        }

        case 'read': {
          const result = await readFile(input.query, root);
          if (!result) {
            return { results: [], error: `File not found: ${input.query}` };
          }
          return { results: [result] };
        }

        case 'list': {
          const result = await listDir(input.query || '.', root);
          if (!result) {
            return { results: [], error: `Directory not found: ${input.query || '.'}` };
          }
          return { results: [result] };
        }

        default:
          return { results: [], error: `Unknown mode: ${input.mode}` };
      }
    } catch (error) {
      return { 
        results: [], 
        error: `Find failed: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }
};
