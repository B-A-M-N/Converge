import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/db/sqlite';
import { assertInvariant, InvariantViolationError, assertLeaseExclusivity, assertEventOrdering, assertNoEventGaps, assertActorAttribution } from './invariants';

describe('Invariant Assertion Library', () => {
  beforeEach(() => {
    // Set up test fixtures using db.transaction
    db.transaction(() => {
      // Clean tables
      db.exec('DELETE FROM events');
      db.exec('DELETE FROM jobs');
      db.exec('DELETE FROM runs');
      db.exec('DELETE FROM leases');
    })();
  });

  afterEach(() => {
    // Cleanup
    db.transaction(() => {
      db.exec('DELETE FROM events');
      db.exec('DELETE FROM jobs');
      db.exec('DELETE FROM runs');
      db.exec('DELETE FROM leases');
    })();
  });

  describe('assertInvariant', () => {
    it('passes when check returns true', async () => {
      await assertInvariant('TestInvariant', () => true);
    });

    it('throws InvariantViolationError when check returns false', async () => {
      await expect(
        assertInvariant('TestInvariant', () => false)
      ).rejects.toThrow(InvariantViolationError);
    });

    it('includes context in error details', async () => {
      await expect(
        assertInvariant('TestInvariant', () => false, { foo: 'bar' })
      ).rejects.toThrow((error: Error) => {
        expect((error as InvariantViolationError).details).toEqual({ foo: 'bar' });
        return true;
      });
    });
  });

  describe('assertLeaseExclusivity', () => {
    it('passes when no active runs or leases exist', async () => {
      await assertLeaseExclusivity('job-123');
    });

    it('passes when exactly 1 running run exists', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, name, interval_spec, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'test', '{"seconds": 60}');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-1', 'job-123', 'running');
      })();
      await assertLeaseExclusivity('job-123');
    });

    it('passes when exactly 1 active lease exists', async () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, name, interval_spec, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'test', '{"seconds": 60}');
        db.prepare('INSERT INTO leases (job_id, holder, acquired_at, expires_at) VALUES (?, ?, datetime(), ?)')
          .run('job-123', 'client-1', future);
      })();
      await assertLeaseExclusivity('job-123');
    });

    it('fails when 2 running runs exist', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, name, interval_spec, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'test', '{"seconds": 60}');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-1', 'job-123', 'running');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-2', 'job-123', 'running');
      })();
      await expect(assertLeaseExclusivity('job-123')).rejects.toThrow(InvariantViolationError);
    });

    it('fails when 2 active leases exist', async () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, name, interval_spec, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'test', '{"seconds": 60}');
        db.prepare('INSERT INTO leases (job_id, holder, acquired_at, expires_at) VALUES (?, ?, datetime(), ?)')
          .run('job-123', 'client-1', future);
        db.prepare('INSERT INTO leases (job_id, holder, acquired_at, expires_at) VALUES (?, ?, datetime(), ?)')
          .run('job-123', 'client-2', future);
      })();
      await expect(assertLeaseExclusivity('job-123')).rejects.toThrow(InvariantViolationError);
    });
  });

  describe('assertEventOrdering', () => {
    it('passes when events are strictly ordered', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO events (job_id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime())')
          .run('job-123', null, 'JOB_CREATED', '{}');
        db.prepare('INSERT INTO events (job_id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime())')
          .run('job-123', 'run-1', 'RUN_STARTED', '{}');
        db.prepare('INSERT INTO events (job_id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime())')
          .run('job-123', 'run-1', 'RUN_FINISHED', '{}');
      })();
      await assertEventOrdering('job-123');
    });

    it('fails when event gap exists (non-contiguous IDs)', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO events (id, job_id, type, payload, created_at) VALUES (1, ?, ?, ?, datetime())')
          .run('job-123', 'JOB_CREATED', '{}');
        db.prepare('INSERT INTO events (id, job_id, type, payload, created_at) VALUES (3, ?, ?, ?, datetime())')
          .run('job-123', 'RUN_STARTED', '{}'); // skip id 2
      })();
      await expect(assertEventOrdering('job-123')).rejects.toThrow(InvariantViolationError);
    });
  });

  describe('assertNoEventGaps', () => {
    it('passes when sequence is contiguous', async () => {
      db.transaction(() => {
        for (let i = 10; i <= 15; i++) {
          db.prepare('INSERT INTO events (id, job_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime())')
            .run(i, 'job-123', 'EVENT', '{}');
        }
      })();
      await assertNoEventGaps(10, 15);
    });

    it('fails when gap exists', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO events (id, job_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime())')
          .run(1, 'job-123', 'EVENT', '{}');
        db.prepare('INSERT INTO events (id, job_id, type, payload, created_at) VALUES (?, ?, ?, ?, datetime())')
          .run(3, 'job-123', 'EVENT', '{}');
      })();
      await expect(assertNoEventGaps(1, 3)).rejects.toThrow(InvariantViolationError);
    });
  });

  describe('assertActorAttribution', () => {
    it('passes when all STATE_CHANGED events have actor', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO events (job_id, type, payload, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'STATE_CHANGED', JSON.stringify({ from: 'pending', to: 'active', actorId: 'user1', actorType: 'human' }));
        db.prepare('INSERT INTO events (job_id, type, payload, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'STATE_CHANGED', JSON.stringify({ from: 'active', to: 'paused', actorId: 'sys', actorType: 'system' }));
      })();
      await assertActorAttribution('job-123');
    });

    it('fails when STATE_CHANGED event lacks actorId', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO events (job_id, type, payload, created_at) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'STATE_CHANGED', JSON.stringify({ from: 'pending', to: 'active' })); // missing actor
      })();
      await expect(assertActorAttribution('job-123')).rejects.toThrow(InvariantViolationError);
    });
  });
});
