/**
 * Ask Tool - User Clarification
 * 
*/

import type { Tool } from './types.js';

interface AskInput {
  question: string;
  options?: string[];
}

interface AskOutput {
  awaiting: true;
  question: string;
  options?: string[];
}

export const askTool: Tool<AskInput, AskOutput> = {
  name: 'ask',
  description: `Ask the user for clarification.

Use when:
- The task is ambiguous and you need direction
- A destructive operation needs confirmation
- You are blocked and need guidance

Avoid using when:
- You can make a reasonable assumption
- The answer is searchable via knowledge tool

Example:
- ask({ question: "Should I also update the tests?", options: ["Yes", "No", "Skip for now"] })`,

  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Question to ask the user'
      },
      options: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional choices to present'
      }
    },
    required: ['question']
  },

  async execute(input: AskInput): Promise<AskOutput> {
    return {
      awaiting: true,
      question: input.question,
      options: input.options
    };
  }
};
