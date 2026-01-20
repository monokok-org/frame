/**
 * Configuration Manager
 * 
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface FrameConfig {
  llm: {
    baseUrl: string;
    model: string;
  };
  safety: {
    maxFileSizeMB: number;
    commandTimeoutMs: number;
    blockedCommands: string[];
  };
  paths: {
    homeDir: string;
    frameDir: string;
    projectRoot: string;
  };
}

interface SettingsFile {
  ollama?: {
    url?: string;
    model?: string;
  };
  safety?: {
    maxFileSizeMB?: number;
    commandTimeoutMs?: number;
    blockedCommands?: string[];
  };
}

// ============================================================================
// Defaults
// ============================================================================

const DEFAULTS: Omit<FrameConfig, 'paths'> = {
  llm: {
    baseUrl: 'http://localhost:11434',
    model: 'devstral-small-2:24b'
  },
  safety: {
    maxFileSizeMB: 10,
    commandTimeoutMs: 30000,
    blockedCommands: ['rm -rf /', 'mkfs', 'dd if=']
  }
};

// ============================================================================
// Singleton Config
// ============================================================================

let config: FrameConfig | null = null;
let projectRoot: string | null = null;

/**
 * Set the project root directory
 * Called once at startup before any tools run
 */
export function setProjectRoot(root: string): void {
  projectRoot = path.resolve(root);
}

/**
 * Get the project root directory
 */
export function getProjectRoot(): string {
  if (!projectRoot) {
    // Fallback to cwd if not explicitly set
    projectRoot = process.cwd();
  }
  return projectRoot;
}

/**
 * Get Frame home directory (~/.frame)
 */
export function getFrameDir(): string {
  return path.join(os.homedir(), '.frame');
}

/**
 * Ensure Frame directories exist
 */
export function ensureFrameDirs(): void {
  const frameDir = getFrameDir();
  const dirs = [
    frameDir,
    path.join(frameDir, 'cache'),
    path.join(frameDir, 'logs')
  ];
  
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Load settings from file
 */
function loadSettingsFile(filePath: string): SettingsFile | null {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore parse errors
  }
  return null;
}

/**
 * Load configuration
 * Priority: project .frame/config.json > ~/.frame/settings.json > defaults
 */
export function loadConfig(): FrameConfig {
  if (config) return config;
  
  const homeDir = os.homedir();
  const frameDir = getFrameDir();
  const root = getProjectRoot();
  
  // Ensure directories exist
  ensureFrameDirs();
  
  // Start with defaults
  config = {
    ...DEFAULTS,
    llm: { ...DEFAULTS.llm },
    safety: { ...DEFAULTS.safety },
    paths: {
      homeDir,
      frameDir,
      projectRoot: root
    }
  };
  
  // Load user settings (~/.frame/settings.json)
  const userSettings = loadSettingsFile(path.join(frameDir, 'settings.json'));
  if (userSettings) {
    if (userSettings.ollama?.url) {
      config.llm.baseUrl = userSettings.ollama.url;
    }
    if (userSettings.ollama?.model) {
      config.llm.model = userSettings.ollama.model;
    }
    if (userSettings.safety?.maxFileSizeMB) {
      config.safety.maxFileSizeMB = userSettings.safety.maxFileSizeMB;
    }
    if (userSettings.safety?.commandTimeoutMs) {
      config.safety.commandTimeoutMs = userSettings.safety.commandTimeoutMs;
    }
  }
  
  // Load project config (.frame/config.json) - overrides user settings
  const projectConfig = loadSettingsFile(path.join(root, '.frame', 'config.json'));
  if (projectConfig) {
    if (projectConfig.ollama?.url) {
      config.llm.baseUrl = projectConfig.ollama.url;
    }
    if (projectConfig.ollama?.model) {
      config.llm.model = projectConfig.ollama.model;
    }
  }
  
  return config;
}

/**
 * Get current config (loads if not already loaded)
 */
export function getConfig(): FrameConfig {
  if (!config) {
    loadConfig();
  }
  return config!;
}

/**
 * Reset config (for testing)
 */
export function resetConfig(): void {
  config = null;
  projectRoot = null;
}

/**
 * Save user settings to ~/.frame/settings.json
 */
export function saveUserSettings(settings: Partial<SettingsFile>): void {
  const frameDir = getFrameDir();
  const settingsPath = path.join(frameDir, 'settings.json');
  
  let current: SettingsFile = {};
  try {
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch {
    // Start fresh
  }
  
  const merged = {
    ...current,
    ...settings,
    ollama: { ...current.ollama, ...settings.ollama },
    safety: { ...current.safety, ...settings.safety }
  };
  
  ensureFrameDirs();
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf8');
  
  // Reload config
  resetConfig();
}
