#!/usr/bin/env node
/**
 * Simple counter example using @framedev/tui
 */

import { Program, type Init, type Update, type View, quit } from '../src/index.js';

// Define the model (application state)
interface Model {
  count: number;
}

// Define messages (events)
type Msg =
  | { type: 'key'; key: string; ctrl: boolean }
  | { type: 'quit' };

// Initialize the model
const init: Init<Model, Msg> = () => {
  return [{ count: 0 }];
};

// Update function - handles state changes
const update: Update<Model, Msg> = (model, msg) => {
  switch (msg.type) {
    case 'key':
      if (msg.key === 'q' || (msg.key === 'c' && msg.ctrl)) {
        return [model, quit()];
      }
      if (msg.key === '+' || msg.key === '=') {
        return [{ count: model.count + 1 }];
      }
      if (msg.key === '-' || msg.key === '_') {
        return [{ count: model.count - 1 }];
      }
      if (msg.key === 'r') {
        return [{ count: 0 }];
      }
      return [model];

    default:
      return [model];
  }
};

// View function - renders the UI
const view: View<Model> = (model) => {
  return `
┌─────────────────────────────────────────┐
│           Counter Example               │
├─────────────────────────────────────────┤
│                                         │
│         Count: ${model.count.toString().padStart(4)}                   │
│                                         │
├─────────────────────────────────────────┤
│  Controls:                              │
│    +/=  : Increment                     │
│    -/_  : Decrement                     │
│    r    : Reset                         │
│    q    : Quit                          │
└─────────────────────────────────────────┘
  `.trim();
};

// Create and run the program
const program = new Program(init, update, view);
program.run();
