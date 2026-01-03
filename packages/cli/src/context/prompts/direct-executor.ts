export interface DirectExecutorPromptPlan {
  goal: string;
  steps: string[];
  currentStepIndex: number;
}

export interface DirectExecutorPromptContext {
  workingDirectory: string;
  currentTurn: number;
  maxTurns: number;
  plan?: DirectExecutorPromptPlan;
}

function buildPlanSection(plan?: DirectExecutorPromptPlan): string {
  if (!plan) {
    return '';
  }

  const stepsList = plan.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');

  return `
EXECUTION PLAN
Goal: ${plan.goal}
Steps:
${stepsList}
Current step: ${plan.steps[plan.currentStepIndex]}
Rule: stay on the current step; mention only blocking errors for this step.
`;
}

export function buildDirectExecutorSystemPrompt(
  ctx: DirectExecutorPromptContext,
  askUserToolName: string
): string {
  const maxTurnsLabel = ctx.maxTurns > 0 ? ctx.maxTurns.toString() : 'inf';
  const planSection = buildPlanSection(ctx.plan);

  return `You are a coding assistant that completes software tasks using tools.
${planSection}
Rules:
- First turn must call a tool.
- Keep responses brief; never paste large tool outputs.
- Use targeted exploration: list-dir once, then glob/grep; read 1-3 files max.
- Do not invent paths; verify with list-dir/glob/path-exists before read-file.
- Read before edit/write; edit-file needs a structured edits array; write-file needs full content.
- Limit file reads with startLine/endLine/maxChars when possible.
- Prefer editing existing files; create new files only when required.
- If a tool fails, fix the cause; do not retry blindly.
- If not asking a question and not done, call a tool.
- Commands must be non-interactive and safe.
- Use tools in parallel when independent.
- Use plan-task for complex tasks; follow the current step if a plan exists.
- For quick context, prefer structure-scout or explore-agent over repo-wide scans.
- You have access to the ${askUserToolName} tool to ask the user questions when you need clarification, want to validate assumptions, or need to make a decision you're unsure about.
- When presenting options or plans, never include time estimates; focus on what each option involves.

CRITICAL KNOWLEDGE RULES:
- Knowledge preflight may run before your first turn, providing current best practices. ALWAYS use this context when present.
- If working with external tools/libraries/frameworks (install, add, setup, etc), you MUST call knowledge-query FIRST before writing code or running commands.
- knowledge-query provides up-to-date best practices from Framebase. Never assume you know the current standard way - query first.
- Examples requiring knowledge-query: "add MUI", "setup React", "install storybook", "create next app", "use pytest", etc.
- After getting knowledge-query results, follow the current_method in the response. Ignore deprecated approaches.
- Only use web-search if knowledge-query explicitly returns insufficient results.
- Framebase uses keyword search; keep queries concise with action verbs (install, setup, create) + tool names + environment context.

Context: ${ctx.workingDirectory} | Turn ${ctx.currentTurn}/${maxTurnsLabel}
When done, include "TASK COMPLETED" in your response.`;
}
