/**
 * Context Builder
 *
 * Role-based context strategies for optimal token usage with small models (7B-14B).
 * Integrates with LocalKnowledgeService for knowledge augmentation.
 */

import {
  type ContextRole,
  type ErrorInfo,
} from '../types/context.js';
import type { ExecutorContext } from '../types/executor.js';
import { type LocalKnowledgeService, type KnowledgeQuery } from '../knowledge/index.js';
import { WorkspaceMemoryManager } from './workspace-memory.js';
import { allSkills } from '../skills/index.js';
import { logger } from '../utils/logger.js';
import fs from 'fs';

/**
 * Context builder with role-based strategies
 */
export class ContextBuilder {
  private workspaceMemory: WorkspaceMemoryManager;
  private knowledgeService?: LocalKnowledgeService;

  constructor(
    workspaceMemory: WorkspaceMemoryManager,
    knowledgeService?: LocalKnowledgeService
  ) {
    this.workspaceMemory = workspaceMemory;
    this.knowledgeService = knowledgeService;
  }

  /**
   * Build context based on role
   */
  async buildContext(
    role: ContextRole,
    query: string,
    options: {
      executorContext?: ExecutorContext;
      errorInfo?: ErrorInfo;
    } = {}
  ): Promise<string> {

    switch (role) {
      case 'STATEFUL':
        return this.buildStatefulContext(query, options.executorContext);

      case 'STATELESS':
        return this.buildStatelessContext(query);

      case 'SELECTIVE':
        return this.buildSelectiveContext(query, options.errorInfo);

      case 'ORACLE':
        return this.buildOracleContext(query, options);

      case 'DIAGNOSTIC':
        return this.buildDiagnosticContext(query, options.executorContext);

      default:
        throw new Error(`Unknown context role: ${role}`);
    }
  }

  /**
   * STATEFUL: Direct Executor (needs full execution history)
   */
  private buildStatefulContext(query: string, executorContext?: ExecutorContext): string {
    const sections: string[] = [];

    // 1. Current task
    sections.push('# Current Task');
    sections.push(query);
    sections.push('');

    // 2. Execution history (if available)
    if (executorContext) {
      sections.push('# Execution History');
      sections.push(`State: ${executorContext.state}`);
      sections.push(`Retries: ${executorContext.retries}`);

      if (executorContext.plan) {
        sections.push('');
        sections.push('## Current Plan');
        sections.push(`Goal: ${executorContext.plan.goal}`);
        sections.push('Steps:');
        executorContext.plan.steps.forEach((step) => {
          sections.push(`  ${step.step}. ${step.description}`);
        });
      }

      if (executorContext.executionLog && executorContext.executionLog.length > 0) {
        sections.push('');
        sections.push('## Execution Log (Chronological)');
        executorContext.executionLog.forEach((log, i) => {
          sections.push(`${i + 1}. ${log}`);
        });
      }

      if (executorContext.lastError) {
        sections.push('');
        sections.push('## Last Error');
        sections.push(executorContext.lastError);
      }

      sections.push('');
    }

    // 3. Workspace state
    const workspaceContext = this.workspaceMemory.getContextString();
    if (workspaceContext) {
      sections.push(workspaceContext);
    }

    // 4. Available tools
    sections.push('# Available Tools');
    sections.push(this.listMotorSkills());

    return sections.join('\n').trim();
  }

  /**
   * STATELESS: Fresh agents (Researcher, File Finder)
   */
  private async buildStatelessContext(query: string): Promise<string> {
    const sections: string[] = [];

    // 1. Task
    sections.push('# Task');
    sections.push(query);
    sections.push('');

    // 2. Available tools
    sections.push('# Available Tools');
    sections.push(this.listMotorSkills());
    sections.push('');

    // 3. Knowledge augmentation (if available)
    if (this.knowledgeService) {
      const knowledgeBlock = await this.augmentWithKnowledge(query);
      if (knowledgeBlock) {
        sections.push(knowledgeBlock);
      }
    }

    return sections.join('\n').trim();
  }

