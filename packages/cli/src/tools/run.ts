/**
 * Run Tool - Shell Execution
 * 
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import type { Tool } from './types.js';
import { getProjectRoot, getConfig } from '../utils/config.js';

interface RunInput {
  command: string; // Command to run, or PID for read/kill
  args?: string[]; // Optional arguments specifically for the command
  timeout?: number;
  cwd?: string;
  run_in_background?: boolean;
  action?: 'run' | 'read' | 'kill' | 'list';
}

interface RunOutput {
  exitCode?: number;
  stdout: string;
  stderr: string;
  error?: string;
  pid?: number; // Process ID for background processes
}

interface BackgroundProcess {
  process: ChildProcess;
  command: string;
  startTime: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

// Global state for background processes
// In a real app this might need to be more robust (e.g. file-backed or service)
const activeProcesses = new Map<number, BackgroundProcess>();

// Constants
const DEFAULT_TIMEOUT = 30000;
const MAX_OUTPUT = 50000; // 50KB total buffer for background processes
const MAX_FOREGROUND_OUTPUT = 10000;

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?|--recursive)\s+[\/~]/i,
  /rm\s+-rf?\s+\*/i,
  />\s*\/dev\/sd/i,
  /mkfs\./i,
  /dd\s+if=/i,
  /chmod\s+777\s+\//i,
  /curl.*\|\s*(ba)?sh/i,
  /wget.*\|\s*(ba)?sh/i,
];

function isDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some(pattern => pattern.test(command));
}

function truncateOutput(output: string, limit: number): string {
  if (output.length <= limit) return output;
  return output.slice(0, limit) + `\n... [output truncated to ${limit} chars]`;
}

function isWithinRoot(targetPath: string, root: string): boolean {
  const resolved = path.resolve(root, targetPath);
  return resolved.startsWith(path.resolve(root));
}

export const runTool: Tool<RunInput, RunOutput> = {
  name: 'run',
  description: `Executes a given bash command in a persistent shell session with optional timeout.

IMPORTANT: This tool is for terminal operations like git, npm, docker. DO NOT use it for file operations (reading, writing, editing, searching) - use specialized tools.

Actions:
- "run" (default): Execute a command. Set 'run_in_background': true to run asynchronously.
- "read": Read output from a background process. Pass the PID as the 'command' argument.
- "kill": Kill a background process. Pass the PID as the 'command' argument.
- "list": List all active background processes. Pass "list" as the 'command'.

Usage:
- Foreground: run({ command: "npm test" })
- Background: run({ command: "npm run dev", run_in_background: true }) -> returns PID
- Read output: run({ command: "<PID>", action: "read" })
- Kill process: run({ command: "<PID>", action: "kill" })
`,

  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute, or PID for read/kill actions'
      },
      action: {
        type: 'string',
        enum: ['run', 'read', 'kill', 'list'],
        description: 'Action to perform',
        default: 'run'
      },
      run_in_background: {
        type: 'boolean',
        description: 'Run command in background (returns PID)'
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds (default: 30000 for foreground)'
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: project root)'
      }
    },
    required: ['command']
  },

  async execute(input: RunInput): Promise<RunOutput> {
    const action = input.action || 'run';

    // Handle List
    if (action === 'list' || input.command === 'list') {
      const processes = Array.from(activeProcesses.entries()).map(([pid, p]) => {
        const status = p.exitCode !== null ? `Done (${p.exitCode})` : 'Running';
        const duration = Math.round((Date.now() - p.startTime) / 1000);
        return `PID ${pid}: ${p.command} [${status}, ${duration}s]`;
      });

      return {
        stdout: processes.length > 0 ? processes.join('\n') : 'No background processes.',
        stderr: ''
      };
    }

    // Handle Read/Kill (Pid-based)
    if (action === 'read' || action === 'kill') {
      const pid = parseInt(input.command.trim());
      if (isNaN(pid)) {
        return { stdout: '', stderr: '', error: `Invalid PID: ${input.command}. Expected a number.` };
      }

      const proc = activeProcesses.get(pid);
      if (!proc) {
        return { stdout: '', stderr: '', error: `Process with PID ${pid} not found.` };
      }

      if (action === 'kill') {
        process.kill(pid, 'SIGTERM'); // Try graceful first
        // Check if still alive after short delay? 
        // For now just return success
        activeProcesses.delete(pid);
        return {
          stdout: `Process ${pid} killed.`,
          stderr: ''
        };
      }

      if (action === 'read') {
        const out = proc.stdout;
        const err = proc.stderr;
        // Optionally clear buffer after read? 
        return {
          exitCode: proc.exitCode ?? undefined,
          stdout: out,
          stderr: err,
        };
      }
    }

    // Handle Run
    const cfg = getConfig();
    const root = getProjectRoot();
    const cwd = input.cwd ? path.join(root, input.cwd) : root;
    const timeout = input.timeout ?? (input.run_in_background ? 0 : (cfg.safety.commandTimeoutMs || DEFAULT_TIMEOUT));

    // Safety checks
    if (isDangerous(input.command)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: '',
        error: 'Command blocked: potentially dangerous operation'
      };
    }

    if (!isWithinRoot(cwd, root)) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: '',
        error: `Working directory outside project root: ${input.cwd}`
      };
    }

    return new Promise((resolve) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
      const shellArg = process.platform === 'win32' ? '/c' : '-c';

      const child = spawn(shell, [shellArg, input.command], {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !!input.run_in_background
      });

      const pid = child.pid;
      if (!pid) {
        resolve({ stdout: '', stderr: '', error: 'Failed to spawn process' });
        return;
      }

      // Initialize background state
      if (input.run_in_background) {
        activeProcesses.set(pid, {
          process: child,
          command: input.command,
          startTime: Date.now(),
          stdout: '',
          stderr: '',
          exitCode: null
        });

        // Background output handling
        child.stdout.on('data', (d) => {
          const p = activeProcesses.get(pid);
          if (p) p.stdout = truncateOutput(p.stdout + d.toString(), MAX_OUTPUT);
        });

        child.stderr.on('data', (d) => {
          const p = activeProcesses.get(pid);
          if (p) p.stderr = truncateOutput(p.stderr + d.toString(), MAX_OUTPUT);
        });

        child.on('close', (code) => {
          const p = activeProcesses.get(pid);
          if (p) p.exitCode = code ?? 0;
        });

        // Return immediately with PID
        resolve({
          stdout: `Command started in background.\nPID: ${pid}\nUse action="read" with command="${pid}" to see output.`,
          stderr: '',
          pid
        });
        return;
      }

      // Foreground execution
      let stdout = '';
      let stderr = '';
      let killed = false;

      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);

        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout: truncateOutput(stdout, MAX_FOREGROUND_OUTPUT),
          stderr: truncateOutput(stderr, MAX_FOREGROUND_OUTPUT),
          error: killed ? `Command timed out after ${timeout}ms` : undefined
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          stdout: '',
          stderr: '',
          error: `Failed to execute: ${err.message}`
        });
      });
    });
  }
};

