import { db } from '../db/sqlite';

export interface EventRow {
  id: number;
  job_id: string;
  event_type: string;
  actor_id: string;
  timestamp: string;
  metadata: string | null;
}

export class EventRepository {
  static init(): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
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
    `);
  }

  static insert(event: Omit<EventRow, 'id'>): void {
    db.prepare(
      'INSERT INTO events (job_id, event_type, actor_id, timestamp, metadata) VALUES (?, ?, ?, ?, ?)'
    ).run(event.job_id, event.event_type, event.actor_id, event.timestamp, event.metadata ?? null);
  }

  static getByJob(jobId: string): EventRow[] {
    return db.prepare('SELECT * FROM events WHERE job_id = ? ORDER BY timestamp ASC').all(jobId) as EventRow[];
  }

  static countByJobAndType(jobId: string, eventType: string): number {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE job_id = ? AND event_type = ?').get(jobId, eventType) as { cnt: number };
    return row.cnt;
  }
}
