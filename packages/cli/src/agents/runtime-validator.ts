/**
 * RuntimeValidator Sub-Agent
 *
 * Runs build/test commands to verify the application actually works.
 * Task-agnostic: uses project-specific scripts from workspace context.
 */

import type { ToolResult } from '../types/executor.js';
import type { LearnedFrame, VerificationCheck, CheckResult, VerificationResult } from '../types/learned-frames.js';
import type { UnifiedLLMClient } from '../llm/unified-client.js';
import { logger } from '../utils/logger.js';
import { allSkills } from '../skills/index.js';
import { PlatformDetector } from './platform-detector.js';
import { DependencyChecker } from './dependency-checker.js';
import fs from 'fs';
import path from 'path';

export interface ValidationCommand {
  name: string;
  command: string;
  timeout: number;
  optional?: boolean; // If true, failure doesn't fail validation
}

export interface RuntimeValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  commandResults: Array<{
    command: ValidationCommand;
    result: ToolResult;
  }>;
}

export class RuntimeValidator {
  private platformDetector?: PlatformDetector;
  private dependencyChecker?: DependencyChecker;

  constructor(llm?: UnifiedLLMClient) {
    if (llm) {
      this.platformDetector = new PlatformDetector(llm);
      this.dependencyChecker = new DependencyChecker(llm);
    }
  }

  /**
   * Validate using provided commands
   */
  async validate(
    commands: ValidationCommand[],
    opts: {
      failFast?: boolean; // Stop on first failure
    } = {}
  ): Promise<RuntimeValidationResult> {
    if (commands.length === 0) {
      logger.debug('[RuntimeValidator] No validation commands provided');
      return {
        passed: true,
        errors: [],
        warnings: [],
        commandResults: [],
      };
    }

    logger.info(`[RuntimeValidator] Running ${commands.length} validation command(s)`);

    const errors: string[] = [];
    const warnings: string[] = [];
    const commandResults: Array<{ command: ValidationCommand; result: ToolResult }> = [];

    for (const cmd of commands) {
      logger.info(`[RuntimeValidator] Running: ${cmd.name} (${cmd.command})`);

      const result = await this.runCommand(cmd.command, cmd.timeout);
      commandResults.push({ command: cmd, result });

      // Check for errors
      const hasError = this.detectError(result);

      if (hasError) {
        const errorMsg = `${cmd.name} failed: ${result.error || this.extractErrorMessage(result)}`;

        if (cmd.optional) {
          warnings.push(errorMsg);
          logger.warn(`[RuntimeValidator] ${errorMsg} (optional, continuing)`);
        } else {
          errors.push(errorMsg);
          logger.error(`[RuntimeValidator] ${errorMsg}`);

          if (opts.failFast) {
            logger.warn('[RuntimeValidator] failFast enabled, stopping validation');
            break;
          }
        }
      } else {
        logger.info(`[RuntimeValidator] ${cmd.name} passed`);
      }
    }

    const passed = errors.length === 0;

    if (passed) {
      logger.info('[RuntimeValidator] All validation commands passed');
    } else {
      logger.warn(`[RuntimeValidator] ${errors.length} error(s), ${warnings.length} warning(s)`);
    }

    return {
      passed,
      errors,
      warnings,
      commandResults,
    };
  }

  /**
   * Run a command using exec-command skill
   */
  private async runCommand(command: string, timeout: number): Promise<ToolResult> {
    const execSkill = allSkills.find((s) => s.id === 'exec-command');

    if (!execSkill) {
      logger.error('[RuntimeValidator] exec-command skill not found');
      return {
        tool: 'exec-command',
        args: { command },
        result: null,
        error: 'exec-command skill not found',
        success: false,
      };
    }

    try {
      const result = await execSkill.execute({ command, timeout });

      return {
        tool: 'exec-command',
        args: { command, timeout },
        result,
        success: true,
      };
    } catch (error) {
      logger.debug(`[RuntimeValidator] Command failed: ${error}`);
      return {
        tool: 'exec-command',
        args: { command, timeout },
        result: null,
        error: String(error),
        success: false,
      };
    }
  }

