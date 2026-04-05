import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../src/extensions/claude/adapter';

/**
 * CLA-11: Invariant B — the adapter never fabricates a success response when the daemon
 * did not confirm. Partial failures must be reported as failures with the actual error.
 */
describe('CLA-11: No Fake Success (Invariant B)', () => {
  it('ls returns error not fake success when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'ls',
      args: [],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('pause returns error not fake success when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'pause',
      args: ['fake-id-123'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('status returns error for non-existent job when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'status',
      args: ['non-existent-job-id'],
      options: {},
    }, actor);

    expect(result.status).not.toBe('success');
    expect(result.message).toBeTruthy();
    expect(result.message.length).toBeGreaterThan(0);
    if (result.status === 'error') {
      expect(result.data).toBeUndefined();
    }
  });

  it('run-now returns error not fake success when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'run-now',
      args: ['no-such-job'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('resume returns error not fake success when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'resume',
      args: ['no-such-job'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('cancel returns error not fake success when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'cancel',
      args: ['no-such-job'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('doctor reports error not fake success when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'doctor',
      args: [],
      options: {},
    }, actor);

    expect(['error', 'info']).toContain(result.status);
    expect(result.message).toBeTruthy();
    expect(result.message.length).toBeGreaterThan(0);
  });
});
