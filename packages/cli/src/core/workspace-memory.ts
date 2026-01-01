/**
 * Workspace Memory
 *
 * Tracks workspace state across multiple turns to enable multi-turn conversations.
 * Stores information about recent commands, project creations, and working directory.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';
import { WorkspaceDB } from '../db/workspace-db.js';

export interface ProjectInfo {
  path: string;
  type: string; // 'react', 'vite', 'node', 'next', etc.
  framework?: string; // 'shadcn', 'tailwind', etc.
  timestamp: number;
}

export interface CommandRecord {
  cmd: string;
  exitCode: number;
  timestamp: number;
  output?: string; // Store last 500 chars of output
}

export interface WorkspaceMemory {
  currentDirectory: string;
  lastProjectCreated?: ProjectInfo;
  recentCommands: CommandRecord[];
  recentFiles: string[]; // Recently created/modified files
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
}

const MEMORY_FILE = '.frame/workspace-memory.json';
const MAX_COMMANDS = 10; // Keep last 10 commands
const MAX_FILES = 20; // Keep last 20 files

export class WorkspaceMemoryManager {
  private memory: WorkspaceMemory;
  private memoryPath: string;
  public workspaceDB: WorkspaceDB;

  constructor() {
    this.memoryPath = path.join(process.cwd(), MEMORY_FILE);
    this.memory = this.load();

    // Initialize WorkspaceDB for project context storage
    this.workspaceDB = new WorkspaceDB();
    logger.debug('[WorkspaceMemory] Initialized WorkspaceDB');
  }

  /**
   * Load workspace memory from disk
   */
  private load(): WorkspaceMemory {
    try {
      if (fs.existsSync(this.memoryPath)) {
        const data = fs.readFileSync(this.memoryPath, 'utf-8');
        const loaded = JSON.parse(data) as WorkspaceMemory;
        logger.debug('Loaded workspace memory from disk');
        return loaded;
      }
    } catch (error) {
      logger.warn(`Failed to load workspace memory: ${error}`);
    }

    // Return default memory
    return {
      currentDirectory: process.cwd(),
      recentCommands: [],
      recentFiles: []
    };
  }

  /**
   * Save workspace memory to disk
   */
  private save(): void {
    try {
      const dir = path.dirname(this.memoryPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        this.memoryPath,
        JSON.stringify(this.memory, null, 2),
        'utf-8'
      );
      logger.debug('Saved workspace memory to disk');
    } catch (error) {
      logger.error(`Failed to save workspace memory: ${error}`);
    }
  }

  /**
   * Get current workspace memory
   */
  get(): WorkspaceMemory {
    return this.memory;
  }

  /**
   * Record a command execution
   */
  recordCommand(cmd: string, exitCode: number, output?: string): void {
    const record: CommandRecord = {
      cmd,
      exitCode,
      timestamp: Date.now(),
      output: output ? output.slice(-500) : undefined
    };

    this.memory.recentCommands.unshift(record);
    this.memory.recentCommands = this.memory.recentCommands.slice(0, MAX_COMMANDS);

    // Detect package manager from command
    if (cmd.startsWith('npm ')) {
      this.memory.packageManager = 'npm';
    } else if (cmd.startsWith('pnpm ')) {
      this.memory.packageManager = 'pnpm';
    } else if (cmd.startsWith('yarn ')) {
      this.memory.packageManager = 'yarn';
    } else if (cmd.startsWith('bun ')) {
      this.memory.packageManager = 'bun';
    }

    // Detect project creation from command
    this.detectProjectCreation(cmd, exitCode);

    this.save();
  }

  /**
   * Detect if a command created a project
   */
  private detectProjectCreation(cmd: string, exitCode: number): void {
    if (exitCode !== 0) return; // Only track successful commands

    // npm create vite@latest my-app
    if (cmd.includes('npm create vite') || cmd.includes('npm init vite')) {
      const match = cmd.match(/(?:create|init)\s+vite(?:@latest)?\s+(\S+)/);
      if (match) {
        const projectName = match[1].replace(/^--/, ''); // Remove -- flags
        this.memory.lastProjectCreated = {
          path: path.join(process.cwd(), projectName),
          type: 'vite',
          framework: 'react', // Default assumption
          timestamp: Date.now()
        };
      }
    }

    // npx create-react-app my-app
    if (cmd.includes('create-react-app')) {
      const match = cmd.match(/create-react-app\s+(\S+)/);
      if (match) {
        const projectName = match[1];
        this.memory.lastProjectCreated = {
          path: path.join(process.cwd(), projectName),
          type: 'react',
          framework: 'cra',
          timestamp: Date.now()
        };
      }
    }

    // npx create-next-app my-app
    if (cmd.includes('create-next-app')) {
      const match = cmd.match(/create-next-app\s+(\S+)/);
      if (match) {
        const projectName = match[1];
        this.memory.lastProjectCreated = {
          path: path.join(process.cwd(), projectName),
          type: 'next',
          framework: 'nextjs',
          timestamp: Date.now()
        };
      }
    }

    // npm init / pnpm init
    if (cmd.match(/^(npm|pnpm|yarn|bun)\s+init/)) {
      this.memory.lastProjectCreated = {
        path: process.cwd(),
        type: 'node',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Record a file creation/modification
   */
  recordFile(filePath: string): void {
    // Store relative path
    const relativePath = path.relative(process.cwd(), filePath);

    // Add to front, remove duplicates, keep max files
    this.memory.recentFiles = [
      relativePath,
      ...this.memory.recentFiles.filter(f => f !== relativePath)
    ].slice(0, MAX_FILES);

    this.save();
  }

  /**
   * Update last project created (for manual tracking)
   */
  setLastProject(projectPath: string, type: string, framework?: string): void {
    this.memory.lastProjectCreated = {
      path: projectPath,
      type,
      framework,
      timestamp: Date.now()
    };
    this.save();
  }

  /**
   * Get formatted context string for agent prompts
   */
  getContextString(): string {
    const lines: string[] = [];

    // Recent project
    if (this.memory.lastProjectCreated) {
      const project = this.memory.lastProjectCreated;
      const age = Date.now() - project.timestamp;
      const isRecent = age < 5 * 60 * 1000; // 5 minutes

      if (isRecent) {
        lines.push(`Last project created: ${project.type} at ${project.path}`);
        if (project.framework) {
          lines.push(`  Framework: ${project.framework}`);
        }
      }
    }

    // Recent successful commands
    const successfulCommands = this.memory.recentCommands
      .filter(c => c.exitCode === 0)
      .slice(0, 3);

    if (successfulCommands.length > 0) {
      lines.push('Recent successful commands:');
      successfulCommands.forEach(c => {
        lines.push(`  - ${c.cmd}`);
      });
    }

    // Recent failed commands
    const failedCommands = this.memory.recentCommands
      .filter(c => c.exitCode !== 0)
      .slice(0, 2);

    if (failedCommands.length > 0) {
      lines.push('Recent failed commands:');
      failedCommands.forEach(c => {
        lines.push(`  - ${c.cmd} (exit code: ${c.exitCode})`);
      });
    }

    // Package manager
    if (this.memory.packageManager) {
      lines.push(`Package manager: ${this.memory.packageManager}`);
    }

    // Recent files
    if (this.memory.recentFiles.length > 0) {
      lines.push(`Recently modified files: ${this.memory.recentFiles.slice(0, 5).join(', ')}`);
    }

    return lines.length > 0
      ? `\n## Workspace Context\n${lines.join('\n')}\n`
      : '';
  }

  /**
   * Clear workspace memory
   */
  clear(): void {
    this.memory = {
      currentDirectory: process.cwd(),
      recentCommands: [],
      recentFiles: []
    };
    this.save();
  }
}
