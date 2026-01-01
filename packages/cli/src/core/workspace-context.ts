/**
 * Workspace Context - Global access to workspace memory
 *
 * Provides a singleton instance of WorkspaceMemoryManager that can be
 * accessed by skills without passing it through the entire call chain.
 */

import type { WorkspaceMemoryManager } from './workspace-memory.js';

let workspaceMemoryInstance: WorkspaceMemoryManager | null = null;

/**
 * Set the global workspace memory instance
 */
export function setWorkspaceMemory(memory: WorkspaceMemoryManager): void {
  workspaceMemoryInstance = memory;
}

/**
 * Get the global workspace memory instance
 */
export function getWorkspaceMemory(): WorkspaceMemoryManager | null {
  return workspaceMemoryInstance;
}
