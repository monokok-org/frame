/**
 * TUI-based REPL for Frame
 * Uses @framedev/tui for interactive terminal UI
 */

import {
  Program,
  type Init,
  type Update,
  type View,
  type Cmd,
  type BatchCmd,
  type KeyMsg,
  type ResizeMsg,
  batch,
  tick,
  quit
} from '@framedev/tui';
import chalk from 'chalk';
import { SettingsManager } from '../utils/settings.js';
import type { DirectExecutor } from '../core/direct-executor.js';
import type { ExecutorEvent, ExecutorResult } from '../types/executor.js';
import { logger, setConsoleLoggingEnabled } from '../utils/logger.js';
import { getDebugLogger } from '../utils/debug-logger.js';

interface LogEntry {
  message: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'system';
  timestamp: number;
}

type ActivityLevel = 'info' | 'warn' | 'error' | 'success' | 'system';

interface OllamaModelInfo {
  model?: string;
  contextLength?: number;
  parameterSize?: string;
  quantizationLevel?: string;
  family?: string;
  format?: string;
}

interface OllamaShowResponse {
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
    format?: string;
  };
  model_info?: Record<string, unknown>;
  parameters?: string;
}

type ModelInfoStatus = 'idle' | 'loading' | 'ready' | 'error';
type OllamaStatus = 'idle' | 'checking' | 'ready' | 'missing_config' | 'server_error' | 'model_missing';

interface Model {
  mode: 'normal' | 'settings' | 'help' | 'onboarding';
  input: string;
  cursorPos: number;
  isRunning: boolean;
  awaitingInput: boolean;
  isPaused: boolean;
  pendingQuestion?: string;
  queuedInputs: string[];
  history: string[];
  historyIndex: number;
  historyDraft: string;
  spinnerIndex: number;
  activity: string;
  activityDetail: string;
  activityLevel: ActivityLevel;
  settings: SettingsManager;
  settingsPath: string;
  isFirstRun: boolean;
  ollamaInfoStatus: ModelInfoStatus;
  ollamaInfo?: OllamaModelInfo;
  ollamaInfoError?: string;
  ollamaStatus: OllamaStatus;
  ollamaStatusError?: string;
  workingDir: string;
  logs: LogEntry[];
  debugLogPath: string;
  width: number;
  height: number;
}

type Msg =
  | KeyMsg
  | ResizeMsg
  | { type: 'tick' }
  | { type: 'activity'; event: ExecutorEvent }
  | { type: 'log'; entry: LogEntry }
  | { type: 'task_result'; result: ExecutorResult }
  | { type: 'task_error'; error: string }
  | { type: 'model_info'; info?: OllamaModelInfo; error?: string }
  | { type: 'ollama_status'; status: OllamaStatus; error?: string }
  | { type: 'quit' };

export interface CentaurComponents {
  directExecutor: DirectExecutor;
}

const SPINNER_FRAMES = ['|', '/', '-', '\\'];
const MAX_LOG_ENTRIES = 200;
const MAX_ACTIVITY_DETAIL = 500;
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;
const OLLAMA_SUGGESTED_MODELS = ['devstral-small-2:24b', 'qwen2.5-coder:14b'];
const OLLAMA_TOOLCALL_NOTE =
  'Use official Ollama models with tool calling; custom GGUF/GGML may not work.';

type CmdResult<Msg> = Cmd<Msg> | BatchCmd<Msg> | null;

export class TUIRepl {
  private directExecutor: DirectExecutor;
  private program: Program<Model, Msg> | null = null;

  constructor(components: CentaurComponents) {
    this.directExecutor = components.directExecutor;
  }

  async start(): Promise<void> {
    setConsoleLoggingEnabled(false);

    const init: Init<Model, Msg> = () => {
      const settings = new SettingsManager();
      const isFirstRun = settings.isFirstRun();
      const settingsPath = settings.getPath();
      const debugLogger = getDebugLogger();
      const width = process.stdout.columns || 80;
      const height = process.stdout.rows || 24;

      return [
        {
          mode: isFirstRun ? 'onboarding' : 'normal',
          input: '',
          cursorPos: 0,
          isRunning: false,
          awaitingInput: false,
          isPaused: false,
          pendingQuestion: undefined,
          queuedInputs: [],
          history: [],
          historyIndex: 0,
          historyDraft: '',
          spinnerIndex: 0,
          activity: 'Idle',
          activityDetail: 'Ready',
          activityLevel: 'system',
          settings,
          settingsPath,
          isFirstRun,
          ollamaInfoStatus: 'idle',
          ollamaInfo: undefined,
          ollamaInfoError: undefined,
          ollamaStatus: 'checking',
          ollamaStatusError: undefined,
          workingDir: process.cwd(),
          logs: [
            {
              message: 'Welcome to Frame',
              level: 'system',
              timestamp: Date.now()
            },
            {
              message: 'Type a request or /help for commands',
              level: 'system',
              timestamp: Date.now()
            }
          ],
          debugLogPath: debugLogger.getLogPath(),
          width,
          height
        },
        this.createOllamaStatusCommand(settings)
      ];
    };

    const update: Update<Model, Msg> = (model, msg) => {
      switch (msg.type) {
        case 'key':
          return this.handleKeyPress(model, msg);

        case 'resize':
          return [
            {
              ...model,
              width: msg.width,
              height: msg.height
            },
            null
          ];

        case 'tick':
          return this.handleTick(model);

        case 'activity':
          return [this.handleActivity(model, msg.event), null];

        case 'log':
          return [this.appendLog(model, msg.entry), null];

        case 'task_result':
          return this.handleTaskResult(model, msg.result);

        case 'task_error':
          return this.handleTaskError(model, msg.error);

        case 'model_info':
          return [
            {
              ...model,
              ollamaInfoStatus: msg.error ? 'error' : 'ready',
              ollamaInfo: msg.error ? undefined : msg.info,
              ollamaInfoError: msg.error
            },
            null
          ];
        case 'ollama_status':
          return [
            {
              ...model,
              ollamaStatus: msg.status,
              ollamaStatusError: msg.error
            },
            null
          ];

        case 'quit':
          return [model, quit()];

        default:
          return [model, null];
      }
    };

    const view: View<Model> = (model) => {
      return this.renderView(model);
    };

    const program = new Program(init, update, view, { altScreen: true });
    this.program = program;
    this.directExecutor.setEventHandler((event) => {
      this.program?.send({ type: 'activity', event });
    });
    await program.run();
  }

