import path from 'path';
import fs from 'fs';
import { glob } from 'glob';
import { logger } from './logger.js';
import { getFileType } from './file-utils.js';
import { getErrorMessage } from './error-utils.js';
import { getOllamaClient } from '../llm/index.js';
import { PlatformDetector } from '../agents/platform-detector.js';
import { DependencyExtractor } from '../agents/dependency-extractor.js';
import type { DependencyExtractionResult } from '../agents/dependency-extractor.js';

export interface DependencyInfo {
  name: string;
  version: string;
  type: 'dependency' | 'devDependency';
}

export interface FrameworkInfo {
  name: string;
  type: string;
}

export interface ProjectInfo {
  rootDir: string;
  dependencies: DependencyInfo[];
  frameworks: FrameworkInfo[];
  languages: Set<string>;
  entryPoints: string[];
}

const EXCLUDE_PATTERNS = [
  'node_modules/**',
  'dist/**',
  'build/**',
  '.git/**',
  '.frame/**',
  'coverage/**',
  '**/*.test.ts',
  '**/*.test.js'
];

export class ProjectAnalyzer {
  private rootDir: string;

  constructor(rootDir: string = process.cwd()) {
    this.rootDir = rootDir;
  }

  async analyzeProject(): Promise<ProjectInfo> {
    logger.debug(`Analyzing project at ${this.rootDir}`);

    const dependencies = await this.analyzeDependencies();
    const frameworks = this.detectFrameworks(dependencies);
    const languages = await this.detectLanguages();
    const entryPoints = this.findEntryPoints();

    logger.debug(`Project analysis complete: ${languages.size} languages, ${dependencies.length} dependencies, ${frameworks.length} frameworks`);

    return {
      rootDir: this.rootDir,
      dependencies,
      frameworks,
      languages,
      entryPoints
    };
  }

  private async detectLanguages(): Promise<Set<string>> {
    const languages = new Set<string>();

    const files = await glob(['**/*.{js,jsx,ts,tsx,py,rb,php,java,go,rs,c,cpp,h,cs}'], {
      cwd: this.rootDir,
      ignore: EXCLUDE_PATTERNS,
      nodir: true
    });

    files.forEach(file => {
      const type = getFileType(file);
      if (type !== 'other') {
        languages.add(type);
      }
    });

    return languages;
  }

  private async analyzeDependencies(): Promise<DependencyInfo[]> {
    const dependencies: DependencyInfo[] = [];
    let llm;

    try {
      llm = getOllamaClient();
    } catch (error) {
      logger.warn(`LLM unavailable for dependency analysis: ${getErrorMessage(error)}`);
      return dependencies;
    }

    const detector = new PlatformDetector(llm);
    const extractor = new DependencyExtractor(llm);

    let detection;
    try {
      detection = await detector.detect(this.rootDir);
    } catch (error) {
      logger.warn(`Platform detection failed: ${getErrorMessage(error)}`);
      return dependencies;
    }

    const manifestPatterns = Object.values(detection.dependencyFiles || {}).flat();
    const manifestPaths = await this.resolveManifestPaths(manifestPatterns);

    if (manifestPaths.length === 0) {
      logger.debug('No dependency manifests found during analysis');
      return dependencies;
    }

    const results = await Promise.all(
      manifestPaths.map(async (manifestPath) => ({
        manifestPath,
        result: await extractor.extract(manifestPath)
      }))
    );

    const merged = this.mergeDependencies(results.map(({ result }) => result));
    dependencies.push(...merged);

    return dependencies;
  }

  private async resolveManifestPaths(manifestPatterns: string[]): Promise<string[]> {
    const unique = new Set<string>();

    for (const pattern of manifestPatterns) {
      if (!pattern || typeof pattern !== 'string') {
        continue;
      }

      if (this.isGlobPattern(pattern)) {
        const matches = await glob(pattern, {
          cwd: this.rootDir,
          ignore: EXCLUDE_PATTERNS,
          nodir: true
        });
        matches.forEach((match) => unique.add(path.join(this.rootDir, match)));
        continue;
      }

      const candidate = path.isAbsolute(pattern) ? pattern : path.join(this.rootDir, pattern);
      if (fs.existsSync(candidate)) {
        unique.add(candidate);
      }
    }

    return Array.from(unique);
  }

  private mergeDependencies(results: DependencyExtractionResult[]): DependencyInfo[] {
    const merged = new Map<string, DependencyInfo>();

    for (const result of results) {
      for (const dep of result.dependencies) {
        const key = dep.name.toLowerCase();
        const existing = merged.get(key);
        if (existing) {
          const version = existing.version !== 'unknown' ? existing.version : dep.version ?? 'unknown';
          const type = this.preferDependency(existing.type, dep.type);
          merged.set(key, { name: existing.name, version, type });
          continue;
        }

        merged.set(key, {
          name: dep.name,
          version: dep.version ?? 'unknown',
          type: dep.type
        });
      }
    }

    return Array.from(merged.values());
  }

  private preferDependency(
    current: 'dependency' | 'devDependency',
    incoming: 'dependency' | 'devDependency'
  ): 'dependency' | 'devDependency' {
    if (current === 'dependency' || incoming === 'dependency') {
      return 'dependency';
    }
    return 'devDependency';
  }

  private isGlobPattern(value: string): boolean {
    return /[*?[\]]/.test(value);
  }

  detectFrameworks(dependencies: DependencyInfo[]): FrameworkInfo[] {
    const frameworks: FrameworkInfo[] = [];
    const frameworkMap: Record<string, string> = {
      'react': 'frontend',
      'vue': 'frontend',
      'angular': 'frontend',
      'svelte': 'frontend',
      'next': 'fullstack',
      'nuxt': 'fullstack',
      'remix': 'fullstack',
      'express': 'backend',
      'nestjs': 'backend',
      'fastify': 'backend',
      'koa': 'backend',
      'electron': 'desktop',
      'react-native': 'mobile',
      'expo': 'mobile'
    };

    dependencies.forEach(dep => {
      const depName = dep.name.toLowerCase();

      Object.entries(frameworkMap).forEach(([framework, type]) => {
        if (depName === framework || depName.startsWith(`${framework}/`) || depName.startsWith(`@${framework}/`)) {
          if (!frameworks.some(f => f.name === framework)) {
            frameworks.push({ name: framework, type });
          }
        }
      });
    });

    return frameworks;
  }

  private findEntryPoints(): string[] {
    const entryPoints: string[] = [];
    const potentialEntryPoints = [
      'index.ts', 'index.js', 'main.ts', 'main.js', 'app.ts', 'app.js',
      'server.ts', 'server.js', 'src/index.ts', 'src/index.js',
      'src/main.ts', 'src/main.js', 'src/app.ts', 'src/app.js'
    ];

    potentialEntryPoints.forEach(entryPoint => {
      const fullPath = path.join(this.rootDir, entryPoint);
      if (fs.existsSync(fullPath)) {
        entryPoints.push(entryPoint);
      }
    });

    return entryPoints;
  }
}
