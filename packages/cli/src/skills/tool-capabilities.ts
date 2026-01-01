/**
 * Tool Capability Registry
 *
 * Provides semantic understanding of what tools CAN and CANNOT do.
 * Used by planner to choose the right tool and avoid suggesting external packages.
 */

export interface ToolCapability {
  id: string;
  category: 'filesystem' | 'search' | 'execution' | 'web' | 'knowledge';
  capabilities: string[];      // What it CAN do
  limitations: string[];        // What it CANNOT do
  replacesExternal: string[];   // External tools/packages to use this instead of
  usageNotes?: string;          // Additional guidance for planners
}

/**
 * Comprehensive tool capability metadata
 */
export const TOOL_CAPABILITIES: ToolCapability[] = [
  // Filesystem Tools
  {
    id: 'read-file',
    category: 'filesystem',
    capabilities: [
      'Read text file contents',
      'Read file content (optionally by line range)',
      'Read configuration files',
      'Read source code files'
    ],
    limitations: [
      'Cannot read binary files',
      'Cannot read files larger than configured max size',
      'Cannot read files outside project root'
    ],
    replacesExternal: ['cat', 'head', 'tail', 'less', 'more'],
    usageNotes: 'Prefer this over bash commands for reading files. Multiple reads can be parallelized.'
  },
  {
    id: 'write-file',
    category: 'filesystem',
    capabilities: [
      'Create new files',
      'Overwrite existing files',
      'Write text content to files'
    ],
    limitations: [
      'Cannot append to files (use edit-file for modifications)',
      'Cannot create files outside project root'
    ],
    replacesExternal: ['echo >', 'cat > file <<EOF', 'tee'],
    usageNotes: 'For existing files, prefer edit-file. Only use write-file for new files or complete rewrites.'
  },
  {
    id: 'edit-file',
    category: 'filesystem',
    capabilities: [
      'Modify existing files with structured edits',
      'Replace, insert, or delete text with anchors',
      'Update configuration files safely',
      'Apply multiple edits in a single operation'
    ],
    limitations: [
      'Matches must resolve to a unique location unless occurrence is set',
      'Anchors must exist in the file (use read-file first)',
      'Cannot edit binary files',
      'Automatically strips line number prefixes from read-file output'
    ],
    replacesExternal: ['sed', 'awk', 'perl -pi -e'],
    usageNotes: 'Must read file first to see content. Provide edits: [{ type: "replace"|"insert"|"delete"|"replace-between", ... }]. matchMode defaults to "smart". Use occurrence to disambiguate.'
  },
  {
    id: 'list-dir',
    category: 'filesystem',
    capabilities: [
      'List directory contents',
      'Discover files in a directory'
    ],
    limitations: [
      'No recursive listing',
      'Cannot list directories outside project root'
    ],
    replacesExternal: ['ls', 'dir'],
    usageNotes: 'For pattern-based searches, use glob instead.'
  },
  {
    id: 'get-cwd',
    category: 'filesystem',
    capabilities: [
      'Get current working directory',
      'Determine project root'
    ],
    limitations: [],
    replacesExternal: ['pwd'],
    usageNotes: 'All relative paths are resolved from this directory.'
  },
  {
    id: 'path-exists',
    category: 'filesystem',
    capabilities: [
      'Check if file exists',
      'Check if directory exists',
      'Verify prerequisite files'
    ],
    limitations: [],
    replacesExternal: ['test -e', '[ -f ]', '[ -d ]'],
    usageNotes: 'Use this to check prerequisites before executing commands.'
  },
  {
    id: 'structure-scout',
    category: 'filesystem',
    capabilities: [
      'Summarize project structure',
      'Detect project type and scripts',
      'Provide a compact directory tree'
    ],
    limitations: [
      'Summary is brief and may omit details',
      'Tree depth is limited'
    ],
    replacesExternal: [],
    usageNotes: 'Use for quick project context without reading many files.'
  },

  // Search Tools
  {
    id: 'glob',
    category: 'search',
    capabilities: [
      'Find files by pattern',
      'Recursive file search',
      'Match files by extension or path pattern'
    ],
    limitations: [
      'Cannot search file contents (use grep for that)',
      'No regex support (glob patterns only)'
    ],
    replacesExternal: ['find', 'fd', 'fd-find'],
    usageNotes: 'Fast with 10-second cache. Use patterns like "**/*.ts" or "src/**/*.tsx".'
  },
  {
    id: 'grep',
    category: 'search',
    capabilities: [
      'Search file contents for text',
      'Find code patterns in files',
      'Search across codebase'
    ],
    limitations: [
      'Cannot modify files (use edit-file for that)',
      'Text search only, not binary'
    ],
    replacesExternal: ['grep', 'rg', 'ripgrep', 'ag', 'ack'],
    usageNotes: 'Supports basic patterns. Automatically excludes node_modules and build dirs.'
  },
  {
    id: 'platform-detector',
    category: 'search',
    capabilities: [
      'Detect platforms/languages in a repo',
      'Identify package managers and manifests'
    ],
    limitations: [
      'Summary is brief and heuristic',
      'May need follow-up verification'
    ],
    replacesExternal: [],
    usageNotes: 'Use when unsure about stack or monorepo layout.'
  },
  {
    id: 'dependency-checker',
    category: 'filesystem',
    capabilities: [
      'Check if a dependency exists in a manifest',
      'Report location and version if available'
    ],
    limitations: [
      'Requires a manifest path',
      'May fall back to simple string search'
    ],
    replacesExternal: [],
    usageNotes: 'Call after you know the correct manifest file path.'
  },
  {
    id: 'explore-agent',
    category: 'search',
    capabilities: [
      'Run a short, read-only exploration sub-agent',
      'Return a concise summary of relevant files and context'
    ],
    limitations: [
      'Read-only; cannot modify files or run commands',
      'Summary is brief and may omit details'
    ],
    replacesExternal: [],
    usageNotes: 'Use for quick project context without large tool outputs.'
  },

  // Execution Tools
  {
    id: 'exec-command',
    category: 'execution',
    capabilities: [
      'Run shell commands',
      'Install packages',
      'Run build/test/lint commands',
      'Execute CLI tools',
      'Run npm/pnpm/yarn scripts'
    ],
    limitations: [
      'Cannot run interactive commands (must use --yes flags)',
      'Commands timeout after configured duration',
      'Cannot run commands requiring user input'
    ],
    replacesExternal: [],
    usageNotes: 'Always use non-interactive flags (--yes, -y, --defaults). Redirect stderr with 2>&1 for error capture.'
  },
  {
    id: 'ask-user-question',
    category: 'execution',
    capabilities: [
      'Ask the user for clarification',
      'Validate assumptions with the user'
    ],
    limitations: [
      'Requires user input to continue'
    ],
    replacesExternal: [],
    usageNotes: 'Use when requirements are unclear or when a decision needs confirmation.'
  },

  // Web Tools
  {
    id: 'web-fetch',
    category: 'web',
    capabilities: [
      'Fetch web page content',
      'Read documentation from URLs',
      'Get API responses (text/json)',
      'Download text content from internet'
    ],
    limitations: [
      'Cannot execute JavaScript on pages',
      'Cannot interact with forms or buttons',
      'Cannot take screenshots',
      'Cannot handle complex SPAs that require JS execution',
      'Text content only (no images/PDFs)',
      'Returns first 10,000 characters only'
    ],
    replacesExternal: ['puppeteer', 'playwright', 'selenium', 'curl', 'wget', 'axios fetch'],
    usageNotes: 'NEVER suggest installing puppeteer/playwright - use this for simple page fetching.'
  },
  {
    id: 'error-researcher',
    category: 'web',
    capabilities: [
      'Research non-trivial command errors',
      'Summarize likely fixes with sources'
    ],
    limitations: [
      'Requires network access',
      'May return low-confidence suggestions'
    ],
    replacesExternal: [],
    usageNotes: 'Use only when error output is unclear or non-trivial.'
  },
  {
    id: 'web-search',
    category: 'web',
    capabilities: [
      'Search the internet for information',
      'Find documentation',
      'Research error messages',
      'Check if packages/APIs exist',
      'Find current information'
    ],
    limitations: [
      'No access to paywalled content',
      'Search quality depends on DuckDuckGo'
    ],
    replacesExternal: [],
    usageNotes: 'ALWAYS include current year (2025) in queries for recent info. Use when uncertain about packages/APIs.'
  },

  // Knowledge Tools
  {
    id: 'knowledge-query',
    category: 'knowledge',
    capabilities: [
      'Query Framebase for up-to-date context frames',
      'Use cached answers for fast retrieval',
      'Fallback to web search when Framebase has no data'
    ],
    limitations: [
      'Depends on Framebase coverage and version filters',
      'May return no frames for unknown sources'
    ],
    replacesExternal: [],
    usageNotes: 'Use before choosing commands or APIs; include exact versions when possible.'
  }
];

