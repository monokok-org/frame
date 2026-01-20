/**
 * Framebase Client
 *
 */

import { logger } from '../../utils/logger.js';

export interface FramebaseQuery {
    q: string;
    filters?: string[];
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
    content?: string;
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

const DEFAULT_FRAMEBASE_URL = process.env.FRAMEBASE_URL || 'https://q.framebase.dev/query';
const DEFAULT_FRAMEBASE_TIMEOUT_MS = Number.parseInt(process.env.FRAMEBASE_TIMEOUT_MS || '3000', 10);
const DEFAULT_FRAMEBASE_LIMIT = Number.parseInt(process.env.FRAMEBASE_LIMIT || '10', 10);
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
        };

        logger.debug(
            `[Framebase] POST ${this.config.baseUrl} q="${params.q}" limit=${limit}` +
            `${payload.filters ? ` filters=${JSON.stringify(payload.filters)}` : ''}`
        );

        try {
            const response = await fetch(this.config.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(this.config.timeoutMs),
            });

            if (!response.ok) {
                let responseBody = '';
                try {
                    responseBody = await response.text();
                } catch {
                    responseBody = '';
                }
                const preview = responseBody ? responseBody.slice(0, 400).replace(/\s+/g, ' ').trim() : '';
                logger.warn(
                    `[Framebase] Response ${response.status} ${response.statusText}` +
                    `${preview ? ` body="${preview}"` : ''}`
                );
                // Fallback to empty if it fails? Or throw? 
                // Logic says "do not fallback or do not use heuristics", so maybe throw or return empty but with error log.
                // I will throw to let the tool handle it.
                throw new Error(`Framebase failed: ${response.status} ${response.statusText}`);
            }

            const data = (await response.json()) as FramebaseResponse;
            const frames = Array.isArray(data.frames) ? data.frames : [];

            logger.debug(`[Framebase] Response ok frames=${frames.length}`);

            return {
                frames: frames.slice(0, limit).map((frame) => this.normalizeFrame(frame)),
            };
        } catch (error) {
            logger.error('[Framebase] Query failed', error);
            // Depending on strictness, we might want to propagate this
            throw error;
        }
    }

    private normalizeFrame(frame: FramebaseFrame): FramebaseFrame {
        if (typeof frame?.context === 'string') {
            return {
                ...frame,
                context: this.trimContext(frame.context),
            };
        }
        if (typeof frame?.content === 'string') {
            return {
                ...frame,
                context: this.trimContext(frame.content),
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
