import initSqlJs, { Database as SqlJsDatabase } from "sql.js";

declare global {
  interface Window {
    priva: any;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, parent_id TEXT, root_id TEXT,
  sort_key TEXT NOT NULL, properties TEXT NOT NULL DEFAULT '{}', content TEXT,
  icon TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL, weight REAL DEFAULT 1.0, metadata TEXT DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS columns (
  id TEXT PRIMARY KEY, database_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', sort_key TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cells (
  row_id TEXT NOT NULL, column_id TEXT NOT NULL, value TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (row_id, column_id)
);
CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL, payload TEXT NOT NULL, recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS views (
  id TEXT PRIMARY KEY, database_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}', sort_key TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
`;

class Database {
  private api: any = null;
  private memDb: SqlJsDatabase | null = null;
  private isElectron: boolean;

  constructor() {
    this.isElectron = typeof window !== "undefined" && !!window.priva?.db;
    if (this.isElectron) {
      this.api = window.priva.db;
    }
  }

  private async ensureMemDb() {
    if (this.memDb) return;
    const SQL = await initSqlJs();
    this.memDb = new SQL.Database();
    this.memDb.run(SCHEMA);
  }

  private runMemQuery(sql: string, params: any[] = []): any[] {
    if (!this.memDb) return [];
    const stmt = this.memDb.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  private runMemExec(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number } {
    if (!this.memDb) return { changes: 0, lastInsertRowid: 0 };
    if (params.length > 0) this.memDb.run(sql, params);
    else this.memDb.run(sql);
    const changes = this.memDb.getRowsModified();
    const last = this.runMemQuery("SELECT last_insert_rowid() as id");
    return { changes, lastInsertRowid: last[0]?.id || 0 };
  }

  async query<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (this.isElectron) return this.api.query(sql, params) as Promise<T[]>;
    await this.ensureMemDb();
    return this.runMemQuery(sql, params) as T[];
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
    if (this.isElectron) return this.api.execute(sql, params);
    await this.ensureMemDb();
    return this.runMemExec(sql, params);
  }

  async transaction(operations: { sql: string; params: unknown[] }[]): Promise<any[]> {
    if (this.isElectron) return this.api.transaction(operations);
    await this.ensureMemDb();
    this.memDb!.run("BEGIN TRANSACTION");
    const results: any[] = [];
    try {
      for (const op of operations) {
        const isSelect = op.sql.trimStart().toUpperCase().startsWith("SELECT");
        results.push(isSelect ? this.runMemQuery(op.sql, op.params || []) : this.runMemExec(op.sql, op.params || []));
      }
      this.memDb!.run("COMMIT");
      return results;
    } catch (err) {
      this.memDb!.run("ROLLBACK");
      throw err;
    }
  }

  async get<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  async all<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.query<T>(sql, params);
  }
}

export const db = new Database();
