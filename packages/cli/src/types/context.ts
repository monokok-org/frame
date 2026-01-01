/**
 * Context Intelligence Types
 *
 * Role-based context strategies for optimal token usage with small models.
 */

/**
 * Context roles that determine what information to include
 */
export type ContextRole = 'STATEFUL' | 'STATELESS' | 'SELECTIVE' | 'ORACLE' | 'DIAGNOSTIC';

/**
 * Configuration for context building
 */
export interface ContextConfig {
  /** Role determines what context to include */
  role: ContextRole;

  /** Maximum tokens for context */
  maxTokens: number;

  /** Include execution history (for retry tracking) */
  includeHistory: boolean;

  /** Include workspace snapshot (files, dirs, state) */
  includeWorkspace: boolean;

  /** Include knowledge augmentation (web search results) */
  includeKnowledge: boolean;
}

/**
 * Error context for selective debugging
 */
export interface ErrorInfo {
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  code?: string;
}

/**
 * Knowledge block for context augmentation
 */
export interface KnowledgeBlock {
  tech: string;
  category: string;
  current_method: string;
  deprecated?: string[];
  confidence: number;
  sources: string[];
  provider?: 'framebase' | 'web';
  frames?: Array<{
    metadata?: {
      source?: string;
      version?: string;
      score?: number;
      rank?: number;
      ttlSeconds?: number;
    };
    context?: string;
  }>;
  filters?: string[];
}

/**
 * Context roles mapped to configurations
 */
export const CONTEXT_CONFIGS: Record<ContextRole, ContextConfig> = {
  // STATEFUL: Direct Executor (needs full execution history)
  STATEFUL: {
    role: 'STATEFUL',
    maxTokens: 4000,
    includeHistory: true,
    includeWorkspace: true,
    includeKnowledge: false,
  },

  // STATELESS: Fresh agents (Researcher, File Finder)
  STATELESS: {
    role: 'STATELESS',
    maxTokens: 2000,
    includeHistory: false,
    includeWorkspace: false,
    includeKnowledge: true,
  },

  // SELECTIVE: Debugger (only error context)
  SELECTIVE: {
    role: 'SELECTIVE',
    maxTokens: 3000,
    includeHistory: false,
    includeWorkspace: false,
    includeKnowledge: false,
  },

  // ORACLE: Planner (high-level summary)
  ORACLE: {
    role: 'ORACLE',
    maxTokens: 2000,
    includeHistory: false,
    includeWorkspace: true, // But compressed!
    includeKnowledge: true,
  },

  // DIAGNOSTIC: Planner on retry (failure analysis + corrective planning)
  DIAGNOSTIC: {
    role: 'DIAGNOSTIC',
    maxTokens: 3500,
    includeHistory: true,      // Show what failed
    includeWorkspace: false,   // Focus on error, not workspace state
    includeKnowledge: false,   // Already failed once, don't dilute context
  },
};

/**
 * Select appropriate context role based on agent type and task complexity
 */
export function selectContextRole(
  agentType: string,
  taskComplexity: 'simple' | 'complex' = 'simple'
): ContextRole {
  // Direct Executor always stateful (needs to track retries)
  if (agentType === 'executor') return 'STATEFUL';

  // Researcher always stateless (fresh perspective)
  if (agentType === 'researcher') return 'STATELESS';

  // Debugger selective (only error data)
  if (agentType === 'debugger') return 'SELECTIVE';

  // Planner oracle (high-level view)
  if (agentType === 'planner') return 'ORACLE';

  // Default: Simple tasks = stateless, Complex = stateful
  return taskComplexity === 'simple' ? 'STATELESS' : 'STATEFUL';
}
