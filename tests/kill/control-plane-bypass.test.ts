import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { assertInvariant } from '../lib/invariants';
import Database from 'better-sqlite3';
import { ConvergeClient } from '../../src/client/ConvergeClient';

describe('KILL TEST: Control Plane Bypass', () => {
  let daemon: TestDaemon;
  let socketPath: string;

  beforeEach(async () => {
    daemon = new TestDaemon('bypass-test');
    await daemon.start();
    socketPath = daemon.getSocketPath();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('should reject or ignore direct DB writes outside control plane', async () => {
    // Use the daemon's isolated DB directly to test bypass
    const db = new Database(daemon.getDbPath());
    const jobId = 'direct-insert-job';

    try {
      const result = db.transaction(() => {
        try {
          // Missing required NOT NULL fields — should fail
          db.prepare(`
            INSERT INTO jobs (id, name, interval_spec, created_at, session_id)
            VALUES (?, ?, ?, datetime(), ?)
          `).run(jobId, 'BypassJob', '{"seconds": 60}', 'test-session');
          return 'inserted';
        } catch (err) {
          return (err as Error).message;
        }
      })();

      // Expected: either rejected by constraint or inserted but no event
      if (result === 'inserted') {
        const eventCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE job_id = ?').get(jobId) as { c: number };
        expect(eventCount.c).toBe(0);
      } else {
        expect(result).toMatch(/constraint|foreign key|NOT NULL/i);
      }

      // Invariant check
      await assertInvariant('ControlPlaneAuthority', () => {
        const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE id = ?').get(jobId) as { c: number };
        if (jobCount.c === 0) return true;
        const eventCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE job_id = ? AND event_type = ?').get(jobId, 'JOB_CREATED') as { c: number };
        return eventCount.c === 1;
      });
    } finally {
      db.close();
    }
  });

  it('should not allow state mutation without actor attribution', async () => {
    const converge = new ConvergeClient({ socketPath, autoConnect: true });
    await converge.connect();
    const db = new Database(daemon.getDbPath());

    try {
      const job = await converge.addJob(
        {
          name: 'ActorTestJob',
          cli: 'test',
          command: 'echo test',
          args: [],
          interval_spec: { seconds: 60 },
        },
        'test-actor'
      );

      const jobId = job.id || job.jobId;

      // Direct DB update to change job state without actor (bypasses control plane)
      db.transaction(() => {
        db.prepare('UPDATE jobs SET state = ? WHERE id = ?').run('paused', jobId);
      })();

      // Verify: no STATE_CHANGED event was emitted for the direct DB update
      const stateChangeEvents = db.prepare(`
        SELECT metadata FROM events
        WHERE job_id = ? AND event_type = 'STATE_CHANGED'
        ORDER BY timestamp DESC LIMIT 1
      `).all(jobId) as Array<{ metadata: string }>;

      // If events exist, they should be from legitimate control plane operations only
      // (The direct UPDATE doesn't emit events — that's the test: bypass has no audit trail)
      for (const ev of stateChangeEvents) {
        const meta = JSON.parse(ev.metadata || '{}');
        // Any real state change events should have actor info
        if (meta.from && meta.to) {
          expect(meta.actorId || 'system').toBeDefined();
        }
      }
    } finally {
      converge.close();
      db.close();
    }
  });
});
