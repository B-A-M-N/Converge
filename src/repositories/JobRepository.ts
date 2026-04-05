import { db } from '../db/sqlite';
import { Job } from '../types';
import { StructuredEventEmitter } from '../daemon/event-emitter';

function transaction<T extends (...args: any[]) => any>(fn: T): T {
  return db.transaction(fn) as unknown as T;
}

function jobRowToJob(row: any): Job {
  return {
    ...row,
    triggers: row.triggers ? JSON.parse(row.triggers) : null,
  } as Job;
}

export class JobRepository {
  static create = transaction((job: Job) => {
    const jobWithDefaults = {
      id: job.id,
      name: job.name ?? null,
      cli: job.cli,
      cwd: job.cwd,
      task: job.task,
      interval_spec: job.interval_spec ?? '',
      timezone: job.timezone ?? null,
      session_id: job.session_id ?? null,
      actor: job.actor ?? null,
      state: job.state,
      stop_condition_json: job.stop_condition_json ?? null,
      max_iterations: job.max_iterations ?? null,
      max_failures: job.max_failures,
      expires_at: job.expires_at ?? null,
      created_at: job.created_at,
      updated_at: job.updated_at,
      last_run_at: job.last_run_at ?? null,
      next_run_at: job.next_run_at ?? null,
      convergence_mode: job.convergence_mode ?? 'normal',
      execution_kind: job.execution_kind ?? 'general',
      triggers: job.triggers ? JSON.stringify(job.triggers) : '[]',
      trigger_mode: job.trigger_mode ?? 'enqueue',
      debounce_ms: job.debounce_ms ?? 0,
    };
    const stmt = db.prepare(`
      INSERT INTO jobs (id, name, cli, cwd, task, interval_spec, timezone, session_id, actor, state, stop_condition_json, max_iterations, max_failures, expires_at, created_at, updated_at, last_run_at, next_run_at, convergence_mode, execution_kind, triggers, trigger_mode, debounce_ms)
      VALUES (@id, @name, @cli, @cwd, @task, @interval_spec, @timezone, @session_id, @actor, @state, @stop_condition_json, @max_iterations, @max_failures, @expires_at, @created_at, @updated_at, @last_run_at, @next_run_at, @convergence_mode, @execution_kind, @triggers, @trigger_mode, @debounce_ms)
    `);
    stmt.run(jobWithDefaults);
    StructuredEventEmitter.jobCreated(job);
  });

  static get(id: string): Job | undefined {
    const row = db.prepare('SELECT * FROM jobs WHERE id = ? AND deleted_at IS NULL').get(id);
    return row ? jobRowToJob(row) : undefined;
  }

  static list(): Job[] {
    return db.prepare('SELECT * FROM jobs WHERE deleted_at IS NULL').all().map(jobRowToJob);
  }

  static getDueJobs(now: string = new Date().toISOString()): Job[] {
    return db.prepare(`
      SELECT * FROM jobs
      WHERE state IN ('active', 'repeat_detected', 'convergence_candidate')
        AND deleted_at IS NULL
        AND interval_spec != ''
        AND next_run_at IS NOT NULL
        AND next_run_at <= ?
      ORDER BY next_run_at ASC
    `).all(now).map(jobRowToJob);
  }

  static updateState(id: string, newState: string): void {
    db.prepare(`UPDATE jobs SET state = ?, updated_at = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`).run(newState, id);
  }

  static updateNextRun(id: string, nextRunAt: string | null, finishedAt?: string, sessionId?: string | null): void {
    void(sessionId);
    db.prepare('UPDATE jobs SET next_run_at = ?, last_run_at = COALESCE(?, last_run_at), updated_at = STRFTIME(\'%Y-%m-%d %H:%M:%f\',\'now\') WHERE id = ?').run(nextRunAt, finishedAt ?? null, id);
  }

  static delete(id: string): void {
    db.prepare("UPDATE jobs SET state = 'cancelled', deleted_at = STRFTIME('%Y-%m-%d %H:%M:%f','now'), updated_at = STRFTIME('%Y-%m-%d %H:%M:%f','now') WHERE id = ?").run(id);
  }

  static setRecoveryRequired(jobId: string): void {
    db.prepare('UPDATE jobs SET recovery_required = 1 WHERE id = ?').run(jobId);
  }
}
