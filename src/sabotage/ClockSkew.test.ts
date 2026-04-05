import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runSchedulerTick } from '../daemon/scheduler';
import { JobRepository } from '../repositories/JobRepository';
import { ControlPlane } from '../core/ControlPlane';
import { db } from '../db/sqlite';
import * as scheduler from '../daemon/scheduler';

// Mock the executor to avoid actual job execution
vi.mock('../daemon/executor', async () => {
  const original = await vi.importActual('../daemon/executor');
  return {
    ...original,
    executeJob: vi.fn().mockResolvedValue(undefined),
  };
});

describe('ClockSkew', () => {
  beforeEach(() => {
    db.exec('DELETE FROM jobs');
    // Reset mock call count
    const executor = require('../daemon/executor');
    const executeJob = executor.executeJobInternal;
    if (executeJob) executeJob.mockClear?.();
    // Set a low limit for truncation test
    (scheduler as any).MAX_JOBS_PER_TICK = 5;
  });

  afterEach(() => {
    // Restore default
    (scheduler as any).MAX_JOBS_PER_TICK = 100;
  });

  it('past seed: job with next_run_at in past is due immediately', () => {
    const now = new Date('2025-01-15T12:00:00Z');
    const nowIso = now.toISOString();

    // Job with next_run_at 14 days ago
    JobRepository.create({
      id: 'past-job',
      name: 'Past Job',
      cli: 'test',
      cwd: '/tmp',
      task: 'echo',
      interval_spec: '1h',
      timezone: null,
      session_id: null,
      state: 'active',
      stop_condition_json: null,
      max_iterations: null,
      max_failures: 3,
      expires_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      last_run_at: null,
      next_run_at: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString(),
    });

    // Job with next_run_at in future (1 month)
    JobRepository.create({
      id: 'future-job',
      name: 'Future Job',
      cli: 'test',
      cwd: '/tmp',
      task: 'echo',
      interval_spec: '1h',
      timezone: null,
      session_id: null,
      state: 'active',
      stop_condition_json: null,
      max_iterations: null,
      max_failures: 3,
      expires_at: null,
      created_at: nowIso,
      updated_at: nowIso,
      last_run_at: null,
      next_run_at: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const due = ControlPlane.getDueJobs(nowIso);
    const ids = due.map(j => j.id);

    expect(ids).toContain('past-job');
    expect(ids).not.toContain('future-job');
  });

  it('forward jump: truncates when many jobs become due', async () => {
    const now = new Date('2025-01-15T12:00:00Z');
    const nowIso = now.toISOString();
    const JOB_COUNT = 10;

    // Create many due jobs
    for (let i = 0; i < JOB_COUNT; i++) {
      JobRepository.create({
        id: `job-${i}`,
        name: `Job ${i}`,
        cli: 'test',
        cwd: '/tmp',
        task: 'echo',
        interval_spec: '1h',
        timezone: null,
        session_id: null,
        state: 'active',
        stop_condition_json: null,
        max_iterations: null,
        max_failures: 3,
        expires_at: null,
        created_at: nowIso,
        updated_at: nowIso,
        last_run_at: null,
        next_run_at: new Date(now.getTime() - i * 60 * 1000).toISOString(), // all in past
      });
    }

    // Import the mocked executeJob
    const executor = await import('../daemon/executor');
    const mockExecute = executor.executeJobInternal as unknown as ReturnType<typeof vi.fn>;

    await runSchedulerTick();

    // Should have been called at most MAX_JOBS_PER_TICK times (5)
    expect(mockExecute).toHaveBeenCalledTimes(5);
  });
});
