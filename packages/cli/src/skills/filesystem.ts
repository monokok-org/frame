/**
 * Motor Skills for File System Operations
 *
 * These are deterministic tools that agents can use to interact with files.
 * Skills don't think - they act.
 */

import fs from 'fs';
import path from 'path';
import type { MotorSkill } from '@homunculus-live/core';
import { logger } from '../utils/logger.js';
import { getErrorMessage } from '../utils/error-utils.js';
import { isWithinProjectRoot, ensureDirectoryExists } from '../utils/file-utils.js';
import { getConfig } from '../utils/config.js';
import { getWorkspaceMemory } from '../core/workspace-context.js';

/**
 * Read file content from disk
 */
export const readFile: MotorSkill<{ path: string; startLine?: number; endLine?: number; maxChars?: number }, string> = {
  id: 'read-file',
  name: 'Read File',
  description: `Reads the contents of a text file from the file system.

Usage notes:
- Path is relative to CURRENT WORKING DIRECTORY (use get-cwd to find out where you are)
- If CWD is "/path/to/project", use "src/App.tsx" NOT "project/src/App.tsx"
- Absolute paths are also supported
- Results are raw file content (no line numbers)
- You can limit output with startLine/endLine or maxChars
- You can call multiple read-file operations in parallel for efficiency
- Prefer this tool over bash commands (cat/head/tail)`,

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to read (relative or absolute)'
      },
      startLine: {
        type: 'number',
        description: '1-based line to start reading from (optional)'
      },
      endLine: {
        type: 'number',
        description: '1-based line to stop reading at (optional)'
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return (optional)'
      }
    },
    required: ['path']
  },

  async execute(input: { path: string; startLine?: number; endLine?: number; maxChars?: number }): Promise<string> {
    const filePath = input.path;
    try {
      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);

      // Safety check
      if (!isWithinProjectRoot(absolutePath, projectRoot)) {
        throw new Error(`Access denied: ${filePath} is outside project root`);
      }

      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const stats = fs.statSync(absolutePath);
      const config = getConfig();
      const maxSize = config.safety.maxFileSizeMB * 1024 * 1024;

      if (stats.size > maxSize) {
        throw new Error(`File too large: ${filePath} (${stats.size} bytes, max: ${maxSize})`);
      }

      const content = fs.readFileSync(absolutePath, 'utf8');
      logger.debug(`[read-file] Read ${content.length} chars from ${filePath}`);

      let output = content;

      if (input.startLine || input.endLine) {
        const lines = content.split('\n');
        const start = Math.max(1, input.startLine ?? 1);
        const end = Math.min(lines.length, input.endLine ?? lines.length);

        if (start > end) {
          output = '';
        } else {
          output = lines.slice(start - 1, end).join('\n');
        }
      }

      if (input.maxChars && input.maxChars > 0 && output.length > input.maxChars) {
        output = `${output.slice(0, input.maxChars)}\n... [truncated]`;
      }

      return output;
    } catch (error) {
      const message = `Failed to read file ${filePath}: ${getErrorMessage(error)}`;
      logger.error(`[read-file] ${message}`);
      throw new Error(message);
    }
  }
};

/**
 * Write content to a file (creates new file or overwrites existing)
 */
export const writeFile: MotorSkill<{ path: string; content: string }, void> = {
  id: 'write-file',
  name: 'Write File',
  description: `Writes content to a file, creating it if it doesn't exist or overwriting if it does.

CRITICAL RULES:
- Path is relative to CURRENT WORKING DIRECTORY (use get-cwd to find out where you are)
- If CWD is "/path/to/project", use "src/App.tsx" NOT "project/src/App.tsx"
- If overwriting an existing file, you MUST use read-file first to see current contents
- ALWAYS prefer edit-file over write-file for existing files
- NEVER write new files unless explicitly required by the user
- NEVER proactively create documentation files (*.md) or README files
- Prefer this tool over bash commands (echo >/cat <<EOF)`,

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the file to write (relative or absolute)'
      },
      content: {
        type: 'string',
        description: 'The content to write to the file'
      }
    },
    required: ['path', 'content']
  },

  async execute({ path: filePath, content }: { path: string; content: string }): Promise<void> {
    try {
      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);

      // Safety check
      if (!isWithinProjectRoot(absolutePath, projectRoot)) {
        throw new Error(`Access denied: ${filePath} is outside project root`);
      }

      // Ensure directory exists
      ensureDirectoryExists(absolutePath);

      fs.writeFileSync(absolutePath, content, 'utf8');
      logger.info(`[write-file] Wrote ${content.length} chars to ${filePath}`);

      // Track in workspace memory
      const memory = getWorkspaceMemory();
      if (memory) {
        memory.recordFile(absolutePath);
      }
    } catch (error) {
      const message = `Failed to write file ${filePath}: ${getErrorMessage(error)}`;
      logger.error(`[write-file] ${message}`);
      throw new Error(message);
    }
  }
};

