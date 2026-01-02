#!/usr/bin/env node

/**
 * Frame  - Coding Agent
 *
 * Main entry point for the application.
 */

import { readFileSync } from 'node:fs';
import { loadConfig, ensureFrameDirectory } from './utils/config.js';
import { logger, setConsoleLoggingEnabled } from './utils/logger.js';
import { createRuntime } from './core/index.js';
import { TUIRepl } from './cli/index.js';
import chalk from 'chalk';

function getVersion(): string {
  try {
    const pkgPath = new URL('../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function getHelpText(): string {
  return [
    'Frame - coding agent optimized for local LLMs',
    '',
    'Usage:',
    '  frame [options]',
    '',
    'Options:',
    '  --help     Show this help and exit',
    '  --version  Show version and exit',
    '',
    'Tip: Use /help inside the TUI for available commands.',
  ].join('\n');
}

async function main() {
  try {
    const args = process.argv.slice(2);
    if (args.includes('--help')) {
      console.log(getHelpText());
      process.exit(0);
    }

    if (args.includes('--version')) {
      console.log(`frame ${getVersion()}`);
      process.exit(0);
    }

    // Load configuration
    loadConfig();

    // Ensure .frame directory exists
    ensureFrameDirectory();

    setConsoleLoggingEnabled(false);
    logger.info('Initializing Frame');

    // Create runtime with direct executor
    const { directExecutor } = await createRuntime();

    // Start TUI REPL with Centaur architecture
    const repl = new TUIRepl({
      directExecutor,
    });
    await repl.start();
  } catch (error) {
    console.error(chalk.red('\n❌ Fatal error:'), error);
    logger.error(`Fatal error: ${error}`);
    process.exit(1);
  }
}

main();
