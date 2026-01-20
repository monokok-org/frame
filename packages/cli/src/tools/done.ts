/**
 * Done Tool - Explicit Completion Signal
 * 
 */

import type { Tool } from './types.js';

interface DoneInput {
  summary: string;
}

interface DoneOutput {
  completed: true;
  summary: string;
}

export const doneTool: Tool<DoneInput, DoneOutput> = {
  name: 'done',
  description: `Signal task completion.

Call this when:
- The requested task is complete
- All changes have been made and verified
- You have a clear summary of what was done

Example:
- done({ summary: "Added logout button to Header component and verified build passes" })`,

  parameters: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'Summary of what was accomplished'
      }
    },
    required: ['summary']
  },

  async execute(input: DoneInput): Promise<DoneOutput> {
    return {
      completed: true,
      summary: input.summary
    };
  }
};
