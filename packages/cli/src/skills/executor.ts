/**
 * Motor Skills for Command Execution
 *
 * exec-command - Run shell commands safely with intelligent process handling
 */

import { spawn } from 'child_process';
import type { MotorSkill } from '@homunculus-live/core';
import { logger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { getWorkspaceMemory } from '../core/workspace-context.js';

// Long-running processes that should be started in background
const BACKGROUND_PROCESS_PATTERNS = [
  /npm\s+run\s+(dev|start|serve)/,
  /yarn\s+(dev|start|serve)/,
  /pnpm\s+(dev|start|serve)/,
  /vite(\s|$)/,
  /webpack-dev-server/,
  /next\s+dev/,
  /gatsby\s+develop/,
  /rails\s+server/,
  /python.*manage\.py\s+runserver/,
  /nodemon/,
  /ts-node-dev/
];

/**
 * Check if a command is a long-running background process (dev server, watcher, etc.)
 */
function isBackgroundProcess(command: string): boolean {
  return BACKGROUND_PROCESS_PATTERNS.some(pattern => pattern.test(command));
}

// Dangerous command patterns that should never be allowed
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,           // rm -rf /
  /rm\s+-rf\s+\*/,           // rm -rf *
  /dd\s+if=/,                // dd if=
  /mkfs/,                    // mkfs
  /:\(\)\{:\|:&\};:/,        // Fork bomb
  /curl[^|]*\|\s*sh/,        // curl ... | sh (but not 2>&1)
  /wget[^|]*\|\s*sh/         // wget ... | sh (but not 2>&1)
];

/**
 * Check if a command is potentially dangerous
 */
function isDangerousCommand(command: string): boolean {
  const normalized = command.toLowerCase().trim();

  // Check against dangerous patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(normalized)) {
      return true;
    }
  }

  // Check for common destructive patterns
  if (normalized.includes('rm') && (normalized.includes('-rf') || normalized.includes('-fr'))) {
    // Allow only if targeting specific files/dirs, not wildcards or root
    if (normalized.includes('/*') || normalized.includes(' /') || normalized === 'rm -rf') {
      return true;
    }
  }

  return false;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration_ms: number;
}

interface AskUserQuestionInput {
  question: string;
}

/**
 * Ask the user a clarification question
 */
export const askUserQuestionSkill: MotorSkill<AskUserQuestionInput, string> = {
  id: 'ask-user-question',
  name: 'Ask User Question',
  description: `Ask the user a clarification question when you need more info or want to validate assumptions.`,

  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description: 'Question to ask the user.'
      }
    },
    required: ['question']
  },

  async execute({ question }: AskUserQuestionInput): Promise<string> {
    const text = typeof question === 'string' ? question : '';
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : 'Need more details to continue.';
  }
};

/**
 * Execute a shell command
 */
export const execCommand: MotorSkill<{ command: string }, ExecResult> = {
  id: 'exec-command',
  name: 'Execute Command',
  description: `Runs a shell command and returns the output (stdout, stderr, exit code).

CRITICAL BEST PRACTICES:
1. **Non-interactive mode**: Always use non-interactive flags to prevent commands from waiting for user input
   - Common flags: --yes, -y, --defaults, --no-interaction, --force, --quiet
   - Research tool-specific flags if unsure (use web-search)

2. **Capture stderr**: Redirect stderr to stdout using 2>&1 to capture error messages
   - Without this, error output may be lost
   - Essential for debugging command failures

3. **Timeout**: Commands have a 30-second timeout. For longer operations, break into smaller steps.

4. **Error handling**: If exitCode !== 0, the stdout/stderr contains the error message
   - Read the output to understand WHY the command failed
   - Use this information to plan corrective actions`,

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute (use --yes flags and 2>&1 for error capture)'
      }
    },
    required: ['command']
  },

  async execute(input: { command: string }): Promise<ExecResult> {
    const command = input.command;
    const startTime = Date.now();

    try {
      const config = getConfig();

      // Safety checks
      if (!config.safety.allowDestructiveCommands && isDangerousCommand(command)) {
        throw new Error(`Dangerous command blocked: ${command}`);
      }

      logger.info(`[exec-command] Executing: ${command}`);

      // INTELLIGENT HANDLING: Detect long-running background processes
      if (isBackgroundProcess(command)) {
        return await executeBackgroundProcess(command, config.safety.commandTimeoutMs);
      }

      // Use spawn instead of exec for better output capture
      const result = await executeWithSpawn(command, config.safety.commandTimeoutMs);

      // Track in workspace memory
      const memory = getWorkspaceMemory();
      if (memory) {
        memory.recordCommand(command, result.exitCode, result.stdout + result.stderr);
      }

      return result;
    } catch (error: any) {
      const duration_ms = Date.now() - startTime;
      logger.error(`[exec-command] Execution error: ${error.message}`);

      const result = {
        stdout: '',
        stderr: error.message || 'Command execution failed',
        exitCode: 1,
        duration_ms
      };

      // Track in workspace memory
      const memory = getWorkspaceMemory();
      if (memory) {
        memory.recordCommand(command, result.exitCode, result.stderr);
      }

      return result;
    }
  }
};