  private handleKeyPress(model: Model, msg: KeyMsg): [Model, CmdResult<Msg>] {
    // Quit with Ctrl+C or Ctrl+D
    if ((msg.key === 'c' || msg.key === 'd') && msg.ctrl) {
      return [model, quit()];
    }

    // Handle different modes
    if (model.mode === 'settings') {
      return this.handleSettingsMode(model, msg);
    }

    if (model.mode === 'help') {
      if (msg.key === 'escape' || msg.key === 'q') {
        return [{ ...model, mode: 'normal' }, null];
      }
      return [model, null];
    }

    if (model.mode === 'onboarding') {
      return this.handleOnboardingMode(model, msg);
    }

    // Normal mode
    return this.handleNormalMode(model, msg);
  }

  private handleNormalMode(model: Model, msg: KeyMsg): [Model, CmdResult<Msg>] {
    const { key } = msg;

    if (key === 'escape') {
      if (model.isRunning) {
        const accepted = this.directExecutor.requestPause();
        if (!accepted) {
          return [model, null];
        }

        const nextModel = this.appendLog(model, {
          level: 'system',
          message: 'Pause requested. Finishing current step...',
          timestamp: Date.now()
        });

        return [
          this.setActivity(nextModel, 'Pausing', 'Finishing current step...', 'warn'),
          null
        ];
      }

      if (model.awaitingInput && model.isPaused) {
        const cleared = {
          ...model,
          input: '',
          cursorPos: 0,
          awaitingInput: false,
          isPaused: false,
          pendingQuestion: undefined
        };

        const nextModel = this.appendLog(cleared, {
          level: 'system',
          message: 'Resuming...',
          timestamp: Date.now()
        });
        return this.continuePausedTask(
          this.setActivity(nextModel, 'Resuming', 'Continuing task...', 'info')
        );
      }

      return [model, null];
    }

    if (key === 'enter') {
      return this.handleSubmit(model);
    }

    if (key === 'backspace') {
      return [this.deleteBackward(model), null];
    }

    if (key === 'delete') {
      return [this.deleteForward(model), null];
    }

    if (key === 'left') {
      return [this.moveCursor(model, -1), null];
    }

    if (key === 'right') {
      return [this.moveCursor(model, 1), null];
    }

    if (key === 'home' || (msg.ctrl && key === 'a')) {
      return [this.setCursor(model, 0), null];
    }

    if (key === 'end' || (msg.ctrl && key === 'e')) {
      return [this.setCursor(model, model.input.length), null];
    }

    if (key === 'ctrl+left') {
      return [this.moveWordLeft(model), null];
    }

    if (key === 'ctrl+right') {
      return [this.moveWordRight(model), null];
    }

    if (msg.ctrl && key === 'w') {
      return [this.deleteWordBackward(model), null];
    }

    if (msg.alt && key === 'backspace') {
      return [this.deleteWordBackward(model), null];
    }

    if (msg.ctrl && key === 'u') {
      return [this.deleteToStart(model), null];
    }

    if (msg.ctrl && key === 'k') {
      return [this.deleteToEnd(model), null];
    }

    if (key === 'up') {
      return [this.navigateHistory(model, 'up'), null];
    }

    if (key === 'down') {
      return [this.navigateHistory(model, 'down'), null];
    }

    if (!msg.ctrl && !msg.alt && !msg.meta) {
      if (key === 'tab') {
        return [this.insertText(model, '  '), null];
      }
      return [this.insertText(model, key), null];
    }

    return [model, null];
  }

  private handleSubmit(model: Model): [Model, CmdResult<Msg>] {
    const trimmed = model.input.trim();
    if (!trimmed) return [model, null];

    if (trimmed.startsWith('/')) {
      return this.handleCommand(model, trimmed);
    }

    const updatedHistory = this.pushHistory(model, trimmed);

    if (model.awaitingInput || this.directExecutor.hasPending()) {
      const withLog = this.appendLog(updatedHistory, {
        level: 'info',
        message: `↳ ${trimmed}`,
        timestamp: Date.now()
      });

      const cleared = {
        ...withLog,
        input: '',
        cursorPos: 0,
        awaitingInput: false,
        isPaused: false,
        pendingQuestion: undefined
      };

      return this.startTask(cleared, trimmed, true);
    }

    if (model.isRunning) {
      const queued = [...updatedHistory.queuedInputs, trimmed];
      let nextModel = {
        ...updatedHistory,
        input: '',
        cursorPos: 0,
        queuedInputs: queued
      };

      nextModel = this.appendLog(nextModel, {
        level: 'system',
        message: `Queued: ${trimmed}`,
        timestamp: Date.now()
      });

      return [nextModel, null];
    }

    let nextModel = this.appendLog(updatedHistory, {
      level: 'info',
      message: `→ ${trimmed}`,
      timestamp: Date.now()
    });

    nextModel = {
      ...nextModel,
      input: '',
      cursorPos: 0,
      awaitingInput: false,
      isPaused: false,
      pendingQuestion: undefined
    };

    return this.startTask(nextModel, trimmed, false);
  }

