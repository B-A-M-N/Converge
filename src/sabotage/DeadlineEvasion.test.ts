import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { JobRepository } from '../repositories/JobRepository';
import { EventRepository } from '../repositories/EventRepository';
import { db } from '../db/sqlite';

describe('DeadlineEvasion', () => {
  beforeAll(() => {
    EventRepository.init();
  });

  beforeEach(() => {
    db.exec('DELETE FROM jobs');
  });

  it('excludes expired jobs from due set (pre-dispatch eligibility)', () => {
    const now = new Date('2025-01-01T12:00:00Z');
    const nowIso = now.toISOString();

    const createJob = (id: string, expires_at: string | null, next_run_at_offset: number) => {
      const nextRun = new Date(now.getTime() + next_run_at_offset * 60 * 1000).toISOString();
      JobRepository.create({
        id,
        name: `job-${id}`,
        cli: 'test',
        cwd: '/tmp',
        task: 'echo test',
        interval_spec: '1h',
        timezone: null,
        session_id: null,
        state: 'active',
        stop_condition_json: null,
        max_iterations: null,
        max_failures: 3,
        expires_at,
        created_at: nowIso,
        updated_at: nowIso,
        last_run_at: null,
        next_run_at: nextRun,
      });
    };

    // Expired job: expires_at 1 hour in the past, next_run_at = now (due)
    createJob('expired', new Date('2025-01-01T10:00:00Z').toISOString(), 0);

    // Valid future: expires_at 1 hour in the future
    createJob('valid-future', new Date('2025-01-01T13:00:00Z').toISOString(), 0);

    // Valid null: expires_at is NULL
    createJob('valid-null', null, 0);

    const dueJobs = JobRepository.getDueJobs(nowIso);
    const ids = dueJobs.map(j => j.id);

    expect(ids).toContain('valid-future');
    expect(ids).toContain('valid-null');
    expect(ids).not.toContain('expired');
  });
});
