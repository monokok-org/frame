/**
 * Edit Tool - Robust File Editing
 * 
 */

import fs from 'fs';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import type { Tool } from './types.js';
import { getProjectRoot } from '../utils/config.js';
import { LanguageServer } from '../services/LanguageServer.js';

// ============================================================================
// Types
// ============================================================================

interface ReplaceLines {
  type: 'replace_lines';
  startLine: number;      // 1-indexed, inclusive
  endLine: number;        // 1-indexed, inclusive
  content: string;        // New content (can be multiple lines)
}

interface InsertLines {
  type: 'insert_lines';
  afterLine: number;      // 0 = insert at beginning, N = insert after line N
  content: string;
}

interface DeleteLines {
  type: 'delete_lines';
  startLine: number;
  endLine: number;
}

interface CreateFile {
  type: 'create_file';
  content: string;
}

interface WriteFile {
  type: 'write_file';     // Full file replacement
  content: string;
}

type EditOperation = ReplaceLines | InsertLines | DeleteLines | CreateFile | WriteFile;

interface EditInput {
  path: string;
  edits: EditOperation[];
}

interface EditOutput {
  success: boolean;
  diff?: string;
  linesChanged?: number;
  error?: string;
  warnings?: string[];
}

const MAX_FILE_SIZE = 500 * 1024; // 500KB

// ============================================================================
// Helpers
// ============================================================================

function isWithinRoot(targetPath: string, root: string): boolean {
  const resolved = path.resolve(root, targetPath);
  return resolved.startsWith(path.resolve(root));
}

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Detect the base indentation of a content block
 */
function detectIndent(content: string): string {
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  if (lines.length === 0) return '';

  let minIndent = Infinity;
  for (const line of lines) {
    const match = line.match(/^(\s*)/);
    if (match && match[1].length < minIndent) {
      minIndent = match[1].length;
    }
  }

  return minIndent === Infinity ? '' : lines[0].slice(0, minIndent);
}

/**
 * Adjust content indentation to match target
 */
function adjustIndent(content: string, targetIndent: string): string {
  const lines = content.split('\n');
  const currentIndent = detectIndent(content);

  if (currentIndent === targetIndent) return content;

  return lines.map(line => {
    if (line.trim().length === 0) return line; // Preserve empty lines

    // Remove current base indent, add target indent
    if (line.startsWith(currentIndent)) {
      return targetIndent + line.slice(currentIndent.length);
    }
    return targetIndent + line.trimStart();
  }).join('\n');
}

/**
 * Get indentation of a specific line
 */
function getLineIndent(lines: string[], lineNum: number): string {
  if (lineNum < 1 || lineNum > lines.length) return '';
  const line = lines[lineNum - 1];
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

/**
 * Apply a single edit operation
 */
function applyEdit(lines: string[], edit: EditOperation): string[] {
  const result = [...lines];

  switch (edit.type) {
    case 'create_file':
    case 'write_file':
      return edit.content.split('\n');

    case 'replace_lines': {
      const { startLine, endLine, content } = edit;

      // Validate range
      if (startLine < 1 || endLine < startLine || startLine > lines.length) {
        throw new Error(`Invalid line range: ${startLine}-${endLine} (file has ${lines.length} lines)`);
      }

      // Get target indentation from first line being replaced
      const targetIndent = getLineIndent(lines, startLine);
      const adjustedContent = adjustIndent(content, targetIndent);
      const newLines = adjustedContent.split('\n');

      // Replace lines (0-indexed internally)
      result.splice(startLine - 1, endLine - startLine + 1, ...newLines);
      return result;
    }

    case 'insert_lines': {
      const { afterLine, content } = edit;

      if (afterLine < 0 || afterLine > lines.length) {
        throw new Error(`Invalid insert position: after line ${afterLine} (file has ${lines.length} lines)`);
      }

      // Get target indentation from surrounding context
      const targetIndent = afterLine > 0
        ? getLineIndent(lines, afterLine)
        : (lines.length > 0 ? getLineIndent(lines, 1) : '');

      const adjustedContent = adjustIndent(content, targetIndent);
      const newLines = adjustedContent.split('\n');

      result.splice(afterLine, 0, ...newLines);
      return result;
    }

    case 'delete_lines': {
      const { startLine, endLine } = edit;

      if (startLine < 1 || endLine < startLine || startLine > lines.length) {
        throw new Error(`Invalid delete range: ${startLine}-${endLine} (file has ${lines.length} lines)`);
      }

      result.splice(startLine - 1, endLine - startLine + 1);
      return result;
    }

    default:
      throw new Error(`Unknown edit type: ${(edit as any).type}`);
  }
}

/**
 * Generate diff between old and new content
 */
function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const patch = createTwoFilesPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    'original',
    'modified',
    { context: 3 }
  );

  const patchLines = patch.split('\n');
  if (patchLines.length > 60) {
    return patchLines.slice(0, 60).join('\n') + '\n... [diff truncated]';
  }
  return patch;
}

