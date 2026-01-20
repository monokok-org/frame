
import * as ts from 'typescript';
import fs from 'fs';
import path from 'path';
import { getProjectRoot } from '../utils/config.js';

/**
 * Singleton service to handle Language Server logic.
 * Currently supports TypeScript/JavaScript via the official TypeScript Compiler API.
 */
export class LanguageServer {
    private static instance: LanguageServer;
    private service: ts.LanguageService | undefined;
    private files: Map<string, { version: number; content: string }> = new Map();
    private rootDir: string;
    private compilerOptions: ts.CompilerOptions;

    private constructor() {
        this.rootDir = getProjectRoot();
        this.compilerOptions = this.loadConfig();
        this.initService();
    }

    public static getInstance(): LanguageServer {
        if (!LanguageServer.instance) {
            LanguageServer.instance = new LanguageServer();
        }
        return LanguageServer.instance;
    }

    private loadConfig(): ts.CompilerOptions {
        const configPath = ts.findConfigFile(
            this.rootDir,
            ts.sys.fileExists,
            'tsconfig.json'
        );

        if (!configPath) {
            return ts.getDefaultCompilerOptions();
        }

        const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
        const parsedConfig = ts.parseJsonConfigFileContent(
            configFile.config,
            ts.sys,
            path.dirname(configPath)
        );

        return parsedConfig.options;
    }

    private initService() {
        const servicesHost: ts.LanguageServiceHost = {
            getScriptFileNames: () => {
                // We only really care about the files we are actively validating or referencing
                // But for a full project view, we might want to include all files. 
                // For performance in this agent context, we'll start with just the root files
                // and let TS resolve imports.
                // Improve: parse parsedConfig.fileNames if needed.
                return Array.from(this.files.keys());
            },
            getScriptVersion: (fileName) => {
                return this.files.get(fileName)?.version.toString() || '0';
            },
            getScriptSnapshot: (fileName) => {
                // If we have an override in memory (the file being edited), use it
                if (this.files.has(fileName)) {
                    return ts.ScriptSnapshot.fromString(this.files.get(fileName)!.content);
                }

                // Otherwise read from disk
                if (fs.existsSync(fileName)) {
                    return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, 'utf8'));
                }

                return undefined;
            },
            getCurrentDirectory: () => this.rootDir,
            getCompilationSettings: () => this.compilerOptions,
            getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
            fileExists: ts.sys.fileExists,
            readFile: ts.sys.readFile,
            readDirectory: ts.sys.readDirectory,
            directoryExists: ts.sys.directoryExists,
            getDirectories: ts.sys.getDirectories,
        };

        // Create the language service files
        this.service = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());
    }

    /**
     * Validate a file with new content.
     * Returns a list of diagnostic strings (syntax + semantic).
     */
    public validatets(filePath: string, content: string): string[] {
        if (!this.service) return [];

        // Normalize path
        const absPath = path.isAbsolute(filePath) ? filePath : path.join(this.rootDir, filePath);

        // Update our virtual file validation
        const currentVersion = this.files.get(absPath)?.version || 0;
        this.files.set(absPath, { version: currentVersion + 1, content });

        // Force the service to recognize the file if it wasn't there before
        // (The host implementation reads from this.files)

        try {
            // 1. Syntactic Diagnostics (Parse errors)
            const syntactic = this.service.getSyntacticDiagnostics(absPath);
            if (syntactic.length > 0) {
                return syntactic.map(d => this.formatDiagnostic(d));
            }

            // 2. Semantic Diagnostics (Type errors)
            const semantic = this.service.getSemanticDiagnostics(absPath);
            if (semantic.length > 0) {
                return semantic.map(d => this.formatDiagnostic(d));
            }

            return [];
        } catch (e) {
            // Fallback or error logging
            return [`Language Server Error: ${e instanceof Error ? e.message : String(e)}`];
        }
    }

    private formatDiagnostic(diagnostic: ts.Diagnostic): string {
        if (diagnostic.file) {
            const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start!);
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
            return `Line ${line + 1}:${character + 1}: ${message}`;
        }
        return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    }
}