  private handleCommand(model: Model, command: string): [Model, CmdResult<Msg>] {
    const cmd = command.toLowerCase();

    switch (cmd) {
      case '/help':
        return [{ ...model, mode: 'help', input: '' }, null];

      case '/settings':
        return this.enterSettings({ ...model, input: '' });

      case '/clear':
        return [{ ...model, logs: [], input: '' }, null];

      case '/debug':
        return [
          this.appendLog({ ...model, input: '' }, {
            level: 'system',
            message: `Debug log: ${model.debugLogPath}`,
            timestamp: Date.now()
          }),
          null
        ];

      case '/cancel':
        if (model.isRunning) {
          return [
            this.appendLog({ ...model, input: '' }, {
              level: 'warn',
              message: 'Cannot cancel an active run yet.',
              timestamp: Date.now()
            }),
            null
          ];
        }

        if (model.awaitingInput || this.directExecutor.hasPending()) {
          const canceled = this.directExecutor.cancelPending?.() ?? false;
          const nextModel = {
            ...model,
            input: '',
            cursorPos: 0,
            awaitingInput: false,
            isPaused: false,
            pendingQuestion: undefined
          };

          const logged = this.appendLog(nextModel, {
              level: canceled ? 'system' : 'warn',
              message: canceled ? 'Canceled pending request.' : 'Nothing to cancel.',
              timestamp: Date.now()
            });

          const activity = this.setActivity(
            logged,
            'Idle',
            'Ready',
            'system'
          );

          return [activity, null];
        }

        return [
          this.appendLog({ ...model, input: '' }, {
            level: 'warn',
            message: 'Nothing to cancel.',
            timestamp: Date.now()
          }),
          null
        ];

      case '/exit':
      case '/quit':
        return [model, quit()];

      default:
        return [
          this.appendLog({ ...model, input: '' }, {
            level: 'warn',
            message: `Unknown command: ${command}`,
            timestamp: Date.now()
          }),
          null
        ];
    }
  }

  private startTask(model: Model, query: string, isResume: boolean): [Model, CmdResult<Msg>] {
    const nextModel = this.setActivity(
      {
        ...model,
        isRunning: true,
        awaitingInput: false,
        isPaused: false,
        pendingQuestion: undefined,
        spinnerIndex: 0
      },
      isResume ? 'Resuming task' : 'Starting task',
      query,
      'info'
    );

    const cmd = batch(
      this.createExecutorCommand(query, isResume, false),
      tick(120, { type: 'tick' })
    );

    return [nextModel, cmd];
  }

  private continuePausedTask(model: Model): [Model, CmdResult<Msg>] {
    const nextModel = {
      ...model,
      isRunning: true,
      spinnerIndex: 0
    };

    const cmd = batch(
      this.createExecutorCommand('', true, true),
      tick(120, { type: 'tick' })
    );

    return [nextModel, cmd];
  }

  private createExecutorCommand(query: string, isResume: boolean, silentResume: boolean): Cmd<Msg> {
    return async () => {
      try {
        const result = isResume
          ? await this.directExecutor.resume(silentResume ? '' : query)
          : await this.directExecutor.execute(query);
        return { type: 'task_result', result };
      } catch (error) {
        logger.error(`Executor error: ${error}`);
        return { type: 'task_error', error: String(error) };
      }
    };
  }

  private handleTaskResult(model: Model, result: ExecutorResult): [Model, CmdResult<Msg>] {
    if (result.status === 'DONE') {
      let nextModel = this.appendLog(
        {
          ...model,
          isRunning: false,
          awaitingInput: false,
          isPaused: false,
          pendingQuestion: undefined,
          spinnerIndex: 0
        },
        {
          level: 'success',
          message: result.result || 'Task complete',
          timestamp: Date.now()
        }
      );
      nextModel = this.setActivity(
        nextModel,
        'Completed',
        result.result || 'Task complete',
        'success'
      );

      if (nextModel.queuedInputs.length > 0) {
        const [nextQuery, ...rest] = nextModel.queuedInputs;
        nextModel = this.appendLog(
          {
            ...nextModel,
            queuedInputs: rest
          },
          {
            level: 'info',
            message: `→ ${nextQuery}`,
            timestamp: Date.now()
          }
        );

        return this.startTask(nextModel, nextQuery, false);
      }

      return [nextModel, null];
    }

    if (result.status === 'ASK') {
      const prompt = result.question || result.result || 'Need more details to continue.';
      const isPaused = result.pause === true;
      let nextModel = this.appendLog(
        {
          ...model,
          isRunning: false,
          awaitingInput: true,
          isPaused,
          pendingQuestion: prompt,
          spinnerIndex: 0
        },
        {
          level: isPaused ? 'system' : 'warn',
          message: isPaused ? 'Paused.' : prompt,
          timestamp: Date.now()
        }
      );
      nextModel = this.setActivity(
        nextModel,
        isPaused ? 'Paused' : 'Awaiting input',
        prompt,
        isPaused ? 'warn' : 'info'
      );

      if (isPaused) {
        nextModel = this.appendLog(nextModel, {
          level: 'system',
          message: prompt,
          timestamp: Date.now()
        });
      }

      if (!nextModel.input && nextModel.queuedInputs.length > 0) {
        const [queued, ...rest] = nextModel.queuedInputs;
        nextModel = {
          ...nextModel,
          queuedInputs: rest,
          input: queued,
          cursorPos: queued.length
        };
      }

      return [nextModel, null];
    }

    const errorMessage = result.error || 'Task failed. Provide more details or try again.';
    let nextModel = this.appendLog(
      {
        ...model,
        isRunning: false,
        awaitingInput: false,
        isPaused: false,
        pendingQuestion: undefined,
        spinnerIndex: 0
      },
      {
        level: 'error',
        message: errorMessage,
        timestamp: Date.now()
      }
    );
    nextModel = this.setActivity(nextModel, 'Failed', errorMessage, 'error');

    return [nextModel, null];
  }

  private handleTaskError(model: Model, error: string): [Model, CmdResult<Msg>] {
    let nextModel = this.appendLog(
      {
        ...model,
        isRunning: false,
        awaitingInput: false,
        isPaused: false,
        pendingQuestion: undefined,
        spinnerIndex: 0
      },
      {
        level: 'error',
        message: error || 'Task failed',
        timestamp: Date.now()
      }
    );
    nextModel = this.setActivity(nextModel, 'Failed', error || 'Task failed', 'error');

    return [nextModel, null];
  }

  private handleTick(model: Model): [Model, CmdResult<Msg>] {
    if (!model.isRunning) {
      return [model, null];
    }

    const nextIndex = (model.spinnerIndex + 1) % SPINNER_FRAMES.length;
    return [
      {
        ...model,
        spinnerIndex: nextIndex
      },
      tick(120, { type: 'tick' })
    ];
  }

