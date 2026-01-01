import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Ensure log directory exists
const logDir = path.join(process.cwd(), '.frame', 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.simple()
  )
});

const fileTransport = new winston.transports.File({
  filename: path.join(logDir, 'frame.log'),
  maxsize: 5242880, // 5MB
  maxFiles: 5
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    consoleTransport,
    fileTransport
  ]
});

export function setConsoleLoggingEnabled(enabled: boolean): void {
  const hasConsole = logger.transports.includes(consoleTransport);
  if (enabled && !hasConsole) {
    logger.add(consoleTransport);
  }
  if (!enabled && hasConsole) {
    logger.remove(consoleTransport);
  }
}
