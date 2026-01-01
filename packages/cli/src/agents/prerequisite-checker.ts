/**
 * PrerequisiteChecker Sub-Agent
 *
 * Validates dependencies before execution to prevent retry loops.
 * Checks prerequisites from learned patterns and suggests remediation steps.
 */

import type { WorkspaceDB } from '../db/workspace-db.js';
import type { ToolResult, PlanStep } from '../types/executor.js';
import { logger } from '../utils/logger.js';
import { allSkills } from '../skills/index.js';

export interface Prerequisite {
  description: string;
  check: {
    tool: string;
    args: Record<string, any>;
  };
  remedy: PlanStep[];
}

export interface PrerequisiteCheckResult {
  passed: boolean;
  failures: Array<{
    prereq: Prerequisite;
    checkResult: ToolResult;
  }>;
  recommendedSteps: PlanStep[];
}

export class PrerequisiteChecker {
  private workspaceDB: WorkspaceDB;

  constructor(workspaceDB: WorkspaceDB) {
    this.workspaceDB = workspaceDB;
  }

  /**
   * Check prerequisites for a learned pattern
   */
  async checkPattern(patternId: string): Promise<PrerequisiteCheckResult> {
    logger.info(`[PrerequisiteChecker] Checking prerequisites for pattern: ${patternId}`);

    const pattern = this.workspaceDB.getPattern(patternId);

    if (!pattern) {
      logger.warn(`[PrerequisiteChecker] Pattern not found: ${patternId}`);
      return {
        passed: true,
        failures: [],
        recommendedSteps: [],
      };
    }

    return this.checkPrerequisites(JSON.parse(pattern.prerequisites));
  }

  /**
   * Check a list of prerequisites
   */
  async checkPrerequisites(prerequisites: Prerequisite[]): Promise<PrerequisiteCheckResult> {
    if (prerequisites.length === 0) {
      logger.debug('[PrerequisiteChecker] No prerequisites to check');
      return {
        passed: true,
        failures: [],
        recommendedSteps: [],
      };
    }

    logger.info(`[PrerequisiteChecker] Checking ${prerequisites.length} prerequisites`);

    const failures: Array<{ prereq: Prerequisite; checkResult: ToolResult }> = [];

    for (const prereq of prerequisites) {
      const checkResult = await this.runCheck(prereq.check.tool, prereq.check.args);

      if (!checkResult.success) {
        logger.warn(`[PrerequisiteChecker] Failed: ${prereq.description}`);
        failures.push({ prereq, checkResult });
      } else {
        logger.debug(`[PrerequisiteChecker] Passed: ${prereq.description}`);
      }
    }

    // Collect all remedy steps from failures
    const recommendedSteps: PlanStep[] = [];
    for (const failure of failures) {
      recommendedSteps.push(...failure.prereq.remedy);
    }

    const passed = failures.length === 0;

    if (passed) {
      logger.info('[PrerequisiteChecker] All prerequisites satisfied');
    } else {
      logger.warn(
        `[PrerequisiteChecker] ${failures.length} prerequisite(s) failed, ${recommendedSteps.length} remedy step(s) recommended`
      );
    }

    return {
      passed,
      failures,
      recommendedSteps,
    };
  }

  /**
   * Run a single prerequisite check (invoke tool)
   */
  private async runCheck(
    toolName: string,
    args: Record<string, any>
  ): Promise<ToolResult> {
    const skill = allSkills.find((s) => s.id === toolName);

    if (!skill) {
      logger.error(`[PrerequisiteChecker] Unknown tool: ${toolName}`);
      return {
        tool: toolName,
        args,
        result: null,
        error: `Unknown tool: ${toolName}`,
        success: false,
      };
    }

    try {
      const result = await skill.execute(args);

      return {
        tool: toolName,
        args,
        result,
        success: true,
      };
    } catch (error) {
      logger.debug(`[PrerequisiteChecker] Check failed: ${error}`);
      return {
        tool: toolName,
        args,
        result: null,
        error: String(error),
        success: false,
      };
    }
  }

  /**
   * Infer prerequisites from context.
   * Disabled to keep prerequisite checks task-agnostic.
   */
  static inferPrerequisites(query: string, projectType: string): Prerequisite[] {
    void query;
    void projectType;
    return [];
  }
}
