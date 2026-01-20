/**
 * Structured Logger
 * 
 * Logs to console and .frame/logs/session-<timestamp>.jsonl
 */

import fs from 'fs';
import path from 'path';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

let logFileStream: fs.WriteStream | null = null;
let isInitialized = false;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatConsoleMessage(level: LogLevel, message: string): string {
  const timestamp = new Date().toISOString();
  return `${timestamp} [${level.toUpperCase()}]: ${message}`;
}

function writeToFile(entry: LogEntry): void {
  if (logFileStream) {
    logFileStream.write(JSON.stringify(entry) + '\n');
  }
}

export const logger = {
  /**
   * Initialize the logger with a workspace root
   */
  init(workspaceRoot: string): void {
    if (isInitialized) return;

    try {
      const logsDir = path.join(workspaceRoot, '.frame', 'logs');
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = path.join(logsDir, `session-${timestamp}.jsonl`);

      logFileStream = fs.createWriteStream(logFile, { flags: 'a' });
      isInitialized = true;

      // Log initialization
      this.debug('Logger initialized', { logFile });
    } catch (error) {
      console.error('Failed to initialize logger:', error);
    }
  },

  debug(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'debug',
      message,
      data
    };

    writeToFile(entry);

    if (shouldLog('debug')) {
      console.debug(formatConsoleMessage('debug', message));
    }
  },

  info(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message,
      data
    };

    writeToFile(entry);

    if (shouldLog('info')) {
      console.info(formatConsoleMessage('info', message));
    }
  },

  warn(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message,
      data
    };

    writeToFile(entry);

    if (shouldLog('warn')) {
      console.warn(formatConsoleMessage('warn', message));
    }
  },

  error(message: string, data?: any): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
      data
    };

    writeToFile(entry);

    if (shouldLog('error')) {
      console.error(formatConsoleMessage('error', message));
    }
  },

  close(): void {
    if (logFileStream) {
      logFileStream.end();
      logFileStream = null;
      isInitialized = false;
    }
  }
};

export function setConsoleLoggingEnabled(_enabled: boolean): void {
  // No-op in simplified logger
}
