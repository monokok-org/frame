/**
 * Core types for the TUI framework
 * Inspired by The Elm Architecture (bubbletea)
 */

/**
 * Command is an async operation that may produce a message
 */
export type Cmd<Msg> = () => Promise<Msg | null>;

/**
 * Batch allows running multiple commands
 */
export type BatchCmd<Msg> = {
  type: 'batch';
  cmds: Cmd<Msg>[];
};

/**
 * Init function returns the initial model and optional command
 */
export type Init<Model, Msg> = () => [Model, Cmd<Msg> | BatchCmd<Msg> | null];

/**
 * Update function handles messages and returns updated model + optional command
 */
export type Update<Model, Msg> = (
  model: Model,
  msg: Msg
) => [Model, Cmd<Msg> | BatchCmd<Msg> | null];

/**
 * View function renders the current model to a string
 */
export type View<Model> = (model: Model) => string;

/**
 * Program options
 */
export interface ProgramOptions {
  /**
   * Use alternate screen buffer (full-screen mode)
   */
  altScreen?: boolean;

  /**
   * Enable mouse support
   */
  mouseAllMotion?: boolean;

  /**
   * Enable mouse cell motion
   */
  mouseCellMotion?: boolean;

  /**
   * Input mode (default: 'raw')
   */
  inputMode?: 'raw' | 'cooked';
}

/**
 * Key message from keyboard input
 */
export interface KeyMsg {
  type: 'key';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  sequence: string;
}

/**
 * Resize message when terminal size changes
 */
export interface ResizeMsg {
  type: 'resize';
  width: number;
  height: number;
}

/**
 * Mouse message
 */
export interface MouseMsg {
  type: 'mouse';
  button: 'left' | 'right' | 'middle' | 'release' | 'wheelUp' | 'wheelDown';
  x: number;
  y: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * Error message
 */
export interface ErrorMsg {
  type: 'error';
  error: Error;
}

/**
 * Quit message
 */
export interface QuitMsg {
  type: 'quit';
}