/**
 * Count changed lines
 */
function countChangedLines(oldLines: string[], newLines: string[]): number {
  return Math.abs(newLines.length - oldLines.length) +
    Math.min(oldLines.length, newLines.length);
}

// ============================================================================
// Tool Definition
// ============================================================================

export const editTool: Tool<EditInput, EditOutput> = {
  name: 'edit',
  description: `Edit files using line numbers with advanced validation.
  
IMPORTANT: Use line numbers from find({ mode: "read" }) output.

Edit types:
- replace_lines: Replace lines startLine to endLine with new content
- insert_lines: Insert content after a specific line (0 = beginning)
- delete_lines: Delete lines from startLine to endLine
- create_file: Create a new file with content
- write_file: Replace entire file content

Feature:
- Automatically validates code using Language Server (TypeScript/JavaScript).
- Checks for both Syntax Errors (parsing) and Semantic Errors (types, unused vars).
- Returns detailed errors if the edit breaks the build.

Examples:
  Replace lines 10-15:
  edit({ path: "src/app.ts", edits: [{ 
    type: "replace_lines", 
    startLine: 10, 
    endLine: 15, 
    content: "const x = 1;\\nconst y = 2;" 
  }]})`,

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File path to edit'
      },
      edits: {
        type: 'array',
        description: 'List of edit operations',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['replace_lines', 'insert_lines', 'delete_lines', 'create_file', 'write_file']
            },
            startLine: { type: 'number', description: 'Start line (1-indexed, for replace/delete)' },
            endLine: { type: 'number', description: 'End line (1-indexed, inclusive)' },
            afterLine: { type: 'number', description: 'Insert after this line (0 = beginning)' },
            content: { type: 'string', description: 'New content' }
          }
        }
      }
    },
    required: ['path', 'edits']
  },

  async execute(input: EditInput): Promise<EditOutput> {
    const root = getProjectRoot();
    const absolutePath = path.isAbsolute(input.path)
      ? input.path
      : path.join(root, input.path);

    if (!isWithinRoot(absolutePath, root)) {
      return { success: false, error: `Access denied: ${input.path} is outside project root` };
    }

    try {
      const isCreate = input.edits.length === 1 &&
        (input.edits[0].type === 'create_file' || input.edits[0].type === 'write_file');

      let originalContent = '';
      let originalLines: string[] = [];

      if (!isCreate || input.edits[0].type === 'write_file') {
        if (fs.existsSync(absolutePath)) {
          const stats = fs.statSync(absolutePath);
          if (stats.size > MAX_FILE_SIZE) {
            return { success: false, error: `File too large: ${input.path}` };
          }
          originalContent = fs.readFileSync(absolutePath, 'utf8');
          originalLines = originalContent.split('\n');
        } else if (!isCreate) {
          return { success: false, error: `File not found: ${input.path}` };
        }
      }

      // Apply edits sequentially
      let lines = [...originalLines];
      for (const edit of input.edits) {
        lines = applyEdit(lines, edit);
      }

      const newContent = lines.join('\n');

      // VALIDATION STEP
      const ext = path.extname(absolutePath);
      if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
        const ls = LanguageServer.getInstance();
        const errors = ls.validatets(absolutePath, newContent);

        if (errors.length > 0) {
          return {
            success: false,
            error: `Validation failed (Language Server):\n${errors.join('\n')}\n\nPlease fix your edit and try again.`
          };
        }
      }

      // Write file
      ensureDir(absolutePath);
      fs.writeFileSync(absolutePath, newContent, 'utf8');

      const diff = isCreate && input.edits[0].type === 'create_file'
        ? `Created ${input.path} (${lines.length} lines)`
        : generateDiff(originalContent, newContent, input.path);

      const linesChanged = countChangedLines(originalLines, lines);

      return { success: true, diff, linesChanged };

    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
};
