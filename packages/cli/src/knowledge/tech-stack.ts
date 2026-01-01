export type FramebaseSourceAliases = Record<string, string[]>;

export const FRAMEBASE_SOURCE_ALIASES: FramebaseSourceAliases = {
  node: ['node', 'nodejs', 'node.js'],
  python: ['python', 'py'],
  pytest: ['pytest'],
  cuda: ['cuda'],
};

export function parseTechStack(techStack?: string): { source?: string; version?: string } {
  if (!techStack) return {};
  const trimmed = techStack.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex === -1) {
    return { source: trimmed };
  }
  return {
    source: trimmed.slice(0, atIndex),
    version: trimmed.slice(atIndex + 1),
  };
}

export function normalizeSource(
  source?: string,
  aliases: FramebaseSourceAliases = FRAMEBASE_SOURCE_ALIASES
): string | undefined {
  if (!source) return undefined;
  const lower = source.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(aliases, lower)) {
    return lower;
  }
  const aliasMatch = Object.entries(aliases).find(([, entries]) => entries.includes(lower));
  return aliasMatch ? aliasMatch[0] : lower;
}

export function isKnownSource(
  source: string,
  aliases: FramebaseSourceAliases = FRAMEBASE_SOURCE_ALIASES
): boolean {
  return Object.prototype.hasOwnProperty.call(aliases, source);
}

export function detectSourceFromQuery(
  query: string,
  aliases: FramebaseSourceAliases = FRAMEBASE_SOURCE_ALIASES
): string | undefined {
  const lower = query.toLowerCase();
  for (const [source, entries] of Object.entries(aliases)) {
    if (entries.some((alias) => lower.includes(alias))) {
      return source;
    }
  }
  return undefined;
}

export function extractVersionFromQuery(
  query: string,
  source?: string,
  aliases: FramebaseSourceAliases = FRAMEBASE_SOURCE_ALIASES
): string | undefined {
  if (!source) return undefined;
  const entries = aliases[source] || [source];
  for (const alias of entries) {
    const pattern = new RegExp(`\\b${escapeRegex(alias)}\\s*(?:v)?(\\d+(?:\\.\\d+){0,2})\\b`, 'i');
    const match = query.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  const dottedVersion = query.match(/\bv?(\d+\.\d+(?:\.\d+)?)\b/i);
  if (dottedVersion?.[1]) {
    return dottedVersion[1];
  }
  const vMajor = query.match(/\bv(\d+)\b/i);
  if (vMajor?.[1]) {
    return vMajor[1];
  }
  return undefined;
}

export function normalizeVersion(version?: string, source?: string): string | undefined {
  if (!version) return undefined;
  const trimmed = version.trim();
  if (source === 'node' && !trimmed.startsWith('v')) {
    return `v${trimmed}`;
  }
  return trimmed;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
