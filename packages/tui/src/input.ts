/**
 * Input handler for keyboard and mouse events
 */

import type { KeyMsg, MouseMsg } from './types.js';

export type InputMsg = KeyMsg | MouseMsg;

export class InputHandler {
  private listeners: Set<(msg: InputMsg) => void> = new Set();
  private isListening: boolean = false;

  /**
   * Start listening to input
   */
  start(): void {
    if (this.isListening) return;

    // Set raw mode to capture keypresses
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', this.handleData);

    this.isListening = true;
  }

  /**
   * Stop listening to input
   */
  stop(): void {
    if (!this.isListening) return;

    process.stdin.removeListener('data', this.handleData);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    this.isListening = false;
  }

  /**
   * Add a message listener
   */
  addListener(listener: (msg: InputMsg) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a message listener
   */
  removeListener(listener: (msg: InputMsg) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Handle raw input data
   */
  private handleData = (data: string): void => {
    const msg = this.parseInput(data);
    if (msg) {
      this.emit(msg);
    }
  };

  /**
   * Parse input into a message
   */
  private parseInput(data: string): InputMsg | null {
    const sequence = data;
    const code = data.charCodeAt(0);

    // Ctrl+C
    if (code === 3) {
      return {
        type: 'key',
        key: 'c',
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Ctrl+D
    if (code === 4) {
      return {
        type: 'key',
        key: 'd',
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Enter
    if (code === 13 || code === 10) {
      return {
        type: 'key',
        key: 'enter',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Backspace
    if (code === 127 || code === 8) {
      return {
        type: 'key',
        key: 'backspace',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Tab
    if (code === 9) {
      return {
        type: 'key',
        key: 'tab',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Escape sequences
    if (code === 27) {
      return this.parseEscapeSequence(data);
    }

    // Regular character
    if (code >= 32 && code <= 126) {
      return {
        type: 'key',
        key: data,
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    return null;
  }

  /**
   * Parse escape sequences (arrows, function keys, etc.)
   */
  private parseEscapeSequence(data: string): KeyMsg | null {
    const sequence = data;

    // Arrow keys
    if (data === '\x1b[A') {
      return {
        type: 'key',
        key: 'up',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[B') {
      return {
        type: 'key',
        key: 'down',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[C') {
      return {
        type: 'key',
        key: 'right',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[D') {
      return {
        type: 'key',
        key: 'left',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Home/End
    if (data === '\x1b[H' || data === '\x1b[1~') {
      return {
        type: 'key',
        key: 'home',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[F' || data === '\x1b[4~') {
      return {
        type: 'key',
        key: 'end',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Delete/Insert
    if (data === '\x1b[3~') {
      return {
        type: 'key',
        key: 'delete',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[2~') {
      return {
        type: 'key',
        key: 'insert',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Page up/down
    if (data === '\x1b[5~') {
      return {
        type: 'key',
        key: 'pageup',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[6~') {
      return {
        type: 'key',
        key: 'pagedown',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Ctrl + Arrow keys
    if (data === '\x1b[1;5C' || data === '\x1b[5C') {
      return {
        type: 'key',
        key: 'ctrl+right',
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    if (data === '\x1b[1;5D' || data === '\x1b[5D') {
      return {
        type: 'key',
        key: 'ctrl+left',
        ctrl: true,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Shift + Tab (backtab)
    if (data === '\x1b[Z') {
      return {
        type: 'key',
        key: 'backtab',
        ctrl: false,
        alt: false,
        shift: true,
        meta: false,
        sequence
      };
    }

    // Escape key
    if (data === '\x1b') {
      return {
        type: 'key',
        key: 'escape',
        ctrl: false,
        alt: false,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Alt + Backspace (ESC + DEL)
    if (data === '\x1b\x7f') {
      return {
        type: 'key',
        key: 'backspace',
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Alt + key (ESC + char)
    if (data.length === 2 && data.startsWith('\x1b')) {
      const key = data[1];
      return {
        type: 'key',
        key,
        ctrl: false,
        alt: true,
        shift: false,
        meta: false,
        sequence
      };
    }

    // Unknown escape sequence
    return null;
  }

  /**
   * Emit a message to all listeners
   */
  private emit(msg: InputMsg): void {
    for (const listener of this.listeners) {
      listener(msg);
    }
  }
}