type EditMatchMode = 'exact' | 'normalized' | 'smart';
type EditOccurrence = 'first' | 'last' | 'all' | number;

type ReplaceEdit = {
  type: 'replace';
  match: string;
  replace: string;
  matchMode?: EditMatchMode;
  occurrence?: EditOccurrence;
};

type DeleteEdit = {
  type: 'delete';
  match: string;
  matchMode?: EditMatchMode;
  occurrence?: EditOccurrence;
};

type InsertEdit = {
  type: 'insert';
  anchor: string;
  position: 'before' | 'after';
  content: string;
  matchMode?: EditMatchMode;
  occurrence?: EditOccurrence;
};

type ReplaceBetweenEdit = {
  type: 'replace-between';
  start: string;
  end: string;
  replace: string;
  includeStart?: boolean;
  includeEnd?: boolean;
  matchMode?: EditMatchMode;
  occurrence?: EditOccurrence;
};

type EditOperation = ReplaceEdit | DeleteEdit | InsertEdit | ReplaceBetweenEdit;

type EditFileInput = {
  path: string;
  edits: EditOperation[];
  strict?: boolean;
};

type MatchRange = { start: number; end: number };

const DEFAULT_MATCH_MODE: EditMatchMode = 'smart';

const normalizeEol = (value: string): string => value.replace(/\r\n/g, '\n');

const detectEol = (value: string): string => (value.includes('\r\n') ? '\r\n' : '\n');

const normalizeLineForMatch = (line: string): string => line.replace(/\s+/g, ' ').trim();

const buildLineIndex = (content: string): { lines: string[]; lineStarts: number[] } => {
  const lines = content.split('\n');
  const lineStarts: number[] = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i += 1) {
    lineStarts.push(offset);
    offset += lines[i].length;
    if (i < lines.length - 1) {
      offset += 1;
    }
  }

  return { lines, lineStarts };
};

const buildRangeFromLines = (
  lineStarts: number[],
  lines: string[],
  startLine: number,
  endLine: number,
  includeTrailingNewline: boolean
): MatchRange => {
  const start = lineStarts[startLine];
  let end = lineStarts[endLine] + lines[endLine].length;

  if (includeTrailingNewline && endLine < lines.length - 1) {
    end += 1;
  }

  return { start, end };
};

const findExactMatches = (content: string, needle: string): MatchRange[] => {
  if (!needle) {
    return [];
  }

  const matches: MatchRange[] = [];
  let cursor = 0;

  while (cursor <= content.length) {
    const index = content.indexOf(needle, cursor);
    if (index === -1) {
      break;
    }
    matches.push({ start: index, end: index + needle.length });
    cursor = index + Math.max(1, needle.length);
  }

  return matches;
};

const lineMatches = (contentLine: string, needleLine: string): boolean => {
  if (!needleLine) {
    return contentLine.length === 0;
  }

  if (contentLine === needleLine) {
    return true;
  }

  return contentLine.includes(needleLine);
};

