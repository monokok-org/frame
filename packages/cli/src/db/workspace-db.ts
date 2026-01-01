/**
 * Unified Workspace Database
 *
 * Single SQLite database for all workspace knowledge:
 * - workspace_context (persistent project structure)
 * - learned_patterns (Minsky frames)
 * - documentation_cache (enriched docs)
 * - execution_history (learning from outcomes)
 * - knowledge_cache (migrated from separate file)
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { logger } from '../utils/logger.js';

export interface WorkspaceContext {
  id?: number;
  project_root: string;
  project_type: string;
  project_framework?: string;
  directory_structure: string; // JSON
  package_manager?: string;
  config_files: string; // JSON array
  entry_points: string; // JSON array
  available_scripts: string; // JSON object
  discovered_at: number;
  last_verified: number;
  session_id: string;
  structure_embedding?: string; // JSON array
}

export interface LearnedPattern {
  id: string;
  category: string;
  keywords: string; // JSON array
  context_tags: string; // JSON array
  prerequisites: string; // JSON array
  verification: string; // JSON object
  confidence: number;
  applied_count: number;
  success_count: number;
  created_at: number;
  last_success?: number;
  pattern_embedding?: string; // JSON array
}

export interface DocumentationEntry {
  id?: number;
  url: string;
  technology: string;
  raw_content: string;
  structured_data: string; // JSON
  prerequisites?: string; // JSON array
  commands?: string; // JSON array
  verification_steps?: string; // JSON array
  common_errors?: string; // JSON array
  fetched_at: number;
  ttl_days: number;
  content_embedding: string; // JSON array
  linked_patterns?: string; // JSON array
}

export interface ExecutionRecord {
  id?: number;
  user_query: string;
  session_id: string;
  executor_type: string;
  plan: string; // JSON
  tool_invocations: string; // JSON array
  status: string;
  error_message?: string;
  root_cause_category?: string;
  pattern_id?: string;
  started_at: number;
  completed_at: number;
  duration_ms: number;
  extracted_patterns?: string; // JSON array
}

export interface KnowledgeEntry {
  id?: number;
  query: string;
  query_embedding: string; // JSON array
  answer: string; // JSON
  category: string;
  tech_stack?: string;
  sources: string; // JSON array
  confidence: number;
  success_count: number;
  failure_count: number;
  cached_at: number;
  accessed_at: number;
  ttl_days: number;
}

export class WorkspaceDB {
  private db: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    // Default: .frame/workspace.db in current directory
    this.dbPath = dbPath || path.join(process.cwd(), '.frame', 'workspace.db');

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initSchema();

    logger.info(`[WorkspaceDB] Initialized at ${this.dbPath}`);
  }

  private initSchema(): void {
    this.db.exec(`
      -- Workspace Context (persistent project structure)
      CREATE TABLE IF NOT EXISTS workspace_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_root TEXT NOT NULL,
        project_type TEXT NOT NULL,
        project_framework TEXT,
        directory_structure TEXT NOT NULL,
        package_manager TEXT,
        config_files TEXT NOT NULL,
        entry_points TEXT NOT NULL,
        available_scripts TEXT NOT NULL,
        discovered_at INTEGER NOT NULL,
        last_verified INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        structure_embedding TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_context_root ON workspace_context(project_root);
      CREATE INDEX IF NOT EXISTS idx_context_session ON workspace_context(session_id);

      -- Learned Patterns (Minsky frames)
      CREATE TABLE IF NOT EXISTS learned_patterns (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        keywords TEXT NOT NULL,
        context_tags TEXT NOT NULL,
        prerequisites TEXT NOT NULL,
        verification TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        applied_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_success INTEGER,
        pattern_embedding TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_pattern_category ON learned_patterns(category);
      CREATE INDEX IF NOT EXISTS idx_pattern_confidence ON learned_patterns(confidence);

      -- Documentation Cache (enriched docs)
      CREATE TABLE IF NOT EXISTS documentation_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        technology TEXT NOT NULL,
        raw_content TEXT NOT NULL,
        structured_data TEXT NOT NULL,
        prerequisites TEXT,
        commands TEXT,
        verification_steps TEXT,
        common_errors TEXT,
        fetched_at INTEGER NOT NULL,
        ttl_days INTEGER DEFAULT 7,
        content_embedding TEXT NOT NULL,
        linked_patterns TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_doc_technology ON documentation_cache(technology);
      CREATE INDEX IF NOT EXISTS idx_doc_url ON documentation_cache(url);

      -- Execution History
      CREATE TABLE IF NOT EXISTS execution_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_query TEXT NOT NULL,
        session_id TEXT NOT NULL,
        executor_type TEXT NOT NULL,
        plan TEXT NOT NULL,
        tool_invocations TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        root_cause_category TEXT,
        pattern_id TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        extracted_patterns TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_exec_session ON execution_history(session_id);
      CREATE INDEX IF NOT EXISTS idx_exec_status ON execution_history(status);

      -- Knowledge Cache (migrated from separate DB)
      CREATE TABLE IF NOT EXISTS knowledge_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        query_embedding TEXT NOT NULL,
        answer TEXT NOT NULL,
        category TEXT NOT NULL,
        tech_stack TEXT,
        sources TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        cached_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL,
        ttl_days INTEGER DEFAULT 30
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge_cache(category);
      CREATE INDEX IF NOT EXISTS idx_knowledge_tech ON knowledge_cache(tech_stack);
    `);

    logger.debug('[WorkspaceDB] Schema initialized');
  }

  // ============================================================
  // WORKSPACE CONTEXT
  // ============================================================

  storeContext(ctx: WorkspaceContext): void {
    const stmt = this.db.prepare(`
      INSERT INTO workspace_context (
        project_root, project_type, project_framework, directory_structure,
        package_manager, config_files, entry_points, available_scripts,
        discovered_at, last_verified, session_id, structure_embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      ctx.project_root,
      ctx.project_type,
      ctx.project_framework || null,
      ctx.directory_structure,
      ctx.package_manager || null,
      ctx.config_files,
      ctx.entry_points,
      ctx.available_scripts,
      ctx.discovered_at,
      ctx.last_verified,
      ctx.session_id,
      ctx.structure_embedding || null
    );

    logger.debug(`[WorkspaceDB] Stored context for ${ctx.project_root}`);
  }

  getContext(projectRoot: string, sessionId: string): WorkspaceContext | null {
    const stmt = this.db.prepare(`
      SELECT * FROM workspace_context
      WHERE project_root = ? AND session_id = ?
      ORDER BY discovered_at DESC
      LIMIT 1
    `);

    const row = stmt.get(projectRoot, sessionId) as WorkspaceContext | undefined;
    return row || null;
  }

  updateContextVerified(projectRoot: string, sessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE workspace_context
      SET last_verified = ?
      WHERE project_root = ? AND session_id = ?
    `);

    stmt.run(Date.now(), projectRoot, sessionId);
  }

  // ============================================================
  // LEARNED PATTERNS
  // ============================================================

  storePattern(pattern: LearnedPattern): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO learned_patterns (
        id, category, keywords, context_tags, prerequisites, verification,
        confidence, applied_count, success_count, created_at, last_success,
        pattern_embedding
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      pattern.id,
      pattern.category,
      pattern.keywords,
      pattern.context_tags,
      pattern.prerequisites,
      pattern.verification,
      pattern.confidence,
      pattern.applied_count,
      pattern.success_count,
      pattern.created_at,
      pattern.last_success || null,
      pattern.pattern_embedding || null
    );

    logger.debug(`[WorkspaceDB] Stored pattern: ${pattern.id}`);
  }

  getPattern(id: string): LearnedPattern | null {
    const stmt = this.db.prepare('SELECT * FROM learned_patterns WHERE id = ?');
    const row = stmt.get(id) as LearnedPattern | undefined;
    return row || null;
  }

  searchPatterns(opts: {
    category?: string;
    minConfidence?: number;
    limit?: number;
  }): LearnedPattern[] {
    let sql = 'SELECT * FROM learned_patterns WHERE 1=1';
    const params: any[] = [];

    if (opts.category) {
      sql += ' AND category = ?';
      params.push(opts.category);
    }

    if (opts.minConfidence) {
      sql += ' AND confidence >= ?';
      params.push(opts.minConfidence);
    }

    sql += ' ORDER BY confidence DESC, applied_count DESC';

    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as LearnedPattern[];
  }

  updatePatternSuccess(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE learned_patterns
      SET confidence = MIN(1.0, confidence + 0.05),
          applied_count = applied_count + 1,
          success_count = success_count + 1,
          last_success = ?
      WHERE id = ?
    `);

    stmt.run(Date.now(), id);
  }

  updatePatternFailure(id: string): void {
    const stmt = this.db.prepare(`
      UPDATE learned_patterns
      SET confidence = MAX(0.1, confidence - 0.1),
          applied_count = applied_count + 1
      WHERE id = ?
    `);

    stmt.run(id);
  }

  // ============================================================
  // DOCUMENTATION CACHE
  // ============================================================

  storeDocumentation(doc: DocumentationEntry): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO documentation_cache (
        url, technology, raw_content, structured_data, prerequisites,
        commands, verification_steps, common_errors, fetched_at,
        ttl_days, content_embedding, linked_patterns
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      doc.url,
      doc.technology,
      doc.raw_content,
      doc.structured_data,
      doc.prerequisites || null,
      doc.commands || null,
      doc.verification_steps || null,
      doc.common_errors || null,
      doc.fetched_at,
      doc.ttl_days,
      doc.content_embedding,
      doc.linked_patterns || null
    );

    logger.debug(`[WorkspaceDB] Stored documentation: ${doc.url}`);
  }

  getDocumentation(url: string): DocumentationEntry | null {
    const stmt = this.db.prepare('SELECT * FROM documentation_cache WHERE url = ?');
    const row = stmt.get(url) as DocumentationEntry | undefined;
    return row || null;
  }

  searchDocumentation(opts: {
    technology?: string;
    limit?: number;
  }): DocumentationEntry[] {
    let sql = 'SELECT * FROM documentation_cache WHERE 1=1';
    const params: any[] = [];

    if (opts.technology) {
      sql += ' AND technology = ?';
      params.push(opts.technology);
    }

    sql += ' ORDER BY fetched_at DESC';

    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as DocumentationEntry[];
  }

  // ============================================================
  // EXECUTION HISTORY
  // ============================================================

  recordExecution(record: ExecutionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO execution_history (
        user_query, session_id, executor_type, plan, tool_invocations,
        status, error_message, root_cause_category, pattern_id,
        started_at, completed_at, duration_ms, extracted_patterns
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.user_query,
      record.session_id,
      record.executor_type,
      record.plan,
      record.tool_invocations,
      record.status,
      record.error_message || null,
      record.root_cause_category || null,
      record.pattern_id || null,
      record.started_at,
      record.completed_at,
      record.duration_ms,
      record.extracted_patterns || null
    );

    logger.debug(`[WorkspaceDB] Recorded execution: ${record.status}`);
  }

  getExecutionHistory(opts: {
    sessionId?: string;
    status?: string;
    limit?: number;
  }): ExecutionRecord[] {
    let sql = 'SELECT * FROM execution_history WHERE 1=1';
    const params: any[] = [];

    if (opts.sessionId) {
      sql += ' AND session_id = ?';
      params.push(opts.sessionId);
    }

    if (opts.status) {
      sql += ' AND status = ?';
      params.push(opts.status);
    }

    sql += ' ORDER BY started_at DESC';

    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as ExecutionRecord[];
  }

  // ============================================================
  // KNOWLEDGE CACHE
  // ============================================================

  storeKnowledge(entry: KnowledgeEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_cache (
        query, query_embedding, answer, category, tech_stack, sources,
        confidence, success_count, failure_count, cached_at, accessed_at, ttl_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.query,
      entry.query_embedding,
      entry.answer,
      entry.category,
      entry.tech_stack || null,
      entry.sources,
      entry.confidence,
      entry.success_count,
      entry.failure_count,
      entry.cached_at,
      entry.accessed_at,
      entry.ttl_days
    );

    logger.debug(`[WorkspaceDB] Stored knowledge: ${entry.query}`);
  }

  searchKnowledge(opts: {
    category?: string;
    tech_stack?: string;
    minConfidence?: number;
    limit?: number;
  }): KnowledgeEntry[] {
    let sql = 'SELECT * FROM knowledge_cache WHERE 1=1';
    const params: any[] = [];

    if (opts.category) {
      sql += ' AND category = ?';
      params.push(opts.category);
    }

    if (opts.tech_stack) {
      sql += ' AND tech_stack = ?';
      params.push(opts.tech_stack);
    }

    if (opts.minConfidence) {
      sql += ' AND confidence >= ?';
      params.push(opts.minConfidence);
    }

    sql += ' ORDER BY confidence DESC, accessed_at DESC';

    if (opts.limit) {
      sql += ' LIMIT ?';
      params.push(opts.limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as KnowledgeEntry[];
  }

  updateKnowledgeSuccess(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE knowledge_cache
      SET confidence = MIN(1.0, confidence + 0.05),
          success_count = success_count + 1,
          accessed_at = ?
      WHERE id = ?
    `);

    stmt.run(Date.now(), id);
  }

  updateKnowledgeFailure(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE knowledge_cache
      SET confidence = MAX(0.1, confidence - 0.1),
          failure_count = failure_count + 1,
          accessed_at = ?
      WHERE id = ?
    `);

    stmt.run(Date.now(), id);
  }

  // ============================================================
  // UTILITIES
  // ============================================================

  close(): void {
    this.db.close();
    logger.info('[WorkspaceDB] Closed');
  }

  vacuum(): void {
    this.db.exec('VACUUM');
    logger.info('[WorkspaceDB] Vacuumed');
  }

  getStats(): {
    contexts: number;
    patterns: number;
    docs: number;
    executions: number;
    knowledge: number;
  } {
    const contexts = this.db.prepare('SELECT COUNT(*) as count FROM workspace_context').get() as { count: number };
    const patterns = this.db.prepare('SELECT COUNT(*) as count FROM learned_patterns').get() as { count: number };
    const docs = this.db.prepare('SELECT COUNT(*) as count FROM documentation_cache').get() as { count: number };
    const executions = this.db.prepare('SELECT COUNT(*) as count FROM execution_history').get() as { count: number };
    const knowledge = this.db.prepare('SELECT COUNT(*) as count FROM knowledge_cache').get() as { count: number };

    return {
      contexts: contexts.count,
      patterns: patterns.count,
      docs: docs.count,
      executions: executions.count,
      knowledge: knowledge.count,
    };
  }
}
