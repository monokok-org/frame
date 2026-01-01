/**
 * Program - The main event loop
 * Implements The Elm Architecture pattern
 */

import type {
  Init,
  Update,
  View,
  Cmd,
  BatchCmd,
  ProgramOptions,
  ResizeMsg
} from './types.js';
import { Renderer } from './renderer.js';
import { InputHandler, type InputMsg } from './input.js';

export class Program<Model, Msg> {
  private model!: Model;
  private init: Init<Model, Msg>;
  private update: Update<Model, Msg>;
  private view: View<Model>;
  private renderer: Renderer;
  private inputHandler: InputHandler;
  private running: boolean = false;
  private renderRequested: boolean = false;

  constructor(
    init: Init<Model, Msg>,
    update: Update<Model, Msg>,
    view: View<Model>,
    options: ProgramOptions = {}
  ) {
    this.init = init;
    this.update = update;
    this.view = view;
    this.renderer = new Renderer(options.altScreen ?? false);
    this.inputHandler = new InputHandler();
  }

  /**
   * Run the program
   */
  async run(): Promise<void> {
    if (this.running) {
      throw new Error('Program is already running');
    }

    this.running = true;

    // Setup cleanup handlers
    this.setupCleanup();

    // Initialize renderer
    this.renderer.init();

    // Initialize input handler
    this.inputHandler.start();
    this.inputHandler.addListener(this.handleInput);

    // Handle terminal resize
    process.stdout.on('resize', this.handleResize);

    // Initialize model and run initial command
    const [initialModel, initialCmd] = this.init();
    this.model = initialModel;

    // Render initial view
    this.render();

    // Run initial command if provided
    if (initialCmd) {
      await this.runCommand(initialCmd);
    }

    // Keep process alive
    await this.waitForQuit();
  }

  /**
   * Send a message to update the model
   */
  send(msg: Msg): void {
    this.handleMessage(msg);
  }

  /**
   * Quit the program
   */
  quit(): void {
    this.cleanup();
    process.exit(0);
  }

  /**
   * Handle input messages from the input handler
   */
  private handleInput = (inputMsg: InputMsg): void => {
    // Cast input messages to the app's message type
    this.handleMessage(inputMsg as unknown as Msg);
  };

  /**
   * Handle terminal resize
   */
  private handleResize = (): void => {
    const { width, height } = this.renderer.getSize();
    const resizeMsg: ResizeMsg = {
      type: 'resize',
      width,
      height
    };
    this.handleMessage(resizeMsg as unknown as Msg);
  };

  /**
   * Handle a message by calling update and running returned command
   */
  private handleMessage(msg: Msg): void {
    // Check for quit message
    if (this.isQuitMsg(msg)) {
      this.quit();
      return;
    }

    // Update the model
    const [newModel, cmd] = this.update(this.model, msg);
    this.model = newModel;

    // Request a render
    this.requestRender();

    // Run command if provided
    if (cmd) {
      this.runCommand(cmd).catch(err => {
        console.error('Command error:', err);
      });
    }
  }

  /**
   * Request a render on next tick
   */
  private requestRender(): void {
    if (this.renderRequested) return;
    this.renderRequested = true;

    setImmediate(() => {
      this.renderRequested = false;
      this.render();
    });
  }

  /**
   * Render the current view
   */
  private render(): void {
    const output = this.view(this.model);
    this.renderer.render(output);
  }

  /**
   * Run a command
   */
  private async runCommand(cmd: Cmd<Msg> | BatchCmd<Msg>): Promise<void> {
    if (this.isBatchCmd(cmd)) {
      // Run all commands in parallel
      const results = await Promise.all(cmd.cmds.map(c => c()));
      for (const result of results) {
        if (result) {
          this.handleMessage(result);
        }
      }
    } else {
      // Run single command
      const result = await cmd();
      if (result) {
        this.handleMessage(result);
      }
    }
  }

  /**
   * Type guard for batch commands
   */
  private isBatchCmd(cmd: Cmd<Msg> | BatchCmd<Msg>): cmd is BatchCmd<Msg> {
    return typeof cmd === 'object' && 'type' in cmd && cmd.type === 'batch';
  }

  /**
   * Type guard for quit messages
   */
  private isQuitMsg(msg: Msg): boolean {
    return typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'quit';
  }

  /**
   * Wait for the program to quit
   */
  private waitForQuit(): Promise<void> {
    return new Promise(() => {
      // Never resolves - program runs until quit
    });
  }

  /**
   * Setup cleanup handlers
   */
  private setupCleanup(): void {
    const cleanup = () => {
      if (this.running) {
        this.cleanup();
      }
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (!this.running) return;

    this.running = false;
    this.inputHandler.stop();
    process.stdout.removeListener('resize', this.handleResize);
    this.renderer.cleanup();
  }
}
