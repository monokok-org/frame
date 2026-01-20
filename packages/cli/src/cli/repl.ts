/**
 * TUI-based REPL
 * 
 */

import {
  Program,
  type Cmd,
  type KeyMsg,
  renderTextInput,
  renderSteps,
  type Step,
  Spinner
} from '@framedev/tui';
import chalk from 'chalk';
import { Executor, type ExecutorResult } from '../executor/index.js';
import { createClient } from '../llm/index.js';
import type { TurnInfo } from '../executor/index.js';
import { getConfig, getProjectRoot, setProjectRoot, loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// ============================================================================
// Model
// ============================================================================

interface Model {
  mode: 'input' | 'running' | 'awaiting';
  input: string;
  cursorPos: number;
  history: HistoryEntry[];
  steps: Step[];
  spinner: Spinner;
  spinnerFrame: number;
  error?: string;
  question?: string;
  modelName: string;
  workingDir: string;
}

interface HistoryEntry {
  type: 'user' | 'assistant' | 'error';
  content: string;
}

// ============================================================================
// Messages
// ============================================================================

type Msg =
  | KeyMsg
  | { type: 'tick' }
  | { type: 'quit' }
  | { type: 'turn'; info: TurnInfo }
  | { type: 'result'; result: ExecutorResult }
  | { type: 'execute'; task: string };

// ============================================================================
// Executor singleton
// ============================================================================

let executor: Executor | null = null;

function getExecutor(onTurn: (info: TurnInfo) => void): Executor {
  if (!executor) {
    const llm = createClient();
    executor = new Executor({
      llm,
      maxTurns: 20,
      onTurn
    });
  }
  return executor;
}

// ============================================================================
// Commands
// ============================================================================

// ============================================================================
// Async Execution State
// ============================================================================

interface RunningTask {
  promise: Promise<ExecutorResult>;
  done: boolean;
  result?: ExecutorResult;
}

let runningTask: RunningTask | null = null;
const updateQueue: TurnInfo[] = [];

// ============================================================================
// Commands
// ============================================================================

function executeTask(task: string): Cmd<Msg> {
  return async () => {
    // Reset state
    runningTask = null;
    updateQueue.length = 0;

    const onTurn = (info: TurnInfo) => {
      updateQueue.push(info);
    };

    const exec = getExecutor(onTurn);

    // Start execution in background (fire and forget from TUI perspective)
    const promise = exec.isAwaiting()
      ? exec.resume(task)
      : exec.execute(task);

    runningTask = {
      promise,
      done: false
    };

    // Handle completion
    promise.then(result => {
      if (runningTask) {
        runningTask.result = result;
        runningTask.done = true;
      }
    });

    // Start ticking immediately
    return { type: 'tick' };
  };
}

function tickCmd(): Cmd<Msg> {
  return async () => {
    // Check if we have pending updates
    if (updateQueue.length > 0) {
      const info = updateQueue.shift()!;
      return { type: 'turn', info };
    }

    // Check if task is done
    if (runningTask?.done && runningTask.result) {
      const result = runningTask.result;
      runningTask = null; // Clear task
      return { type: 'result', result };
    }

    // Otherwise wait and tick again - slowed down to 100ms for stability
    await new Promise(resolve => setTimeout(resolve, 100));
    return { type: 'tick' };
  };
}

// ============================================================================
// Init
// ============================================================================

function init(): [Model, Cmd<Msg> | null] {
  // Initialize config
  setProjectRoot(process.cwd());
  loadConfig();

  // Initialize logger
  logger.init(getProjectRoot());

  const cfg = getConfig();

  const model: Model = {
    mode: 'input',
    input: '',
    cursorPos: 0,
    history: [],
    steps: [],
    spinner: new Spinner('dots'),
    spinnerFrame: 0,
    modelName: cfg.llm.model,
    workingDir: getProjectRoot()
  };

  return [model, null];
}

// ============================================================================
// Update
// ============================================================================

function update(model: Model, msg: Msg): [Model, Cmd<Msg> | null] {
  if (msg.type === 'key') {
    return handleKey(model, msg);
  }

  if (msg.type === 'tick') {
    if (model.mode !== 'running') {
      return [model, null];
    }
    return [
      { ...model, spinnerFrame: model.spinnerFrame + 1 },
      tickCmd()
    ];
  }

  if (msg.type === 'turn') {
    const steps = [...model.steps];
    const info = msg.info;

    // Always update for status changes or tools
    if (info.toolName || info.status || info.thought) {
      // Find existing step for this turn
      const existingIdx = steps.findIndex(s => s.id === `turn-${info.turn}`);

      const label = info.toolName
        ? (info.status || info.toolName)
        : (info.status || info.thought || 'Thinking...');

      // Helper to format detail
      const formatResult = (content: string): string => {
        try {
          const parsed = JSON.parse(content);
          // Prefer "answer" for search/knowledge tools
          if (parsed.answer) return String(parsed.answer).slice(0, 500);
          if (parsed.message) return String(parsed.message).slice(0, 500);
          if (parsed.summary) return String(parsed.summary).slice(0, 500);
          // Fallback to stringified
          return JSON.stringify(parsed).slice(0, 500);
        } catch {
          // Not JSON, return raw string
          return content.slice(0, 500);
        }
      };

      const detail = info.toolResult
        ? formatResult(info.toolResult)
        : (info.status || '');

      const step: Step = {
        id: `turn-${info.turn}`,
        label: label.length > 60 ? label.slice(0, 57) + '...' : label,
        status: info.toolResult ? 'success' : 'running',
        detail,
        tool: info.toolName,
        args: info.toolArgs
      };

      if (existingIdx >= 0) {
        steps[existingIdx] = step;
      } else {
        steps.push(step);
      }
    }

    // Continue ticking to drain queue or wait for result
    return [{ ...model, steps }, tickCmd()];
  }

  if (msg.type === 'result') {
    const result = msg.result;
    const history = [...model.history];

    if (result.status === 'done') {
      history.push({ type: 'assistant', content: result.summary || 'Done' });
      return [
        { ...model, mode: 'input', history, steps: [], error: undefined, question: undefined },
        null
      ];
    }

    if (result.status === 'ask') {
      return [
        { ...model, mode: 'awaiting', question: result.question, steps: [] },
        null
      ];
    }

    if (result.status === 'error' || result.status === 'max_turns') {
      history.push({ type: 'error', content: result.error || 'Unknown error' });
      return [
        { ...model, mode: 'input', history, steps: [], error: result.error },
        null
      ];
    }

    return [model, null];
  }

  if (msg.type === 'execute') {
    const history = [...model.history];
    history.push({ type: 'user', content: msg.task });

    return [
      { ...model, mode: 'running', history, steps: [], input: '', cursorPos: 0 },
      executeTask(msg.task)
    ];
  }

  return [model, null];
}

function handleKey(model: Model, msg: KeyMsg): [Model, Cmd<Msg> | null] {
  // Quit on Ctrl+C
  if (msg.ctrl && msg.key === 'c') {
    return [model, async () => ({ type: 'quit' as const })];
  }

  // Only handle input in input/awaiting mode
  if (model.mode === 'running') {
    return [model, null];
  }

  const key = msg.key;

  // Submit on Enter
  if (key === 'return' || key === 'enter') {
    const task = model.input.trim();
    if (!task) return [model, null];

    return update(model, { type: 'execute', task });
  }

  // Backspace
  if (key === 'backspace') {
    if (model.cursorPos === 0) return [model, null];
    const newInput = model.input.slice(0, model.cursorPos - 1) + model.input.slice(model.cursorPos);
    return [
      { ...model, input: newInput, cursorPos: model.cursorPos - 1 },
      null
    ];
  }

  // Delete
  if (key === 'delete') {
    if (model.cursorPos >= model.input.length) return [model, null];
    const newInput = model.input.slice(0, model.cursorPos) + model.input.slice(model.cursorPos + 1);
    return [{ ...model, input: newInput }, null];
  }

  // Cursor movement
  if (key === 'left') {
    return [{ ...model, cursorPos: Math.max(0, model.cursorPos - 1) }, null];
  }
  if (key === 'right') {
    return [{ ...model, cursorPos: Math.min(model.input.length, model.cursorPos + 1) }, null];
  }
  if (msg.ctrl && key === 'a') {
    return [{ ...model, cursorPos: 0 }, null];
  }
  if (msg.ctrl && key === 'e') {
    return [{ ...model, cursorPos: model.input.length }, null];
  }

  // Regular character input
  if (key.length === 1 && !msg.ctrl && !msg.alt) {
    const newInput = model.input.slice(0, model.cursorPos) + key + model.input.slice(model.cursorPos);
    return [
      { ...model, input: newInput, cursorPos: model.cursorPos + 1 },
      null
    ];
  }

  return [model, null];
}

// ============================================================================
// View
// ============================================================================

function countLines(text: string): number {
  return text.split('\n').length;
}

function view(model: Model): string {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;


  // --- 1. Render Fixed Elements First to calculate remaining space ---

  // Header
  const headerParts = [
    '',
    chalk.cyan.bold('  🤖 Frame v2') + chalk.dim(` - ${model.modelName}`),
    chalk.dim(`  ${model.workingDir}`),
    ''
  ];
  const headerHeight = headerParts.length;

  // Footer (Input + Help)
  let footerParts: string[] = [];

  // Awaiting input
  if (model.mode === 'awaiting' && model.question) {
    footerParts.push(chalk.yellow('  ? ') + model.question);
    footerParts.push('');
  }

  // Input
  if (model.mode === 'input' || model.mode === 'awaiting') {
    const prompt = model.mode === 'awaiting' ? 'Reply' : 'Task';
    footerParts.push(renderTextInput(model.input, model.cursorPos, {
      label: prompt,
      placeholder: model.mode === 'awaiting' ? 'Type your response...' : 'What would you like to do?',
      width: Math.min(width - 4, 80),
      focused: true,
      prefix: '  '
    }));
  }

  footerParts.push('');
  footerParts.push(chalk.dim('  Ctrl+C to quit'));
  footerParts.push(''); // Margin

  const footerHeight = footerParts.reduce((acc, part) => acc + countLines(part), 0);

  // --- 2. Calculate Available Space ---
  // Reserve 1 line for safety against edge-case wrapping
  const maxContentHeight = Math.max(0, height - headerHeight - footerHeight - 1);
  let remainingHeight = maxContentHeight;

  const contentLinesTop: string[] = []; // Will prepend to lines (history)
  const contentLinesBottom: string[] = []; // Will append to lines (running)

  // --- 3. Render Running State (Priority) ---
  if (model.mode === 'running' && remainingHeight > 0) {
    const frame = model.spinner.nextFrame();
    const statusLine = `  ${frame} ${chalk.yellow('Working...')}`;
    contentLinesBottom.push(statusLine);
    contentLinesBottom.push('');
    remainingHeight -= 2;

    if (model.steps.length > 0 && remainingHeight > 0) {
      // Show as many steps as fit
      const stepsStr = renderSteps(model.steps, '    ');
      const stepLines = stepsStr.split('\n');
      // If too many steps, show latest
      const visibleSteps = stepLines.slice(-remainingHeight);
      contentLinesBottom.push(...visibleSteps);
      contentLinesBottom.push('');
      remainingHeight -= (visibleSteps.length + 1);
    }
  }

  // --- 4. Render History (Fill remaining space from bottom up) ---
  if (remainingHeight > 0) {
    const historyLines: string[] = [];
    // Iterate backwards through history
    for (let i = model.history.length - 1; i >= 0; i--) {
      if (remainingHeight <= 0) break;

      const entry = model.history[i];
      let entryParts: string[] = [];

      if (entry.type === 'user') {
        entryParts.push(chalk.blue('  > ') + entry.content);
      } else if (entry.type === 'assistant') {
        // Truncate long assistant output in history to save space
        const contentLines = entry.content.split('\n');
        if (contentLines.length > 5) {
          entryParts.push(chalk.green('  ✓ ') + contentLines.slice(0, 5).join('\n') + chalk.dim(' ... (truncated)'));
        } else {
          entryParts.push(chalk.green('  ✓ ') + entry.content);
        }
      } else {
        entryParts.push(chalk.red('  ✗ ') + entry.content);
      }
      entryParts.push(''); // Spacing

      // Check fit
      const entryHeight = entryParts.reduce((acc, p) => acc + countLines(p), 0);
      if (remainingHeight >= entryHeight) {
        historyLines.unshift(...entryParts);
        remainingHeight -= entryHeight;
      } else {
        // Partial fit or skip?
        break;
      }
    }
    contentLinesTop.push(...historyLines);
  }

  // --- 5. Assemble ---
  return [
    ...headerParts,
    ...contentLinesTop,
    ...contentLinesBottom,
    ...footerParts
  ].join('\n');
}

// ============================================================================
// Run
// ============================================================================

export async function startRepl(): Promise<void> {
  const program = new Program(init, update, view, {
    altScreen: false
  });

  await program.run();
}
