import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConvergeClient } from '../../src/client/ConvergeClient';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';
import { assertReplayEquivalence } from '../lib/invariants';

describe('KILL TEST: Replay Equivalence', () => {
  let daemon: TestDaemon;
  let client: ConvergeClient;
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(tmpdir(), 'converge-replay-'));
    daemon = new TestDaemon(homeDir);
    await daemon.start();

    const socketPath = daemon.getSocketPath();
    client = new ConvergeClient({ socketPath });
    await client.connect();
  });

  afterEach(async () => {
    await client.close();
    await daemon.stop();
  });

  it('should produce bitwise identical event stream after daemon restart', async () => {
    // 1. Create a deterministic job
    const job = await client.createJob(
      {
        cli: 'test',
        command: 'echo replay-test',
        args: [],
        interval_spec: 'once'
      },
      'replay-test-actor'
    );

    // 2. Run the job to completion
    const run = await client.runNow(job.id, 'replay-test-actor');

    // Wait for run to complete
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 3. Capture original event sequence from database
    const dbPath = daemon.getDbPath();
    const db = require('better-sqlite3')(dbPath);
    const originalEvents = db
      .prepare('SELECT id, type, payload FROM events WHERE job_id = ? ORDER BY id ASC')
      .all(job.id) as Array<{ id: number; type: string; payload: string }>;

    expect(originalEvents.length).toBeGreaterThan(0);

    // 4. Stop daemon
    await daemon.stop();

    // 5. Restart daemon
    await daemon.start();
    const newSocketPath = daemon.getSocketPath();

    // 6. Connect new client
    const newClient = new ConvergeClient({ socketPath: newSocketPath });
    await newClient.connect();

    try {
      // 7. Subscribe with since=0 to get full replay
      const replayedEvents: Array<{ id: number; type: string; payload: string }> = [];
      await newClient.subscribe('events' as any,
        (event) => {
          replayedEvents.push({
            id: event.event_id,
            type: event.eventType,
            payload: event.payload
          });
        }
      );

      // Wait for replay to complete (all events sent)
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 8. Compare original vs replayed
      await assertReplayEquivalence(run.runId, async () => {
        // Get events directly from DB for comparison (since client subscription may have delivered them)
        // For the assertion, we can return the replayedEvents we collected
        return replayedEvents;
      });

      // Additional explicit checks:
      expect(replayedEvents.length).toBe(originalEvents.length);
      for (let i = 0; i < originalEvents.length; i++) {
        expect(replayedEvents[i].type).toBe(originalEvents[i].type);
        expect(replayedEvents[i].payload).toBe(originalEvents[i].payload);
      }
    } finally {
      await newClient.close();
    }
  });
});
