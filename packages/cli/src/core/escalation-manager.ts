/**
 * EscalationManager
 *
 * Determines when to escalate from Direct Executor to Council/Research.
 * Follows the principle: "Only escalate when actually stuck"
 */

import type { ExecutorContext, ExecutionPlan } from '../types/executor.js';
import { ErrorTracker } from './error-tracker.js';
import { logger } from '../utils/logger.js';

/**
 * Escalation decision
 */
export interface EscalationDecision {
  /** Should we escalate? */
  escalate: boolean;

  /** Where to escalate (if escalate=true) */
  target?: 'research' | 'council' | 'debugger';

  /** Why escalate */
  reason?: string;

  /** What to escalate (query for research, error for debugger) */
  query?: string;
}

/**
 * Escalation configuration
 */
export interface EscalationConfig {
  /** Minimum confidence threshold for plans */
  minPlanConfidence: number;

  /** How many times same error must repeat before escalating */
  sameErrorThreshold: number;

  /** Complexity threshold (0-1) - simple tasks don't escalate on first attempt */
  simpleTaskThreshold: number;
}

const DEFAULT_CONFIG: EscalationConfig = {
  minPlanConfidence: 0.5,
  sameErrorThreshold: 2,
  simpleTaskThreshold: 0.5,
};

export class EscalationManager {
  private errorTracker: ErrorTracker;
  private config: EscalationConfig;

  constructor(config?: Partial<EscalationConfig>) {
    this.errorTracker = new ErrorTracker();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Determine if we should escalate
   */
  shouldEscalate(context: ExecutorContext, plan?: ExecutionPlan): EscalationDecision {
    // NEVER escalate on first attempt of simple tasks
    if (context.retries === 0 && this.isSimpleTask(context)) {
      logger.debug('[EscalationManager] Simple task on first attempt - no escalation');
      return { escalate: false };
    }

    // Escalate if planner admitted uncertainty (confidence < threshold)
    if (plan && plan.confidence < this.config.minPlanConfidence) {
      logger.info(
        `[EscalationManager] Plan confidence too low: ${plan.confidence} < ${this.config.minPlanConfidence}`
      );

      // Check if planner needs research
      if (plan.needsResearch && plan.needsResearch.length > 0) {
        return {
          escalate: true,
          target: 'research',
          reason: 'Planner needs research',
          query: plan.needsResearch[0],
        };
      }

      // Check if planner has uncertainties
      if (plan.uncertainties && plan.uncertainties.length > 0) {
        return {
          escalate: true,
          target: 'council',
          reason: 'Planner uncertain',
          query: plan.uncertainties.join('; '),
        };
      }

      // Generic low confidence
      return {
        escalate: true,
        target: 'research',
        reason: 'Plan confidence too low',
        query: context.query,
      };
    }

    // Escalate if same error repeated multiple times
    if (this.sameErrorRepeated(context, this.config.sameErrorThreshold)) {
      logger.warn(
        `[EscalationManager] Same error repeated ${this.config.sameErrorThreshold}+ times`
      );
      return {
        escalate: true,
        target: 'council',
        reason: 'Same error repeated',
        query: context.lastError || 'Unknown error',
      };
    }

    // Escalate if error message is unclear after 1st retry
    if (context.retries >= 1 && context.lastError) {
      const breadcrumbs = this.errorTracker.parseErrorBreadcrumbs(context.lastError, '');

      if (!this.errorTracker.hasActionableBreadcrumbs(breadcrumbs)) {
        logger.info('[EscalationManager] Error unclear after retry, escalating to debugger');
        return {
          escalate: true,
          target: 'debugger',
          reason: 'Unclear error',
          query: context.lastError,
        };
      }
    }

    // Don't escalate - try again
    logger.debug('[EscalationManager] No escalation needed, continuing with retry');
    return { escalate: false };
  }

  /**
   * Check if same error repeated N times
   */
  private sameErrorRepeated(context: ExecutorContext, threshold: number): boolean {
    // Build error history from execution log
    const errorEntries = context.executionLog.filter((entry) => this.isErrorEntry(entry));

    if (errorEntries.length < threshold) {
      return false;
    }

    // Take last N errors
    const recentErrors = errorEntries.slice(-threshold);

    // Normalize and compare
    const firstError = this.errorTracker.normalizeError(recentErrors[0]);
    const allSame = recentErrors.every(
      (e) => this.errorTracker.normalizeError(e) === firstError
    );

    return allSame;
  }

  private isErrorEntry(entry: string): boolean {
    const normalized = entry.toLowerCase();
    return normalized.includes('error') || normalized.includes('failed');
  }

  /**
   * Estimate task complexity
   */
  private isSimpleTask(context: ExecutorContext): boolean {
    const query = context.query.toLowerCase();

    // Simple keywords
    const simpleKeywords = [
      'read',
      'show',
      'display',
      'list',
      'find',
      'search',
      'what is',
      'where is',
      'how to',
    ];

    // Complex keywords
    const complexKeywords = [
      'install',
      'setup',
      'configure',
      'create',
      'build',
      'deploy',
      'refactor',
      'migrate',
    ];

    const hasSimpleKeyword = simpleKeywords.some((kw) => query.includes(kw));
    const hasComplexKeyword = complexKeywords.some((kw) => query.includes(kw));

    // If plan exists, use step count as complexity indicator
    if (context.plan) {
      return context.plan.steps.length <= 3;
    }

    // Heuristic: simple if has simple keyword and no complex keyword
    return hasSimpleKeyword && !hasComplexKeyword;
  }
}