  private applyActivity(model: Model, event: ExecutorEvent): Model {
    const detail = event.detail ? this.compactPreview(event.detail) : '';
    const level = event.level ?? this.mapActivityLevel(event.type);

    return {
      ...model,
      activity: event.message || 'Working',
      activityDetail: detail,
      activityLevel: level
    };
  }

  private handleActivity(model: Model, event: ExecutorEvent): Model {
    const next = this.applyActivity(model, event);
    if (!this.shouldLogActivity(event)) {
      return next;
    }

    const message = this.formatActivityLog(event);
    if (!message) {
      return next;
    }

    return this.appendLog(next, {
      level: this.mapLogLevel(event),
      message,
      timestamp: Date.now()
    });
  }

  private shouldLogActivity(event: ExecutorEvent): boolean {
    switch (event.type) {
      case 'tool_start':
      case 'tool_result':
      case 'start':
      case 'resume':
      case 'awaiting_input':
      case 'done':
      case 'distress':
        return true;
      case 'thinking':
      default:
        return false;
    }
  }

  private formatActivityLog(event: ExecutorEvent): string {
    const detail = event.detail ? this.compactPreview(event.detail) : '';
    switch (event.type) {
      case 'tool_start':
        return detail ? `${event.message}: ${detail}` : event.message;
      case 'tool_result':
        if (event.level === 'error') {
          return detail ? `Tool error (${event.tool}): ${detail}` : `Tool error (${event.tool})`;
        }
        return detail ? `${event.message}: ${detail}` : event.message;
      case 'start':
        return detail ? `Starting: ${detail}` : event.message;
      case 'resume':
        return detail ? `Resuming: ${detail}` : event.message;
      case 'awaiting_input':
        return detail ? `Awaiting input: ${detail}` : event.message;
      case 'done':
        return detail ? `Done: ${detail}` : event.message;
      case 'distress':
        return detail ? `Failed: ${detail}` : event.message;
      case 'thinking':
        return event.message;
      case 'info':
        return detail ? `${event.message}: ${detail}` : event.message;
      default:
        return detail ? `${detail}` : 'Working';
    }
  }

  private mapLogLevel(event: ExecutorEvent): LogEntry['level'] {
    if (event.level) {
      return event.level;
    }
    const mapped = this.mapActivityLevel(event.type);
    return mapped === 'success' ? 'success'
      : mapped === 'error' ? 'error'
      : mapped === 'warn' ? 'warn'
      : mapped === 'system' ? 'system'
      : 'info';
  }

  private setActivity(
    model: Model,
    message: string,
    detail: string,
    level: ActivityLevel = 'system'
  ): Model {
    return {
      ...model,
      activity: message,
      activityDetail: this.compactPreview(detail),
      activityLevel: level
    };
  }

  private mapActivityLevel(type: ExecutorEvent['type']): ActivityLevel {
    switch (type) {
      case 'distress':
        return 'error';
      case 'done':
        return 'success';
      case 'awaiting_input':
        return 'warn';
      default:
        return 'info';
    }
  }

  private compactPreview(text: string): string {
    const compact = text.replace(/\s+/g, ' ').trim();
    if (compact.length <= MAX_ACTIVITY_DETAIL) {
      return compact;
    }
    return `${compact.slice(0, MAX_ACTIVITY_DETAIL)}…`;
  }

  private appendLog(model: Model, entry: LogEntry): Model {
    const nextLogs = [...model.logs, entry];
    const trimmed = nextLogs.length > MAX_LOG_ENTRIES
      ? nextLogs.slice(-MAX_LOG_ENTRIES)
      : nextLogs;

    return {
      ...model,
      logs: trimmed
    };
  }

  private pushHistory(model: Model, entry: string): Model {
    const nextHistory = model.history.length > 0 && model.history[model.history.length - 1] === entry
      ? model.history
      : [...model.history, entry];

    return {
      ...model,
      history: nextHistory,
      historyIndex: nextHistory.length,
      historyDraft: ''
    };
  }

  private navigateHistory(model: Model, direction: 'up' | 'down'): Model {
    if (model.history.length === 0) {
      return model;
    }

    if (direction === 'up') {
      const nextIndex = Math.max(0, model.historyIndex - 1);
      const draft = model.historyIndex === model.history.length ? model.input : model.historyDraft;
      const nextInput = model.history[nextIndex] ?? '';

      return {
        ...model,
        historyIndex: nextIndex,
        historyDraft: draft,
        input: nextInput,
        cursorPos: nextInput.length
      };
    }

    if (direction === 'down') {
      const nextIndex = Math.min(model.history.length, model.historyIndex + 1);
      const nextInput = nextIndex === model.history.length
        ? model.historyDraft
        : model.history[nextIndex] ?? '';

      return {
        ...model,
        historyIndex: nextIndex,
        input: nextInput,
        cursorPos: nextInput.length
      };
    }

    return model;
  }

  private insertText(model: Model, text: string): Model {
    const sanitized = this.sanitizeText(text);
    if (!sanitized) {
      return model;
    }

    const before = model.input.slice(0, model.cursorPos);
    const after = model.input.slice(model.cursorPos);
    const nextInput = before + sanitized + after;
    const nextCursor = model.cursorPos + sanitized.length;

    return {
      ...model,
      input: nextInput,
      cursorPos: nextCursor
    };
  }

  private deleteBackward(model: Model): Model {
    if (model.cursorPos <= 0) {
      return model;
    }

    const before = model.input.slice(0, model.cursorPos - 1);
    const after = model.input.slice(model.cursorPos);

    return {
      ...model,
      input: before + after,
      cursorPos: model.cursorPos - 1
    };
  }

  private deleteForward(model: Model): Model {
    if (model.cursorPos >= model.input.length) {
      return model;
    }

    const before = model.input.slice(0, model.cursorPos);
    const after = model.input.slice(model.cursorPos + 1);

    return {
      ...model,
      input: before + after,
      cursorPos: model.cursorPos
    };
  }

