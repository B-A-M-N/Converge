import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConcurrentTestClient } from '../lib/helpers';
import { assertInvariant } from '../lib/invariants';
import { ConvergeClient } from '../../src/client/ConvergeClient';

describe('KILL TEST: Bounded Execution (Infinite Loop Prevention)', () => {
  let daemon: TestDaemon;
  let socketPath: string;

  beforeEach(async () => {
    daemon = new TestDaemon('infinite-loop-test');
    await daemon.start();
    socketPath = daemon.getSocketPath();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('should enforce max_iterations and prevent unbounded execution', async () => {
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      // Create job with small max_iterations limit
      const job = await client.createJob(
        {
          cli: 'test',
          command: 'true',
          args: [],
          interval_spec: 'once',
          max_iterations: 2,
        },
        'test-actor'
      );

      const jobId = job.id;

      // First run should succeed
      const run1 = await client.runNow(jobId, 'test-actor');
      expect(run1).toBeDefined();

      // Wait for completion
      await new Promise(resolve => setTimeout(resolve, 500));

      // Second run should also succeed (within limit)
      const run2 = await client.runNow(jobId, 'test-actor');
      expect(run2).toBeDefined();

      await new Promise(resolve => setTimeout(resolve, 500));

      // Third run should be rejected because job has reached max_iterations
      await expect(client.runNow(jobId, 'test-actor')).rejects.toThrow();

      // Invariant: No run remains in 'running' state indefinitely
      await assertInvariant('BoundedExecution', async () => {
        const { default: Database } = await import('better-sqlite3');
        const dbPath = require('path').join(daemon.getHomeDir(), '.converge', 'converge.db');
        const db = new Database(dbPath);
        try {
          const runningCount = db.prepare(`
            SELECT COUNT(*) as c FROM runs
            WHERE job_id = ? AND status = 'running'
          `).get(jobId) as { c: number };
          return runningCount.c === 0;
        } finally {
          db.close();
        }
      });
    } finally {
      client.close();
    }
  });
});