  /**
   * Detect if a command result indicates an error
   */
  private detectError(result: ToolResult): boolean {
    // Tool invocation failed
    if (!result.success) {
      return true;
    }

    // Check exit code
    if (result.result && typeof result.result === 'object') {
      const execResult = result.result as any;

      // Non-zero exit code
      if (execResult.exitCode && execResult.exitCode !== 0) {
        return true;
      }

      // stderr contains "error" (case-insensitive)
      if (execResult.stderr && /error/i.test(execResult.stderr)) {
        return true;
      }

      // stdout contains "error" (but not "0 errors" or similar)
      if (
        execResult.stdout &&
        /error/i.test(execResult.stdout) &&
        !/0\s+errors?/i.test(execResult.stdout)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Extract error message from command result
   */
  private extractErrorMessage(result: ToolResult): string {
    if (result.error) {
      return result.error;
    }

    if (result.result && typeof result.result === 'object') {
      const execResult = result.result as any;

      if (execResult.stderr) {
        // Extract first few lines of stderr
        const lines = execResult.stderr.split('\n').slice(0, 5);
        return lines.join('\n');
      }

      if (execResult.stdout) {
        // Extract error lines from stdout
        const errorLines = execResult.stdout
          .split('\n')
          .filter((line: string) => /error/i.test(line))
          .slice(0, 5);
        return errorLines.join('\n');
      }

      if (execResult.exitCode) {
        return `Exit code ${execResult.exitCode}`;
      }
    }

    return 'Unknown error';
  }

  /**
   * Infer validation commands from project type and available scripts
   */
  static inferValidationCommands(
    projectType: string,
    availableScripts: Record<string, string>,
    mode: 'strict' | 'lenient' = 'lenient'
  ): ValidationCommand[] {
    const commands: ValidationCommand[] = [];

    // JavaScript/TypeScript projects
    if (projectType === 'react' || projectType === 'vue' || projectType === 'javascript') {
      // Type checking (strict)
      if (availableScripts.typecheck) {
        commands.push({
          name: 'Type checking',
          command: 'npm run typecheck',
          timeout: 30000,
          optional: mode === 'lenient',
        });
      } else if (availableScripts.tsc) {
        commands.push({
          name: 'Type checking',
          command: 'npm run tsc',
          timeout: 30000,
          optional: mode === 'lenient',
        });
      }

      // Build (strict)
      if (availableScripts.build) {
        commands.push({
          name: 'Build',
          command: 'npm run build',
          timeout: 60000,
          optional: false,
        });
      }

      // Lint (lenient)
      if (availableScripts.lint) {
        commands.push({
          name: 'Linting',
          command: 'npm run lint',
          timeout: 30000,
          optional: true,
        });
      }

      // Tests (lenient)
      if (availableScripts.test) {
        commands.push({
          name: 'Tests',
          command: 'npm run test',
          timeout: 60000,
          optional: true,
        });
      }
    }

    // Python projects
    if (projectType === 'python') {
      // Type checking (mypy)
      commands.push({
        name: 'Type checking',
        command: 'python -m mypy .',
        timeout: 30000,
        optional: mode === 'lenient',
      });

      // Tests (pytest)
      commands.push({
        name: 'Tests',
        command: 'python -m pytest',
        timeout: 60000,
        optional: mode === 'lenient',
      });
    }

    // Go projects
    if (projectType === 'go') {
      commands.push({
        name: 'Build',
        command: 'go build ./...',
        timeout: 60000,
        optional: false,
      });

      commands.push({
        name: 'Tests',
        command: 'go test ./...',
        timeout: 60000,
        optional: mode === 'lenient',
      });
    }

    // Rust projects
    if (projectType === 'rust') {
      commands.push({
        name: 'Build',
        command: 'cargo build',
        timeout: 120000,
        optional: false,
      });

      commands.push({
        name: 'Tests',
        command: 'cargo test',
        timeout: 120000,
        optional: mode === 'lenient',
      });
    }

    return commands;
  }

  /**
   * Verify execution using LearnedFrame verification checks
   */
  async verifyWithFrame(
    frame: LearnedFrame,
    executionResult?: ToolResult
  ): Promise<VerificationResult> {
    logger.info(`[RuntimeValidator] Verifying with frame: ${frame.id}`);

    // Permissive mode: just check exit code
    if (frame.verification.mode === 'permissive') {
      const success = executionResult ? executionResult.success : true;
      return {
        success,
        reason: success ? 'Permissive verification passed' : 'Execution failed',
      };
    }

    // Strict mode: run all verification checks
    const results: CheckResult[] = [];

    for (const check of frame.verification.checks) {
      logger.debug(`[RuntimeValidator] Running check: ${check.type} - ${check.expectation}`);
      const result = await this.runCheck(check);
      results.push(result);

      if (!result.passed) {
        logger.warn(`[RuntimeValidator] Check failed: ${check.expectation}`);
      }
    }

    const allPassed = results.every((r) => r.passed);
    const failures = results.filter((r) => !r.passed);

    if (!allPassed) {
      return {
        success: false,
        reason: `${failures.length} verification check(s) failed`,
        failedChecks: failures,
      };
    }

    logger.info('[RuntimeValidator] All frame verification checks passed');
    return { success: true };
  }

  /**
   * Run a single verification check
   */
  async runCheck(check: VerificationCheck): Promise<CheckResult> {
    switch (check.type) {
      case 'file-exists':
        return this.checkFileExists(check);

      case 'dependency-installed':
        return this.checkDependencyInstalled(check);

      case 'command-succeeds':
        return this.checkCommandSucceeds(check);

      case 'app-runs':
        return this.checkAppRuns(check);

      default:
        logger.warn(`[RuntimeValidator] Unknown check type: ${(check as any).type}`);
        return {
          passed: false,
          expectation: check.expectation,
          error: `Unknown check type: ${(check as any).type}`,
        };
    }
  }

  /**
   * Check if file exists (supports glob patterns)
   */
  private async checkFileExists(check: VerificationCheck): Promise<CheckResult> {
    const { path: filePath, pattern } = check.args;

    if (pattern) {
      // Use glob skill for pattern matching
      const globSkill = allSkills.find((s) => s.id === 'glob');
      if (!globSkill) {
        return {
          passed: false,
          expectation: check.expectation,
          error: 'glob skill not found',
        };
      }

      try {
        const result = await globSkill.execute({ pattern });
        const files = result as string[];
        const exists = files && files.length > 0;

        return {
          passed: exists,
          expectation: check.expectation,
          actualValue: exists ? `Found ${files.length} file(s)` : 'No files found',
        };
      } catch (error) {
        return {
          passed: false,
          expectation: check.expectation,
          error: String(error),
        };
      }
    } else if (filePath) {
      // Simple file existence check
      const exists = fs.existsSync(path.resolve(process.cwd(), filePath));
      return {
        passed: exists,
        expectation: check.expectation,
        actualValue: exists ? 'File exists' : 'File not found',
      };
    }

    return {
      passed: false,
      expectation: check.expectation,
      error: 'Missing path or pattern argument',
    };
  }

  /**
   * Check if dependency is installed (LLM-based, platform-agnostic)
   * Works with ANY manifest format - LLM figures it out!
   */
  private async checkDependencyInstalled(check: VerificationCheck): Promise<CheckResult> {
    const { dependency } = check.args;

    try {
      // If we have LLM agents, use them!
      if (this.platformDetector && this.dependencyChecker) {
        logger.info(`[RuntimeValidator] Using LLM-based dependency check for "${dependency}"`);

        // Step 1: Detect platform and find manifest files
        const detection = await this.platformDetector.detect(process.cwd());

        // Step 2: Get all dependency files across all platforms
        const allManifests: string[] = [];
        for (const manifestList of Object.values(detection.dependencyFiles)) {
          allManifests.push(...manifestList);
        }

        if (allManifests.length === 0) {
          return {
            passed: false,
            expectation: check.expectation,
            actualValue: 'No dependency manifests found',
          };
        }

        logger.debug(`[RuntimeValidator] Checking ${allManifests.length} manifest file(s)`);

        // Step 3: Check each manifest using LLM
        const result = await this.dependencyChecker.checkMultiple(
          dependency,
          allManifests.map((f) => path.join(process.cwd(), f))
        );

        return {
          passed: result.installed,
          expectation: check.expectation,
          actualValue: result.installed
            ? `Found: ${result.reasoning}`
            : `Not found: ${result.reasoning}`,
        };
      }

      // Fallback: simple file-based check (if no LLM available)
      logger.warn('[RuntimeValidator] No LLM available, using fallback dependency check');
      return this.fallbackDependencyCheck(dependency, check);
    } catch (error) {
      return {
        passed: false,
        expectation: check.expectation,
        error: String(error),
      };
    }
  }

  /**
   * Fallback dependency check - should never be needed if LLM is available
   */
  private async fallbackDependencyCheck(
    dependency: string,
    check: VerificationCheck
  ): Promise<CheckResult> {
    logger.error('[RuntimeValidator] LLM not available - cannot perform platform-agnostic dependency check');

    return {
      passed: false,
      expectation: check.expectation,
      error: `LLM required for dependency check of "${dependency}" - no hardcoded fallback available`,
    };
  }

  /**
   * Check if command succeeds (exit code 0)
   */
  private async checkCommandSucceeds(check: VerificationCheck): Promise<CheckResult> {
    const { command } = check.args;

    const result = await this.runCommand(command, 30000);

    const success =
      result.success &&
      result.result &&
      typeof result.result === 'object' &&
      (result.result as any).exitCode === 0;

    return {
      passed: success,
      expectation: check.expectation,
      actualValue: success
        ? 'Command succeeded'
        : `Command failed: ${result.error || 'Non-zero exit code'}`,
    };
  }

  /**
   * Check if app runs without errors
   */
  private async checkAppRuns(check: VerificationCheck): Promise<CheckResult> {
    const { command } = check.args;

    const result = await this.runCommand(command, 10000);

    if (!result.success) {
      return {
        passed: false,
        expectation: check.expectation,
        actualValue: `Failed to run: ${result.error}`,
      };
    }

    const execResult = result.result as any;
    const hasError =
      execResult.exitCode !== 0 ||
      (execResult.stderr && /error/i.test(execResult.stderr));

    return {
      passed: !hasError,
      expectation: check.expectation,
      actualValue: hasError
        ? 'App encountered errors'
        : 'App ran successfully',
    };
  }
}
