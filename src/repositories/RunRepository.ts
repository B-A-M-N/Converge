import { db } from '../db/sqlite';
import { Run } from '../types';

function mapRunRow(row: any): Run {
  return { ...row } as Run;
}

export class RunRepository {
  static create(run: Run): void {
    db.prepare(`
      INSERT INTO runs (id, job_id, started_at, status, stdout_path, stderr_path, pid, is_ambiguous)
      VALUES (@id, @job_id, @started_at, @status, @stdout_path, @stderr_path, @pid, @is_ambiguous)
    `).run({
      id: run.id,
      job_id: run.job_id,
      started_at: run.started_at,
      status: run.status || 'running',
      stdout_path: run.stdout_path ?? null,
      stderr_path: run.stderr_path ?? null,
      pid: run.pid ?? null,
      is_ambiguous: run.is_ambiguous ?? 0,
    });
  }

  static get(id: string): Run | undefined {
    const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row ? mapRunRow(row) : undefined;
  }

  static getByJob(jobId: string): Run[] {
    return db.prepare('SELECT * FROM runs WHERE job_id = ? ORDER BY started_at DESC').all(jobId).map(mapRunRow);
  }

  static getActiveRun(jobId: string): Run | undefined {
    const row = db.prepare(`
      SELECT * FROM runs
      WHERE job_id = ? AND status = 'running'
      ORDER BY started_at DESC
      LIMIT 1
    `).get(jobId);
    return row ? mapRunRow(row) : undefined;
  }

  static getPid(runId: string): number | undefined {
    const row = db.prepare('SELECT pid FROM runs WHERE id = ?').get(runId) as { pid: number | null } | undefined;
    return row?.pid ?? undefined;
  }

  static setPid(runId: string, pid: number): void {
    db.prepare('UPDATE runs SET pid = ? WHERE id = ?').run(pid, runId);
  }

  static update(run: Partial<Run> & { id: string }): void {
    const updates: string[] = [];
    const params: any[] = [];
    for (const [key, value] of Object.entries(run)) {
      if (key === 'id') continue;
      updates.push(`${key} = ?`);
      // better-sqlite3 cannot bind booleans; convert to 0/1
      const bound = value === true ? 1 : value === false ? 0 : (value ?? null);
      params.push(bound);
    }
    if (updates.length === 0) return;
    params.push(run.id);
    db.prepare(`UPDATE runs SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  static getStuckRuns(): Run[] {
    const rows = db.prepare("SELECT * FROM runs WHERE status = 'running'").all();
    return rows.map(mapRunRow);
  }
}