  /**
   * SELECTIVE: Debugger (only error context)
   */
  private buildSelectiveContext(query: string, errorInfo?: ErrorInfo): string {
    const sections: string[] = [];

    // 1. Error to fix
    sections.push('# Error to Fix');
    sections.push(query);
    sections.push('');

    // 2. Error details
    if (errorInfo) {
      sections.push('# Error Details');
      sections.push(`Message: ${errorInfo.message}`);

      if (errorInfo.file) {
        sections.push(`File: ${errorInfo.file}${errorInfo.line ? `:${errorInfo.line}` : ''}`);
      }

      if (errorInfo.stack) {
        sections.push('');
        sections.push('## Stack Trace');
        sections.push(errorInfo.stack);
      }

      if (errorInfo.code) {
        sections.push('');
        sections.push('## Relevant Code');
        sections.push('```');
        sections.push(errorInfo.code);
        sections.push('```');
      }

      sections.push('');
    }

    // 3. Available tools
    sections.push('# Available Tools');
    sections.push(this.listMotorSkills());

    return sections.join('\n').trim();
  }

  /**
   * ORACLE: Planner (high-level summary)
   */
  private async buildOracleContext(query: string, options?: any): Promise<string> {
    const sections: string[] = [];

    // 1. User request
    sections.push('# User Request');
    sections.push(query);
    sections.push('');

    // 2. Exploration findings (if available from EXPLORE state)
    if (options?.executorContext?.explorationFindings) {
      const findings = options.executorContext.explorationFindings;
      sections.push('# Exploration Findings (from EXPLORE phase)');
      sections.push('');

      // PROJECT CONTEXT (CRITICAL - shows actual project structure)
      if (findings.projectContext) {
        const pc = findings.projectContext;
        sections.push('## Project Context (CRITICAL - Read This First):');
        sections.push(`Working Directory: ${pc.cwd}`);
        sections.push(`Project Type: ${pc.projectType}`);
        sections.push('');

        if (pc.markers.length > 0) {
          sections.push('### Configuration Files Present:');
          pc.markers.forEach((m: string) => sections.push(`- ${m}`));
          sections.push('');
        }

        sections.push('### Directory Structure:');
        sections.push(pc.structure);
        sections.push('');

        if (pc.documentation.length > 0) {
          sections.push('### Project Documentation:');
          pc.documentation.forEach((doc: any) => {
            sections.push(`**${doc.path}:** ${doc.summary}`);
          });
          sections.push('');
        }
      }

      if (findings.patterns.length > 0) {
        sections.push('## Patterns & Conventions Found:');
        findings.patterns.forEach((p: string) => sections.push(`- ${p}`));
        sections.push('');
      }

      if (findings.similarFeatures.length > 0) {
        sections.push('## Similar Implementations:');
        findings.similarFeatures.forEach((s: string) => sections.push(`- ${s}`));
        sections.push('');
      }

      if (findings.criticalFiles.length > 0) {
        sections.push('## Entry Points & Critical Files:');
        sections.push('**IMPORTANT**: These are the ACTUAL files that exist in this project:');
        findings.criticalFiles.forEach((f: string) => sections.push(`- ${f}`));
        sections.push('');
        sections.push('**When reading/editing app files, use these exact paths and extensions!**');
        sections.push('');
      }

      if (findings.recommendations.length > 0) {
        sections.push('## Recommendations:');
        findings.recommendations.forEach((r: string) => sections.push(`- ${r}`));
        sections.push('');
      }
    }

    // 3. Project summary (compressed)
    const summary = this.summarizeWorkspace();
    if (summary) {
      sections.push('# Project Summary');
      sections.push(summary);
      sections.push('');
    }

    // 4. Directory context (ONLY if query seems to need it AND no exploration was done)
    if (!options?.executorContext?.explorationFindings && this.needsDirectoryContext(query)) {
      const dirContext = this.getDirectoryContext();
      if (dirContext) {
        sections.push('# Current Directory Contents');
        sections.push(dirContext);
        sections.push('');
      }
    }

    // 5. Available Tools (NOT agents! Centaur uses motor skills directly)
    sections.push('# Available Tools');
    sections.push(this.listMotorSkills());
    sections.push('');

    // 6. Knowledge augmentation (if available)
    if (this.knowledgeService) {
      const knowledgeBlock = await this.augmentWithKnowledge(query);
      if (knowledgeBlock) {
        sections.push(knowledgeBlock);
      }
    }

    return sections.join('\n').trim();
  }

