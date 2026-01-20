/**
 * Command helpers
 */

import type { Cmd, BatchCmd, QuitMsg, TickMsg } from './types.js';

/**
 * Create a batch command that runs multiple commands
 */
export function batch<Msg>(...cmds: Cmd<Msg>[]): BatchCmd<Msg> {
  return {
    type: 'batch',
    cmds
  };
}

/**
 * Quit command - returns a quit message
 */
export function quit<Msg extends QuitMsg>(): Cmd<Msg> {
  return async () => ({ type: 'quit' } as Msg);
}

/**
 * Tick command - executes after a delay
 */
export function tick<Msg>(delayMs: number, msg: Msg): Cmd<Msg> {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return msg;
  };
}

/**
 * Animation tick - for smoother animations with timestamp
 */
export function animationTick<Msg extends TickMsg>(intervalMs: number = 50): Cmd<Msg> {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    return { type: 'tick', time: Date.now() } as Msg;
  };
}

/**
 * Every - creates a recurring tick command at specified interval
 */
export function every<Msg>(intervalMs: number, msgFactory: () => Msg): Cmd<Msg> {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    return msgFactory();
  };
}

/**
 * Sequence commands - run commands one after another
 */
export function sequence<Msg>(...cmds: Cmd<Msg>[]): Cmd<Msg> {
  return async () => {
    for (const cmd of cmds) {
      const result = await cmd();
      if (result) return result;
    }
    return null;
  };
}

/**
 * Race - return first command that produces a result
 */
export function race<Msg>(...cmds: Cmd<Msg>[]): Cmd<Msg> {
  return async () => {
    const results = await Promise.race(
      cmds.map(async (cmd) => {
        const result = await cmd();
        if (result !== null) return result;
        return new Promise<never>(() => {});
      })
    );
    return results;
  };
}

/**
 * Delay - pause before returning a message
 */
export function delay<Msg>(ms: number, msg: Msg): Cmd<Msg> {
  return async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
    return msg;
  };
}

/**
 * Debounce - wait for quiet period before executing
 */
let debounceTimers = new Map<string, NodeJS.Timeout>();

export function debounce<Msg>(key: string, delayMs: number, cmd: Cmd<Msg>): Cmd<Msg> {
  return async () => {
    const existing = debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(async () => {
        debounceTimers.delete(key);
        const result = await cmd();
        resolve(result);
      }, delayMs);
      debounceTimers.set(key, timer);
    });
  };
}

/**
 * Retry - retry a command on failure
 */
export function retry<Msg>(
  cmd: Cmd<Msg>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    onError?: (error: unknown, attempt: number) => Msg | null;
  } = {}
): Cmd<Msg> {
  const { maxAttempts = 3, delayMs = 1000, onError } = options;

  return async () => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await cmd();
        return result;
      } catch (error) {
        lastError = error;
        if (onError) {
          const errorMsg = onError(error, attempt);
          if (errorMsg) return errorMsg;
        }
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError;
  };
}

/**
 * No-op command
 */
export function none<Msg>(): Cmd<Msg> {
  return async () => null;
}

/**
 * Map - transform the result of a command
 */
export function map<MsgA, MsgB>(cmd: Cmd<MsgA>, fn: (msg: MsgA) => MsgB): Cmd<MsgB> {
  return async () => {
    const result = await cmd();
    if (result === null) return null;
    return fn(result);
  };
}

/**
 * Filter - only pass through messages that match predicate
 */
export function filter<Msg>(cmd: Cmd<Msg>, predicate: (msg: Msg) => boolean): Cmd<Msg> {
  return async () => {
    const result = await cmd();
    if (result === null) return null;
    return predicate(result) ? result : null;
  };
}