  private deleteToStart(model: Model): Model {
    const nextInput = model.input.slice(model.cursorPos);

    return {
      ...model,
      input: nextInput,
      cursorPos: 0
    };
  }

  private deleteToEnd(model: Model): Model {
    const nextInput = model.input.slice(0, model.cursorPos);

    return {
      ...model,
      input: nextInput,
      cursorPos: nextInput.length
    };
  }

  private deleteWordBackward(model: Model): Model {
    const prevIndex = this.findWordBoundaryLeft(model.input, model.cursorPos);
    if (prevIndex === model.cursorPos) {
      return model;
    }

    const before = model.input.slice(0, prevIndex);
    const after = model.input.slice(model.cursorPos);

    return {
      ...model,
      input: before + after,
      cursorPos: prevIndex
    };
  }

  private moveCursor(model: Model, delta: number): Model {
    const nextCursor = Math.max(0, Math.min(model.input.length, model.cursorPos + delta));
    if (nextCursor === model.cursorPos) {
      return model;
    }

    return {
      ...model,
      cursorPos: nextCursor
    };
  }

  private setCursor(model: Model, pos: number): Model {
    const nextCursor = Math.max(0, Math.min(model.input.length, pos));
    return {
      ...model,
      cursorPos: nextCursor
    };
  }

  private moveWordLeft(model: Model): Model {
    const nextCursor = this.findWordBoundaryLeft(model.input, model.cursorPos);
    return {
      ...model,
      cursorPos: nextCursor
    };
  }

  private moveWordRight(model: Model): Model {
    const nextCursor = this.findWordBoundaryRight(model.input, model.cursorPos);
    return {
      ...model,
      cursorPos: nextCursor
    };
  }

  private findWordBoundaryLeft(text: string, cursorPos: number): number {
    let index = cursorPos;
    while (index > 0 && /\s/.test(text[index - 1])) {
      index -= 1;
    }
    while (index > 0 && !/\s/.test(text[index - 1])) {
      index -= 1;
    }
    return index;
  }

  private findWordBoundaryRight(text: string, cursorPos: number): number {
    let index = cursorPos;
    while (index < text.length && /\s/.test(text[index])) {
      index += 1;
    }
    while (index < text.length && !/\s/.test(text[index])) {
      index += 1;
    }
    return index;
  }

  private sanitizeText(text: string): string {
    return text.replace(/[\r\n]+/g, ' ').replace(/\t/g, '  ');
  }

  private renderView(model: Model): string {
    if (model.mode === 'onboarding') {
      return this.renderOnboarding(model);
    }

    if (model.mode === 'help') {
      return this.renderHelp(model);
    }

    if (model.mode === 'settings') {
      return this.renderSettings(model);
    }

    return this.renderNormal(model);
  }

  private renderNormal(model: Model): string {
    const width = Math.max(50, model.width || 80);
    const height = Math.max(12, model.height || 24);
    const contentWidth = width - 2;

    const header = this.renderHeader(model, contentWidth);
    const tip = this.renderTipLine(model, contentWidth);
    const top = `┌${'─'.repeat(contentWidth)}┐`;
    const sep = `├${'─'.repeat(contentWidth)}┤`;
    const bottom = `└${'─'.repeat(contentWidth)}┘`;

    const fixedLines = model.pendingQuestion ? 10 : 9;
    const logLinesCount = Math.max(3, height - fixedLines);
    const logLines = this.renderLogLines(model, logLinesCount, contentWidth);

    const lines = [top, `│${header}│`, `│${tip}│`, sep];

    for (const line of logLines) {
      lines.push(`│${line}│`);
    }

    lines.push(sep);

    if (model.pendingQuestion) {
      lines.push(`│${this.renderPromptLine(model, contentWidth)}│`);
    }

    lines.push(`│${this.renderInputLine(model, contentWidth)}│`);
    lines.push(sep);
    lines.push(`│${this.renderFooterLine(model, contentWidth)}│`);
    lines.push(bottom);

    return lines.join('\n');
  }

  private renderHeader(model: Model, contentWidth: number): string {
    const pathWidth = Math.max(12, Math.min(42, Math.floor(contentWidth * 0.55)));
    const path = this.truncateMiddle(model.workingDir, pathWidth);
    const left = `Frame  ${path}`;
    const right = this.buildStatusText(model);
    const joined = this.joinBar(contentWidth, left, right);
    return chalk.bgHex('#1f2933').white(this.padAnsi(joined, contentWidth));
  }

  private renderTipLine(model: Model, contentWidth: number): string {
    const tip = this.buildTipLine(model);
    const truncated = this.truncateText(tip, contentWidth);
    const colored = this.colorTipLine(truncated, model);
    return chalk.bgHex('#111827')(this.padAnsi(colored, contentWidth));
  }

  private buildTipLine(model: Model): string {
    if (model.ollamaStatus === 'server_error') {
      return 'Ollama not reachable - run `ollama serve` then /settings.';
    }

    if (model.ollamaStatus === 'model_missing') {
      return this.buildOllamaPullTip(model);
    }

    if (model.ollamaStatus === 'missing_config') {
      return `Tip: edit ${model.settingsPath} to set your Ollama URL/model, then run /settings.`;
    }

    if (model.isFirstRun) {
      return `Tip: edit ${model.settingsPath} to set your Ollama URL/model, then run /settings.`;
    }

    return 'Tip: /settings to view config • /help for commands';
  }

  private colorTipLine(text: string, model: Model): string {
    if (model.ollamaStatus === 'server_error' || model.ollamaStatus === 'model_missing') {
      return chalk.redBright(text);
    }

    if (model.ollamaStatus === 'missing_config') {
      return chalk.yellowBright(text);
    }

    return chalk.gray(text);
  }

  private buildOllamaStatusLine(
    model: Model,
    options?: {
      indent?: string;
      prefix?: string;
    }
  ): string {
    const { label, tone } = this.describeOllamaStatus(model);
    const indent = options?.indent ?? '';
    const prefix = options?.prefix ?? 'Ollama status:';
    const line = `${indent}${prefix} ${label}`;
    return this.colorStatusLine(line, tone);
  }