const findNormalizedMatches = (content: string, needle: string): MatchRange[] => {
  if (!needle) {
    return [];
  }

  const { lines, lineStarts } = buildLineIndex(content);
  const normalizedLines = lines.map(normalizeLineForMatch);
  const needleLines = needle.split('\n').map(normalizeLineForMatch);
  const matches: MatchRange[] = [];
  const includeTrailingNewline = needle.endsWith('\n');

  if (needleLines.length === 1) {
    for (let i = 0; i < normalizedLines.length; i += 1) {
      if (lineMatches(normalizedLines[i], needleLines[0])) {
        matches.push(buildRangeFromLines(lineStarts, lines, i, i, includeTrailingNewline));
      }
    }
    return matches;
  }

  for (let i = 0; i <= normalizedLines.length - needleLines.length; i += 1) {
    let matched = true;
    for (let j = 0; j < needleLines.length; j += 1) {
      if (!lineMatches(normalizedLines[i + j], needleLines[j])) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matches.push(buildRangeFromLines(lineStarts, lines, i, i + needleLines.length - 1, includeTrailingNewline));
    }
  }

  return matches;
};

const findSubsequenceMatches = (content: string, needle: string): MatchRange[] => {
  if (!needle) {
    return [];
  }

  const { lines, lineStarts } = buildLineIndex(content);
  const normalizedLines = lines.map(normalizeLineForMatch);
  let needleLines = needle.split('\n').map(normalizeLineForMatch);
  const includeTrailingNewline = needle.endsWith('\n');

  if (needleLines.length > 1) {
    needleLines = needleLines.filter((line) => line.length > 0);
  }

  if (needleLines.length === 0) {
    return [];
  }

  const matches: MatchRange[] = [];

  for (let i = 0; i < normalizedLines.length; i += 1) {
    if (!lineMatches(normalizedLines[i], needleLines[0])) {
      continue;
    }

    let needleIndex = 1;
    let endLine = i;

    for (let j = i + 1; j < normalizedLines.length && needleIndex < needleLines.length; j += 1) {
      if (lineMatches(normalizedLines[j], needleLines[needleIndex])) {
        endLine = j;
        needleIndex += 1;
      }
    }

    if (needleIndex === needleLines.length) {
      matches.push(buildRangeFromLines(lineStarts, lines, i, endLine, includeTrailingNewline));
    }
  }

  return matches;
};

const findMatches = (content: string, needle: string, matchMode: EditMatchMode): MatchRange[] => {
  if (matchMode === 'exact') {
    return findExactMatches(content, needle);
  }

  if (matchMode === 'normalized') {
    return findNormalizedMatches(content, needle);
  }

  const exactMatches = findExactMatches(content, needle);
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const normalizedMatches = findNormalizedMatches(content, needle);
  if (normalizedMatches.length > 0) {
    return normalizedMatches;
  }

  return findSubsequenceMatches(content, needle);
};

const parseOccurrence = (occurrence: EditOccurrence | undefined): EditOccurrence | undefined => {
  if (typeof occurrence === 'number') {
    return occurrence;
  }

  if (typeof occurrence === 'string') {
    const lowered = occurrence.toLowerCase();
    if (lowered === 'first' || lowered === 'last' || lowered === 'all') {
      return lowered;
    }

    const asNumber = Number.parseInt(occurrence, 10);
    if (!Number.isNaN(asNumber)) {
      return asNumber;
    }
  }

  return occurrence;
};

const pickMatches = (matches: MatchRange[], occurrence: EditOccurrence | undefined, label: string): MatchRange[] => {
  if (matches.length === 0) {
    throw new Error(`${label} did not match anything. Use read-file to capture the exact text or add anchors to make it unique.`);
  }

  const normalizedOccurrence = parseOccurrence(occurrence);

  if (!normalizedOccurrence) {
    if (matches.length !== 1) {
      throw new Error(`${label} matched ${matches.length} times. Provide occurrence: "first" | "last" | <number> or refine the match.`);
    }
    return [matches[0]];
  }

  if (normalizedOccurrence === 'all') {
    return matches;
  }

  if (normalizedOccurrence === 'first') {
    return [matches[0]];
  }

  if (normalizedOccurrence === 'last') {
    return [matches[matches.length - 1]];
  }

  if (typeof normalizedOccurrence === 'number') {
    if (normalizedOccurrence < 1 || normalizedOccurrence > matches.length) {
      throw new Error(`${label} occurrence ${normalizedOccurrence} is out of range (1-${matches.length}).`);
    }
    return [matches[normalizedOccurrence - 1]];
  }

  return [matches[0]];
};

