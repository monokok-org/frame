const CODE_FENCE_RE = /```json\n?|```\n?/gi;

export function stripMarkdownCodeFence(output: string): string {
  const trimmed = output.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  return trimmed.replace(CODE_FENCE_RE, '').trim();
}

export function extractJsonObject(output: string): string {
  const firstBrace = output.indexOf('{');
  const lastBrace = output.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace > lastBrace) {
    throw new Error('No valid JSON object found in output');
  }
  return output.slice(firstBrace, lastBrace + 1);
}

export function parseJsonObject<T = unknown>(output: string): T {
  const cleaned = stripMarkdownCodeFence(output);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const extracted = extractJsonObject(cleaned);
    return JSON.parse(extracted) as T;
  }
}
