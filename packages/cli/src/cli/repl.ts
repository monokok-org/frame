import readline from 'readline';
import chalk from 'chalk';
import { logger } from '../utils/logger.js';
import type { DirectExecutor } from '../core/direct-executor.js';

export class CodeREPL {
  private directExecutor: DirectExecutor;
  private rl: readline.Interface;
  private isRunning: boolean = false;

  constructor(directExecutor: DirectExecutor) {
    this.directExecutor = directExecutor;
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.blue('frame> ')
    });
  }

  async start(): Promise<void> {
    this.printWelcome();
    this.rl.prompt();

    this.rl.on('line', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        this.rl.prompt();
        return;
      }

      if (trimmed.startsWith('/')) {
        await this.handleCommand(trimmed);
        this.rl.prompt();
        return;
      }

      if (this.isRunning) {
        console.log(chalk.yellow('[WAIT] Please wait for the current task to complete...'));
        this.rl.prompt();
        return;
      }

      await this.handleUserQuery(trimmed);
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log(chalk.gray('\nGoodbye!'));
      process.exit(0);
    });
  }

  private printWelcome(): void {
    console.log(chalk.bold.blue('\n========================================='));
    console.log(chalk.bold.blue('  Frame  - Direct Executor'));
    console.log(chalk.bold.blue('=========================================\n'));
    console.log(chalk.gray('Focused direct execution for local LLMs\n'));
    console.log(chalk.gray('Commands:'));
    console.log(chalk.gray('  /help     - Show help'));
    console.log(chalk.gray('  /clear    - Clear screen'));
    console.log(chalk.gray('  /exit     - Exit REPL\n'));
  }

  private async handleCommand(command: string): Promise<void> {
    const cmd = command.toLowerCase();

    switch (cmd) {
      case '/help':
        this.printHelp();
        break;

      case '/clear':
        console.clear();
        this.printWelcome();
        break;

      case '/exit':
      case '/quit':
        this.rl.close();
        break;

      default:
        console.log(chalk.red('Unknown command: ' + command));
        console.log(chalk.gray('Type /help for available commands'));
    }
  }

  private printHelp(): void {
    console.log(chalk.bold('\nAvailable Commands:'));
    console.log(chalk.gray('  /help     - Show this help message'));
    console.log(chalk.gray('  /clear    - Clear the screen'));
    console.log(chalk.gray('  /exit     - Exit the REPL\n'));
    console.log(chalk.bold('Usage:'));
    console.log(chalk.gray('  Just type your request naturally:'));
    console.log(chalk.gray('    "Add a login button to the homepage"'));
    console.log(chalk.gray('    "Find the User model"'));
    console.log(chalk.gray('    "Run the tests"\n'));
  }

  private async handleUserQuery(query: string): Promise<void> {
    this.isRunning = true;

    try {
      console.log(chalk.cyan('\n-> Processing: "' + query + '"\n'));
      const isResume = this.directExecutor.hasPending();
      const result = isResume
        ? await this.directExecutor.resume(query)
        : await this.directExecutor.execute(query);

      if (result.status === 'DONE') {
        console.log(chalk.green('\n[SUCCESS] ' + (result.result || 'Task complete') + '\n'));
      } else if (result.status === 'ASK') {
        console.log(chalk.yellow('\n[INPUT REQUIRED]\n' + (result.question || result.result || '') + '\n'));
      } else {
        console.log(chalk.red('\n[ERROR] ' + (result.error || 'Task failed') + '\n'));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red('\n[ERROR] ' + msg + '\n'));
      logger.error('REPL error: ' + String(error));
    } finally {
      this.isRunning = false;
    }
  }
}