const formatMissingMatchHint = (content: string, needle: string): string => {
  const preview = needle.length > 120 ? `${needle.slice(0, 120)}...` : needle;
  const lines = content.split('\n');
  const filePreview = lines.slice(0, 15).map((line, idx) => `${idx + 1}: ${line}`).join('\n');
  const trimmedNeedleLine = needle.split('\n').find((line) => line.trim().length > 0) ?? '';

  if (!trimmedNeedleLine) {
    return `String not found in file. Searched for:\n"${preview}"\n\nFile content (first 15 lines):\n${filePreview}`;
  }

  const matchingLines = lines
    .map((line, idx) => ({ line, idx }))
    .filter(({ line }) => line.includes(trimmedNeedleLine) || trimmedNeedleLine.includes(line.trim()))
    .slice(0, 3);

  if (matchingLines.length === 0) {
    return `String not found in file. Searched for:\n"${preview}"\n\nFile content (first 15 lines):\n${filePreview}\n\n` +
      `HINT: Make sure you used read-file first and copied the exact text.`;
  }

  return `String not found in file. Searched for:\n"${preview}"\n\nFile content (first 15 lines):\n${filePreview}\n\n` +
    `HINT: Found similar text at line(s): ${matchingLines.map((m) => m.idx + 1).join(', ')}.\n` +
    `Consider using matchMode: "smart" or replace-between with anchors for blocks.`;
};

/**
 * Edit a file with structured, anchor-friendly operations
 */
const editFileParameters = {
  type: 'object',
  properties: {
    path: {
      type: 'string',
      description: 'Path to the file to edit'
    },
    edits: {
      type: 'array',
      description: 'Array of edit operations to apply in order',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['replace', 'delete', 'insert', 'replace-between']
          },
          match: {
            type: 'string',
            description: 'Text to match for replace/delete'
          },
          replace: {
            type: 'string',
            description: 'Replacement text for replace/replace-between'
          },
          anchor: {
            type: 'string',
            description: 'Anchor text for insert'
          },
          position: {
            type: 'string',
            enum: ['before', 'after']
          },
          content: {
            type: 'string',
            description: 'Content to insert'
          },
          start: {
            type: 'string',
            description: 'Start anchor for replace-between'
          },
          end: {
            type: 'string',
            description: 'End anchor for replace-between'
          },
          includeStart: {
            type: 'boolean',
            description: 'Whether to include the start anchor in the replacement'
          },
          includeEnd: {
            type: 'boolean',
            description: 'Whether to include the end anchor in the replacement'
          },
          matchMode: {
            type: 'string',
            enum: ['exact', 'normalized', 'smart']
          },
          occurrence: {
            type: 'string',
            description: 'Which match to use: "first", "last", "all", or a 1-based number'
          }
        }
      }
    },
    strict: {
      type: 'boolean',
      description: 'If true, fail on missing/ambiguous matches. Defaults to true.'
    }
  },
  required: ['path', 'edits']
} as MotorSkill['parameters'];

