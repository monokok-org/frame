/**
 * Command helpers
 */

import type { Cmd, BatchCmd, QuitMsg } from './types.js';

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
 * No-op command
 */
export function none<Msg>(): Cmd<Msg> {
  return async () => null;
}
