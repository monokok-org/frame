import chalk from 'chalk';
import stringWidth from 'string-width';
import type { SelectableOption, Step, SpinnerStyle } from './types.js';

const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_REGEX, '');
}

function visibleWidth(text: string): number {
  return stringWidth(stripAnsi(text));
}

function padEnd(text: string, width: number): string {
  const padding = Math.max(0, width - visibleWidth(text));
  return text + ' '.repeat(padding);
}

function truncateText(text: string, maxWidth: number): string {
  if (visibleWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 3) {
    return text.slice(0, Math.max(0, maxWidth));
  }
  return text.slice(0, Math.max(0, maxWidth - 1)) + '…';
}

export const BOX_STYLES = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    leftT: '├',
    rightT: '┤',
    topT: '┬',
    bottomT: '┴',
    cross: '┼'
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    leftT: '╠',
    rightT: '╣',
    topT: '╦',
    bottomT: '╩',
    cross: '╬'
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    leftT: '├',
    rightT: '┤',
    topT: '┬',
    bottomT: '┴',
    cross: '┼'
  },
  heavy: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
    leftT: '┣',
    rightT: '┫',
    topT: '┳',
    bottomT: '┻',
    cross: '╋'
  },
  none: {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    horizontal: ' ',
    vertical: ' ',
    leftT: ' ',
    rightT: ' ',
    topT: ' ',
    bottomT: ' ',
    cross: ' '
  }
} as const;

export const SPINNER_STYLES = {
  dots: {
    frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
    interval: 80
  },
  line: {
    frames: ['-', '\\', '|', '/'],
    interval: 130
  },
  arc: {
    frames: ['◜', '◠', '◝', '◞', '◡', '◟'],
    interval: 100
  },
  circle: {
    frames: ['◐', '◓', '◑', '◒'],
    interval: 120
  },
  bounce: {
    frames: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
    interval: 120
  },
  pulse: {
    frames: ['█', '▓', '▒', '░', '▒', '▓'],
    interval: 150
  },
  arrows: {
    frames: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
    interval: 100
  },
  blocks: {
    frames: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█', '▇', '▆', '▅', '▄', '▃', '▂'],
    interval: 80
  }
} as const;

export function renderCheckboxGroup(
  options: SelectableOption[],
  cursorIndex: number,
  prefix: string = ''
): string {
  return options
    .map((option, index) => {
      const isFocused = index === cursorIndex;
      const isSelected = option.selected;

      const checkbox = isSelected ? chalk.green('◉') : chalk.dim('○');
      const label = isFocused ? chalk.cyan.bold(option.label) : option.label;
      const focusIndicator = isFocused ? chalk.cyan('❯ ') : '  ';
      const description = option.description ? chalk.dim(` - ${option.description}`) : '';

      return `${prefix}${focusIndicator}${checkbox} ${label}${description}`;
    })
    .join('\n');
}

export function renderRadioGroup(
  options: SelectableOption[],
  cursorIndex: number,
  selectedId: string | null,
  prefix: string = ''
): string {
  return options
    .map((option, index) => {
      const isFocused = index === cursorIndex;
      const isSelected = option.id === selectedId;

      const radio = isSelected ? chalk.green('●') : chalk.dim('○');
      const label = isFocused ? chalk.cyan.bold(option.label) : option.label;
      const focusIndicator = isFocused ? chalk.cyan('❯ ') : '  ';
      const description = option.description ? chalk.dim(` - ${option.description}`) : '';

      return `${prefix}${focusIndicator}${radio} ${label}${description}`;
    })
    .join('\n');
}

