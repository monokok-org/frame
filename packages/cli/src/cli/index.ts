#!/usr/bin/env node
/**
 * Frame CLI Entry Point
 */

import { startRepl } from './repl.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--version') || args.includes('-v')) {
    console.log('frame v0.3.0');
    return;
  }

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Frame - Local AI Code Generation Agent

Usage:
  frame              Start interactive REPL
  frame --version    Show version
  frame --help       Show this help

Environment:
  LLM_BASE_URL      Ollama API URL (default: http://localhost:11434)
  LLM_MODEL         Model to use (default: devstral-small-2:24b)
`);
    return;
  }

  await startRepl();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
