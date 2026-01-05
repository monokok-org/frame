import fs from 'fs';
import path from 'path';
import { SettingsManager } from './settings.js';

export interface FrameConfig {
  llm: {
    baseURL: string;
    model: string;
    embeddingModel: string;
    apiKey?: string;
  };
  safety: {
    maxFileSizeMB: number;
    commandTimeoutMs: number;
    allowDestructiveCommands: boolean;
  };
}

const defaultConfig: FrameConfig = {
  llm: {
    baseURL: 'http://localhost:11434/v1',
    model: 'devstral-small-2:24b',
    embeddingModel: 'nomic-embed-text',
    apiKey: 'x'
  },
  safety: {
    maxFileSizeMB: 10,
    commandTimeoutMs: 30000,
    allowDestructiveCommands: false
  }
};

let config: FrameConfig = { ...defaultConfig };

export function loadConfig(): FrameConfig {
  // Load user settings from ~/.frame/settings.json
  const settings = new SettingsManager();
  const userSettings = settings.get();

  // Apply user settings as base (before env vars)
  config.llm.baseURL = userSettings.ollama.url;
  config.llm.model = userSettings.ollama.model;
  config.llm.embeddingModel = userSettings.ollama.embeddingModel;

  // Override from environment variables (env vars take precedence)
  if (process.env.LLM_BASE_URL) {
    config.llm.baseURL = process.env.LLM_BASE_URL;
  }

  if (process.env.LLM_MODEL) {
    config.llm.model = process.env.LLM_MODEL;
  }

  if (process.env.EMBEDDING_MODEL) {
    config.llm.embeddingModel = process.env.EMBEDDING_MODEL;
  }

  if (process.env.LLM_API_KEY) {
    config.llm.apiKey = process.env.LLM_API_KEY;
  }

  if (process.env.MAX_FILE_SIZE_MB) {
    config.safety.maxFileSizeMB = parseInt(process.env.MAX_FILE_SIZE_MB, 10);
  }

  if (process.env.COMMAND_TIMEOUT_MS) {
    config.safety.commandTimeoutMs = parseInt(process.env.COMMAND_TIMEOUT_MS, 10);
  }

  if (process.env.ALLOW_DESTRUCTIVE_COMMANDS) {
    config.safety.allowDestructiveCommands = process.env.ALLOW_DESTRUCTIVE_COMMANDS === 'true';
  }

  return config;
}

export function getConfig(): FrameConfig {
  return config;
}

export function ensureFrameDirectory(): void {
  const frameDir = path.join(process.cwd(), '.frame');

  if (!fs.existsSync(frameDir)) {
    fs.mkdirSync(frameDir, { recursive: true });
    fs.mkdirSync(path.join(frameDir, 'logs'), { recursive: true });
  }
}
