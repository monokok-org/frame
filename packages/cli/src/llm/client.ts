/**
 * LLM Client Factory
 */

import type { LLMClient } from './types.js';
import { getConfig } from '../utils/config.js';
import { OllamaClient } from './ollama.client.js';

export { OllamaClient } from './ollama.client.js';

/**
 * Create LLM client from config
 */
export function createClient(): LLMClient {
  const cfg = getConfig();

  return new OllamaClient({
    baseUrl: cfg.llm.baseUrl,
    model: cfg.llm.model
  });
}