export function renderSteps(steps: Step[], prefix: string = ''): string {
  return steps
    .map((step) => {
      let icon = ' ';
      let labelStyle = (s: string) => s;
      switch (step.status) {
        case 'pending':
          icon = chalk.gray('○');
          labelStyle = chalk.gray;
          break;
        case 'running':
          icon = chalk.yellow('●');
          labelStyle = chalk.yellow.bold;
          break;
        case 'success':
          icon = chalk.green('✔');
          labelStyle = chalk.green;
          break;
        case 'error':
          icon = chalk.red('✘');
          labelStyle = chalk.red;
          break;
        case 'skipped':
          icon = chalk.gray('─');
          labelStyle = chalk.strikethrough.gray;
          break;
      }

      let labelText = step.label;

      // Auto-format tool details if provided
      if (step.tool && step.args) {
        switch (step.tool) {
          case 'run':
            if (typeof step.args.command === 'string') {
              // Show PID if reading/killing
              if (step.args.action === 'read' || step.args.action === 'kill') {
                labelText = `${step.args.action === 'kill' ? 'Kill' : 'Read'}: PID ${step.args.command}`;
              } else {
                labelText = `Run: ${step.args.command}`;
              }
            }
            break;
          case 'find':
            if (typeof step.args.pattern === 'string') {
              labelText = `Find: "${step.args.pattern}"`;
            }
            break;
          case 'grep': // grep_search
            if (typeof step.args.query === 'string') {
              labelText = `Grep: "${step.args.query}" in ${step.args.path || '.'}`;
            } else if (typeof step.args.Query === 'string') { // Support capitalized too if used
              labelText = `Grep: "${step.args.Query}"`;
            }
            break;
          case 'edit': // edit
            if (typeof step.args.path === 'string') {
              labelText = `Edit: ${step.args.path}`;
            }
            break;
          case 'knowledge':
            if (typeof step.args.query === 'string') {
              labelText = `Research: ${step.args.query}`;
            }
            break;
          case 'search':
            if (typeof step.args.query === 'string') {
              labelText = `Search: "${step.args.query}"`;
            }
            break;
        }
      }

      const label = labelStyle(labelText);
      const detail = step.detail ? chalk.dim(` (${step.detail})`) : '';

      return `${prefix}${icon} ${label}${detail}`;
    })
    .join('\n');
}

export function renderProgressBar(
  current: number,
  total: number,
  width: number = 30,
  options: {
    showPercentage?: boolean;
    showCount?: boolean;
    filledChar?: string;
    emptyChar?: string;
    leftCap?: string;
    rightCap?: string;
    filledColor?: (s: string) => string;
    emptyColor?: (s: string) => string;
    style?: 'block' | 'gradient' | 'thin' | 'ascii';
  } = {}
): string {
  const {
    showPercentage = true,
    showCount = false,
    style = 'block'
  } = options;

  let filledChar = options.filledChar;
  let emptyChar = options.emptyChar;
  let leftCap = options.leftCap ?? '';
  let rightCap = options.rightCap ?? '';
  const filledColor = options.filledColor ?? chalk.cyan;
  const emptyColor = options.emptyColor ?? chalk.gray;

  if (!filledChar || !emptyChar) {
    switch (style) {
      case 'gradient':
        filledChar = '█';
        emptyChar = '░';
        break;
      case 'thin':
        filledChar = '━';
        emptyChar = '─';
        leftCap = '[';
        rightCap = ']';
        break;
      case 'ascii':
        filledChar = '=';
        emptyChar = '-';
        leftCap = '[';
        rightCap = ']';
        break;
      case 'block':
      default:
        filledChar = '█';
        emptyChar = '▒';
        break;
    }
  }

  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const barWidth = Math.max(1, width - leftCap.length - rightCap.length);
  const filledWidth = Math.round((percentage / 100) * barWidth);
  const emptyWidth = barWidth - filledWidth;

  const filled = filledColor(filledChar.repeat(filledWidth));
  const empty = emptyColor(emptyChar.repeat(emptyWidth));

  let suffix = '';
  if (showPercentage && showCount) {
    suffix = ` ${percentage}% (${current}/${total})`;
  } else if (showPercentage) {
    suffix = ` ${percentage}%`;
  } else if (showCount) {
    suffix = ` ${current}/${total}`;
  }

  return `${leftCap}${filled}${empty}${rightCap}${chalk.dim(suffix)}`;
}

