/**
 * LearnedFrames - Knowledge structures that capture learned prerequisites and verification rules
 * Based on Minsky Frame Theory
 *
 * These are different from AgentFrames (legacy/cli/frames/*.ts):
 * - AgentFrames: Define agent behavior (static TypeScript files)
 * - LearnedFrames: Store learned knowledge (dynamic SQLite database)
 */

/**
 * Tool invocation - represents calling a motor skill with arguments
 */
export interface ToolInvocation {
  tool: string;
  args: Record<string, any>;
}

export type FrameCategory = 'package-install' | 'code-modification' | 'project-setup' | 'debugging';

export type VerificationCheckType =
  | 'file-exists'
  | 'dependency-installed' // Platform-agnostic: checks package.json, Cargo.toml, go.mod, etc.
  | 'command-succeeds'
  | 'app-runs';

export interface VerificationCheck {
  type: VerificationCheckType;
  args: Record<string, any>;
  expectation: string;
}

export interface Prerequisite {
  description: string;
  check: ToolInvocation;
  remedy: ToolInvocation[];
  learnedFrom: string; // 'seed' | 'failure:YYYY-MM-DD' | 'council:YYYY-MM-DD'
}

export interface LearnedFrame {
  id: string;
  category: FrameCategory;

  // Pattern matching
  triggers: {
    keywords: string[];
    context: string[]; // ['React', 'Next.js', 'Vite', etc.]
  };

  // Learned constraints (what must be true BEFORE executing)
  prerequisites: Prerequisite[];

  // Verification rules (what must be true AFTER executing)
  verification: {
    mode: 'strict' | 'permissive';
    checks: VerificationCheck[];
  };

  // Learning metadata
  confidence: number; // 0-1, increases with success
  appliedCount: number;
  lastSuccess?: number; // timestamp
  lastFailure?: number; // timestamp
  createdAt: number; // timestamp
}

export interface FrameSearchQuery {
  query: string;
  context?: string[]; // Project context (React, TypeScript, etc.)
  category?: FrameCategory;
  threshold?: number; // Minimum confidence (default 0.5)
}

export interface FrameSearchResult {
  frame: LearnedFrame;
  score: number; // Relevance score 0-1
  matchedKeywords: string[];
}

export interface CheckResult {
  passed: boolean;
  expectation: string;
  actualValue?: any;
  error?: string;
}

export interface VerificationResult {
  success: boolean;
  reason?: string;
  failedChecks?: CheckResult[];
}
