/**
 * Skill Policies - Safety constraints for motor skills
 *
 * These policies wrap skills with additional safety checks and constraints.
 */

import type { SkillPolicy } from '@homunculus-live/core';
import { isWithinProjectRoot } from '../utils/file-utils.js';
import { getConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import path from 'path';

/**
 * READ-ONLY mode enforcement (for exploration agents)
 * When enabled, blocks all write operations
 */
let readOnlyMode = false;
const readOnlyAgents = new Set<string>(); // Track which agents are read-only

export function enableReadOnlyMode(agentId?: string) {
  if (agentId) {
    readOnlyAgents.add(agentId);
    logger.debug(`[policy] Enabled READ-ONLY mode for agent ${agentId}`);
  } else {
    readOnlyMode = true;
    logger.debug('[policy] Enabled global READ-ONLY mode');
  }
}

export function disableReadOnlyMode(agentId?: string) {
  if (agentId) {
    readOnlyAgents.delete(agentId);
    logger.debug(`[policy] Disabled READ-ONLY mode for agent ${agentId}`);
  } else {
    readOnlyMode = false;
    readOnlyAgents.clear();
    logger.debug('[policy] Disabled global READ-ONLY mode');
  }
}

export function isReadOnly(agentId?: string): boolean {
  return readOnlyMode || (agentId ? readOnlyAgents.has(agentId) : false);
}

/**
 * Main safety policy for all motor skills
 */
export const safetyPolicy: SkillPolicy = {
  canExecute(context) {
    const { input, agentId } = context;
    const skillId = (context as any).skill?.id;

    // READ-ONLY mode check
    const writeOperations = ['write-file', 'edit-file', 'exec-command'];
    if (writeOperations.includes(skillId || '') && isReadOnly(agentId)) {
      logger.warn(`[policy] Blocked ${skillId} by ${agentId}: READ-ONLY mode active`);
      return {
        allowed: false,
        reason: `Agent is in READ-ONLY exploration mode. Cannot execute write operation: ${skillId}`
      };
    }

    // File write operations
    if (skillId === 'write-file' || skillId === 'edit-file') {
      const filePath = typeof input === 'object' && input && 'path' in input
        ? (input as { path: string }).path
        : '';

      if (!filePath) {
        return { allowed: false, reason: 'File path is required' };
      }

      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);

      if (!isWithinProjectRoot(absolutePath, projectRoot)) {
        logger.warn(`[policy] Blocked ${skillId} by ${agentId}: path outside project root`);
        return {
          allowed: false,
          reason: `Access denied: ${filePath} is outside project root`
        };
      }

      // Block writes to critical files
      const criticalFiles = [
        'package.json',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        '.env',
        '.git/config'
      ];

      const relativePath = path.relative(projectRoot, absolutePath);
      if (criticalFiles.some(critical => relativePath.includes(critical))) {
        logger.warn(`[policy] Blocked ${skillId} by ${agentId}: critical file ${relativePath}`);
        return {
          allowed: false,
          reason: `Cannot modify critical file: ${relativePath}. Manual approval required.`
        };
      }
    }

    // File read operations
    if (skillId === 'read-file') {
      const filePath = typeof input === 'string' ? input : '';

      if (!filePath) {
        return { allowed: false, reason: 'File path is required' };
      }

      const projectRoot = process.cwd();
      const absolutePath = path.isAbsolute(filePath)
        ? filePath
        : path.join(projectRoot, filePath);

      if (!isWithinProjectRoot(absolutePath, projectRoot)) {
        logger.warn(`[policy] Blocked ${skillId} by ${agentId}: path outside project root`);
        return {
          allowed: false,
          reason: `Access denied: ${filePath} is outside project root`
        };
      }
    }

    // Command execution
    if (skillId === 'exec-command') {
      const config = getConfig();
      const command = typeof input === 'string' ? input : '';

      // Check if destructive commands are allowed
      if (!config.safety.allowDestructiveCommands) {
        // Block package installations (require manual approval)
        const installCommands = ['npm install', 'yarn add', 'pnpm add', 'npm i', 'yarn i'];
        if (installCommands.some(cmd => command.toLowerCase().includes(cmd))) {
          logger.warn(`[policy] Blocked ${skillId} by ${agentId}: package installation`);
          return {
            allowed: false,
            reason: 'Package installation requires manual approval. Please run the command yourself.'
          };
        }
      }
    }

    // Web search
    if (skillId === 'web-search') {
      const params = typeof input === 'object' && input && 'query' in input
        ? input as { query: string; maxResults?: number }
        : { query: '', maxResults: 5 };

      if (!params.query || params.query.trim().length === 0) {
        return { allowed: false, reason: 'Search query cannot be empty' };
      }

      // Rate limiting: max 10 results per search
      if (params.maxResults && params.maxResults > 10) {
        logger.warn(`[policy] Limited web-search by ${agentId}: max results capped at 10`);
        // Allow but cap the results
        (params as any).maxResults = 10;
      }
    }

    // Web fetch
    if (skillId === 'web-fetch') {
      const url = typeof input === 'string' ? input : '';

      if (!url || url.trim().length === 0) {
        return { allowed: false, reason: 'URL cannot be empty' };
      }

      // Validate URL format
      try {
        const urlObj = new URL(url);

        // Only allow HTTP/HTTPS
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
          logger.warn(`[policy] Blocked web-fetch by ${agentId}: invalid protocol ${urlObj.protocol}`);
          return {
            allowed: false,
            reason: `Only HTTP and HTTPS protocols are allowed (got ${urlObj.protocol})`
          };
        }

        // Block localhost/internal IPs
        const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
        const hostname = urlObj.hostname.toLowerCase();
        if (blockedHosts.some(blocked => hostname === blocked || hostname.startsWith('192.168.') || hostname.startsWith('10.'))) {
          logger.warn(`[policy] Blocked web-fetch by ${agentId}: internal/localhost URL`);
          return {
            allowed: false,
            reason: 'Cannot fetch from localhost or internal network addresses'
          };
        }
      } catch (error) {
        return { allowed: false, reason: 'Invalid URL format' };
      }
    }

    // Default: allow
    return { allowed: true };
  }
};