export function renderBox(
  content: string | string[],
  options: {
    title?: string;
    width?: number;
    style?: keyof typeof BOX_STYLES;
    padding?: number;
    titleAlign?: 'left' | 'center' | 'right';
    titleColor?: (s: string) => string;
    borderColor?: (s: string) => string;
    contentColor?: (s: string) => string;
  } = {}
): string {
  const {
    title,
    style = 'single',
    padding = 1,
    titleAlign = 'left',
    titleColor = chalk.bold,
    borderColor = chalk.dim,
    contentColor = (s: string) => s
  } = options;

  const box = BOX_STYLES[style];
  const lines = Array.isArray(content) ? content : content.split('\n');

  const maxContentWidth = Math.max(...lines.map(visibleWidth), title ? visibleWidth(title) + 4 : 0);
  const contentWidth = options.width ? options.width - 2 - padding * 2 : maxContentWidth;
  const innerWidth = contentWidth + padding * 2;

  const paddingStr = ' '.repeat(padding);
  const renderLine = (line: string): string => {
    const truncated = truncateText(line, contentWidth);
    const padded = padEnd(truncated, contentWidth);
    return `${borderColor(box.vertical)}${paddingStr}${contentColor(padded)}${paddingStr}${borderColor(box.vertical)}`;
  };

  const horizontalLine = box.horizontal.repeat(innerWidth);
  let topLine = `${borderColor(box.topLeft)}${borderColor(horizontalLine)}${borderColor(box.topRight)}`;

  if (title) {
    const titleText = titleColor(` ${title} `);
    const titleWidth = visibleWidth(titleText);
    const availableWidth = innerWidth;

    if (titleWidth < availableWidth) {
      let leftPad: number;
      if (titleAlign === 'center') {
        leftPad = Math.floor((availableWidth - titleWidth) / 2);
      } else if (titleAlign === 'right') {
        leftPad = availableWidth - titleWidth - 1;
      } else {
        leftPad = 1;
      }
      const rightPad = availableWidth - titleWidth - leftPad;

      topLine = `${borderColor(box.topLeft)}${borderColor(box.horizontal.repeat(leftPad))}${titleText}${borderColor(box.horizontal.repeat(rightPad))}${borderColor(box.topRight)}`;
    }
  }

  const bottomLine = `${borderColor(box.bottomLeft)}${borderColor(horizontalLine)}${borderColor(box.bottomRight)}`;

  return [topLine, ...lines.map(renderLine), bottomLine].join('\n');
}

export function renderKeyValue(
  pairs: Array<{ key: string; value: string }>,
  options: {
    separator?: string;
    keyColor?: (s: string) => string;
    valueColor?: (s: string) => string;
    keyWidth?: number;
  } = {}
): string {
  const {
    separator = ': ',
    keyColor = chalk.dim,
    valueColor = (s: string) => s
  } = options;

  const keyWidth = options.keyWidth ?? Math.max(...pairs.map(p => p.key.length));

  return pairs
    .map(({ key, value }) => {
      const paddedKey = padEnd(key, keyWidth);
      return `${keyColor(paddedKey)}${separator}${valueColor(value)}`;
    })
    .join('\n');
}

export function renderTable(
  headers: string[],
  rows: string[][],
  options: {
    style?: keyof typeof BOX_STYLES;
    headerColor?: (s: string) => string;
    borderColor?: (s: string) => string;
    columnWidths?: number[];
    padding?: number;
  } = {}
): string {
  const {
    style = 'single',
    headerColor = chalk.bold,
    borderColor = chalk.dim,
    padding = 1
  } = options;

  const box = BOX_STYLES[style];

  const columnWidths = options.columnWidths ?? headers.map((h, i) => {
    const cellWidths = [visibleWidth(h), ...rows.map(r => visibleWidth(r[i] ?? ''))];
    return Math.max(...cellWidths);
  });

  const paddingStr = ' '.repeat(padding);

  const renderCell = (content: string, colIndex: number, isHeader: boolean): string => {
    const width = columnWidths[colIndex] ?? 10;
    const truncated = truncateText(content, width);
    const padded = padEnd(truncated, width);
    return isHeader ? headerColor(padded) : padded;
  };

  const renderRow = (cells: string[], isHeader: boolean): string => {
    const rendered = cells.map((c, i) => `${paddingStr}${renderCell(c, i, isHeader)}${paddingStr}`);
    return `${borderColor(box.vertical)}${rendered.join(borderColor(box.vertical))}${borderColor(box.vertical)}`;
  };

  const horizontalLine = (left: string, mid: string, right: string): string => {
    const segments = columnWidths.map(w => box.horizontal.repeat(w + padding * 2));
    return `${borderColor(left)}${segments.join(borderColor(mid))}${borderColor(right)}`;
  };

  const result: string[] = [];
  result.push(horizontalLine(box.topLeft, box.topT, box.topRight));
  result.push(renderRow(headers, true));
  result.push(horizontalLine(box.leftT, box.cross, box.rightT));
  for (const row of rows) {
    result.push(renderRow(row, false));
  }
  result.push(horizontalLine(box.bottomLeft, box.bottomT, box.bottomRight));

  return result.join('\n');
}

export function renderBadge(
  text: string,
  options: {
    color?: (s: string) => string;
    bgColor?: (s: string) => string;
    style?: 'rounded' | 'square' | 'pill';
  } = {}
): string {
  const { color = chalk.white, bgColor = chalk.bgCyan, style = 'rounded' } = options;

  let left = '';
  let right = '';
  switch (style) {
    case 'pill':
      left = '⌈';
      right = '⌋';
      break;
    case 'square':
      left = '[';
      right = ']';
      break;
    case 'rounded':
    default:
      left = '(';
      right = ')';
      break;
  }

  return bgColor(color(`${left}${text}${right}`));
}

