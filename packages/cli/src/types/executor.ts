/**
 * Direct Executor Types
 *
 * State machine types for the Direct Executor (PLAN → EXECUTE → VERIFY → DONE).
 */

/**
 * Executor states
 * EXPLORE → FRAME_SELECT → PLAN → EXECUTE → VERIFY → LEARN → DONE
 */
export type ExecutorState = 'EXPLORE' | 'FRAME_SELECT' | 'PLAN' | 'EXECUTE' | 'VERIFY' | 'LEARN' | 'DONE' | 'DISTRESS';

/**
 * Tool invocation result
 */
export interface ToolResult {
  tool: string;
  args: Record<string, any>;
  result: any;
  error?: string;
  success: boolean;
}

/**
 * Plan step
 */
export interface PlanStep {
  step: number;
  description: string;
  tool: string;
  args: Record<string, any>;
  expectedOutcome: string;
}

/**
 * Project context discovered during exploration
 */
export interface ProjectContext {
  /** Current working directory */
  cwd: string;

  /** Project type (react, vue, node, python, monorepo, etc.) */
  projectType: string;

  /** Key markers that identified the project type */
  markers: string[];

  /** Important project documentation found (.md files) */
  documentation: Array<{
    path: string;
    summary: string;
  }>;

  /** Project structure overview */
  structure: string;

  /** Project environment (commands, CLIs, CI) */
  environment?: {
    testCommand?: string;
    buildCommand?: string;
    lintCommand?: string;
    devCommand?: string;
    formatCommand?: string;
    availableCLIs: string[];
    ciPresent: boolean;
  };
}

/**
 * Exploration findings (from EXPLORE state)
 */
export interface ExplorationFindings {
  /** Project context (type, structure, docs) */
  projectContext: ProjectContext;

  /** Existing patterns/conventions found */
  patterns: string[];

  /** Similar implementations to reference */
  similarFeatures: string[];

  /** 3-5 files most relevant to the task */
  criticalFiles: string[];

  /** Architectural recommendations */
  recommendations: string[];
}

/**
 * Execution plan from planner
 */
export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  successCriteria: string[];
  criticalFiles?: string[]; // Optional: Critical files identified by planner

  /** Plan confidence score (0.0-1.0) */
  confidence: number;

  /** Things the planner is uncertain about */
  uncertainties?: string[];

  /** Topics that need research before planning */
  needsResearch?: string[];
}

/**
 * Executor context (state + history)
 */
export interface ExecutorContext {
  /** Original user query */
  query: string;

  /** Current state */
  state: ExecutorState;

  /** Retry counter */
  retries: number;

  /** Max retries before distress */
  maxRetries: number;

  /** Exploration findings (from EXPLORE state) */
  explorationFindings?: ExplorationFindings;

  /** Selected LearnedFrame (from FRAME_SELECT state) */
  selectedFrame?: any; // LearnedFrame type (avoiding circular dependency)

  /** Prerequisite steps to inject before main plan (from FRAME_SELECT state) */
  prerequisiteSteps?: PlanStep[];

  /** Current execution plan */
  plan?: ExecutionPlan;

  /** Execution log (chronological) */
  executionLog: string[];

  /** Tool invocation history */
  toolInvocations: ToolResult[];

  /** Last error (if any) */
  lastError?: string;

  /** Verification results */
  verificationResult?: VerificationResult;

  /** Final result (on success) */
  result?: string;

  /** Timestamp when execution started */
  startedAt: number;
}

/**
 * Root cause categories for failure diagnosis
 */
export type RootCauseCategory =
  | 'missing-dependency'      // Package/tool not installed or initialized
  | 'missing-file'            // Required file doesn't exist
  | 'missing-directory'       // Required directory doesn't exist
  | 'syntax-error'            // Command/code syntax wrong
  | 'permission-denied'       // Access/permission issue
  | 'network-error'           // Network/download failure
  | 'configuration-error'     // Config file invalid or missing
  | 'environment-error'       // Environment variable or system issue
  | 'unknown';                // Fallback when diagnosis unclear

/**
 * Root cause analysis from verifier
 */
export interface RootCause {
  /** Category of the error */
  category: RootCauseCategory;

  /** Human-readable diagnosis of what went wrong */
  diagnosis: string;

  /** Evidence supporting the diagnosis (tool results, error messages) */
  evidence: string[];

  /** Suggested corrective steps to fix the issue */
  suggestedFixes?: Array<{
    description: string;
    steps: PlanStep[];
    confidence: number; // 0.0 to 1.0
  }>;
}

/**
 * Verification result
 */
export interface VerificationResult {
  success: boolean;
  criteria: {
    criterion: string;
    satisfied: boolean;
    reason: string;
  }[];
  overallReason: string;

  /** Root cause analysis (only present when success = false) */
  rootCause?: RootCause;
}

/**
 * Executor result (returned to caller)
 */
export interface ExecutorResult {
  status: 'DONE' | 'DISTRESS' | 'ASK';
  result?: string;
  question?: string;
  pause?: boolean;
  context?: ExecutorContext;
  error?: string;
}

/**
 * Executor activity event (for UI status updates)
 */
export type ExecutorEvent =
  | { type: 'start'; message: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'resume'; message: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'thinking'; message: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'tool_start'; message: string; tool: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'tool_result'; message: string; tool: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'awaiting_input'; message: string; detail?: string; pause?: boolean; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'done'; message: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'distress'; message: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' }
  | { type: 'info'; message: string; detail?: string; level?: 'info' | 'warn' | 'error' | 'success' | 'system' };

/**
 * Distress context (for handing off to Biosphere)
 */
export interface DistressContext {
  query: string;
  attempts: number;
  errors: string[];
  executorState: ExecutorContext;
  lastPlan?: ExecutionPlan;
}

/**
 * Resolution from Biosphere (after distress)
 */
export interface DistressResolution {
  solution: string;
  retryPlan?: ExecutionPlan;
  suggestions: string[];
}
