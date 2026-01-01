/**
 * Motor Skills Index
 *
 * Simplified, language-agnostic motor skills.
 * Tools provide raw capabilities. Models provide intelligence.
 */

export * from './filesystem.js';
export * from './search.js';
export * from './executor.js';
export * from './web.js';
export * from './knowledge.js';
export * from './planning.js';
export * from './explore-agent.js';
export * from './agent-tools.js';
export * from './policies.js';
export * from './tool-capabilities.js';

import { filesystemSkills } from './filesystem.js';
import { searchSkills } from './search.js';
import { executorSkills } from './executor.js';
import { webSkills } from './web.js';
import { knowledgeQuerySkill } from './knowledge.js';
import { planningSkills } from './planning.js';
import { exploreAgent } from './explore-agent.js';
import { agentTools } from './agent-tools.js';

/**
 * Core Skills (19 total):
 *
 * Filesystem (6): read-file, write-file, edit-file, list-dir, get-cwd, path-exists
 * Search (2): glob, grep
 * Explore (1): explore-agent
 * Agent Tools (4): structure-scout, platform-detector, dependency-checker, error-researcher
 * Execution (2): ask-user-question, exec-command
 * Web (2): web-fetch, web-search
 * Knowledge (1): knowledge-query
 * Planning (1): plan-task
 */
export const allSkills = [
  ...filesystemSkills,
  ...searchSkills,
  ...executorSkills,
  ...webSkills,
  ...planningSkills,
  knowledgeQuerySkill,
  exploreAgent,
  ...agentTools
];
