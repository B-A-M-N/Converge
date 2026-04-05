import { db } from '../db/sqlite';

export class LeaseRepository {
  static acquire(jobId: string, ownerId: string, durationMs: number, isRenewal: boolean = false): boolean {
    const sql = `INSERT INTO leases (job_id, owner_id, acquired_at, expires_at) VALUES (?, ?, STRFTIME('%Y-%m-%d %H:%M:%f','now'), STRFTIME('%Y-%m-%d %H:%M:%f','now', ?)) ON CONFLICT(job_id) DO UPDATE SET owner_id=excluded.owner_id, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at WHERE leases.expires_at < STRFTIME('%Y-%m-%d %H:%M:%f','now') OR (leases.owner_id = excluded.owner_id AND ? = 1)`;
    const durationSeconds = (durationMs / 1000).toFixed(3);
    const info = db.prepare(sql).run(jobId, ownerId, `+${durationSeconds} seconds`, isRenewal ? 1 : 0);
    return info.changes === 1;
  }

  static release(jobId: string, ownerId: string): void {
    db.prepare('DELETE FROM leases WHERE job_id = ? AND owner_id = ?').run(jobId, ownerId);
  }

  static getActiveLease(jobId: string): { expires_at: string; owner_id: string } | undefined {
    const row = db.prepare('SELECT expires_at, owner_id FROM leases WHERE job_id = ? AND expires_at > STRFTIME(\'%Y-%m-%d %H:%M:%f\',\'now\')').get(jobId);
    return row as { expires_at: string; owner_id: string } | undefined;
  }
}