  /**
   * Augment context with knowledge from LocalKnowledgeService
   */
  private async augmentWithKnowledge(query: string): Promise<string | null> {
    if (!this.knowledgeService) return null;

    try {
      // Extract technology and category from query
      const tech = this.extractTechnology(query);
      const category = this.inferCategory(query);

      if (!tech || !category) {
        logger.debug('[ContextBuilder] No tech/category detected for knowledge augmentation');
        return null;
      }

      logger.debug(`[ContextBuilder] Augmenting with knowledge: ${tech} (${category})`);

      // Query knowledge service
      const knowledge = await this.knowledgeService.query({
        query,
        category,
        tech_stack: tech,
      });

      // Only inject high-confidence knowledge
      if (knowledge.confidence < 0.7) {
        logger.debug(`[ContextBuilder] Low confidence (${knowledge.confidence}), skipping`);
        return null;
      }

      // Format knowledge block
      return this.formatKnowledge(tech, category, knowledge);
    } catch (error) {
      logger.warn(`[ContextBuilder] Knowledge augmentation failed: ${error}`);
      return null;
    }
  }

  /**
   * Format knowledge answer into compact context block (~300 tokens)
   */
  private formatKnowledge(
    tech: string,
    _category: string,
    answer: {
      current_method: string;
      deprecated?: string[];
      confidence: number;
      sources: string[];
      cached: boolean;
      provider: 'framebase' | 'web';
      frames?: Array<{ context?: string }>;
      filters?: string[];
    }
  ): string {
    const sections: string[] = [];

    if (answer.frames && answer.frames.length > 0) {
      sections.push(`# Framebase (${tech})`);
      if (answer.filters && answer.filters.length > 0) {
        sections.push(`Filters: ${answer.filters.join(', ')}`);
      }

      answer.frames.slice(0, 2).forEach((frame, index) => {
        if (frame.context) {
          sections.push(`## Frame ${index + 1}`);
          sections.push(this.truncateText(frame.context, 1200));
          sections.push('');
        }
      });

      if (answer.sources && answer.sources.length > 0) {
        sections.push(`Source: ${answer.sources[0]}`);
      }

      if (answer.cached) {
        sections.push('(from cache)');
      }

      return sections.join('\n').trim();
    }

    sections.push(`# Knowledge Base (${tech})`);
    sections.push(`Current: ${answer.current_method}`);

    if (answer.deprecated && answer.deprecated.length > 0) {
      sections.push(`Avoid: ${answer.deprecated.join(', ')}`);
    }

    sections.push(`Confidence: ${(answer.confidence * 100).toFixed(0)}%`);
    sections.push(`Sources: ${answer.sources.slice(0, 2).join(', ')}`);

    if (answer.cached) {
      sections.push('(from cache)');
    }

    return sections.join('\n');
  }

  /**
   * Infer knowledge category from query patterns
   */
  private inferCategory(query: string): KnowledgeQuery['category'] | null {
    const lower = query.toLowerCase();

    if (/^(create|make|build|scaffold|init|setup)/i.test(lower)) {
      return 'best-practice';
    }

    if (/deprecated|outdated|legacy|old/i.test(lower)) {
      return 'deprecated-check';
    }

    if (/compare|vs|versus|better|which/i.test(lower)) {
      return 'tool-comparison';
    }

    if (/current|modern|latest|standard|recommended/i.test(lower)) {
      return 'current-standard';
    }

    return null; // No knowledge needed
  }

  /**
   * Extract technology from query
   */
  private extractTechnology(query: string): string | null {
    const lower = query.toLowerCase();
    const techAliases: Record<string, string[]> = {
      react: ['react'],
      vue: ['vue'],
      angular: ['angular'],
      svelte: ['svelte'],
      solid: ['solid'],
      vite: ['vite'],
      webpack: ['webpack'],
      rollup: ['rollup'],
      esbuild: ['esbuild'],
      node: ['node', 'nodejs', 'node.js'],
      express: ['express'],
      fastify: ['fastify'],
      koa: ['koa'],
      tailwind: ['tailwind'],
      typescript: ['typescript', 'ts'],
      next: ['next', 'nextjs', 'next.js'],
      nuxt: ['nuxt', 'nuxtjs', 'nuxt.js'],
      astro: ['astro'],
      remix: ['remix'],
      python: ['python'],
      pytest: ['pytest'],
      cuda: ['cuda'],
    };

    for (const [tech, aliases] of Object.entries(techAliases)) {
      if (aliases.some((alias) => lower.includes(alias))) {
        return tech;
      }
    }

    return null;
  }

