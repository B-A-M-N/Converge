import { db } from '../../src/db/sqlite';
import { EventRepository } from '../../src/repositories/EventRepository';
import { RunRepository } from '../../src/repositories/RunRepository';
import { JobRepository } from '../../src/repositories/JobRepository';
import { LeaseRepository } from '../../src/repositories/LeaseRepository';

export class InvariantViolationError extends Error {
  constructor(
    invariantName: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(`[INVARIANT VIOLATION: ${invariantName}] ${message}`);
    this.name = 'InvariantViolationError';
  }
}

/**
 * Assert that an invariant check passes.
 * Throws InvariantViolationError if check returns false.
 */
export async function assertInvariant(
  name: string,
  check: () => boolean | Promise<boolean>,
  context?: Record<string, unknown>
): Promise<void> {
  const result = await Promise.resolve(check());
  if (!result) {
    throw new InvariantViolationError(name, 'Invariant check failed', context);
  }
}

/**
 * Assert that at most one active run exists for a given jobId.
 * Implements: Lease Exclusivity invariant.
 */
export async function assertLeaseExclusivity(jobId: string): Promise<void> {
  const activeRuns = db
    .prepare('SELECT COUNT(*) as c FROM runs WHERE job_id = ? AND status = ?')
    .get(jobId, 'running') as { c: number };
  const activeLeases = db
    .prepare('SELECT COUNT(*) as c FROM leases WHERE job_id = ? AND expires_at > ?')
    .get(jobId, new Date().toISOString()) as { c: number };

  await assertInvariant(
    'LeaseExclusivity',
    () => activeRuns.c <= 1 && activeLeases.c <= 1,
    { jobId, activeRuns: activeRuns.c, activeLeases: activeLeases.c }
  );
}

/**
 * Assert that events for a job are strictly ordered by event_id.
 * Implements: Event Ordering invariant.
 */
export async function assertEventOrdering(jobId: string): Promise<void> {
  const events = db
    .prepare('SELECT id FROM events WHERE job_id = ? ORDER BY id ASC')
    .all(jobId) as Array<{ id: number }>;

  for (let i = 1; i < events.length; i++) {
    if (events[i].id !== events[i - 1].id + 1) {
      throw new InvariantViolationError(
        'EventOrdering',
        `Event gap detected: ${events[i - 1].id} -> ${events[i].id}`,
        { jobId, gap: events[i].id - events[i - 1].id }
      );
    }
  }

  await assertInvariant(
    'EventOrdering',
    () => events.length === 0 || events[events.length - 1].id === events[0].id + events.length - 1,
    { jobId, eventCount: events.length }
  );
}

/**
 * Assert that a contiguous sequence of event IDs exists without gaps.
 * Implements: Event Integrity (no gaps) invariant.
 */
export async function assertNoEventGaps(
  eventIdStart: number,
  eventIdEnd: number
): Promise<void> {
  const count = db
    .prepare('SELECT COUNT(*) as c FROM events WHERE id >= ? AND id <= ?')
    .get(eventIdStart, eventIdEnd) as { c: number };

  const expected = eventIdEnd - eventIdStart + 1;
  await assertInvariant(
    'NoEventGaps',
    () => count.c === expected,
    { eventIdStart, eventIdEnd, expected, actual: count.c }
  );
}

/**
 * Assert that replay of a run produces identical event sequence and final state.
 * Implements: Replay Determinism invariant.
 */
export async function assertReplayEquivalence(
  jobId: string,
  getReplayEvents: (jobId: string) => Promise<Array<{ id: number; event_type: string; metadata: string }>>
): Promise<void> {
  const originalEvents = db
    .prepare('SELECT id, event_type, metadata FROM events WHERE job_id = ? ORDER BY id ASC')
    .all(jobId) as Array<{ id: number; event_type: string; metadata: string }>;

  const replayedEvents = await getReplayEvents(jobId);

  await assertInvariant(
    'ReplayEquivalence',
    () => {
      if (originalEvents.length !== replayedEvents.length) return false;
      for (let i = 0; i < originalEvents.length; i++) {
        if (originalEvents[i].event_type !== replayedEvents[i].event_type) return false;
        if (originalEvents[i].metadata !== replayedEvents[i].metadata) return false;
      }
      return true;
    },
    { jobId, originalCount: originalEvents.length, replayedCount: replayedEvents.length }
  );
}

/**
 * Assert that all state transitions for a job have non-null actor attribution.
 * Implements: Actor Attribution invariant (Invariant E).
 */
export async function assertActorAttribution(jobId: string): Promise<void> {
  const stateChanges = db
    .prepare(`
      SELECT e.id, e.actor_id
      FROM events e
      WHERE e.job_id = ? AND e.event_type = 'STATE_CHANGED'
    `)
    .all(jobId) as Array<{ id: number; actor_id: string }>;

  for (const ev of stateChanges) {
    await assertInvariant(
      'ActorAttribution',
      () => ev.actor_id !== null && ev.actor_id !== undefined && ev.actor_id !== '',
      { eventId: ev.id, jobId, actorId: ev.actor_id }
    );
  }
}

/**
 * Assert that every state transition has a corresponding event.
 * Implements: Event ↔ State Consistency invariant (Invariant C).
 */
export async function assertEventStateConsistency(jobId: string): Promise<void> {
  // Get job state transitions from runs
  const runs = db
    .prepare('SELECT id, status FROM runs WHERE job_id = ? ORDER BY finished_at ASC')
    .all(jobId) as Array<{ id: string; status: string }>;

  for (const run of runs) {
    const jobEvents = db
      .prepare('SELECT event_type FROM events WHERE job_id = ?')
      .all(jobId) as Array<{ event_type: string }>;

    await assertInvariant(
      'EventStateConsistency',
      () => {
        // RUN_STARTED should exist for finished runs
        if (run.status !== 'running') {
          return jobEvents.some(ev => ev.event_type === 'RUN_STARTED');
        }
        return true;
      },
      { runId: run.id, runStatus: run.status, eventCount: jobEvents.length }
    );
  }
}