  private buildOllamaStatusDetailLine(model: Model, indent = ''): string | null {
    if (!model.ollamaStatusError) {
      return null;
    }

    const cleaned = model.ollamaStatusError.replace(/\s+/g, ' ').trim();
    if (!cleaned) {
      return null;
    }

    return `${indent}Error: ${cleaned}`;
  }

  private describeOllamaStatus(
    model: Model
  ): { label: string; tone: 'ok' | 'warn' | 'error' | 'info' } {
    switch (model.ollamaStatus) {
      case 'ready':
        return { label: 'Ready', tone: 'ok' };
      case 'checking':
        return { label: 'Checking...', tone: 'info' };
      case 'missing_config':
        return { label: 'Missing URL/model', tone: 'warn' };
      case 'server_error':
        return { label: 'Unreachable', tone: 'error' };
      case 'model_missing':
        return { label: 'Model missing', tone: 'error' };
      case 'idle':
      default:
        return { label: 'Idle', tone: 'info' };
    }
  }

  private colorStatusLine(text: string, tone: 'ok' | 'warn' | 'error' | 'info'): string {
    switch (tone) {
      case 'ok':
        return chalk.greenBright(text);
      case 'warn':
        return chalk.yellowBright(text);
      case 'error':
        return chalk.redBright(text);
      case 'info':
      default:
        return chalk.cyanBright(text);
    }
  }

  private buildOllamaPullTip(model: Model): string {
    const modelName = model.settings.get().ollama.model;
    const candidates = [modelName, ...OLLAMA_SUGGESTED_MODELS].filter(Boolean);
    const unique = Array.from(new Set(candidates));
    const primary = unique[0];
    const secondary = unique[1];

    if (primary && secondary) {
      return `Model missing - run \`ollama pull ${primary}\` (or ${secondary}).`;
    }

    if (primary) {
      return `Model missing - run \`ollama pull ${primary}\`.`;
    }

    return 'Model missing - run `ollama pull <model>`.';
  }

  private buildStatusText(model: Model): string {
    if (model.awaitingInput) {
      return model.isPaused ? 'Paused' : 'Awaiting input';
    }

    if (model.isRunning) {
      const spinner = SPINNER_FRAMES[model.spinnerIndex % SPINNER_FRAMES.length];
      const queueLabel = model.queuedInputs.length > 0 ? ` • queued ${model.queuedInputs.length}` : '';
      return `Running ${spinner}${queueLabel}`;
    }

    if (model.queuedInputs.length > 0) {
      return `Idle • queued ${model.queuedInputs.length}`;
    }

    return 'Idle';
  }

  private renderPromptLine(model: Model, contentWidth: number): string {
    const label = `${model.isPaused ? 'Paused' : 'Prompt'}: ${model.pendingQuestion ?? ''}`;
    const truncated = this.truncateText(label, contentWidth);
    return this.padAnsi(chalk.yellow(truncated), contentWidth);
  }

  private renderInputLine(model: Model, contentWidth: number): string {
    const promptLabel = model.awaitingInput ? 'reply>' : 'frame>';
    const prompt = chalk.cyan(promptLabel);
    const promptWithSpace = `${prompt} `;
    const available = Math.max(0, contentWidth - this.visibleWidth(promptWithSpace));

    const { visible, cursorIndex } = this.computeInputWindow(model.input, model.cursorPos, available);
    const cursorChar = cursorIndex < visible.length ? visible[cursorIndex] : ' ';
    const before = visible.slice(0, cursorIndex);
    const after = cursorIndex < visible.length ? visible.slice(cursorIndex + 1) : '';

    let body = `${before}${chalk.inverse(cursorChar || ' ')}${after}`;

    if (!model.input && !model.awaitingInput) {
      const placeholder = this.truncateText('Type a request...', Math.max(0, available - this.visibleWidth(body)));
      body += chalk.gray(placeholder);
    }

    return this.padAnsi(promptWithSpace + body, contentWidth);
  }

  private renderFooterLine(model: Model, contentWidth: number): string {
    let hint = 'Enter to send • /help /settings /clear /exit';

    if (model.isRunning) {
      hint = 'Running... Enter to queue • /help /clear /exit';
    }

    if (model.awaitingInput) {
      hint = model.isPaused
        ? 'Paused • Esc to continue • Enter to send'
        : 'Awaiting reply • Enter to send • /cancel to drop';
    }

    const truncated = this.truncateText(hint, contentWidth);
    return this.padAnsi(chalk.gray(truncated), contentWidth);
  }

  private renderLogLines(model: Model, count: number, contentWidth: number): string[] {
    const entries = model.logs.slice(-count);
    const rendered = entries.map((entry) => this.renderLogEntry(entry, contentWidth));
    const paddingCount = Math.max(0, count - rendered.length);

    for (let i = 0; i < paddingCount; i += 1) {
      rendered.unshift(this.padAnsi('', contentWidth));
    }

    return rendered;
  }

  private renderLogEntry(entry: LogEntry, contentWidth: number): string {
    const time = this.formatTime(entry.timestamp);
    const icon = this.getLogIcon(entry.level);
    const text = this.truncateText(`${time} ${icon} ${entry.message}`, contentWidth);
    const colored = this.colorLogLine(entry.level, text);
    return this.padAnsi(colored, contentWidth);
  }

  private formatTime(timestamp: number): string {
    return new Date(timestamp).toTimeString().slice(0, 5);
  }

  private getLogIcon(level: LogEntry['level']): string {
    switch (level) {
      case 'success':
        return '✓';
      case 'warn':
        return '!';
      case 'error':
        return '✗';
      case 'system':
        return '•';
      case 'info':
      default:
        return '•';
    }
  }

  private colorLogLine(level: LogEntry['level'], text: string): string {
    switch (level) {
      case 'success':
        return chalk.green(text);
      case 'warn':
        return chalk.yellow(text);
      case 'error':
        return chalk.red(text);
      case 'system':
        return chalk.gray(text);
      case 'info':
      default:
        return chalk.cyan(text);
    }
  }

