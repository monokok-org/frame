/**
 * ErrorTracker
 *
 * Extracts actionable information from error output (breadcrumbs)
 * and suggests immediate solutions before escalating to research/council.
 */

import { logger } from '../utils/logger.js';

/**
 * Error breadcrumbs extracted from stderr/stdout
 */
export interface ErrorBreadcrumbs {
  /** Commands suggested by error message (e.g., "did you mean X?") */
  suggestedCommands: string[];

  /** Missing packages/modules mentioned */
  missingPackages: string[];

  /** Deprecation warnings */
  deprecationWarnings: string[];

  /** File paths referenced in errors */
  fileReferences: string[];

  /** URLs mentioned (documentation links) */
  urlReferences: string[];

  /** Config issues detected */
  configIssues: string[];

  /** Environment problems */
  environmentIssues: string[];
}

/**
 * Solution derived from breadcrumbs
 */
export interface Solution {
  /** Type of solution */
  type: 'command' | 'install' | 'research' | 'fetch' | 'config' | 'environment';

  /** The solution value (command to run, package to install, URL to fetch, etc.) */
  value: string;

  /** Confidence in this solution (0.0-1.0) */
  confidence: number;

  /** Why this solution was suggested */
  reason: string;
}

export class ErrorTracker {
  /**
   * Extract actionable information from error output
   */
  parseErrorBreadcrumbs(stderr: string, stdout: string): ErrorBreadcrumbs {
    const combined = `${stderr}\n${stdout}`;

    const breadcrumbs: ErrorBreadcrumbs = {
      suggestedCommands: [],
      missingPackages: [],
      deprecationWarnings: [],
      fileReferences: [],
      urlReferences: [],
      configIssues: [],
      environmentIssues: [],
    };

    // Parse "Did you mean X?" suggestions
    const didYouMeanMatches = combined.matchAll(/did you mean[:\s]+['\"`]?([^'\"`\n]+)['\"`]?/gi);
    for (const match of didYouMeanMatches) {
      breadcrumbs.suggestedCommands.push(match[1].trim());
    }

    // Parse "Try running X" suggestions
    const tryRunningMatches = combined.matchAll(/try running[:\s]+['\"`]?([^'\"`\n]+)['\"`]?/gi);
    for (const match of tryRunningMatches) {
      breadcrumbs.suggestedCommands.push(match[1].trim());
    }

    // Parse "Module not found: X"
    const moduleNotFoundMatches = combined.matchAll(/(?:module|package) not found[:\s]+['\"`]?([^'\"`\n]+)['\"`]?/gi);
    for (const match of moduleNotFoundMatches) {
      breadcrumbs.missingPackages.push(match[1].trim());
    }

    // Parse "Cannot find module 'X'"
    const cannotFindMatches = combined.matchAll(/cannot find (?:module|package)[:\s]+['\"`]([^'\"`]+)['\"`]/gi);
    for (const match of cannotFindMatches) {
      breadcrumbs.missingPackages.push(match[1].trim());
    }

    // Parse deprecation warnings
    const deprecatedMatches = combined.matchAll(/deprecated[:\s]+(.+?)(?:\n|$)/gi);
    for (const match of deprecatedMatches) {
      breadcrumbs.deprecationWarnings.push(match[1].trim());
    }

    // Parse file paths mentioned in errors (at/in/from <file>:<line>)
    const filePathMatches = combined.matchAll(/(?:at |in |from )([\\/\w.-]+\.\w+)(?::\d+)?/g);
    for (const match of filePathMatches) {
      breadcrumbs.fileReferences.push(match[1].trim());
    }

    // Parse URLs (documentation links)
    const urlMatches = combined.matchAll(/https?:\/\/[^\s]+/g);
    for (const match of urlMatches) {
      breadcrumbs.urlReferences.push(match[0].trim());
    }

    // Parse config issues
    const configMatches = combined.matchAll(/(?:missing|invalid|required)[:\s]+(.+?(?:config|\.json|\.yaml|\.toml))(?:\n|$)/gi);
    for (const match of configMatches) {
      breadcrumbs.configIssues.push(match[1].trim());
    }

    // Parse environment issues
    const envMatches = combined.matchAll(/(?:environment variable|env)[:\s]+([A-Z_]+)/g);
    for (const match of envMatches) {
      breadcrumbs.environmentIssues.push(match[1].trim());
    }

    logger.debug(`[ErrorTracker] Extracted breadcrumbs: ${JSON.stringify(breadcrumbs, null, 2)}`);

    return breadcrumbs;
  }

  /**
   * Follow breadcrumbs to find solution
   */
  async followBreadcrumbs(breadcrumbs: ErrorBreadcrumbs): Promise<Solution | null> {
    // Priority 1: Try suggested command first (highest confidence)
    if (breadcrumbs.suggestedCommands.length > 0) {
      return {
        type: 'command',
        value: breadcrumbs.suggestedCommands[0],
        confidence: 0.9,
        reason: 'Error message suggested this command',
      };
    }

    // Priority 2: If missing package, try to install
    if (breadcrumbs.missingPackages.length > 0) {
      const pkg = breadcrumbs.missingPackages[0];
      return {
        type: 'install',
        value: pkg,
        confidence: 0.8,
        reason: `Error indicates missing package: ${pkg}`,
      };
    }

    // Priority 3: If config issue, suggest reading config file
    if (breadcrumbs.configIssues.length > 0) {
      return {
        type: 'config',
        value: breadcrumbs.configIssues[0],
        confidence: 0.7,
        reason: `Error indicates config issue: ${breadcrumbs.configIssues[0]}`,
      };
    }

    // Priority 4: If URL provided, fetch it
    if (breadcrumbs.urlReferences.length > 0) {
      return {
        type: 'fetch',
        value: breadcrumbs.urlReferences[0],
        confidence: 0.8,
        reason: 'Error message referenced this documentation',
      };
    }

    // Priority 5: If deprecation, search for replacement
    if (breadcrumbs.deprecationWarnings.length > 0) {
      const searchQuery = `${breadcrumbs.deprecationWarnings[0]} replacement 2025`;
      return {
        type: 'research',
        value: searchQuery,
        confidence: 0.6,
        reason: 'Deprecation warning detected, need to find replacement',
      };
    }

    // Priority 6: If environment issue, suggest checking env
    if (breadcrumbs.environmentIssues.length > 0) {
      return {
        type: 'environment',
        value: breadcrumbs.environmentIssues[0],
        confidence: 0.7,
        reason: `Error indicates missing environment variable: ${breadcrumbs.environmentIssues[0]}`,
      };
    }

    return null;
  }

  /**
   * Check if error has actionable breadcrumbs
   */
  hasActionableBreadcrumbs(breadcrumbs: ErrorBreadcrumbs): boolean {
    return (
      breadcrumbs.suggestedCommands.length > 0 ||
      breadcrumbs.missingPackages.length > 0 ||
      breadcrumbs.urlReferences.length > 0 ||
      breadcrumbs.configIssues.length > 0
    );
  }

  /**
   * Normalize error message for comparison (remove timestamps, paths, etc.)
   */
  normalizeError(error: string): string {
    return error
      .replace(/\d{4}-\d{2}-\d{2}/g, 'DATE') // Remove dates
      .replace(/\d{2}:\d{2}:\d{2}/g, 'TIME') // Remove times
      .replace(/\/[\w\/.-]+/g, 'PATH') // Remove paths
      .replace(/line \d+/gi, 'line N') // Remove line numbers
      .toLowerCase()
      .trim();
  }

  /**
   * Check if two errors are the same (normalized comparison)
   */
  isSameError(error1: string, error2: string): boolean {
    return this.normalizeError(error1) === this.normalizeError(error2);
  }
}
