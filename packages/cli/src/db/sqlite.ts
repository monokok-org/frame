import { createRequire } from 'node:module';

export type SQLiteBackend = 'node:sqlite' | 'better-sqlite3';

export interface SQLiteRunResult {
  changes: number;
  lastInsertRowid?: number | bigint;
}

export interface SQLiteStatement {
  run(...params: any[]): SQLiteRunResult;
  get<T = any>(...params: any[]): T | undefined;
  all<T = any>(...params: any[]): T[];
}

export interface SQLiteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
  pragma(sql: string): void;
  close(): void;
}

type NodeSqliteModule = {
  DatabaseSync: new (path: string) => {
    exec(sql: string): void;
    prepare(sql: string): SQLiteStatement;
    close(): void;
  };
};

type BetterSqlite3Ctor = new (path: string) => {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatement;
  pragma(sql: string): void;
  close(): void;
};

const require = createRequire(import.meta.url);

function loadNodeSqlite(): NodeSqliteModule | null {
  try {
    return require('node:sqlite') as NodeSqliteModule;
  } catch {
    return null;
  }
}

function loadBetterSqlite3(): BetterSqlite3Ctor | null {
  try {
    const mod = require('better-sqlite3') as { default?: BetterSqlite3Ctor } | BetterSqlite3Ctor;
    return (mod as { default?: BetterSqlite3Ctor }).default ?? (mod as BetterSqlite3Ctor);
  } catch {
    return null;
  }
}

class NodeSqliteDatabase implements SQLiteDatabase {
  private db: {
    exec(sql: string): void;
    prepare(sql: string): SQLiteStatement;
    close(): void;
  };

  constructor(path: string, mod: NodeSqliteModule) {
    this.db = new mod.DatabaseSync(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SQLiteStatement {
    return this.db.prepare(sql);
  }

  pragma(sql: string): void {
    this.db.exec(`PRAGMA ${sql}`);
  }

  close(): void {
    this.db.close();
  }
}

class BetterSqliteDatabase implements SQLiteDatabase {
  private db: {
    exec(sql: string): void;
    prepare(sql: string): SQLiteStatement;
    pragma(sql: string): void;
    close(): void;
  };

  constructor(path: string, ctor: BetterSqlite3Ctor) {
    this.db = new ctor(path);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SQLiteStatement {
    return this.db.prepare(sql);
  }

  pragma(sql: string): void {
    this.db.pragma(sql);
  }

  close(): void {
    this.db.close();
  }
}

export function openSQLite(path: string): { db: SQLiteDatabase; backend: SQLiteBackend } {
  const nodeSqlite = loadNodeSqlite();
  if (nodeSqlite) {
    return { db: new NodeSqliteDatabase(path, nodeSqlite), backend: 'node:sqlite' };
  }

  const betterSqlite3 = loadBetterSqlite3();
  if (!betterSqlite3) {
    throw new Error('No SQLite backend available. Use Node >= 22 or install better-sqlite3.');
  }

  return { db: new BetterSqliteDatabase(path, betterSqlite3), backend: 'better-sqlite3' };
}