  private renderHelp(model: Model): string {
    const contentWidth = Math.max(50, model.width || 80) - 2;
    const lines = [
      'Commands',
      '  /help      Show this help',
      '  /settings  View settings',
      '  /clear     Clear log panel',
      '  /debug     Show debug log path',
      '  /cancel    Cancel pending question',
      '  /exit      Quit',
      '',
      'Editing',
      '  Up/Down         History',
      '  Ctrl+A / Ctrl+E Start/End of line',
      '  Ctrl+W          Delete previous word',
      '  Alt+Backspace   Delete previous word',
      '  Ctrl+U / Ctrl+K Delete to start/end',
      '  Ctrl+Left/Right Move by word',
      '  Esc             Pause/Continue run',
      '',
      'Debug',
      this.truncateText(`  Log file: ${model.debugLogPath}`, contentWidth),
      '',
      "Press ESC or 'q' to return"
    ];

    return this.renderPanel('Help', lines, model);
  }

  private renderOnboarding(model: Model): string {
    const contentWidth = Math.max(50, model.width || 80) - 2;
    const art = [
      '  _____                 ',
      ' |  ___|__  _ __ ___ ___',
      " | |_ / _ \\| '__/ __/ _ \\",
      ' |  _| (_) | | | (_|  __/',
      ' |_|  \\___/|_|  \\___\\___|'
    ];
    const defaultModel = model.settings.get().ollama.model;
    const alternateModel = OLLAMA_SUGGESTED_MODELS.find((name) => name !== defaultModel);
    const statusLine = this.buildOllamaStatusLine(model);
    const statusDetail = this.buildOllamaStatusDetailLine(model);
    const statusLines = statusDetail
      ? [statusLine, this.truncateText(statusDetail, contentWidth)]
      : [statusLine];

    const lines = [
      ...art,
      '',
      'Welcome to Frame! Looks like this is your first run.',
      '',
      ...statusLines,
      '',
      'Quick start:',
      '  1) Run: ollama serve',
      `  2) Pull: ollama pull ${defaultModel}`,
      ...(alternateModel ? [`     or: ollama pull ${alternateModel}`] : []),
      `  3) ${OLLAMA_TOOLCALL_NOTE}`,
      '',
      this.truncateText(`Edit ${model.settingsPath} to set your Ollama URL/model.`, contentWidth),
      "Press 's' for settings, or Esc to start.",
      'Tip: /help shows commands.'
    ];

    return this.renderPanel('Welcome', lines, model);
  }

  private buildModelInfoLines(model: Model): string[] {
    if (model.ollamaInfoStatus === 'loading') {
      return ['  Loading model info...'];
    }

    if (model.ollamaInfoStatus === 'error') {
      const message = model.ollamaInfoError || 'Unable to load model info.';
      return [`  Error: ${message}`];
    }

    if (model.ollamaInfoStatus !== 'ready' || !model.ollamaInfo) {
      return ['  Loading model info...'];
    }

    const info = model.ollamaInfo;
    const lines = [
      `  Context: ${info.contextLength ?? 'n/a'}`,
      `  Family: ${info.family ?? 'n/a'}`,
      `  Parameters: ${info.parameterSize ?? 'n/a'}`,
      `  Quantization: ${info.quantizationLevel ?? 'n/a'}`
    ];

    if (info.format) {
      lines.push(`  Format: ${info.format}`);
    }

    return lines;
  }

  private renderSettings(model: Model): string {
    const settings = model.settings.get();
    const contentWidth = Math.max(50, model.width || 80) - 2;
    const modelInfoLines = this.buildModelInfoLines(model).map((line) =>
      this.truncateText(line, contentWidth)
    );
    const statusLine = this.buildOllamaStatusLine(model, { indent: '  ', prefix: 'Status:' });
    const statusDetail = this.buildOllamaStatusDetailLine(model, '  ');

    const lines = [
      'Ollama',
      statusLine,
      ...(statusDetail ? [this.truncateText(statusDetail, contentWidth)] : []),
      this.truncateText(`  URL: ${settings.ollama.url}`, contentWidth),
      this.truncateText(`  Model: ${settings.ollama.model}`, contentWidth),
      this.truncateText(`  Embedding: ${settings.ollama.embeddingModel}`, contentWidth),
      '',
      'Model info (Ollama /api/show)',
      ...modelInfoLines,
      '',
      'UI',
      this.truncateText(`  Theme: ${settings.ui.theme}`, contentWidth),
      this.truncateText(`  Show Details: ${settings.ui.showAgentDetails ? 'Yes' : 'No'}`, contentWidth),
      '',
      this.truncateText(`Settings are stored at ${model.settingsPath}`, contentWidth),
      '',
      "Press ESC or 'q' to return"
    ];

    return this.renderPanel('Settings', lines, model);
  }

  private renderPanel(title: string, lines: string[], model: Model): string {
    const width = Math.max(50, model.width || 80);
    const contentWidth = width - 2;
    const top = `┌${'─'.repeat(contentWidth)}┐`;
    const sep = `├${'─'.repeat(contentWidth)}┤`;
    const bottom = `└${'─'.repeat(contentWidth)}┘`;

    const header = chalk.bgHex('#1f2933').white(this.padAnsi(` ${title} `, contentWidth));
    const body = lines.map((line) => this.padAnsi(this.truncateText(line, contentWidth), contentWidth));

    return [
      top,
      `│${header}│`,
      sep,
      ...body.map((line) => `│${line}│`),
      bottom
    ].join('\n');
  }

  private handleOnboardingMode(model: Model, msg: KeyMsg): [Model, CmdResult<Msg>] {
    if (msg.key === 's') {
      return this.enterSettings(model);
    }

    if (msg.key === 'escape' || msg.key === 'q' || msg.key === 'enter') {
      return [{ ...model, mode: 'normal' }, null];
    }

    if (msg.key === 'h' || msg.key === '?') {
      return [{ ...model, mode: 'help' }, null];
    }

    return [model, null];
  }

