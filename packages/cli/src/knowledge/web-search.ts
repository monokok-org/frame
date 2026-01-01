/**
 * Web Search Client
 *
 * Anonymous web search using DuckDuckGo HTML endpoint.
 * No API key required, privacy-focused.
 */

import { logger } from '../utils/logger.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  region?: string;
}

export class WebSearchClient {
  private readonly baseURL = 'https://html.duckduckgo.com/html/';
  private readonly userAgent = 'Mozilla/5.0 (compatible; FrameKnowledgeService/1.0)';

  /**
   * Perform anonymous web search
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { maxResults = 10, region = 'wt-wt' } = options;

    logger.debug(`[WebSearch] Searching: "${query}"`);

    try {
      // Build search URL
      const params = new URLSearchParams({
        q: query,
        kl: region, // Region (wt-wt = worldwide)
      });

      const url = `${this.baseURL}?${params.toString()}`;

      // Fetch results
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': this.userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status} ${response.statusText}`);
      }

      const html = await response.text();

      // Parse results from HTML
      const results = this.parseResults(html);

      logger.debug(`[WebSearch] Found ${results.length} results`);

      return results.slice(0, maxResults);
    } catch (error) {
      logger.error('[WebSearch] Search failed:', error);
      throw new Error(`Web search failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse DuckDuckGo HTML results
   */
  private parseResults(html: string): SearchResult[] {
    const results: SearchResult[] = [];

    // DuckDuckGo result structure:
    // <div class="result__body">
    //   <h2 class="result__title"><a href="...">Title</a></h2>
    //   <a class="result__snippet">Snippet text</a>
    // </div>

    // Simple regex-based parsing (more reliable than full HTML parser)
    // Match result blocks
    const resultRegex = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
    const titleRegex = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i;
    const snippetRegex = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i;

    let match;
    while ((match = resultRegex.exec(html)) !== null) {
      const resultBlock = match[1];

      // Extract title and URL
      const titleMatch = titleRegex.exec(resultBlock);
      if (!titleMatch) continue;

      let url = titleMatch[1];
      const title = this.cleanHTML(titleMatch[2]);

      // DuckDuckGo uses redirect URLs, extract actual URL
      if (url.startsWith('/l/?')) {
        const urlParams = new URLSearchParams(url.substring(3));
        url = urlParams.get('uddg') || url;
      }

      // Extract snippet
      const snippetMatch = snippetRegex.exec(resultBlock);
      const snippet = snippetMatch ? this.cleanHTML(snippetMatch[1]) : '';

      results.push({
        title,
        url,
        snippet
      });
    }

    return results;
  }

  /**
   * Clean HTML tags and entities from text
   */
  private cleanHTML(text: string): string {
    return text
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Build optimized search query for technical knowledge
   */
  buildTechnicalQuery(query: string, options: {
    category?: string;
    tech_stack?: string;
    year?: number;
  } = {}): string {
    const { category, tech_stack, year } = options;
    const currentYear = year || new Date().getFullYear();

    // Add category-specific prefixes
    const prefixes: Record<string, string> = {
      'best-practice': 'best way to',
      'deprecated-check': 'is deprecated',
      'current-standard': 'current standard for',
      'tool-comparison': 'compare',
    };

    const parts = [
      category && prefixes[category] ? prefixes[category] : '',
      query,
      tech_stack || '',
      currentYear.toString()
    ].filter(Boolean);

    return parts.join(' ');
  }
}
