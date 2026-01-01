/**
 * Planning Skill
 *
 * Allows the model to create or update execution plans.
 * Model decides WHEN to plan, not hardcoded.
 */

import type { MotorSkill } from '@homunculus-live/core';

interface PlanInput {
  goal: string; // What we're trying to accomplish
  steps: string[] | any; // Ordered steps (3-5 high-level actions) - allow any for flexibility
}

/**
 * Plan Task Skill
 *
 * Model calls this to create or update its execution plan.
 * Use when:
 * - Starting a new complex task
 * - Current approach isn't working (need to replan)
 * - Task requirements changed
 */
export const planTaskSkill: MotorSkill<PlanInput, string> = {
  id: 'plan-task',
  name: 'Plan Task',
  description: `Create or update execution plan. Use this when:
- Starting a complex task that needs multiple steps
- Current approach failed and you need to replan
- User changed requirements mid-task

Input:
- goal: One sentence describing what we're accomplishing
- steps: Array of 3-5 HIGH-LEVEL steps (e.g., ["Explore project", "Create component", "Add tests"])

This creates a plan that will be shown to you in every subsequent turn to keep you on track.`,

  parameters: {
    type: 'object' as const,
    properties: {
      goal: {
        type: 'string',
        description: 'One sentence describing the goal',
      },
      steps: {
        type: 'string',
        description: 'Array of 3-5 high-level steps (JSON array string)',
      },
    },
    required: ['goal', 'steps'],
  },

  async execute(input: PlanInput): Promise<string> {
    // Parse steps - model may send as JSON string or array
    let steps: string[] = [];

    if (Array.isArray(input.steps)) {
      steps = input.steps;
    } else if (typeof input.steps === 'string') {
      try {
        // Try parsing as JSON array
        const parsed = JSON.parse(input.steps);
        if (Array.isArray(parsed)) {
          steps = parsed;
        }
      } catch {
        // If parsing fails, split by comma or newline
        steps = input.steps.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      }
    }

    // Validate steps
    if (steps.length < 2 || steps.length > 5) {
      return `Error: Plan must have 2-5 steps. You provided ${steps.length} steps.`;
    }

    // The plan is stored in the context by the DirectExecutor
    // This skill just validates and returns the plan for confirmation
    return JSON.stringify(
      {
        goal: input.goal,
        steps: steps,
        status: 'Plan created/updated',
      },
      null,
      2
    );
  },
};

export const planningSkills = [planTaskSkill];
