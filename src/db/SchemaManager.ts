import { db } from './sqlite';

const MIGRATIONS = [
  // Migration 1: Core tables
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        name TEXT,
        cli TEXT NOT NULL,
        cwd TEXT NOT NULL,
        task TEXT NOT NULL,
        interval_spec TEXT NOT NULL,
        timezone TEXT,
        session_id TEXT,
        actor TEXT,
        state TEXT NOT NULL DEFAULT 'pending',
        stop_condition_json TEXT,
        max_iterations INTEGER,
        max_failures INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT,
        deleted_at TEXT,
        recovery_required INTEGER DEFAULT 0,
        spec_hash TEXT,
        interval_ms INTEGER
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        exit_code INTEGER,
        output TEXT,
        stdout_path TEXT,
        stderr_path TEXT,
        summary_json TEXT,
        should_continue BOOLEAN,
        reason TEXT,
        pid INTEGER,
        output_hash TEXT,
        provenance_json TEXT,
        is_ambiguous INTEGER DEFAULT 0,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS leases (
        job_id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
    `,
  },
  // Migration 2: _migrations audit table
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        checksum TEXT NOT NULL
      );
    `,
  },
  // Migration 17: Rebuild events table to current schema
  {
    version: 17,
    sql: `
      DROP TABLE IF EXISTS events;
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_events_job_id ON events(job_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
    `,
  },
];

export class SchemaManager {
  static async initialize(): Promise<void> {
    const currentVersion: number = db.pragma('user_version', { simple: true }) as number;

    for (const migration of MIGRATIONS) {
      if (migration.version > currentVersion) {
        db.transaction(() => {
          db.exec(migration.sql);
          db.prepare(
            'INSERT OR REPLACE INTO _migrations (version, applied_at, checksum) VALUES (?, ?, ?)'
          ).run(
            migration.version,
            new Date().toISOString(),
            'sha256-placeholder'
          );
        })();
        db.pragma(`user_version = ${migration.version}`);
      }
    }
  }

  static validateSchema(): void {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    const requiredTables = ['jobs', 'runs', 'leases'];

    for (const required of requiredTables) {
      if (!tableNames.includes(required)) {
        throw new SchemaDriftError(`Required table '${required}' is missing`);
      }
    }
  }
}

export class SchemaDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaDriftError';
  }
}
