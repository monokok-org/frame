/**
 * Ollama LLM Client
 *
 * Singleton wrapper for the unified LLM client.
 */

import { UnifiedLLMClient } from './unified-client.js';
import { getConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

let client: UnifiedLLMClient | null = null;

export function getOllamaClient(): UnifiedLLMClient {
  if (client) {
    return client;
  }

  const config = getConfig();

  logger.info(`Initializing unified LLM client: ${config.llm.baseURL}`);
  logger.info(`Models: ${config.llm.model} (completion), ${config.llm.embeddingModel} (embedding)`);

  client = new UnifiedLLMClient({
    baseURL: config.llm.baseURL,
    apiKey: config.llm.apiKey || 'x',
    model: config.llm.model,
    embeddingModel: config.llm.embeddingModel
  });

  return client;
}
