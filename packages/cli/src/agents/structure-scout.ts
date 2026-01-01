/**
 * StructureScout Sub-Agent
 *
 * Lightweight specialist that discovers project structure ONCE per session.
 * Results cached in workspace.db for subsequent turns (eliminates redundant scans).
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';

export interface ProjectStructure {
  projectRoot: string;
  projectType: string;
  framework?: string;
  packageManager?: string;
  directoryTree: DirectoryNode;
  configFiles: string[];
  entryPoints: string[];
  availableScripts: Record<string, string>;
  environment: ProjectEnvironment;
}

export interface ProjectEnvironment {
  testCommand?: string;
  buildCommand?: string;
  lintCommand?: string;
  devCommand?: string;
  formatCommand?: string;
  availableCLIs: string[];
  ciPresent: boolean;
}

export interface DirectoryNode {
  name: string;
  type: 'file' | 'directory';
  children?: DirectoryNode[];
}

export class StructureScout {
  private projectRoot: string;
  private gitignorePatterns: string[] = [];

  constructor(projectRoot?: string) {
    this.projectRoot = projectRoot || process.cwd();
  }

  /**
   * Load and parse .gitignore file
   */
  private async loadGitignore(): Promise<void> {
    try {
      const gitignorePath = path.join(this.projectRoot, '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');

      this.gitignorePatterns = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')) // Remove empty lines and comments
        .map(pattern => {
          // Convert gitignore patterns to simple matching
          // Remove leading slash
          if (pattern.startsWith('/')) {
            pattern = pattern.slice(1);
          }
          return pattern;
        });

      logger.debug(`[StructureScout] Loaded ${this.gitignorePatterns.length} gitignore patterns`);
    } catch (error) {
      // .gitignore doesn't exist or can't be read - that's fine
      logger.debug(`[StructureScout] No .gitignore file found or could not be read`);
    }
  }

  /**
   * Check if a path should be ignored based on .gitignore patterns
   */
  private isIgnored(relativePath: string): boolean {
    if (this.gitignorePatterns.length === 0) return false;

    for (const pattern of this.gitignorePatterns) {
      // Simple pattern matching
      if (pattern.endsWith('/')) {
        // Directory pattern
        const dirPattern = pattern.slice(0, -1);
        if (relativePath === dirPattern || relativePath.startsWith(dirPattern + '/')) {
          return true;
        }
      } else if (pattern.includes('*')) {
        // Wildcard pattern - simple glob matching
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        if (regex.test(relativePath)) {
          return true;
        }
      } else {
        // Exact match or starts with
        if (relativePath === pattern || relativePath.startsWith(pattern + '/')) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Main discovery method
   */
  async discover(opts: {
    maxDepth?: number;
  } = {}): Promise<ProjectStructure> {
    const maxDepth = opts.maxDepth || 3;

    logger.info(`[StructureScout] Discovering project structure (depth: ${maxDepth})`);

    // Load .gitignore first so we can filter during discovery
    await this.loadGitignore();

    const [
      projectType,
      framework,
      packageManager,
      tree,
      configFiles,
      entryPoints,
      scripts
    ] = await Promise.all([
      this.detectProjectType(),
      this.detectFramework(),
      this.detectPackageManager(),
      this.buildDirectoryTree(this.projectRoot, maxDepth),
      this.findConfigFiles(),
      this.findEntryPoints(),
      this.extractScripts()
    ]);

    // Discover environment after we have scripts
    const environment = await this.discoverEnvironment(scripts, packageManager);

    const structure: ProjectStructure = {
      projectRoot: this.projectRoot,
      projectType,
      framework,
      packageManager,
      directoryTree: tree,
      configFiles,
      entryPoints,
      availableScripts: scripts,
      environment
    };

    logger.info(`[StructureScout] Discovered: ${projectType}${framework ? ` (${framework})` : ''}`);
    logger.debug(`[StructureScout] Environment: test=${environment.testCommand}, build=${environment.buildCommand}, lint=${environment.lintCommand}`);
    return structure;
  }

  /**
   * Detect project type by checking marker files
   */
  private async detectProjectType(): Promise<string> {
    try {
      // Check for package.json (JavaScript/TypeScript)
      const pkgPath = path.join(this.projectRoot, 'package.json');
      if (await this.fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

        // Check dependencies for framework
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        if (deps.react) return 'react';
        if (deps.vue) return 'vue';
        if (deps.angular || deps['@angular/core']) return 'angular';
        if (deps.svelte) return 'svelte';
        if (deps.express || deps.fastify || deps.koa) return 'node-backend';

        return 'javascript'; // Generic JS project
      }

      // Check for Python
      if (await this.fileExists(path.join(this.projectRoot, 'requirements.txt')) ||
          await this.fileExists(path.join(this.projectRoot, 'setup.py')) ||
          await this.fileExists(path.join(this.projectRoot, 'pyproject.toml'))) {
        return 'python';
      }

      // Check for Go
      if (await this.fileExists(path.join(this.projectRoot, 'go.mod'))) {
        return 'go';
      }

      // Check for Rust
      if (await this.fileExists(path.join(this.projectRoot, 'Cargo.toml'))) {
        return 'rust';
      }

      // Check for Ruby
      if (await this.fileExists(path.join(this.projectRoot, 'Gemfile'))) {
        return 'ruby';
      }

      return 'unknown';
    } catch (error) {
      logger.warn(`[StructureScout] Error detecting project type: ${error}`);
      return 'unknown';
    }
  }

  /**
   * Detect framework/tooling
   */
  private async detectFramework(): Promise<string | undefined> {
    try {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      if (await this.fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Build tools
        if (deps.vite || await this.fileExists(path.join(this.projectRoot, 'vite.config.ts'))) {
          return 'vite';
        }
        if (deps.next || await this.fileExists(path.join(this.projectRoot, 'next.config.js'))) {
          return 'next';
        }
        if (deps['@remix-run/react']) return 'remix';
        if (deps.astro) return 'astro';
        if (deps.nuxt) return 'nuxt';

        // Metaframeworks
        if (deps['create-react-app'] || pkg.name?.includes('react-app')) return 'cra';
      }

      // Python frameworks
      const reqPath = path.join(this.projectRoot, 'requirements.txt');
      if (await this.fileExists(reqPath)) {
        const reqs = await fs.readFile(reqPath, 'utf-8');
        if (reqs.includes('django')) return 'django';
        if (reqs.includes('flask')) return 'flask';
        if (reqs.includes('fastapi')) return 'fastapi';
      }

      return undefined;
    } catch (error) {
      logger.warn(`[StructureScout] Error detecting framework: ${error}`);
      return undefined;
    }
  }

  /**
   * Detect package manager
   */
  private async detectPackageManager(): Promise<string | undefined> {
    try {
      if (await this.fileExists(path.join(this.projectRoot, 'pnpm-lock.yaml'))) {
        return 'pnpm';
      }
      if (await this.fileExists(path.join(this.projectRoot, 'yarn.lock'))) {
        return 'yarn';
      }
      if (await this.fileExists(path.join(this.projectRoot, 'bun.lockb'))) {
        return 'bun';
      }
      if (await this.fileExists(path.join(this.projectRoot, 'package-lock.json'))) {
        return 'npm';
      }

      // Python
      if (await this.fileExists(path.join(this.projectRoot, 'poetry.lock'))) {
        return 'poetry';
      }
      if (await this.fileExists(path.join(this.projectRoot, 'Pipfile'))) {
        return 'pipenv';
      }

      return undefined;
    } catch (error) {
      logger.warn(`[StructureScout] Error detecting package manager: ${error}`);
      return undefined;
    }
  }

  /**
   * Build directory tree (limited depth to avoid massive scans)
   */
  private async buildDirectoryTree(dirPath: string, maxDepth: number, currentDepth: number = 0): Promise<DirectoryNode> {
    const name = path.basename(dirPath);

    if (currentDepth >= maxDepth) {
      return { name, type: 'directory' };
    }

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      // Filter out noise AND respect .gitignore
      const filtered = entries.filter(entry => {
        // Hardcoded ignores (always exclude these)
        const alwaysIgnore = ['.git', '.DS_Store'];
        if (alwaysIgnore.includes(entry.name)) {
          return false;
        }

        // Check .gitignore
        const relativePath = path.relative(this.projectRoot, path.join(dirPath, entry.name));
        if (this.isIgnored(relativePath)) {
          return false;
        }

        return true;
      });

      const children = await Promise.all(
        filtered.map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);

          if (entry.isDirectory()) {
            return this.buildDirectoryTree(fullPath, maxDepth, currentDepth + 1);
          } else {
            return { name: entry.name, type: 'file' as const };
          }
        })
      );

      return {
        name,
        type: 'directory',
        children: children.sort((a, b) => {
          // Directories first, then files
          if (a.type === 'directory' && b.type === 'file') return -1;
          if (a.type === 'file' && b.type === 'directory') return 1;
          return a.name.localeCompare(b.name);
        })
      };
    } catch (error) {
      logger.warn(`[StructureScout] Error reading directory ${dirPath}: ${error}`);
      return { name, type: 'directory' };
    }
  }

  /**
   * Find configuration files
   */
  private async findConfigFiles(): Promise<string[]> {
    const configPatterns = [
      'package.json',
      'tsconfig.json',
      'vite.config.ts',
      'vite.config.js',
      'next.config.js',
      'tailwind.config.js',
      'tailwind.config.ts',
      'components.json',
      'eslint.config.js',
      '.eslintrc.js',
      'prettier.config.js',
      'requirements.txt',
      'setup.py',
      'pyproject.toml',
      'Cargo.toml',
      'go.mod',
      'Gemfile'
    ];

    const found: string[] = [];

    for (const pattern of configPatterns) {
      const fullPath = path.join(this.projectRoot, pattern);
      if (await this.fileExists(fullPath)) {
        found.push(pattern);
      }
    }

    return found;
  }

  /**
   * Find entry points
   */
  private async findEntryPoints(): Promise<string[]> {
    const entryPatterns = [
      'src/main.tsx',
      'src/main.ts',
      'src/main.jsx',
      'src/main.js',
      'src/index.tsx',
      'src/index.ts',
      'src/index.jsx',
      'src/index.js',
      'src/App.tsx',
      'src/App.ts',
      'src/App.jsx',
      'src/App.js',
      'pages/index.tsx',
      'pages/index.ts',
      'app/page.tsx',
      'app/page.ts',
      'main.py',
      'app.py',
      'main.go',
      'main.rs'
    ];

    const found: string[] = [];

    for (const pattern of entryPatterns) {
      const fullPath = path.join(this.projectRoot, pattern);
      if (await this.fileExists(fullPath)) {
        found.push(pattern);
      }
    }

    return found;
  }

  /**
   * Extract npm/package scripts
   */
  private async extractScripts(): Promise<Record<string, string>> {
    try {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      if (await this.fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        return pkg.scripts || {};
      }

      return {};
    } catch (error) {
      logger.warn(`[StructureScout] Error extracting scripts: ${error}`);
      return {};
    }
  }

  /**
   * Helper: Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discover project environment (commands, CLIs, CI)
   */
  private async discoverEnvironment(
    scripts: Record<string, string>,
    packageManager?: string
  ): Promise<ProjectEnvironment> {
    const pm = packageManager || 'npm';

    return {
      testCommand: this.findCommand(scripts, ['test', 'test:unit', 'test:all'], pm),
      buildCommand: this.findCommand(scripts, ['build', 'compile', 'dist'], pm),
      lintCommand: this.findCommand(scripts, ['lint', 'eslint', 'check'], pm),
      devCommand: this.findCommand(scripts, ['dev', 'start', 'serve', 'develop'], pm),
      formatCommand: this.findCommand(scripts, ['format', 'fmt', 'prettier'], pm),
      availableCLIs: await this.discoverAvailableCLIs(),
      ciPresent: await this.checkCIPresence()
    };
  }

  /**
   * Find command from script names (priority order)
   */
  private findCommand(
    scripts: Record<string, string>,
    names: string[],
    packageManager: string
  ): string | undefined {
    for (const name of names) {
      if (scripts[name]) {
        return `${packageManager} ${packageManager === 'npm' ? 'run' : ''} ${name}`.trim();
      }
    }
    return undefined;
  }

  /**
   * Discover available CLIs from dependencies
   */
  private async discoverAvailableCLIs(): Promise<string[]> {
    try {
      const pkgPath = path.join(this.projectRoot, 'package.json');
      if (await this.fileExists(pkgPath)) {
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Common CLIs to check for
        const commonCLIs = [
          'typescript',
          'eslint',
          'prettier',
          'vite',
          'webpack',
          'rollup',
          'tsc',
          'jest',
          'vitest',
          'playwright',
          'cypress'
        ];

        return commonCLIs.filter(cli => deps[cli] !== undefined);
      }

      // Check for other language CLIs (Python, Go, Rust)
      const clis: string[] = [];

      // Python
      if (await this.fileExists(path.join(this.projectRoot, 'requirements.txt'))) {
        clis.push('pip', 'python');
      }
      if (await this.fileExists(path.join(this.projectRoot, 'poetry.lock'))) {
        clis.push('poetry');
      }

      // Go
      if (await this.fileExists(path.join(this.projectRoot, 'go.mod'))) {
        clis.push('go');
      }

      // Rust
      if (await this.fileExists(path.join(this.projectRoot, 'Cargo.toml'))) {
        clis.push('cargo');
      }

      // Ruby
      if (await this.fileExists(path.join(this.projectRoot, 'Gemfile'))) {
        clis.push('bundle', 'gem');
      }

      return clis;
    } catch (error) {
      logger.warn(`[StructureScout] Error discovering CLIs: ${error}`);
      return [];
    }
  }

  /**
   * Check if CI is present
   */
  private async checkCIPresence(): Promise<boolean> {
    const ciFiles = [
      '.github/workflows',
      '.gitlab-ci.yml',
      '.circleci/config.yml',
      'azure-pipelines.yml',
      '.travis.yml',
      'Jenkinsfile'
    ];

    for (const ciFile of ciFiles) {
      if (await this.fileExists(path.join(this.projectRoot, ciFile))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Serialize tree to compact string
   */
  static serializeTree(node: DirectoryNode, indent: string = ''): string {
    const lines: string[] = [];

    if (node.type === 'directory') {
      lines.push(`${indent}${node.name}/`);

      if (node.children) {
        for (const child of node.children) {
          lines.push(StructureScout.serializeTree(child, indent + '  '));
        }
      }
    } else {
      lines.push(`${indent}${node.name}`);
    }

    return lines.join('\n');
  }
}