  private truncateText(text: string, maxChars: number): string {
    if (!text) return '';
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
  }

  /**
   * List available motor skills with parameter schemas
   */
  private listMotorSkills(): string {
    const skillsByCategory: Record<string, string[]> = {
      Filesystem: [],
      Search: [],
      Execution: [],
      Web: [],
      Knowledge: [],
      Interaction: [],
    };

    allSkills.forEach((skill) => {
      // Build detailed skill description with parameter schema
      const lines: string[] = [];
      lines.push(`**${skill.id}**: ${skill.description}`);

      // Add parameter schema (CRITICAL: prevents wrong parameter names)
      if (skill.parameters && skill.parameters.properties) {
        const props = skill.parameters.properties as Record<string, any>;
        const required = (skill.parameters.required || []) as string[];

        lines.push('  Parameters:');
        Object.entries(props).forEach(([name, schema]) => {
          const isRequired = required.includes(name);
          const desc = schema.description || schema.type || 'no description';
          lines.push(`    - ${name}${isRequired ? ' (required)' : ''}: ${desc}`);
        });
      } else {
        lines.push('  Parameters: none');
      }

      const fullDescription = lines.join('\n');

      // Categorize
      if (skill.id === 'ask-user-question') {
        skillsByCategory.Interaction.push(fullDescription);
      } else if (skill.id.includes('file') || skill.id.includes('dir') || skill.id.includes('path')) {
        skillsByCategory.Filesystem.push(fullDescription);
      } else if (skill.id.includes('glob') || skill.id.includes('grep')) {
        skillsByCategory.Search.push(fullDescription);
      } else if (skill.id.includes('exec') || skill.id.includes('command')) {
        skillsByCategory.Execution.push(fullDescription);
      } else if (skill.id.includes('web')) {
        skillsByCategory.Web.push(fullDescription);
      } else if (skill.id.includes('knowledge')) {
        skillsByCategory.Knowledge.push(fullDescription);
      }
    });

    const lines: string[] = [];
    Object.entries(skillsByCategory).forEach(([category, skills]) => {
      if (skills.length > 0) {
        lines.push(`## ${category}`);
        skills.forEach((skill) => {
          lines.push(skill);
          lines.push('');
        });
      }
    });

    return lines.join('\n').trim();
  }

