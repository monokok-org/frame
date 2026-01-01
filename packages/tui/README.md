# @framedev/tui

A minimal TUI (Terminal User Interface) framework for TypeScript/Node.js, inspired by [Charm's Bubbletea](https://github.com/charmbracelet/bubbletea).

## Features

- 🎯 **Elm Architecture** - Predictable state management with Model/Update/View pattern
- ⚡ **TypeScript-first** - Full type safety
- 🪶 **Lightweight** - Only 3 dependencies (ansi-escapes, string-width, strip-ansi)
- 🎨 **Flexible rendering** - Inline or full-screen (alt buffer) modes
- ⌨️ **Keyboard input** - Arrow keys, special keys, Ctrl combinations
- 🔄 **Command system** - Built-in async command handling

## Installation

```bash
pnpm add @framedev/tui
```

## Quick Start

```typescript
import { Program, type Init, type Update, type View, quit } from '@framedev/tui';

// 1. Define your model (application state)
interface Model {
  count: number;
}

// 2. Define your messages (events)
type Msg =
  | { type: 'key'; key: string }
  | { type: 'quit' };

// 3. Initialize your model
const init: Init<Model, Msg> = () => {
  return [{ count: 0 }];
};

// 4. Handle updates
const update: Update<Model, Msg> = (model, msg) => {
  switch (msg.type) {
    case 'key':
      if (msg.key === 'q') return [model, quit()];
      if (msg.key === '+') return [{ count: model.count + 1 }];
      if (msg.key === '-') return [{ count: model.count - 1 }];
      return [model];
    default:
      return [model];
  }
};

// 5. Render your view
const view: View<Model> = (model) => {
  return `
Counter: ${model.count}

Press + to increment, - to decrement, q to quit
  `.trim();
};

// 6. Run your program
const program = new Program(init, update, view);
program.run();
```

## Core Concepts

### The Elm Architecture

The framework follows The Elm Architecture pattern with three core concepts:

1. **Model** - Your application state
2. **Update** - How state changes in response to messages
3. **View** - How to display the current state

### Commands

Commands allow you to perform async operations:

```typescript
import { tick, batch } from '@framedev/tui';

const update: Update<Model, Msg> = (model, msg) => {
  // Run a command after 1 second
  return [model, tick(1000, { type: 'timer' })];

  // Run multiple commands
  return [model, batch(
    fetchDataCmd(),
    tick(1000, { type: 'timer' })
  )];
};
```

### Input Handling

Keyboard input is automatically converted to messages:

- Regular keys: `{ type: 'key', key: 'a' }`
- Special keys: `enter`, `backspace`, `tab`, `escape`
- Arrow keys: `up`, `down`, `left`, `right`
- Ctrl combinations: `{ type: 'key', key: 'c', ctrl: true }`

### Program Options

```typescript
const program = new Program(init, update, view, {
  altScreen: true,        // Use full-screen mode
  mouseAllMotion: false,  // Enable mouse tracking (future)
});
```

## API Reference

### `Program<Model, Msg>`

Main program class that runs the event loop.

**Constructor:**
```typescript
new Program(init, update, view, options?)
```

**Methods:**
- `run()` - Start the program
- `send(msg)` - Send a message to the program
- `quit()` - Quit the program

### Built-in Commands

- `quit()` - Quit the program
- `tick(delayMs, msg)` - Send a message after a delay
- `batch(...cmds)` - Run multiple commands in parallel
- `sequence(...cmds)` - Run commands one after another
- `none()` - No-op command

## License

MIT