/**
 * Execute command using spawn for reliable output capture
 * This properly captures stdout/stderr even for commands that fail immediately
 */
async function executeWithSpawn(command: string, timeoutMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let timedOut = false;

    // Spawn process with shell
    const child = spawn('sh', ['-c', command], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FORCE_COLOR: '0' } // Disable colors for cleaner output
    });

    // Collect stdout
    child.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
    });

    // Collect stderr
    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
    });

    // Handle process errors
    child.on('error', (error) => {
      stderr += `\nProcess error: ${error.message}`;
      exitCode = 1;
    });

    // Handle process exit
    child.on('exit', (code, signal) => {
      if (timedOut) return; // Already resolved by timeout

      exitCode = code !== null ? code : (signal ? 1 : 0);
      const duration_ms = Date.now() - startTime;

      // Log the output
      logger.debug(`[exec-command] Exit code: ${exitCode}, Duration: ${duration_ms}ms`);
      if (stdout) {
        logger.debug(`[exec-command] stdout: ${stdout.slice(0, 500)}${stdout.length > 500 ? '...' : ''}`);
      }
      if (stderr) {
        logger.debug(`[exec-command] stderr: ${stderr.slice(0, 500)}${stderr.length > 500 ? '...' : ''}`);
      }

      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        duration_ms
      });
    });

    // Timeout handler
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');

      // Give it 2 seconds to cleanup, then force kill
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 2000);

      const duration_ms = Date.now() - startTime;
      logger.warn(`[exec-command] Command timed out after ${duration_ms}ms`);

      resolve({
        stdout: stdout.trim(),
        stderr: (stderr + `\nCommand timed out after ${timeoutMs}ms`).trim(),
        exitCode: 124, // Standard timeout exit code
        duration_ms
      });
    }, timeoutMs);

    // Clean up timeout if process exits normally
    child.on('exit', () => {
      clearTimeout(timeout);
    });
  });
}

/**
 * Execute a background process (dev server, watcher, etc.)
 * Starts the process, waits for success indicators, then kills it
 */
async function executeBackgroundProcess(command: string, maxWaitMs: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const trackResult = (result: ExecResult) => {
      // Track in workspace memory
      const memory = getWorkspaceMemory();
      if (memory) {
        memory.recordCommand(command, result.exitCode, result.stdout);
      }
      resolve(result);
    };

    const processStartTime = Date.now();
    let stdout = '';
    let stderr = '';
    let resolved = false;

    logger.info(`[exec-command] Detected background process, will verify startup`);

    // Parse command into shell + args
    const child = spawn('sh', ['-c', command], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    // Success patterns that indicate server is ready
    const successPatterns = [
      /ready in \d+\s*ms/i,           // Vite: "ready in 280 ms"
      /compiled successfully/i,       // Webpack
      /server.*running.*http/i,       // Generic server running
      /localhost:\d+/i,                // Any localhost URL
      /listening.*:\d+/i,              // "Listening on :3000"
      /started.*successfully/i,        // Generic success
      /on.*http:\/\//i                 // "on http://..."
    ];

    const checkSuccess = (data: string): boolean => {
      return successPatterns.some(pattern => pattern.test(data));
    };

    // Collect output
    child.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;

      // Check if server started successfully
      if (!resolved && checkSuccess(text)) {
        logger.info(`[exec-command] Background process started successfully`);
        resolved = true;
        child.kill('SIGTERM'); // Gracefully stop

        trackResult({
          stdout,
          stderr,
          exitCode: 0, // Success - server started!
          duration_ms: Date.now() - processStartTime
        });
      }
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      if (!resolved) {
        logger.error(`[exec-command] Process error: ${error.message}`);
        resolved = true;
        trackResult({
          stdout,
          stderr: stderr + `\nProcess error: ${error.message}`,
          exitCode: 1,
          duration_ms: Date.now() - processStartTime
        });
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        logger.debug(`[exec-command] Background process exited with code ${code}`);
        resolved = true;
        trackResult({
          stdout,
          stderr,
          exitCode: code || 0,
          duration_ms: Date.now() - processStartTime
        });
      }
    });

    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        const elapsed = Date.now() - processStartTime;
        logger.warn(`[exec-command] Background process timeout after ${elapsed}ms, killing process`);

        // Check if we got ANY output indicating success
        if (checkSuccess(stdout)) {
          logger.info(`[exec-command] Found success pattern in output, treating as success`);
          resolved = true;
          child.kill('SIGTERM');
          trackResult({
            stdout,
            stderr,
            exitCode: 0, // Success based on output patterns
            duration_ms: Date.now() - processStartTime
          });
        } else {
          logger.warn(`[exec-command] No success pattern found, treating as failure`);
          resolved = true;
          child.kill('SIGKILL'); // Force kill
          trackResult({
            stdout,
            stderr: stderr + '\nTimeout waiting for server to start',
            exitCode: 1,
            duration_ms: Date.now() - processStartTime
          });
        }
      }
    }, maxWaitMs);
  });
}

export const executorSkills = [askUserQuestionSkill, execCommand];
