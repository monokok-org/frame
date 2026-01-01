/**
 * Framebase Client
 *
 * Queries the local Framebase service for up-to-date context frames.
 */

import { logger } from '../utils/logger.js';
import { BUILD_FRAMEBASE_URL } from '../generated/build-config.js';

export interface FramebaseQuery {
  q: string;
  filters?: string[];
  versionRange?: string;
  limit?: number;
}

export interface FramebaseMetadata {
  source?: string;
  version?: string;
  score?: number;
  rank?: number;
  ttlSeconds?: number;
}

export interface FramebaseFrame {
  metadata?: FramebaseMetadata;
  context?: string;
  [key: string]: unknown;
}

export interface FramebaseResponse {
  frames: FramebaseFrame[];
}

export interface FramebaseConfig {
  baseUrl: string;
  timeoutMs: number;
  defaultLimit: number;
  maxFrameChars: number;
  enabled: boolean;
}

const DEFAULT_FRAMEBASE_URL =
  process.env.FRAMEBASE_URL || BUILD_FRAMEBASE_URL || 'http://localhost:8080/query';
const DEFAULT_FRAMEBASE_TIMEOUT_MS = Number.parseInt(process.env.FRAMEBASE_TIMEOUT_MS || '3000', 10);
const DEFAULT_FRAMEBASE_LIMIT = Number.parseInt(process.env.FRAMEBASE_LIMIT || '5', 10);
const DEFAULT_MAX_FRAME_CHARS = Number.parseInt(process.env.FRAMEBASE_MAX_FRAME_CHARS || '3000', 10);
const DEFAULT_FRAMEBASE_ENABLED = process.env.FRAMEBASE_ENABLED
  ? process.env.FRAMEBASE_ENABLED !== 'false'
  : true;

export class FramebaseClient {
  private config: FramebaseConfig;

  constructor(config: Partial<FramebaseConfig> = {}) {
    this.config = {
      baseUrl: config.baseUrl || DEFAULT_FRAMEBASE_URL,
      timeoutMs: config.timeoutMs ?? DEFAULT_FRAMEBASE_TIMEOUT_MS,
      defaultLimit: config.defaultLimit ?? DEFAULT_FRAMEBASE_LIMIT,
      maxFrameChars: config.maxFrameChars ?? DEFAULT_MAX_FRAME_CHARS,
      enabled: config.enabled ?? DEFAULT_FRAMEBASE_ENABLED,
    };
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  get isEnabled(): boolean {
    return Boolean(this.config.baseUrl) && this.config.enabled;
  }

  async query(params: FramebaseQuery): Promise<FramebaseResponse> {
    if (!this.isEnabled) {
      return { frames: [] };
    }

    const limit = params.limit ?? this.config.defaultLimit;
    const payload = {
      q: params.q,
      limit,
      filters: params.filters && params.filters.length > 0 ? params.filters : undefined,
      versionRange: params.versionRange || undefined,
    };

    logger.debug(`[Framebase] Querying "${params.q}" (limit=${limit})`);

    const response = await fetch(this.config.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Framebase failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as FramebaseResponse;
    const frames = Array.isArray(data.frames) ? data.frames : [];

    return {
      frames: frames.slice(0, limit).map((frame) => this.normalizeFrame(frame)),
    };
  }

  private normalizeFrame(frame: FramebaseFrame): FramebaseFrame {
    if (typeof frame?.context === 'string') {
      return {
        ...frame,
        context: this.trimContext(frame.context),
      };
    }
    return { ...frame };
  }

  private trimContext(context: string): string {
    if (context.length <= this.config.maxFrameChars) {
      return context;
    }
    return `${context.slice(0, this.config.maxFrameChars)}...`;
  }
}