/**
 * Get capability info for a specific tool
 */
export function getToolCapability(toolId: string): ToolCapability | undefined {
  return TOOL_CAPABILITIES.find(cap => cap.id === toolId);
}

/**
 * Get all tools in a category
 */
export function getToolsByCategory(category: ToolCapability['category']): ToolCapability[] {
  return TOOL_CAPABILITIES.filter(cap => cap.category === category);
}

/**
 * Find which tool to use instead of an external package/command
 */
export function findReplacementTool(externalTool: string): ToolCapability | undefined {
  const normalized = externalTool.toLowerCase().trim();

  // First try exact match
  const exactMatch = TOOL_CAPABILITIES.find(cap =>
    cap.replacesExternal.some(ext => ext.toLowerCase() === normalized)
  );
  if (exactMatch) return exactMatch;

  // Then try word boundary match (avoid substring false positives like "tee" in "puppeteer")
  return TOOL_CAPABILITIES.find(cap =>
    cap.replacesExternal.some(ext => {
      const pattern = new RegExp(`\\b${ext.toLowerCase()}\\b`);
      return pattern.test(normalized);
    })
  );
}

/**
 * Generate formatted tool context for planner prompts
 */
export function generateToolContextForPlanner(): string {
  const byCategory = {
    filesystem: getToolsByCategory('filesystem'),
    search: getToolsByCategory('search'),
    execution: getToolsByCategory('execution'),
    web: getToolsByCategory('web'),
    knowledge: getToolsByCategory('knowledge')
  };

  const lines: string[] = [
    'AVAILABLE TOOLS (use these INSTEAD of installing external packages):',
    ''
  ];

  // Filesystem
  lines.push('Filesystem:');
  for (const tool of byCategory.filesystem) {
    lines.push(`- ${tool.id}: ${tool.capabilities[0]}`);
    if (tool.replacesExternal.length > 0) {
      lines.push(`  REPLACES: ${tool.replacesExternal.join(', ')}`);
    }
  }
  lines.push('');

  // Search
  lines.push('Search:');
  for (const tool of byCategory.search) {
    lines.push(`- ${tool.id}: ${tool.capabilities[0]}`);
    if (tool.replacesExternal.length > 0) {
      lines.push(`  REPLACES: ${tool.replacesExternal.join(', ')}`);
    }
  }
  lines.push('');

  // Web (CRITICAL - emphasize to avoid puppeteer)
  lines.push('Web (CRITICAL - use these INSTEAD of puppeteer/playwright):');
  for (const tool of byCategory.web) {
    lines.push(`- ${tool.id}: ${tool.capabilities[0]}`);
    if (tool.replacesExternal.length > 0) {
      lines.push(`  REPLACES: ${tool.replacesExternal.join(', ')}`);
    }
    if (tool.limitations.length > 0) {
      lines.push(`  LIMITATIONS: ${tool.limitations.slice(0, 2).join(', ')}`);
    }
  }
  lines.push('');

  // Execution
  lines.push('Execution:');
  for (const tool of byCategory.execution) {
    lines.push(`- ${tool.id}: ${tool.capabilities[0]}`);
  }
  lines.push('');

  // Knowledge
  lines.push('Knowledge:');
  for (const tool of byCategory.knowledge) {
    lines.push(`- ${tool.id}: ${tool.capabilities[0]}`);
  }
  lines.push('');

  lines.push('CRITICAL RULES:');
  lines.push('- NEVER suggest installing: puppeteer, playwright, selenium, curl, wget');
  lines.push('- Use web-fetch for fetching pages, web-search for finding information');
  lines.push('- Use glob/grep instead of find/grep bash commands');
  lines.push('- Use read-file/write-file/edit-file instead of cat/echo/sed');
  lines.push('- When uncertain about a package, use web-search to verify it exists first');

  return lines.join('\n');
}

/**
 * Check if planner is trying to install a tool we already have
 */
export function detectRedundantPackage(packageName: string): ToolCapability | undefined {
  const normalized = packageName.toLowerCase();

  // Direct matches
  const directReplacements = ['puppeteer', 'playwright', 'selenium', 'cheerio', 'jsdom'];
  if (directReplacements.includes(normalized)) {
    return getToolCapability('web-fetch');
  }

  // Check all tools for replacement
  return findReplacementTool(normalized);
}
