/**
 * Executor State Machine
 * 
 */

export type Phase = 'understand' | 'act' | 'verify' | 'ask' | 'done';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  toolCallId?: string;
  name?: string;
}

export interface ExecutorState {
  phase: Phase;
  messages: Message[];
  turnCount: number;
  context: {
    targetFile?: string;
  };
}

export interface ExecutorResult {
  status: 'done' | 'ask' | 'error' | 'max_turns';
  summary?: string;
  question?: string;
  error?: string;
}

/**
 * Create initial state for a new task
 */
export function createInitialState(): ExecutorState {
  return {
    phase: 'understand',
    messages: [],
    turnCount: 0,
    context: {}
  };
}

/**
 * Determine phase transition based on tool call
 */
export function getNextPhase(currentPhase: Phase, toolName: string): Phase {
  switch (toolName) {
    case 'done':
      return 'done';
    
    case 'ask':
      return 'ask';
    
    case 'find':
      // find can be used in any phase for context gathering
      return currentPhase === 'done' ? 'understand' : currentPhase;
    
    case 'edit':
      return 'act';
    
    case 'run':
      // run after edit = verify, run alone = act
      return currentPhase === 'act' ? 'verify' : 'act';
    
    case 'knowledge':
      // knowledge doesn't change phase
      return currentPhase;
    
    default:
      return currentPhase;
  }
}

/**
 * Check if we should continue the loop
 */
export function shouldContinue(state: ExecutorState, maxTurns: number): boolean {
  if (state.phase === 'done') return false;
  if (state.phase === 'ask') return false;
  if (state.turnCount >= maxTurns) return false;
  return true;
}
