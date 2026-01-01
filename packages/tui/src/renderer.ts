/**
 * Terminal renderer
 */

import ansiEscapes from 'ansi-escapes';
import stringWidth from 'string-width';

export class Renderer {
  private lastFrame: string = '';
  private lastFrameLines: string[] = [];
  private useAltScreen: boolean;

  constructor(useAltScreen: boolean = false) {
    this.useAltScreen = useAltScreen;
  }

  /**
   * Initialize the renderer
   */
  init(): void {
    if (this.useAltScreen) {
      process.stdout.write(ansiEscapes.enterAlternativeScreen);
    }
    process.stdout.write(ansiEscapes.cursorHide);
    this.lastFrame = '';
    this.lastFrameLines = [];
  }

  /**
   * Cleanup the renderer
   */
  cleanup(): void {
    process.stdout.write(ansiEscapes.cursorShow);
    if (this.useAltScreen) {
      process.stdout.write(ansiEscapes.exitAlternativeScreen);
    } else {
      process.stdout.write('\n');
    }
  }

  /**
   * Render a frame
   */
  render(content: string): void {
    if (content === this.lastFrame) {
      return; // Skip if content hasn't changed
    }

    let output = '';
    if (this.useAltScreen) {
      output = this.renderDiff(content);
    } else {
      output = ansiEscapes.eraseLines(this.countLines(this.lastFrame)) + content;
    }

    process.stdout.write(output);
    this.lastFrame = content;
    this.lastFrameLines = content.split('\n');
  }

  /**
   * Clear the screen
   */
  clear(): void {
    process.stdout.write(ansiEscapes.clearTerminal);
    process.stdout.write(ansiEscapes.cursorTo(0, 0));
    this.lastFrame = '';
    this.lastFrameLines = [];
  }

  /**
   * Get terminal size
   */
  getSize(): { width: number; height: number } {
    return {
      width: process.stdout.columns || 80,
      height: process.stdout.rows || 24
    };
  }

  /**
   * Count lines in a string
   */
  private countLines(str: string): number {
    if (!str) return 0;
    const lines = str.split('\n');
    const { width } = this.getSize();

    let count = 0;
    for (const line of lines) {
      const lineWidth = stringWidth(line);
      count += Math.max(1, Math.ceil(lineWidth / width));
    }

    return count;
  }

  /**
   * Render only changed lines when using the alternate screen.
   */
  private renderDiff(content: string): string {
    const newLines = content.split('\n');
    const oldLines = this.lastFrameLines;
    const maxLines = Math.max(newLines.length, oldLines.length);

    let output = '';
    for (let i = 0; i < maxLines; i += 1) {
      const nextLine = newLines[i] ?? '';
      const prevLine = oldLines[i] ?? '';
      if (nextLine !== prevLine) {
        output += ansiEscapes.cursorTo(0, i) + ansiEscapes.eraseLine + nextLine;
      }
    }

    return output;
  }
}