  private handleSettingsMode(model: Model, msg: KeyMsg): [Model, CmdResult<Msg>] {
    if (msg.key === 'escape' || msg.key === 'q') {
      return [{ ...model, mode: 'normal', input: '' }, null];
    }

    return [model, null];
  }

  private enterSettings(model: Model): [Model, CmdResult<Msg>] {
    model.settings.reload();
    const nextModel: Model = {
      ...model,
      mode: 'settings',
      input: '',
      ollamaInfoStatus: 'loading' as ModelInfoStatus,
      ollamaInfo: undefined,
      ollamaInfoError: undefined,
      ollamaStatus: 'checking',
      ollamaStatusError: undefined
    };
    return [
      nextModel,
      batch(
        this.createModelInfoCommand(model.settings),
        this.createOllamaStatusCommand(model.settings)
      )
    ];
  }

  private createModelInfoCommand(settings: SettingsManager): Cmd<Msg> {
    return async () => {
      const current = settings.get();
      const baseURL = this.normalizeOllamaBaseURL(current.ollama.url);
      const modelName = current.ollama.model;

      if (!baseURL || !modelName) {
        return { type: 'model_info', error: 'Missing Ollama URL or model name.' };
      }

      try {
        const response = await fetch(`${baseURL}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName })
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          const message = body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`;
          return { type: 'model_info', error: message };
        }

        const data = (await response.json()) as OllamaShowResponse;
        const contextLength = this.extractContextLength(data.model_info, data.parameters);
        const info: OllamaModelInfo = {
          model: modelName,
          contextLength,
          family: data.details?.family,
          parameterSize: data.details?.parameter_size,
          quantizationLevel: data.details?.quantization_level,
          format: data.details?.format
        };

        return { type: 'model_info', info };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { type: 'model_info', error: message };
      }
    };
  }

  private createOllamaStatusCommand(settings: SettingsManager): Cmd<Msg> {
    return async () => {
      const current = settings.get();
      const baseURL = this.normalizeOllamaBaseURL(current.ollama.url);
      const modelName = current.ollama.model;

      if (!baseURL || !modelName) {
        return { type: 'ollama_status', status: 'missing_config', error: 'Missing Ollama URL or model name.' };
      }

      try {
        const versionResponse = await fetch(`${baseURL}/api/version`);
        if (!versionResponse.ok) {
          const body = await versionResponse.text().catch(() => '');
          const message = body ? `HTTP ${versionResponse.status}: ${body}` : `HTTP ${versionResponse.status}`;
          return { type: 'ollama_status', status: 'server_error', error: message };
        }

        const showResponse = await fetch(`${baseURL}/api/show`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: modelName })
        });

        if (!showResponse.ok) {
          const body = await showResponse.text().catch(() => '');
          const message = body ? `HTTP ${showResponse.status}: ${body}` : `HTTP ${showResponse.status}`;
          return { type: 'ollama_status', status: 'model_missing', error: message };
        }

        return { type: 'ollama_status', status: 'ready' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { type: 'ollama_status', status: 'server_error', error: message };
      }
    };
  }

  private normalizeOllamaBaseURL(url: string): string {
    const trimmed = url.replace(/\/+$/, '');
    if (trimmed.endsWith('/v1')) {
      return trimmed.slice(0, -3);
    }
    return trimmed;
  }

  private extractContextLength(
    modelInfo: Record<string, unknown> | undefined,
    parameters?: string
  ): number | undefined {
    if (modelInfo) {
      for (const [key, value] of Object.entries(modelInfo)) {
        if (!key.toLowerCase().includes('context_length')) {
          continue;
        }
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === 'string') {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
      }
    }

    if (parameters) {
      const match = parameters.match(/(?:num_ctx|context_length|context)\s+(\d+)/i);
      if (match) {
        const parsed = Number.parseInt(match[1], 10);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }

    return undefined;
  }

  private joinBar(width: number, left: string, right: string): string {
    const leftWidth = this.visibleWidth(left);
    const rightWidth = this.visibleWidth(right);
    const remaining = width - leftWidth - rightWidth;

    if (remaining <= 1) {
      const truncatedLeft = this.truncateText(left, Math.max(0, width - rightWidth - 1));
      return `${truncatedLeft} ${right}`;
    }

    return `${left}${' '.repeat(remaining)}${right}`;
  }

  private truncateText(text: string, maxWidth: number): string {
    if (this.visibleWidth(text) <= maxWidth) {
      return text;
    }

    if (maxWidth <= 3) {
      return text.slice(0, Math.max(0, maxWidth));
    }

    return text.slice(0, Math.max(0, maxWidth - 3)) + '...';
  }

  private truncateMiddle(text: string, maxWidth: number): string {
    if (this.visibleWidth(text) <= maxWidth) {
      return text;
    }

    if (maxWidth <= 3) {
      return text.slice(0, Math.max(0, maxWidth));
    }

    const keep = Math.max(1, Math.floor((maxWidth - 3) / 2));
    return `${text.slice(0, keep)}...${text.slice(-keep)}`;
  }

  private padAnsi(text: string, width: number): string {
    const padding = Math.max(0, width - this.visibleWidth(text));
    return text + ' '.repeat(padding);
  }

  private stripAnsi(text: string): string {
    return text.replace(ANSI_ESCAPE_REGEX, '');
  }

  private visibleWidth(text: string): number {
    return Array.from(this.stripAnsi(text)).length;
  }

  private computeInputWindow(input: string, cursorPos: number, maxWidth: number): { visible: string; cursorIndex: number } {
    const clampedCursor = Math.max(0, Math.min(cursorPos, input.length));

    if (this.visibleWidth(input) <= maxWidth) {
      return { visible: input, cursorIndex: clampedCursor };
    }

    let start = Math.max(0, clampedCursor - Math.floor(maxWidth * 0.6));
    let end = start + maxWidth;

    if (end > input.length) {
      end = input.length;
      start = Math.max(0, end - maxWidth);
    }

    const visible = input.slice(start, end);
    return { visible, cursorIndex: clampedCursor - start };
  }
}
