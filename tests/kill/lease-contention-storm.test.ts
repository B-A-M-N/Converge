import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConcurrentTestClient } from '../lib/helpers';
import { assertLeaseExclusivity, assertInvariant } from '../lib/invariants';

describe('KILL TEST: Lease Contention Storm', () => {
  let daemon: TestDaemon;
  let socketPath: string;

  beforeEach(async () => {
    daemon = new TestDaemon('lease-storm-test');
    await daemon.start();
    socketPath = daemon.getSocketPath();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('should enforce lease exclusivity under 50 parallel runNow attempts', async () => {
    // Create a job first
    const { ConvergeClient } = await import('../../src/client/ConvergeClient');
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      const jobName = `lease-storm-job-${Date.now()}`;
      const job = await client.addJob(
        {
          name: jobName,
          interval_spec: { seconds: 60 },
          adapter: 'sequential',
          tasks: [{ command: 'true' }], // Simple immediate exit
          stop_condition: { max_iterations: 1 },
        },
        'test-actor'
      );

      // Now launch 50 parallel runNow attempts using ConcurrentTestClient.assertExclusiveRun
      await ConcurrentTestClient.assertExclusiveRun(
        socketPath,
        async (client, actorId) => {
          return await client.runNow(job.jobId!!, actorId);
        },
        50
      );

      // Verify exactly one active lease/run exists
      await assertLeaseExclusivity(job.jobId!!);

      // Double-check via DB: exactly one run should have been created (completed, not running,
      // since the command exits immediately).
      const db = require('better-sqlite3')(daemon.getDbPath());
      const result = db.prepare("SELECT COUNT(*) as c FROM runs WHERE job_id = ? AND status IN ('running','completed')").get(job.jobId!) as { c: number };
      expect(result.c).toBe(1);
      db.close();
    } finally {
      client.close();
    }
  });

  it('should fail losers with clear contention error', async () => {
    const { ConvergeClient } = await import('../../src/client/ConvergeClient');
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      const jobName = `lease-storm-error-test-${Date.now()}`;
      const job = await client.addJob(
        {
          name: jobName,
          interval_spec: { seconds: 60 },
          adapter: 'sequential',
          tasks: [{ command: 'true' }],
          stop_condition: { max_iterations: 1 },
        },
        'test-actor'
      );

      // Run 20 parallel attempts to increase chance of losers.
      // Let runInParallel handle errors so that successes/failures are correctly tracked.
      const results = await ConcurrentTestClient.runInParallel(
        socketPath,
        20,
        async (client, actorId) => {
          const run = await client.runNow(job.jobId!!, actorId);
          return { runId: run.runId };
        }
      );

      const successes = results.filter(r => r.success);
      const failures = results.filter(r => !r.success);

      // Exactly one success
      expect(successes.length).toBe(1);

      // Losers should get an error indicating lease contention
      expect(failures.length).toBeGreaterThan(0);
      for (const f of failures) {
        expect(f.error).toMatch(/lease|contention|already|active/i);
      }
    } finally {
      client.close();
    }
  });

  it('should remain stable across multiple contention storms', async () => {
    const { ConvergeClient } = await import('../../src/client/ConvergeClient');
    const client = new ConvergeClient({ socketPath, autoConnect: true });
    await client.connect();

    try {
      // Run the contention storm 3 times on fresh jobs to ensure no flakiness
      for (let round = 0; round < 3; round++) {
        const jobName = `lease-storm-multi-${Date.now()}-${round}`;
        const job = await client.addJob(
          {
            name: jobName,
            interval_spec: { seconds: 60 },
            adapter: 'sequential',
            tasks: [{ command: 'true' }],
            stop_condition: { max_iterations: 1 },
          },
          'test-actor'
        );

        await ConcurrentTestClient.assertExclusiveRun(
          socketPath,
          async (client, actorId) => await client.runNow(job.jobId!!, actorId),
          50
        );

        await assertLeaseExclusivity(job.jobId!!);
      }
    } finally {
      client.close();
    }
  });
});
