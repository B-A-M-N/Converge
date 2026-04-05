import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestDaemon } from '../helpers/test-daemon';
import { ConvergeClient } from '../../src/client/ConvergeClient';

describe('KILL TEST: Event Replay Gap', () => {
  let daemon: TestDaemon;
  let socketPath: string;

  beforeEach(async () => {
    daemon = new TestDaemon();
    await daemon.start();
    socketPath = daemon.getSocketPath();
  });

  afterEach(async () => {
    await daemon.stop();
  });

  it('should fill all gaps and produce contiguous event sequences after reconnect', async () => {
    const client = new ConvergeClient({ socketPath, autoConnect: true });

    try {
      await client.connect();

      // Create a simple job
      const job = await client.createJob(
        {
          cli: 'test',
          command: 'true',
          args: [],
          interval_spec: '60s',
          stop_condition: { type: 'exitCode', code: 0 },
        },
        'test-actor'
      );

      // Trigger a run to generate events
      await client.runNow(job.id, 'test-actor');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Get the full event sequence
      const initialEvents: any[] = await client.replay(0);
      expect(initialEvents.length).toBeGreaterThan(0);

      // Verify events form a contiguous sequence with no gaps
      const sortedIds = initialEvents.map(e => e.event_id).sort((a, b) => a - b);
      const minId = sortedIds[0];
      const maxId = sortedIds[sortedIds.length - 1];
      expect(maxId - minId + 1).toBe(sortedIds.length);

      // Get checkpoint
      const checkpoint = maxId;

      // Simulate disconnect/reconnect
      client.close();
      const client2 = new ConvergeClient({ socketPath, autoConnect: true });
      await client2.connect();

      try {
        // Replay from checkpoint
        const replayedEvents: any[] = await client2.replay(checkpoint);

        // Replay should return either no events (nothing new) or events > checkpoint
        for (const ev of replayedEvents) {
          expect(ev.event_id).toBeGreaterThan(checkpoint);
        }

        // Verify replayed events form a contiguous sequence starting at checkpoint+1
        if (replayedEvents.length > 0) {
          const replayIds = replayedEvents.map(e => e.event_id).sort((a, b) => a - b);
          const expectedMin = checkpoint + 1;
          expect(replayIds[0]).toBe(expectedMin);
          expect(replayIds[replayIds.length - 1] - replayIds[0] + 1).toBe(replayIds.length);
        }
      } finally {
        client2.close();
      }
    } finally {
      try { client.close(); } catch (e) {}
    }
  });
});
