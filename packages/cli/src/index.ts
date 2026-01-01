#!/usr/bin/env node

/**
 * Frame  - Coding Agent
 *
 * Main entry point for the application.
 */

import { loadConfig, ensureFrameDirectory } from './utils/config.js';
import { logger, setConsoleLoggingEnabled } from './utils/logger.js';
import { createRuntime } from './core/index.js';
import { TUIRepl } from './cli/index.js';
import chalk from 'chalk';

async function main() {
  try {
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
