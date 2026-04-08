import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConvergeClient } from '../../src/client/ConvergeClient';
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { v4 as uuidv4 } from 'uuid';
import { assertInvariant, assertActorAttribution } from '../lib/invariants';

describe('Multi-Agent Contamination', () => {
  let daemon: TestDaemon;
  let clientA: ConvergeClient;
  let clientB: ConvergeClient;
  let homeDir: string;
  const actorA = 'agent-alpha';
  const actorB = 'agent-beta';

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(tmpdir(), 'converge-multiagent-'));
    daemon = new TestDaemon(homeDir);
    await daemon.start();

    const socketPath = daemon.getSocketPath();
    clientA = new ConvergeClient({ socketPath });
    clientB = new ConvergeClient({ socketPath });
    await clientA.connect();
    await clientB.connect();
  });

  afterEach(async () => {
    await clientA.close();
    await clientB.close();
    await daemon.stop();
  });

  it('should prevent cross-agent event leakage', async () => {
    // Agent Alpha creates job A
    const jobA = await clientA.addJob(
      {
        cli: 'test',
        command: 'echo alpha',
        args: [],
        interval_spec: '5s'
      },
      actorA
    );

    // Agent Beta creates job B
    const jobB = await clientB.addJob(
      {
        cli: 'test',
        command: 'echo beta',
        args: [],
        interval_spec: '5s'
      },
      actorB
    );

    // Both agents subscribe to their own job events (all event types)
    const eventsA: any[] = [];
    const eventsB: any[] = [];

    await clientA.subscribe('events' as any, (event) => {
      eventsA.push(event);
    });
    await clientB.subscribe('events' as any, (event) => {
      eventsB.push(event);
    });

    // Alpha runs job A
    const runA = await clientA.runNow(jobA.id, actorA);

    // Wait briefly for events to propagate
    await new Promise(resolve => setTimeout(resolve, 500));

    // Beta runs job B
    const runB = await clientB.runNow(jobB.id, actorB);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify Alpha only receives events for job A
    const jobBEventsInA = eventsA.filter(e => e.job_id === jobB.id);
    expect(jobBEventsInA.length).toBe(0);

    // Verify Beta only receives events for job B
    const jobAEventsInB = eventsB.filter(e => e.job_id === jobA.id);
    expect(jobAEventsInB.length).toBe(0);

    // Assert invariant: no cross-contamination
    await assertInvariant('MultiAgentEventIsolation', () => {
      return eventsA.every(e => e.job_id === jobA.id) && eventsB.every(e => e.job_id === jobB.id);
    });
  });

  it('should enforce actor attribution on state changes', async () => {
    const jobA = await clientA.addJob(
      { cli: 'test', command: 'echo alpha', args: [], interval_spec: '5s' },
      actorA
    );

    // Execute run as Alpha
    await clientA.runNow(jobA.id, actorA);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify all state change events have actor attribution
    await assertActorAttribution(jobA.id);
  });

  it('should prevent agent B from pausing agent A\'s job', async () => {
    const jobA = await clientA.addJob(
      { cli: 'test', command: 'echo alpha', args: [], interval_spec: '5s' },
      actorA
    );

    // Agent B attempts to pause job A
    try {
      await clientB.pauseJob(jobA.id, actorB);
      // If no exception thrown, that's a failure - should be unauthorized
      throw new Error('Agent B should not be able to pause Agent A\'s job');
    } catch (error: any) {
      // Expected: authorization error or not found (if ACL enforced)
      expect(error.message).toMatch(/unauthorized|not found|permission/i);
    }

    // Verify job A state is still active (Alpha can query)
    const job = await clientA.getJob(jobA.id, actorA);
    expect(job.state).toBe('pending'); // remains in initial state
  });

  it('should maintain lease isolation between agents', async () => {
    const jobA = await clientA.addJob(
      { cli: 'test', command: 'echo alpha', args: [], interval_spec: '5s' },
      actorA
    );

    // Alpha acquires lease via runNow
    const runPromise = clientA.runNow(jobA.id, actorA);

    // Give it a moment to acquire lease
    await new Promise(resolve => setTimeout(resolve, 200));

    // Beta queries active lease for job A - should be null or inaccessible
    const leaseB = await clientB.getActiveLease(jobA.id, actorB);
    expect(leaseB).toBeNull();

    // Alpha completes run
    await runPromise;

    // Alpha can query lease (should be null after completion)
    const leaseA = await clientA.getActiveLease(jobA.id, actorA);
    expect(leaseA).toBeNull();
  });

  it('should isolate run state modifications between agents', async () => {
    const jobA = await clientA.addJob(
      { cli: 'test', command: 'echo alpha', args: [], interval_spec: '5s' },
      actorA
    );

    const jobB = await clientB.addJob(
      { cli: 'test', command: 'echo beta', args: [], interval_spec: '5s' },
      actorB
    );

    // Alpha runs job A
    const runA = await clientA.runNow(jobA.id, actorA);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Beta attempts to cancel job A
    try {
      await clientB.cancelJob(jobA.id, actorB);
      // Should fail
      throw new Error('Agent B should not cancel Agent A\'s job');
    } catch (error: any) {
      expect(error.message).toMatch(/unauthorized|not found|permission/i);
    }

    // Alpha's job A should still be running or completed normally
    const finalRunA = await clientA.getRun(runA.runId, actorA);
    expect(['running', 'finished', 'completed']).toContain(finalRunA.status);

    // Beta's own job B should be unaffected
    const runB = await clientB.runNow(jobB.id, actorB);
    expect(runB.runId).toBeDefined();
  });
});
