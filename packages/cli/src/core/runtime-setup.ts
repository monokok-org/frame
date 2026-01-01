/**
 * Runtime Setup
 *
 * Direct executor only (no Biosphere/Frames).
 */

import { getOllamaClient } from '../llm/index.js';
import { logger } from '../utils/logger.js';
import { WorkspaceMemoryManager } from './workspace-memory.js';
import { setWorkspaceMemory } from './workspace-context.js';
import { DirectExecutor } from './direct-executor.js';

export async function createRuntime(): Promise<{
  workspaceMemory: WorkspaceMemoryManager;
  directExecutor: DirectExecutor;
}> {
  const llm = getOllamaClient();

  logger.info('Initializing runtime...');

  const workspaceMemory = new WorkspaceMemoryManager();
  setWorkspaceMemory(workspaceMemory);
  logger.info('Workspace memory initialized');

  const directExecutor = new DirectExecutor({
    llm: llm as any,
    workingDirectory: process.cwd(),
    maxTurns: 0,
  });
  logger.info('Direct executor initialized');

  return {
    workspaceMemory,
    directExecutor,
  };
}
