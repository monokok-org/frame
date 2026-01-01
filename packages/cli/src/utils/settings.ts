/**
 * User settings manager
 * Persists settings to ~/.frame/settings.json
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

export interface UserSettings {
  ollama: {
    url: string;
    model: string;
    embeddingModel: string;
  };
  ui: {
    theme: 'default' | 'minimal';
    showAgentDetails: boolean;
  };
}

const DEFAULT_SETTINGS: UserSettings = {
  ollama: {
    url: 'http://localhost:11434/v1',
    model: 'devstral-small-2:24b',
    embeddingModel: 'nomic-embed-text'
  },
  ui: {
    theme: 'default',
    showAgentDetails: true
  }
};

export class SettingsManager {
  private settingsPath: string;
  private settings: UserSettings;
  private firstRun = false;

  constructor() {
    const homeDir = os.homedir();
    const frameDir = path.join(homeDir, '.frame');

    // Ensure directory exists
    if (!fs.existsSync(frameDir)) {
      fs.mkdirSync(frameDir, { recursive: true });
    }

    this.settingsPath = path.join(frameDir, 'settings.json');
    this.settings = this.load();
  }

  /**
   * Load settings from disk
   */
  private load(): UserSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = fs.readFileSync(this.settingsPath, 'utf8');
        const loaded = JSON.parse(data);
        // Merge with defaults to handle missing fields
        return {
          ...DEFAULT_SETTINGS,
          ...loaded,
          ollama: { ...DEFAULT_SETTINGS.ollama, ...loaded.ollama },
          ui: { ...DEFAULT_SETTINGS.ui, ...loaded.ui }
        };
      } else {
        // Create settings file with defaults on first run
        this.firstRun = true;
        const defaults = { ...DEFAULT_SETTINGS };
        fs.writeFileSync(
          this.settingsPath,
          JSON.stringify(defaults, null, 2),
          'utf8'
        );
        return defaults;
      }
    } catch (error) {
      logger.error(`Failed to load settings: ${error}`);
    }
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * Save settings to disk
   */
  save(): void {
    try {
      fs.writeFileSync(
        this.settingsPath,
        JSON.stringify(this.settings, null, 2),
        'utf8'
      );
    } catch (error) {
      logger.error(`Failed to save settings: ${error}`);
    }
  }

  /**
   * Get current settings
   */
  get(): UserSettings {
    return { ...this.settings };
  }

  /**
   * Reload settings from disk
   */
  reload(): void {
    this.settings = this.load();
  }

  /**
   * Return true if settings were created on this run
   */
  isFirstRun(): boolean {
    return this.firstRun;
  }

  /**
   * Get settings file path
   */
  getPath(): string {
    return this.settingsPath;
  }

  /**
   * Update settings
   */
  update(partial: Partial<UserSettings>): void {
    this.settings = {
      ...this.settings,
      ...partial,
      ollama: { ...this.settings.ollama, ...(partial.ollama || {}) },
      ui: { ...this.settings.ui, ...(partial.ui || {}) }
    };
    this.save();
  }

  /**
   * Update Ollama settings
   */
  updateOllama(ollama: Partial<UserSettings['ollama']>): void {
    this.settings.ollama = {
      ...this.settings.ollama,
      ...ollama
    };
    this.save();
  }

  /**
   * Reset to defaults
   */
  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
  }
}
