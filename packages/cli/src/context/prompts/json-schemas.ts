/**
 * JSON Schemas for Structured Outputs
 *
 * Ollama-compatible JSON schemas for reducing JSON parsing errors.
 * These schemas enforce valid JSON structure at the LLM level.
 */

/**
 * Intent classification schema
 */
export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    type: {
      type: 'string',
      enum: ['DIRECT', 'EMERGENT'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    reason: {
      type: 'string',
    },
  },
  required: ['type', 'confidence', 'reason'],
} as const;

/**
 * Knowledge intent schema
 */
export const KNOWLEDGE_INTENT_SCHEMA = {
  type: 'object',
  properties: {
    needs_knowledge: {
      type: 'boolean',
    },
    category: {
      type: 'string',
      enum: [
        'best-practice',
        'tool-comparison',
        'deprecated-check',
        'current-standard',
        'none',
      ],
    },
    reason: {
      type: 'string',
    },
  },
  required: ['needs_knowledge', 'category', 'reason'],
} as const;

/**
 * Knowledge query rewrite schema
 */
export const KNOWLEDGE_QUERY_REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
    },
    source: {
      type: 'string',
    },
    tech_stack: {
      type: 'string',
    },
    filters: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    reason: {
      type: 'string',
    },
  },
  required: ['query', 'reason'],
} as const;

/**
 * Execution plan step schema
 */
const PLAN_STEP_SCHEMA = {
  type: 'object',
  properties: {
    step: {
      type: 'number',
    },
    description: {
      type: 'string',
    },
    tool: {
      type: 'string',
    },
    args: {
      type: 'object',
    },
    expectedOutcome: {
      type: 'string',
    },
  },
  required: ['step', 'description', 'tool', 'args', 'expectedOutcome'],
} as const;

/**
 * Execution plan schema
 */
export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    goal: {
      type: 'string',
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    uncertainties: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    needsResearch: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    steps: {
      type: 'array',
      items: PLAN_STEP_SCHEMA,
    },
    successCriteria: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    criticalFiles: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['goal', 'confidence', 'steps', 'successCriteria'],
} as const;

/**
 * Executor tool call schema
 */
export const EXECUTOR_SCHEMA = {
  type: 'object',
  properties: {
    tool: {
      type: 'string',
    },
    args: {
      type: 'object',
    },
    error: {
      type: 'string',
    },
  },
} as const;

/**
 * Verification criterion schema
 */
const VERIFICATION_CRITERION_SCHEMA = {
  type: 'object',
  properties: {
    criterion: {
      type: 'string',
    },
    met: {
      type: 'boolean',
    },
    evidence: {
      type: 'string',
    },
  },
  required: ['criterion', 'met', 'evidence'],
} as const;

/**
 * Root cause schema
 */
const ROOT_CAUSE_SCHEMA = {
  type: 'object',
  properties: {
    category: {
      type: 'string',
    },
    diagnosis: {
      type: 'string',
    },
    evidence: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    suggestedFixes: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['category', 'diagnosis', 'evidence'],
} as const;

/**
 * Verification result schema
 */
export const VERIFIER_SCHEMA = {
  type: 'object',
  properties: {
    success: {
      type: 'boolean',
    },
    criteria: {
      type: 'array',
      items: VERIFICATION_CRITERION_SCHEMA,
    },
    overallReason: {
      type: 'string',
    },
    rootCause: ROOT_CAUSE_SCHEMA,
  },
  required: ['success', 'criteria', 'overallReason'],
} as const;

/**
 * Project context schema
 */
const PROJECT_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    cwd: {
      type: 'string',
    },
    projectType: {
      type: 'string',
    },
    markers: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    documentation: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    structure: {
      type: 'string',
    },
  },
  required: ['cwd', 'projectType', 'markers', 'documentation'],
} as const;

/**
 * Exploration findings schema
 */
export const EXPLORER_SCHEMA = {
  type: 'object',
  properties: {
    projectContext: PROJECT_CONTEXT_SCHEMA,
    patterns: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    similarFeatures: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    criticalFiles: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    recommendations: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
  },
  required: ['projectContext', 'patterns', 'similarFeatures', 'criticalFiles', 'recommendations'],
} as const;

/**
 * Answer extraction schema (for web search results)
 */
export const ANSWER_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    current_method: {
      type: 'string',
    },
    deprecated: {
      type: 'array',
      items: {
        type: 'string',
      },
    },
    rationale: {
      type: 'string',
    },
  },
  required: ['current_method', 'rationale'],
} as const;

/**
 * Knowledge query generation schema (Phase 1)
 */
export const KNOWLEDGE_QUERY_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    q: {
      type: 'string',
      description: 'Concise keyword query for Framebase (e.g., "react install", "mui setup")',
    },
    filters: {
      type: 'array',
      items: {
        type: 'string',
      },
      description: 'Framebase filters (e.g., "source = \\"react\\"", "version = \\"latest\\"")',
    },
    limit: {
      type: 'number',
      description: 'Number of frames to retrieve (default 5)',
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of why this query and filters were chosen',
    },
  },
  required: ['q'],
} as const;

/**
 * Knowledge synthesis schema (Phase 2 - after getting frames)
 */
export const KNOWLEDGE_SYNTHESIS_SCHEMA = {
  type: 'object',
  properties: {
    no_relevant_info: {
      type: 'boolean',
      description: 'True if frames contain no relevant information for the task',
    },
    recipe: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One-line summary of what to do (e.g., "Install MUI v7 with emotion styling")',
        },
        steps: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Ordered list of specific actions (e.g., "pnpm add @mui/material@7.3.6")',
        },
        key_points: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Important notes (e.g., "Requires React 18+", "Uses emotion for styling")',
        },
        deprecated: {
          type: 'array',
          items: {
            type: 'string',
          },
          description: 'Old methods to avoid (e.g., "Don\'t use create-react-app (deprecated)")',
        },
      },
      required: ['summary', 'steps'],
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Confidence in the recipe (0-1)',
    },
    reason: {
      type: 'string',
      description: 'Brief explanation of synthesis reasoning',
    },
  },
  required: ['confidence', 'reason'],
} as const;
