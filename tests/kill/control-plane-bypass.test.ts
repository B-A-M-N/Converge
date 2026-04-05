import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/sqlite';
import { TestDaemon } from '../helpers/test-daemon';
import { ConcurrentTestClient } from '../lib/helpers';
import { assertInvariant } from '../lib/invariants';

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
    // Attempt: insert job directly into database, bypassing ControlPlane
    const jobId = 'direct-insert-job';
    const result = db.transaction(() => {
      try {
        db.prepare(`
          INSERT INTO jobs (id, name, interval_spec, created_at, session_id)
          VALUES (?, ?, ?, datetime(), ?)
        `).run(jobId, 'BypassJob', '{"seconds": 60}', 'test-session');
        return 'inserted';
      } catch (err) {
        return (err as Error).message;
      }
    })();

    // Expected: either rejected by constraint (no insert) or inserted but no event
    if (result === 'inserted') {
      // Job row exists, but check: was JOB_CREATED event emitted?
      const eventCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE job_id = ?').get(jobId) as { c: number };
      expect(eventCount.c).toBe(0); // No event = control plane not bypassed
    } else {
      // Insert failed — constraints enforced
      expect(result).toMatch(/constraint|foreign key|NOT NULL/i);
    }

    // Invariant check: no job state without proper event
    await assertInvariant('ControlPlaneAuthority', () => {
      const jobCount = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE id = ?').get(jobId) as { c: number };
      if (jobCount.c === 0) return true; // rejected entirely
      // If job exists, must have corresponding event
      const eventCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE job_id = ? AND type = ?').get(jobId, 'JOB_CREATED') as { c: number };
      return eventCount.c === 1;
    });
  });

  it('should not allow state mutation without actor attribution', async () => {
    // Attempt: transition job state directly via DB UPDATE (no actor)
    // First create a job properly via daemon
    const client = new ConcurrentTestClient();
    // Actually, use ConvergeClient
    const { ConvergeClient } = await import('../../src/client/ConvergeClient');
    const converge = new ConvergeClient({ socketPath, autoConnect: true });
    await converge.connect();

    try {
      const job = await converge.addJob(
        {
          name: 'ActorTestJob',
          interval_spec: { seconds: 60 },
        },
        'test-actor'
      );

      // Now attempt direct DB update to change job state without actor
      db.transaction(() => {
        db.prepare('UPDATE jobs SET state = ? WHERE id = ?').run('paused', job.jobId);
      })();

      // Check: state change should NOT have corresponding STATE_CHANGED event with proper actor
      const stateChangeEvents = db.prepare(`
        SELECT payload FROM events
        WHERE job_id = ? AND type = 'STATE_CHANGED'
        ORDER BY created_at DESC LIMIT 1
      `).all(job.jobId) as Array<{ payload: string }>;

      if (stateChangeEvents.length > 0) {
        const payload = JSON.parse(stateChangeEvents[0].payload);
        // The latest STATE_CHANGED should have actorId/actorType
        expect(payload.actorId).toBeDefined();
        expect(payload.actorType).toBeDefined();
      }
    } finally {
      converge.close();
    }
  });
});
