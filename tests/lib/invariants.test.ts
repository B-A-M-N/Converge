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
      const error = await assertInvariant('TestInvariant', () => false, { foo: 'bar' }).catch(e => e);
      expect(error).toBeInstanceOf(InvariantViolationError);
      expect((error as InvariantViolationError).details).toEqual({ foo: 'bar' });
    });
  });

  describe('assertLeaseExclusivity', () => {
    it('passes when no active runs or leases exist', async () => {
      await assertLeaseExclusivity('job-123');
    });

    it('passes when exactly 1 running run exists', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-1', 'job-123', 'running');
      })();
      await assertLeaseExclusivity('job-123');
    });

    it('passes when exactly 1 active lease exists', async () => {
      const future = new Date(Date.now() + 3600000).toISOString();
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO leases (job_id, owner_id, acquired_at, expires_at) VALUES (?, ?, datetime(), ?)')
          .run('job-123', 'client-1', future);
      })();
      await assertLeaseExclusivity('job-123');
    });

    it('fails when 2 running runs exist', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-1', 'job-123', 'running');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-2', 'job-123', 'running');
      })();
      await expect(assertLeaseExclusivity('job-123')).rejects.toThrow(InvariantViolationError);
    });

    it('fails when 2 active runs exist', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        // Insert two runs in 'running' state — schema allows this (no unique constraint on runs.status)
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-1', 'job-123', 'running');
        db.prepare('INSERT INTO runs (id, job_id, status, started_at) VALUES (?, ?, ?, datetime())')
          .run('run-2', 'job-123', 'running');
      })();
      await expect(assertLeaseExclusivity('job-123')).rejects.toThrow(InvariantViolationError);
    });
  });

  describe('assertEventOrdering', () => {
    it('passes when events are strictly ordered', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO events (job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'JOB_CREATED', 'system');
        db.prepare('INSERT INTO events (job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'RUN_STARTED', 'system');
        db.prepare('INSERT INTO events (job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'RUN_FINISHED', 'system');
      })();
      await assertEventOrdering('job-123');
    });

    it('fails when event gap exists (non-contiguous IDs)', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO events (id, job_id, event_type, actor_id, timestamp) VALUES (1, ?, ?, ?, datetime())')
          .run('job-123', 'JOB_CREATED', 'system');
        db.prepare('INSERT INTO events (id, job_id, event_type, actor_id, timestamp) VALUES (3, ?, ?, ?, datetime())')
          .run('job-123', 'RUN_STARTED', 'system'); // skip id 2
      })();
      await expect(assertEventOrdering('job-123')).rejects.toThrow(InvariantViolationError);
    });
  });

  describe('assertNoEventGaps', () => {
    it('passes when sequence is contiguous', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        for (let i = 10; i <= 15; i++) {
          db.prepare('INSERT INTO events (id, job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, ?, datetime())')
            .run(i, 'job-123', 'EVENT', 'system');
        }
      })();
      await assertNoEventGaps(10, 15);
    });

    it('fails when gap exists', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO events (id, job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, ?, datetime())')
          .run(1, 'job-123', 'EVENT', 'system');
        db.prepare('INSERT INTO events (id, job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, ?, datetime())')
          .run(3, 'job-123', 'EVENT', 'system');
      })();
      await expect(assertNoEventGaps(1, 3)).rejects.toThrow(InvariantViolationError);
    });
  });

  describe('assertActorAttribution', () => {
    it('passes when all STATE_CHANGED events have actor', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO events (job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'STATE_CHANGED', 'user1');
        db.prepare('INSERT INTO events (job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'STATE_CHANGED', 'sys');
      })();
      await assertActorAttribution('job-123');
    });

    it('fails when STATE_CHANGED event lacks actorId', async () => {
      db.transaction(() => {
        db.prepare('INSERT INTO jobs (id, cli, cwd, task, interval_spec, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, datetime(), datetime())')
          .run('job-123', 'test', '/tmp', 'echo test', '{"seconds": 60}', 'pending');
        db.prepare('INSERT INTO events (job_id, event_type, actor_id, timestamp) VALUES (?, ?, ?, datetime())')
          .run('job-123', 'STATE_CHANGED', ''); // empty actor_id
      })();
      await expect(assertActorAttribution('job-123')).rejects.toThrow(InvariantViolationError);
    });
  });
});
