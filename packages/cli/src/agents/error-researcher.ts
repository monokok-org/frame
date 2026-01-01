/**
 * ErrorResearcher Sub-Agent
 *
 * Proactively searches the web for solutions to unknown errors.
 * Triggered when commands fail with unclear error messages.
 */

import type { ToolResult } from '../types/executor.js';
import { logger } from '../utils/logger.js';
import { webSearch, webFetch } from '../skills/web.js';

export interface ResearchResult {
  searched: boolean;
  solution?: string;
  sources: string[];
  confidence: number;
}

export class ErrorResearcher {
  /**
   * Research a command failure
   */
  async researchError(
    command: string,
    errorOutput: string,
    context: {
      projectType?: string;
      technology?: string;
    }
  ): Promise<ResearchResult> {
    // Check if error is worth researching (not trivial)
    if (!this.shouldResearch(errorOutput)) {
      return { searched: false, sources: [], confidence: 0 };
    }

    logger.info(`[ErrorResearcher] Researching error: ${this.extractErrorSummary(errorOutput)}`);

    // Extract key error patterns
    const errorPatterns = this.extractErrorPatterns(errorOutput);

    // Build search query
    const searchQuery = this.buildSearchQuery(command, errorPatterns, context);

    // Perform web search
    const searchResult = await this.webSearch(searchQuery);

    if (!searchResult.success || !searchResult.result) {
      logger.warn('[ErrorResearcher] Web search failed or returned no results');
      return { searched: true, sources: [], confidence: 0 };
    }

    // Extract solution from search results
    const solution = await this.extractSolution(
      searchResult.result,
      command,
      errorPatterns,
      context
    );

    return solution;
  }

  /**
   * Determine if error is worth researching
   */
  private shouldResearch(errorOutput: string): boolean {
    // Skip trivial errors
    const trivialErrors = [
      /command not found/i,
      /no such file or directory/i,
      /permission denied/i,
    ];

    if (trivialErrors.some((re) => re.test(errorOutput))) {
      return false;
    }

    // Research errors that look like validation failures, API errors, or unknown issues
    const researchableErrors = [
      /validation failed/i,
      /required/i,
      /something went wrong/i,
      /please check/i,
      /error below/i,
      /unexpected/i,
    ];

    return researchableErrors.some((re) => re.test(errorOutput));
  }

  /**
   * Extract error summary for logging
   */
  private extractErrorSummary(errorOutput: string): string {
    const lines = errorOutput.split('\n').filter((l) => l.trim().length > 0);

    // Find first error-like line
    const errorLine = lines.find((l) => /error|failed|wrong/i.test(l));

    if (errorLine) {
      return errorLine.slice(0, 100);
    }

    return lines[0]?.slice(0, 100) || 'Unknown error';
  }

  /**
   * Extract specific error patterns from output
   */
  private extractErrorPatterns(errorOutput: string): string[] {
    const patterns: string[] = [];

    // Validation errors (e.g., "resolvedPaths: Required")
    const validationMatch = errorOutput.match(/- ([\w.]+): (Required|Invalid|Missing)/gi);
    if (validationMatch) {
      patterns.push(...validationMatch);
    }

    // Specific error messages
    const errorLines = errorOutput
      .split('\n')
      .filter((l) => /error|failed/i.test(l) && l.trim().length > 10);

    patterns.push(...errorLines.slice(0, 3));

    return patterns;
  }

  /**
   * Build search query optimized for finding solutions
   */
  private buildSearchQuery(
    command: string,
    errorPatterns: string[],
    context: { projectType?: string; technology?: string }
  ): string {
    const parts: string[] = [];

    const techMatch = command.match(/npx\s+(@?\w+)/);
    const technology = context.technology || (techMatch ? techMatch[1] : '');

    if (technology) {
      parts.push(technology);
    }

    // Add primary error pattern
    if (errorPatterns.length > 0) {
      parts.push(errorPatterns[0]);
    }

    // Add "fix" or "solution"
    parts.push('fix solution');

    // Add year for recency
    parts.push('2025');

    return parts.join(' ');
  }

  /**
   * Perform web search
   */
  private async webSearch(query: string): Promise<ToolResult> {
    try {
      const result = await webSearch.execute({ query, maxResults: 5 });

      return {
        tool: 'web-search',
        args: { query },
        result,
        success: true,
      };
    } catch (error) {
      return {
        tool: 'web-search',
        args: { query },
        result: null,
        error: String(error),
        success: false,
      };
    }
  }

  /**
   * Extract solution from search results using web-fetch
   */
  private async extractSolution(
    searchResults: any,
    command: string,
    errorPatterns: string[],
    _context: { projectType?: string; technology?: string }
  ): Promise<ResearchResult> {
    // searchResults is an array of {title, url, snippet}
    if (!Array.isArray(searchResults) || searchResults.length === 0) {
      return { searched: true, sources: [], confidence: 0 };
    }

    // Prefer official docs and GitHub issues
    const priorityResults = searchResults.sort((a, b) => {
      const aScore = this.scoreUrl(a.url);
      const bScore = this.scoreUrl(b.url);
      return bScore - aScore;
    });

    // Fetch top result
    const topResult = priorityResults[0];
    logger.info(`[ErrorResearcher] Fetching solution from: ${topResult.url}`);

    const fetchResult = await this.webFetch(topResult.url, errorPatterns[0] || command);

    if (!fetchResult.success || !fetchResult.result) {
      // Fallback to snippet
      return {
        searched: true,
        solution: topResult.snippet,
        sources: [topResult.url],
        confidence: 0.5,
      };
    }

    return {
      searched: true,
      solution: String(fetchResult.result),
      sources: [topResult.url],
      confidence: 0.8,
    };
  }

  /**
   * Score URL by trustworthiness for error solutions
   */
  private scoreUrl(url: string): number {
    let score = 0;

    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      return score;
    }

    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const combined = `${host}${path}`;

    if (parsed.protocol === 'https:') score += 5;

    const docHints = [
      'docs',
      'documentation',
      'guide',
      'manual',
      'reference',
      'api',
      'kb',
      'knowledge',
      'support',
      'help',
      'faq',
      'troubleshoot',
    ];
    const communityHints = ['forum', 'community', 'discussion', 'discuss', 'questions', 'answers'];
    const trackerHints = ['issues', 'issue', 'bugs', 'bug', 'changelog', 'releases', 'release'];

    if (
      host.startsWith('docs.') ||
      host.startsWith('developer.') ||
      host.startsWith('support.') ||
      host.startsWith('help.')
    ) {
      score += 25;
    }

    if (docHints.some((hint) => combined.includes(hint))) score += 60;
    if (communityHints.some((hint) => combined.includes(hint))) score += 35;
    if (trackerHints.some((hint) => combined.includes(hint))) score += 25;

    if (url.includes('2025') || url.includes('2024')) score += 10;

    return score;
  }

  /**
   * Fetch web page content
   */
  private async webFetch(url: string, query: string): Promise<ToolResult> {
    try {
      const result = await webFetch.execute({ url });

      return {
        tool: 'web-fetch',
        args: { url, query },
        result,
        success: true,
      };
    } catch (error) {
      return {
        tool: 'web-fetch',
        args: { url, query },
        result: null,
        error: String(error),
        success: false,
      };
    }
  }
}