export const editFile: MotorSkill<EditFileInput, { editsApplied: number; replacements: number }> = {
  id: 'edit-file',
  name: 'Edit File',
  description: `Modifies an existing file using robust, anchor-friendly edits.

CRITICAL RULES:
- Path is relative to CURRENT WORKING DIRECTORY (use get-cwd to find out where you are)
- If CWD is "/path/to/project", use "src/App.tsx" NOT "project/src/App.tsx"
- You MUST use read-file first to see the file contents before editing
- Prefer replace-between for blocks, insert with anchors for new lines, and replace for small edits
- matchMode defaults to "smart" (tries exact, normalized, then line-subsequence match)
- If a match is ambiguous, set occurrence ("first" | "last" | number | "all")
- Prefer this tool over write-file for modifying existing files`,

  parameters: editFileParameters,

  async execute({ path: filePath, edits, strict = true }: EditFileInput): Promise<{ editsApplied: number; replacements: number }> {
    try {
      if (!filePath) {
        throw new Error('Parameter "path" is required');
      }
      if (!Array.isArray(edits) || edits.length === 0) {
        throw new Error('Parameter "edits" must be a non-empty array');
      }

      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);

      if (!isWithinProjectRoot(absolutePath, projectRoot)) {
        throw new Error(`Access denied: ${filePath} is outside project root`);
      }

      if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const rawContent = fs.readFileSync(absolutePath, 'utf8');
      const eol = detectEol(rawContent);
      let content = normalizeEol(rawContent);

      let editsApplied = 0;
      let replacements = 0;

      for (const edit of edits) {
        const matchMode = edit.matchMode ?? DEFAULT_MATCH_MODE;

        if (edit.type === 'replace') {
          if (!edit.match) {
            throw new Error('replace edit requires "match" text');
          }
          if (edit.replace === undefined) {
            throw new Error('replace edit requires "replace" text');
          }

          const matchText = normalizeEol(edit.match.replace(/^\s*\d+→/gm, ''));
          const replacementText = normalizeEol(edit.replace);
          const matches = findMatches(content, matchText, matchMode);

          if (matches.length === 0) {
            if (strict) {
              throw new Error(formatMissingMatchHint(content, matchText));
            }
            continue;
          }

          const selected = pickMatches(matches, edit.occurrence, 'replace.match');
          const sorted = selected.slice().sort((a, b) => b.start - a.start);

          for (const range of sorted) {
            content = `${content.slice(0, range.start)}${replacementText}${content.slice(range.end)}`;
          }

          editsApplied += 1;
          replacements += selected.length;
          continue;
        }

        if (edit.type === 'delete') {
          if (!edit.match) {
            throw new Error('delete edit requires "match" text');
          }

          const matchText = normalizeEol(edit.match.replace(/^\s*\d+→/gm, ''));
          const matches = findMatches(content, matchText, matchMode);

          if (matches.length === 0) {
            if (strict) {
              throw new Error(formatMissingMatchHint(content, matchText));
            }
            continue;
          }

          const selected = pickMatches(matches, edit.occurrence, 'delete.match');
          const sorted = selected.slice().sort((a, b) => b.start - a.start);

          for (const range of sorted) {
            content = `${content.slice(0, range.start)}${content.slice(range.end)}`;
          }

          editsApplied += 1;
          replacements += selected.length;
          continue;
        }

        if (edit.type === 'insert') {
          if (!edit.anchor) {
            throw new Error('insert edit requires "anchor" text');
          }
          if (!edit.position) {
            throw new Error('insert edit requires "position" ("before" or "after")');
          }
          if (edit.content === undefined) {
            throw new Error('insert edit requires "content"');
          }

          const anchorText = normalizeEol(edit.anchor.replace(/^\s*\d+→/gm, ''));
          const insertContent = normalizeEol(edit.content);
          const matches = findMatches(content, anchorText, matchMode);

          if (matches.length === 0) {
            if (strict) {
              throw new Error(formatMissingMatchHint(content, anchorText));
            }
            continue;
          }

          const selected = pickMatches(matches, edit.occurrence, 'insert.anchor');
          if (selected.length !== 1) {
            throw new Error('insert edit must resolve to a single anchor match');
          }

          const anchor = selected[0];
          const insertAt = edit.position === 'before' ? anchor.start : anchor.end;
          content = `${content.slice(0, insertAt)}${insertContent}${content.slice(insertAt)}`;

          editsApplied += 1;
          replacements += 1;
          continue;
        }

        if (edit.type === 'replace-between') {
          if (!edit.start || !edit.end) {
            throw new Error('replace-between edit requires "start" and "end" anchors');
          }
          if (edit.replace === undefined) {
            throw new Error('replace-between edit requires "replace" text');
          }

          const startText = normalizeEol(edit.start.replace(/^\s*\d+→/gm, ''));
          const endText = normalizeEol(edit.end.replace(/^\s*\d+→/gm, ''));
          const replacementText = normalizeEol(edit.replace);

          const startMatches = findMatches(content, startText, matchMode);
          if (startMatches.length === 0) {
            if (strict) {
              throw new Error(formatMissingMatchHint(content, startText));
            }
            continue;
          }

          const startSelection = pickMatches(startMatches, edit.occurrence, 'replace-between.start');
          if (startSelection.length !== 1) {
            throw new Error('replace-between start anchor must resolve to a single match');
          }

          const startRange = startSelection[0];
          const endMatches = findMatches(content, endText, matchMode).filter((match) => match.start >= startRange.end);

          if (endMatches.length === 0) {
            if (strict) {
              throw new Error(`replace-between could not find an end anchor after the start anchor.`);
            }
            continue;
          }

          const endRange = endMatches[0];
          const rangeStart = edit.includeStart ? startRange.start : startRange.end;
          const rangeEnd = edit.includeEnd ? endRange.end : endRange.start;

          if (rangeEnd < rangeStart) {
            throw new Error('replace-between anchors are in the wrong order.');
          }

          content = `${content.slice(0, rangeStart)}${replacementText}${content.slice(rangeEnd)}`;

          editsApplied += 1;
          replacements += 1;
          continue;
        }

        throw new Error(`Unknown edit type: ${(edit as { type?: string }).type ?? 'unknown'}`);
      }

      const updated = eol === '\n' ? content : content.replace(/\n/g, eol);
      fs.writeFileSync(absolutePath, updated, 'utf8');

      logger.info(`[edit-file] Modified ${filePath} (${editsApplied} edit${editsApplied !== 1 ? 's' : ''}, ${replacements} replacement${replacements !== 1 ? 's' : ''})`);

      const memory = getWorkspaceMemory();
      if (memory) {
        memory.recordFile(absolutePath);
      }

      return { editsApplied, replacements };
    } catch (error) {
      const message = `Failed to edit file ${filePath}: ${getErrorMessage(error)}`;
      logger.error(`[edit-file] ${message}`);
      throw new Error(message);
    }
  }
};

