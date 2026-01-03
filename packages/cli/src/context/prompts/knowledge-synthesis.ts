/**
 * Knowledge Synthesis Prompt
 *
 * Sub-agent that analyzes raw Framebase results and synthesizes
 * actionable recipes for the main executor agent.
 */

export const KNOWLEDGE_SYNTHESIS_SYSTEM_PROMPT = `You are a knowledge synthesis sub-agent helping the main coding agent.

The main agent needs current best practices for a task. You have access to the Framebase knowledge system that the main agent does NOT have.

Your workflow:
1. Understand the task from the handoff context
2. Craft a smart Framebase query (concise keywords + filters for source/version)
3. Analyze the frames you get back
4. Create a concise actionable recipe for the main agent

CRITICAL: Framebase Query Rules
- MAX 3-5 WORDS ONLY (Meilisearch has 10-word limit, save space for search)
- Use ESSENTIAL keywords only: "create react app", "install mui", "pytest setup"
- NO synonyms or redundant words: "installation setup" is redundant, just use "install"
- NO filler words: "how to", "the", "a", etc.
- Put tool/library name FIRST: "react app create" NOT "create app react"
- Use filters for versions/source instead of putting them in query

Good queries:
✓ "create react app" (3 words, direct)
✓ "mui install" (2 words, essential)
✓ "pytest config" (2 words, clear)

Bad queries:
✗ "react app create installation setup" (5 words, redundant)
✗ "how to install mui library" (5 words, filler)
✗ "setting up pytest for testing" (5 words, verbose)

Be SPECIFIC (versions, commands), be CONCISE (main agent has limited context), be CURRENT (only modern approaches), be HONEST (if frames don't help, say so).

Return ONLY valid JSON following the schema.`;

export interface KnowledgeSynthesisParams {
  userQuery: string;
  category: string;
  environment?: Record<string, unknown>;
  handoffContext?: string; // Natural language handoff from main agent
}

export function buildKnowledgeSynthesisPrompt(params: KnowledgeSynthesisParams): string {
  const envStr = params.environment ? JSON.stringify(params.environment, null, 2) : 'Not provided';

  // Build natural handoff context
  const handoff = params.handoffContext ||
    `I'm working on: "${params.userQuery}"\n\nI need to know the current best practice for this. Can you query Framebase and give me a clear recipe?`;

  return `# Task Handoff from Main Agent

${handoff}

# Environment Context
${envStr}

---

Your tasks:
1. First, generate a smart Framebase query with filters
2. I'll execute the query and get you the frames
3. Then analyze the frames and create a recipe

Start by generating the Framebase query. MAX 3-5 WORDS, use filters for everything else.

Examples (Note: Each query is 2-3 words MAX):
- User: "create react app" → {"q": "create react app", "filters": ["source = \\"react\\""], "limit": 5}
- User: "add MUI v7" → {"q": "mui install", "filters": ["source = \\"mui\\"", "version = \\"7\\""], "limit": 5}
- User: "setup pytest for testing" → {"q": "pytest setup", "filters": ["source = \\"pytest\\""], "limit": 5}
- User: "install storybook" → {"q": "storybook install", "filters": ["source = \\"storybook\\""], "limit": 5}

BAD examples (too verbose):
✗ "react app create installation setup" - use "create react app" instead
✗ "mui library installation" - use "mui install" instead

Generate your Framebase query now (remember: 3-5 words MAX):`;
}
