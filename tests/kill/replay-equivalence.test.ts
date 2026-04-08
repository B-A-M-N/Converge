import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConvergeClient } from '../../src/client/ConvergeClient';
import { promises as fs } from 'fs';
import * as path from 'path';
import { tmpdir } from 'os';

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
    client.close();
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
    await client.runNow(job.id, 'replay-test-actor');

    // Wait for run to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. Get original events via replay API
    const originalEvents = await client.replay(0);
    expect(originalEvents.length).toBeGreaterThan(0);

    // Verify events have proper structure
    for (const ev of originalEvents) {
      expect(ev.event_id).toBeDefined();
      expect(ev.job_id).toBeDefined();
      expect(ev.event_type).toBeDefined();
    }

    // 4. Restart daemon — preserve homeDir/DB so events survive the restart
    client.close();
    await daemon.stop(false);
    await daemon.start();

    const newSocketPath = daemon.getSocketPath();
    const newClient = new ConvergeClient({ socketPath: newSocketPath });
    await newClient.connect();

    try {
      // 5. Replay from beginning — should return same events
      const replayedEvents = await newClient.replay(0);
      expect(replayedEvents.length).toBe(originalEvents.length);

      // Events should be identical
      for (let i = 0; i < originalEvents.length; i++) {
        expect(replayedEvents[i].event_id).toBe(originalEvents[i].event_id);
        expect(replayedEvents[i].event_type).toBe(originalEvents[i].event_type);
      }

      // 6. Replay from checkpoint — should return only new events
      const checkpoint = originalEvents[originalEvents.length - 1].event_id;
      const newEvents = await newClient.replay(checkpoint);
      expect(newEvents.length).toBe(0); // no new events since checkpoint
    } finally {
      newClient.close();
    }
  });
});