export function renderStatusIndicator(
  status: 'success' | 'error' | 'warning' | 'info' | 'pending' | 'running',
  options: {
    showLabel?: boolean;
    animated?: boolean;
    frame?: number;
  } = {}
): string {
  const { showLabel = false, animated = true, frame = 0 } = options;

  const statusConfig = {
    success: { icon: '✔', color: chalk.green, label: 'Success' },
    error: { icon: '✘', color: chalk.red, label: 'Error' },
    warning: { icon: '⚠', color: chalk.yellow, label: 'Warning' },
    info: { icon: 'ℹ', color: chalk.blue, label: 'Info' },
    pending: { icon: '○', color: chalk.gray, label: 'Pending' },
    running: {
      icon: animated ? SPINNER_STYLES.dots.frames[frame % SPINNER_STYLES.dots.frames.length] : '●',
      color: chalk.cyan,
      label: 'Running'
    }
  };

  const config = statusConfig[status];
  const icon = config.color(config.icon);

  if (showLabel) {
    return `${icon} ${config.color(config.label)}`;
  }

  return icon;
}

export function renderDivider(
  width: number,
  options: {
    char?: string;
    label?: string;
    labelAlign?: 'left' | 'center' | 'right';
    color?: (s: string) => string;
  } = {}
): string {
  const { char = '─', label, labelAlign = 'center', color = chalk.dim } = options;

  if (!label) {
    return color(char.repeat(width));
  }

  const labelText = ` ${label} `;
  const labelWidth = visibleWidth(labelText);
  const remainingWidth = Math.max(0, width - labelWidth);

  let leftWidth: number;
  if (labelAlign === 'center') {
    leftWidth = Math.floor(remainingWidth / 2);
  } else if (labelAlign === 'right') {
    leftWidth = remainingWidth - 1;
  } else {
    leftWidth = 1;
  }
  const rightWidth = remainingWidth - leftWidth;

  return `${color(char.repeat(leftWidth))}${labelText}${color(char.repeat(rightWidth))}`;
}

export function renderCollapsible(
  title: string,
  content: string,
  isExpanded: boolean,
  prefix: string = ''
): string {
  const icon = isExpanded ? chalk.cyan('▼') : chalk.cyan('▶');
  const header = `${prefix}${icon} ${chalk.bold(title)}`;

  if (!isExpanded) {
    return header;
  }

  const indentedContent = content
    .split('\n')
    .map(line => `${prefix}  ${line}`)
    .join('\n');

  return `${header}\n${indentedContent}`;
}

export function renderTextInput(
  value: string,
  cursorPos: number,
  options: {
    placeholder?: string;
    width?: number;
    label?: string;
    focused?: boolean;
    error?: string;
    prefix?: string;
  } = {}
): string {
  const {
    placeholder = '',
    width = 40,
    label,
    focused = true,
    error,
    prefix = ''
  } = options;

  const lines: string[] = [];

  if (label) {
    lines.push(`${prefix}${chalk.dim(label)}`);
  }

  let inputDisplay: string;
  if (value.length === 0 && !focused) {
    inputDisplay = chalk.dim(truncateText(placeholder, width));
  } else if (value.length === 0 && focused) {
    inputDisplay = chalk.inverse(' ') + chalk.dim(truncateText(placeholder.slice(1), width - 1));
  } else {
    const clampedCursor = Math.max(0, Math.min(cursorPos, value.length));
    const before = value.slice(0, clampedCursor);
    const cursorChar = value[clampedCursor] ?? ' ';
    const after = value.slice(clampedCursor + 1);

    if (focused) {
      inputDisplay = `${before}${chalk.inverse(cursorChar)}${after}`;
    } else {
      inputDisplay = value;
    }
  }

  const inputLine = truncateText(inputDisplay, width);
  const border = focused ? chalk.cyan('▎') : chalk.dim('│');
  lines.push(`${prefix}${border} ${inputLine}`);

  if (error) {
    lines.push(`${prefix}${chalk.red('  ⚠ ' + error)}`);
  }

  return lines.join('\n');
}

export function renderScrollbar(
  currentLine: number,
  totalLines: number,
  visibleLines: number,
  height: number
): string {
  if (totalLines <= visibleLines) {
    return ' '.repeat(height).split('').join('\n');
  }

  const scrollRatio = currentLine / Math.max(1, totalLines - visibleLines);
  const thumbHeight = Math.max(1, Math.floor((visibleLines / totalLines) * height));
  const thumbPosition = Math.floor(scrollRatio * (height - thumbHeight));

  const lines: string[] = [];
  for (let i = 0; i < height; i++) {
    if (i >= thumbPosition && i < thumbPosition + thumbHeight) {
      lines.push(chalk.dim('█'));
    } else {
      lines.push(chalk.dim('│'));
    }
  }

  return lines.join('\n');
}

