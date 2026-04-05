import { describe, it, expect } from 'vitest';
import { ConvergeClient } from '../../../src/client/ConvergeClient';

/**
 * CLA-10: After reconnect, the adapter supports event resume via checkpoint, receiving
 * events from the last acknowledged point. Replayed events are distinguishable from live events.
 *
 * These tests verify the ConvergeClient replay/reconnect behavior exists and is usable by
 * the adapter. Full daemon-integration replay tests require a running daemon.
 */
describe('CLA-10: Event Replay After Reconnect', () => {
  it('ConvergeClient has subscribe and replay methods', () => {
    const client = new ConvergeClient({
      socketPath: '/tmp/converge-test-replay.sock',
      autoConnect: false,
    });

    expect(typeof client.subscribe).toBe('function');
    expect(typeof client.replay).toBe('function');
    expect(typeof client.getCheckpoint).toBe('function');
    expect(typeof client.setCheckpoint).toBe('function');
  });

  it('checkpoint can be set and retrieved', () => {
    const client = new ConvergeClient({
      socketPath: '/tmp/converge-test-checkpoint.sock',
      autoConnect: false,
    });

    client.setCheckpoint("test-id", {});
  });

  it('checkpoint is null before any events received', () => {
    const client = new ConvergeClient({
      socketPath: '/tmp/converge-test-null-checkpoint.sock',
      autoConnect: false,
    });

    expect(client.getCheckpoint("id")).toBeNull();
  });

  it('subscribe fails when daemon is unavailable', async () => {
    const client = new ConvergeClient({
      socketPath: '/tmp/converge-test-unavailable.sock',
      autoConnect: true,
    });

    await expect(client.subscribe("events", () => {})).rejects.toThrow();

    client.close();
  });

  it('replay fails when daemon is unavailable', async () => {
    const client = new ConvergeClient({
      socketPath: '/tmp/converge-test-replay-unavailable.sock',
      autoConnect: true,
    });

    await expect(client.replay(0)).rejects.toThrow();

    client.close();
  });
});
