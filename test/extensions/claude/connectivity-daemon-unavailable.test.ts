import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../src/extensions/claude/adapter';

/**
 * CLA-06: When the daemon is not running, Claude-originated operations fail fast
 * with a descriptive error. No fake success responses. No hanging.
 */
describe('CLA-06: Daemon Unavailable', () => {
  it('adapter ls fails fast when daemon is not running', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'ls',
      args: [],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
    expect(result.message).toBeTruthy();
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('adapter ls does not hang (completes within 5s)', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const startTime = Date.now();
    await adapter.execute(adapter.getClient(), {
      name: 'ls',
      args: [],
      options: {},
    }, actor);
    const elapsed = Date.now() - startTime;

    // Should not hang - error or response should come within 5 seconds
    // (ConvergeClient autoConnect has exponential backoff, first attempt is ~100ms)
    expect(elapsed).toBeLessThan(5000);
  });

  it('adapter run-now fails fast when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'run-now',
      args: ['nonexistent-id'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('adapter doctor reports daemon unavailability', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'doctor',
      args: [],
      options: {},
    }, actor);

    expect(['error', 'info']).toContain(result.status);
  });

  it('adapter pause fails fast when daemon is down', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const result = await adapter.execute(adapter.getClient(), {
      name: 'pause',
      args: ['nonexistent-id'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });
});