export function renderNotification(
  message: string,
  type: 'success' | 'error' | 'warning' | 'info' = 'info',
  options: {
    width?: number;
    showIcon?: boolean;
  } = {}
): string {
  const { width = 40, showIcon = true } = options;

  const configs = {
    success: { icon: '✔', color: chalk.green, bgColor: chalk.bgGreen.black },
    error: { icon: '✘', color: chalk.red, bgColor: chalk.bgRed.white },
    warning: { icon: '⚠', color: chalk.yellow, bgColor: chalk.bgYellow.black },
    info: { icon: 'ℹ', color: chalk.blue, bgColor: chalk.bgBlue.white }
  };

  const config = configs[type];
  const icon = showIcon ? `${config.icon} ` : '';
  const text = truncateText(`${icon}${message}`, width);

  return config.bgColor(padEnd(` ${text} `, width));
}

export class Spinner {
  private style: SpinnerStyle;
  private currentFrame = 0;
  private color: (s: string) => string;

  constructor(
    styleName: keyof typeof SPINNER_STYLES = 'dots',
    color: (s: string) => string = chalk.cyan
  ) {
    this.style = SPINNER_STYLES[styleName];
    this.color = color;
  }

  nextFrame(): string {
    const frame = this.style.frames[this.currentFrame];
    this.currentFrame = (this.currentFrame + 1) % this.style.frames.length;
    return this.color(frame);
  }

  reset(): void {
    this.currentFrame = 0;
  }

  getInterval(): number {
    return this.style.interval;
  }

  render(label?: string): string {
    const frame = this.nextFrame();
    if (label) {
      return `${frame} ${label}`;
    }
    return frame;
  }
}

export function renderLoadingBar(
  width: number,
  frame: number,
  options: {
    color?: (s: string) => string;
    style?: 'bounce' | 'wave' | 'pulse';
  } = {}
): string {
  const { color = chalk.cyan, style = 'bounce' } = options;

  const chars = '▏▎▍▌▋▊▉█▉▊▋▌▍▎▏';
  const animWidth = Math.min(8, Math.floor(width / 3));

  if (style === 'wave') {
    const result: string[] = [];
    for (let i = 0; i < width; i++) {
      const offset = (frame + i) % chars.length;
      result.push(color(chars[offset]));
    }
    return result.join('');
  }

  if (style === 'pulse') {
    const intensity = Math.abs(Math.sin((frame * Math.PI) / 10));
    const char = chars[Math.floor(intensity * (chars.length - 1))];
    return color(char.repeat(width));
  }

  const position = frame % ((width - animWidth) * 2);
  const actualPos = position < width - animWidth
    ? position
    : (width - animWidth) * 2 - position;

  const result: string[] = [];
  for (let i = 0; i < width; i++) {
    if (i >= actualPos && i < actualPos + animWidth) {
      const localIdx = i - actualPos;
      const charIdx = localIdx % chars.length;
      result.push(color(chars[charIdx]));
    } else {
      result.push(chalk.dim('░'));
    }
  }

  return result.join('');
}

export function renderMenu(
  items: Array<{ id: string; label: string; shortcut?: string; disabled?: boolean }>,
  selectedIndex: number,
  options: {
    width?: number;
    showShortcuts?: boolean;
  } = {}
): string {
  const { width = 30, showShortcuts = true } = options;

  return items
    .map((item, index) => {
      const isSelected = index === selectedIndex;
      const isDisabled = item.disabled ?? false;

      let label = item.label;
      if (showShortcuts && item.shortcut) {
        const shortcutWidth = item.shortcut.length + 2;
        const availableWidth = width - shortcutWidth - 4;
        label = truncateText(item.label, availableWidth);
        const padding = width - visibleWidth(label) - shortcutWidth - 4;
        label = `${label}${' '.repeat(Math.max(0, padding))}${chalk.dim(item.shortcut)}`;
      } else {
        label = truncateText(item.label, width - 4);
      }

      if (isDisabled) {
        return `  ${chalk.strikethrough.dim(label)}  `;
      }

      if (isSelected) {
        return chalk.bgCyan.black(`❯ ${padEnd(label, width - 4)}  `);
      }

      return `  ${label}  `;
    })
    .join('\n');
}