  /**
   * Check if query needs directory context
   * Heuristic: queries about files, initialization, or modification likely need it
   */
  private needsDirectoryContext(query: string): boolean {
    const needsContextPatterns = [
      /\b(init|initialize|setup|scaffold|create|add|install|config)\b/i, // Setup tasks
      /\b(find|locate|where|list|show)\b.*\b(file|folder|dir)/i,           // File queries
      /\b(what('s| is) (in|here|available))\b/i,                           // Discovery queries
    ];

    return needsContextPatterns.some((pattern) => pattern.test(query));
  }

  /**
   * Get current directory contents (top-level only, filtered)
   * Returns ~100 tokens max
   */
  private getDirectoryContext(): string | null {
    try {
      const cwd = process.cwd();
      const entries = fs.readdirSync(cwd);

      // Filter out noise (node_modules, .git, dist, etc.)
      const filtered = entries.filter((entry: string) => {
        return !entry.startsWith('.') &&
               !['node_modules', 'dist', 'build', 'coverage', '.git'].includes(entry);
      });

      if (filtered.length === 0) return null;

      // Mark directories with /
      const annotated = filtered.map((entry: string) => {
        const stats = fs.statSync(`${cwd}/${entry}`);
        return stats.isDirectory() ? `${entry}/` : entry;
      });

      return annotated.slice(0, 20).join(', ') + (annotated.length > 20 ? '...' : '');
    } catch (error) {
      logger.warn(`[ContextBuilder] Failed to read directory: ${error}`);
      return null;
    }
  }

  /**
   * Summarize workspace (compress to ~200 tokens)
   */
  private summarizeWorkspace(): string {
    const memory = this.workspaceMemory.get();
    const sections: string[] = [];

    // Current directory (always useful for planning)
    const cwd = memory.currentDirectory || process.cwd();
    const dirName = cwd.split('/').pop() || cwd;
    sections.push(`Working Directory: ${dirName} (${cwd})`);

    // Project info
    if (memory.lastProjectCreated) {
      const project = memory.lastProjectCreated;
      const age = Date.now() - project.timestamp;
      const isRecent = age < 10 * 60 * 1000; // 10 minutes

      if (isRecent) {
        sections.push(
          `Project: ${project.type}${project.framework ? ` (${project.framework})` : ''} at ${project.path}`
        );
      }
    }

    // Package manager
    if (memory.packageManager) {
      sections.push(`Package Manager: ${memory.packageManager}`);
    }

    // Recent files (top 5)
    if (memory.recentFiles.length > 0) {
      sections.push(`Recent Files: ${memory.recentFiles.slice(0, 5).join(', ')}`);
    }

    return sections.join('\n');
  }

  /**
   * DIAGNOSTIC: Planner on retry (failure analysis + corrective planning)
   */
  private buildDiagnosticContext(query: string, executorContext?: ExecutorContext): string {
    if (!executorContext) {
      throw new Error('DIAGNOSTIC context requires executorContext');
    }

    const sections: string[] = [];

    // 1. Original task
    sections.push('# Original Task');
    sections.push(query);
    sections.push('');

    // 2. Failed plan
    if (executorContext.plan) {
      sections.push('# Previous Plan (FAILED)');
      sections.push(`Goal: ${executorContext.plan.goal}`);
      sections.push('');
      sections.push('## Steps That Were Attempted:');
      executorContext.plan.steps.forEach((step) => {
        sections.push(`${step.step}. ${step.description}`);
        sections.push(`   Tool: ${step.tool}`);
        sections.push(`   Expected: ${step.expectedOutcome}`);
      });
      sections.push('');
    }

    // 3. Root cause analysis (if available)
    if (executorContext.verificationResult?.rootCause) {
      const rc = executorContext.verificationResult.rootCause;
      sections.push('# Root Cause Analysis');
      sections.push(`Category: ${rc.category}`);
      sections.push(`Diagnosis: ${rc.diagnosis}`);
      sections.push('');

      if (rc.evidence.length > 0) {
        sections.push('## Evidence:');
        rc.evidence.forEach((ev) => sections.push(`- ${ev}`));
        sections.push('');
      }

      if (rc.suggestedFixes && rc.suggestedFixes.length > 0) {
        sections.push('## Suggested Corrective Actions:');
        rc.suggestedFixes.forEach((fix, i) => {
          sections.push(`### Option ${i + 1}: ${fix.description} (confidence: ${(fix.confidence * 100).toFixed(0)}%)`);
          fix.steps.forEach((step) => {
            sections.push(`  ${step.step}. ${step.description}`);
            sections.push(`     Tool: ${step.tool}, Args: ${JSON.stringify(step.args)}`);
          });
          sections.push('');
        });
      }
    } else {
      // No root cause available (shouldn't happen, but handle gracefully)
      sections.push('# Failure Summary');
      sections.push(executorContext.verificationResult?.overallReason || executorContext.lastError || 'Unknown error');
      sections.push('');
    }

    // 4. Tool execution results (show what actually happened)
    if (executorContext.toolInvocations.length > 0) {
      sections.push('# Tool Execution Log');
      executorContext.toolInvocations.forEach((inv, i) => {
        sections.push(`## Step ${i + 1}: ${inv.tool}`);
        sections.push(`Args: ${JSON.stringify(inv.args)}`);
        sections.push(`Success: ${inv.success ? 'Yes' : 'NO'}`);

        if (inv.error) {
          sections.push(`ERROR: ${inv.error}`);
        } else if (inv.result) {
          // Truncate long results
          const resultStr = typeof inv.result === 'string'
            ? inv.result.slice(0, 300)
            : JSON.stringify(inv.result).slice(0, 300);
          sections.push(`Result: ${resultStr}`);
        }
        sections.push('');
      });

      // ERROR PATTERN ANALYSIS (helps LLM identify common mistakes)
      sections.push('# Error Pattern Analysis');
      const errorPatterns: string[] = [];

      // Detect parameter mismatches (undefined, wrong type)
      executorContext.toolInvocations.forEach((inv, i) => {
        if (inv.error) {
          if (inv.error.includes('undefined') || inv.error.includes('must be of type') || inv.error.includes('Received undefined')) {
            errorPatterns.push(`Warning: Step ${i + 1} (${inv.tool}): PARAMETER MISMATCH`);
            errorPatterns.push(`   You sent: ${JSON.stringify(inv.args)}`);
            errorPatterns.push(`   The tool likely expects different parameter names.`);
            errorPatterns.push(`   Check the tool's parameter schema in "Available Tools" section below.`);
            errorPatterns.push('');
          }

          if (inv.error.includes('not found') || inv.error.includes('does not exist')) {
            errorPatterns.push(`Warning: Step ${i + 1} (${inv.tool}): FILE/PATH NOT FOUND`);
            errorPatterns.push(`   Path: ${JSON.stringify(inv.args)}`);
            errorPatterns.push(`   This file/directory doesn't exist in the project.`);
            errorPatterns.push('');
          }
        }
      });

      // Detect file not found after negative glob (suggests wrong extension/pattern)
      const globs = executorContext.toolInvocations.filter(t => t.tool === 'glob');
      const reads = executorContext.toolInvocations.filter(t =>
        (t.tool === 'read-file' || t.tool === 'edit-file') &&
        t.error && t.error.includes('not found')
      );

      if (globs.length > 0 && reads.length > 0) {
        const emptyGlobs = globs.filter(g =>
          Array.isArray(g.result) && g.result.length === 0
        );

        if (emptyGlobs.length > 0) {
          errorPatterns.push(`Warning: DISCOVERY CONTRADICTION DETECTED`);
          errorPatterns.push(`   Your glob searches returned zero results:`);
          emptyGlobs.forEach(g => {
            errorPatterns.push(`     - Pattern: ${JSON.stringify(g.args)}`);
          });
          errorPatterns.push(`   But then you tried to read files that don't exist.`);
          errorPatterns.push(`   This suggests:`);
          errorPatterns.push(`     1. Wrong file extension (e.g., looking for .tsx in a .jsx project)`);
          errorPatterns.push(`     2. Wrong directory path`);
          errorPatterns.push(`     3. Project structure different from assumption`);
          errorPatterns.push(`   Solution: Use list-dir to see actual files, then adjust your approach.`);
          errorPatterns.push('');
        }
      }

      // Detect exit code failures
      const cmdFailures = executorContext.toolInvocations.filter(t =>
        t.tool === 'exec-command' &&
        t.result &&
        typeof t.result === 'object' &&
        (t.result as any).exitCode !== 0
      );

      if (cmdFailures.length > 0) {
        errorPatterns.push(`Warning: COMMAND FAILURES (exit code != 0)`);
        cmdFailures.forEach((inv) => {
          const execResult = inv.result as any;
          errorPatterns.push(`   Command: ${JSON.stringify(inv.args)}`);
          errorPatterns.push(`   Exit Code: ${execResult.exitCode}`);
          if (execResult.stderr) {
            errorPatterns.push(`   Error Output: ${execResult.stderr.slice(0, 200)}`);
          }
        });
        errorPatterns.push('');
      }

      if (errorPatterns.length > 0) {
        sections.push(...errorPatterns);
      } else {
        sections.push('No obvious error patterns detected.');
        sections.push('');
      }
    }

    // 5. Retry guidance
    sections.push('# Your Task: Generate a NEW Plan');
    sections.push('IMPORTANT GUIDELINES:');
    sections.push('- DO NOT repeat the same steps that failed');
    sections.push('- Address the root cause FIRST before attempting the original goal');
    sections.push('- If suggested fixes are provided with confidence > 0.7, strongly consider using them');
    sections.push('- Insert corrective steps at the BEGINNING of your plan');
    sections.push('- Example: If "shadcn not installed" -> Step 1: init shadcn, Step 2: add component');
    sections.push('');

    // 6. Available tools
    sections.push('# Available Tools');
    sections.push(this.listMotorSkills());

    return sections.join('\n').trim();
  }
}
