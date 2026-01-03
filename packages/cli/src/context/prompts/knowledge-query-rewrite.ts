/**
 * Knowledge Query Rewrite Prompt
 *
 * Rewrite user requests into concise keyword queries for Framebase (Meilisearch).
 */

export const KNOWLEDGE_QUERY_REWRITE_SYSTEM_PROMPT = `You are a query rewriter for a Meilisearch-based knowledge base (Framebase).
Return ONLY valid JSON following the provided schema.

Goals:
- Convert the request into a short keyword query (2-8 tokens).
- Prefer action keywords like install/setup/create/upgrade/check/deprecated.
- Extract the primary tool/library name as "source" when it is explicit.
- Include environment context (OS, package manager, project type) only if it helps retrieval.
- Avoid full sentences, punctuation, or quoted questions.
- If the request already looks like keywords, keep it concise.

Examples:
Input: "let's add storybook under apps/docs"
Output: {"query":"storybook install pnpm macos","source":"storybook","reason":"focus on install keywords with env"}

Input: "add MUI to this project"
Output: {"query":"mui install react","source":"mui","reason":"library install keywords"}

If unsure, keep the original meaning and output a compact keyword query.`;

export function buildKnowledgeQueryRewritePrompt(params: {
  query: string;
  category: string;
  environment: Record<string, unknown>;
}): string {
  return `Environment context (JSON):
${JSON.stringify(params.environment, null, 2)}

Request:
${params.query}

Category: ${params.category}

Rewrite the request into a concise keyword query for Framebase.`;
}