/**
 * List directory contents
 */
export const listDir: MotorSkill<{ path: string }, string[]> = {
  id: 'list-dir',
  name: 'List Directory',
  description: `Lists files and directories in a given path.

CRITICAL PATH RULES:
- Path is relative to CURRENT WORKING DIRECTORY (use get-cwd first to know where you are)
- If CWD is "/path/to/project", use "src" to list "/path/to/project/src"
- If CWD is "/path/to/project", using "project/src" will FAIL (you're already IN project!)
- Use "." or omit the path argument to list the current directory
- NEVER prepend the project directory name - you are already inside it`,

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory path to list (defaults to current directory)'
      }
    },
    required: []
  },

  async execute(input: { path: string }): Promise<string[]> {
    const dirPath = input.path || '.';
    try {
      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(dirPath)
        ? dirPath
        : path.join(projectRoot, dirPath);

      // Safety check
      if (!isWithinProjectRoot(absolutePath, projectRoot)) {
        throw new Error(`Access denied: ${dirPath} is outside project root`);
      }

      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Directory not found: ${dirPath}`);
      }

      const entries = fs.readdirSync(absolutePath);
      logger.debug(`[list-dir] Listed ${entries.length} entries in ${dirPath}`);

      return entries;
    } catch (error) {
      const message = `Failed to list directory ${dirPath}: ${getErrorMessage(error)}`;
      logger.error(`[list-dir] ${message}`);
      throw new Error(message);
    }
  }
};

/**
 * Get current working directory
 */
export const getCwd: MotorSkill<void, string> = {
  id: 'get-cwd',
  name: 'Get Current Working Directory',
  description: 'Returns the current working directory path',

  parameters: {
    type: 'object',
    properties: {},
    required: []
  },

  async execute(): Promise<string> {
    const cwd = process.cwd();
    logger.debug(`[get-cwd] Current working directory: ${cwd}`);
    return cwd;
  }
};

/**
 * Check if a path exists
 */
export const pathExists: MotorSkill<{ path: string }, boolean> = {
  id: 'path-exists',
  name: 'Check Path Exists',
  description: `Checks if a file or directory exists.

CRITICAL PATH RULES:
- Path is relative to CURRENT WORKING DIRECTORY (use get-cwd first)
- If CWD is "/path/to/project", use "components.json" NOT "project/components.json"`,

  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to check (relative or absolute)'
      }
    },
    required: ['path']
  },

  async execute({ path: filePath }: { path: string }): Promise<boolean> {
    try {
      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);

      const exists = fs.existsSync(absolutePath);
      logger.debug(`[path-exists] ${filePath}: ${exists}`);
      return exists;
    } catch (error) {
      logger.error(`[path-exists] Error checking ${filePath}: ${getErrorMessage(error)}`);
      return false;
    }
  }
};



export const filesystemSkills = [
  readFile,
  writeFile,
  editFile,
  listDir,
  getCwd,
  pathExists
];
