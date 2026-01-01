import path from 'path';
import fs from 'fs';

export function isTextFile(filePath: string): boolean {
  const textExtensions = [
    // Code files
    '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.php', '.java', '.go',
    '.c', '.cpp', '.h', '.cs', '.swift', '.kt', '.scala', '.rs', '.dart',

    // Web files
    '.html', '.css', '.scss', '.sass', '.less', '.json', '.xml', '.yaml', '.yml',

    // Documentation
    '.md', '.txt', '.rst', '.adoc',

    // Configuration
    '.env', '.ini', '.toml', '.conf', '.config',

    // Shell scripts
    '.sh', '.bash', '.zsh', '.fish',

    // Other text files
    '.csv', '.sql', '.graphql', '.prisma'
  ];

  const ext = path.extname(filePath).toLowerCase();

  if (textExtensions.includes(ext)) {
    return true;
  }

  try {
    const buffer = Buffer.alloc(4096);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buffer, 0, 4096, 0);
    fs.closeSync(fd);

    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

export function getFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();

  // Code files
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) return 'javascript';
  if (['.py'].includes(ext)) return 'python';
  if (['.rb'].includes(ext)) return 'ruby';
  if (['.php'].includes(ext)) return 'php';
  if (['.java'].includes(ext)) return 'java';
  if (['.go'].includes(ext)) return 'go';
  if (['.rs'].includes(ext)) return 'rust';
  if (['.c', '.cpp', '.h'].includes(ext)) return 'c-cpp';
  if (['.cs'].includes(ext)) return 'csharp';

  // Web files
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (['.css', '.scss', '.sass', '.less'].includes(ext)) return 'css';
  if (['.json'].includes(ext)) return 'json';
  if (['.xml'].includes(ext)) return 'xml';
  if (['.yaml', '.yml'].includes(ext)) return 'yaml';

  // Documentation
  if (['.md'].includes(ext)) return 'markdown';
  if (['.txt'].includes(ext)) return 'text';

  // Configuration
  if (['.env', '.ini', '.toml', '.conf', '.config'].includes(ext)) return 'config';

  // Other
  if (['.sql'].includes(ext)) return 'sql';
  if (['.graphql'].includes(ext)) return 'graphql';

  return 'other';
}

export function isWithinProjectRoot(filePath: string, projectRoot: string): boolean {
  const absolute = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  const normalized = path.normalize(absolute);
  const normalizedRoot = path.normalize(projectRoot);

  return normalized.startsWith(normalizedRoot);
}

export function ensureDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
