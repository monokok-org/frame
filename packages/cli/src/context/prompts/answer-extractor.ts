export const ANSWER_EXTRACTION_SYSTEM_PROMPT =
  'You are a technical knowledge extractor. You analyze search results and provide current, actionable answers.';

export function buildAnswerExtractionPrompt(
  query: string,
  context: string,
  category?: string,
  techStack?: string
): string {
  const year = new Date().getFullYear();

  return `Based on these search results, answer the technical question.

Question: ${query}
${techStack ? `Technology: ${techStack}` : ''}
${category ? `Category: ${category}` : ''}

Search Results:
${context}

IMPORTANT:
- Focus on CURRENT best practices (${year})
- Identify deprecated/outdated methods
- Provide actionable, specific answers
- Include brief rationale

Return ONLY valid JSON in this format:
{
  "current_method": "The current recommended approach (be specific, include commands/code if applicable)",
  "deprecated": ["List any deprecated alternatives to avoid"],
  "rationale": "Brief explanation why this is current standard (1-2 sentences)"
}`;
}
