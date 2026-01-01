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
