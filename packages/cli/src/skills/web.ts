import type { MotorSkill } from '@homunculus-live/core';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchParams {
  query: string;
  maxResults?: number;
}

export const webSearch: MotorSkill<WebSearchParams, SearchResult[]> = {
  id: 'web-search',
  name: 'Web Search',
  description: `Search the web for current information using DuckDuckGo.

CRITICAL RULES:
- ALWAYS include the current year (2025) in search queries for recent/current info
- Example: "React documentation 2025" NOT "React documentation"
- Use only after knowledge-query (Framebase) returns no useful data
- Maximum 10 results (capped by safety policy)`,

  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (include year 2025 for current info)'
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (default: 5, max: 10)'
      }
    },
    required: ['query']
  },

  async execute(params: WebSearchParams): Promise<SearchResult[]> {
    const { query, maxResults = 5 } = params;

    try {
      // Using DuckDuckGo HTML search (no API key required)
      const encodedQuery = encodeURIComponent(query);
      const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FrameResearcher/1.0)',
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Parse DuckDuckGo HTML results
      // This is a simple regex-based parser - could be improved with a proper HTML parser
      const results: SearchResult[] = [];
      const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([^<]+)</g;

      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        results.push({
          url: match[1],
          title: match[2].trim(),
          snippet: match[3].trim(),
        });
      }

      return results;
    } catch (error) {
      throw new Error(`Web search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export const webFetch: MotorSkill<{ url: string }, string> = {
  id: 'web-fetch',
  name: 'Fetch Web Content',
  description: 'Fetch and read the text content from a URL',

  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'URL to fetch content from'
      }
    },
    required: ['url']
  },

  async execute(input: { url: string }): Promise<string> {
    const url = input.url;
    try {
      // Validate URL format
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are supported');
      }

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; FrameResearcher/1.0)',
        },
        // Add timeout
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/') && !contentType.includes('application/json')) {
        throw new Error('URL does not return text content');
      }

      const text = await response.text();

      // Strip HTML tags for simpler text extraction
      const stripped = text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      // Limit to first 10,000 characters to avoid overwhelming context
      return stripped.slice(0, 10000);
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('Web fetch timed out after 15 seconds');
      }
      throw new Error(`Web fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};

export const webSkills = [webSearch, webFetch];
