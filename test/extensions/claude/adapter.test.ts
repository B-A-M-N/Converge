import { describe, it, expect } from 'vitest';
import { ClaudeActorResolver } from '../../../src/extensions/claude/actor-resolver';
import { ClaudeAdapter } from '../../../src/extensions/claude/adapter';

describe('ClaudeAdapter (integration)', () => {
  it('constructs without errors', () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    expect(adapter.name).toBe('claude-code');
  });

  it('resolves actor deterministically', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor1 = await adapter.resolveActor();
    const actor2 = await adapter.resolveActor();
    expect(actor1).toEqual(actor2);
  });

  it('getSocketPath returns a valid socket path', () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const socketPath = adapter.getSocketPath();
    expect(socketPath).toBeTruthy();
    expect(socketPath).toMatch(/converge.*\.sock$/);
  });

  it('returns error for unknown command name', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'nonexistent',
      args: [],
      options: {},
    }, actor);
    expect(result.status).toBe('error');
    expect(result.message).toContain('Unknown command');
  });

  it('execute handleAdd returns error when required fields missing', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'add',
      args: [],
      options: {},
    }, actor);
    expect(result.status).toBe('error');
    expect(result.message).toContain('Usage: /loop add');
  });

  it('handles ls command gracefully (daemon may not be running)', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'ls',
      args: [],
      options: {},
    }, actor);
    // Daemon running → success, daemon down → error
    expect(['success', 'error']).toContain(result.status);
  });

  it('returns error for pause/resume without id', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();

    const pauseResult = await adapter.execute(adapter.getClient(), {
      name: 'pause',
      args: [],
      options: {},
    }, actor);
    expect(pauseResult.status).toBe('error');
    expect(pauseResult.message).toContain('Usage');

    const resumeResult = await adapter.execute(adapter.getClient(), {
      name: 'resume',
      args: [],
      options: {},
    }, actor);
    expect(resumeResult.status).toBe('error');
    expect(resumeResult.message).toContain('Usage');
  });

  it('doctor returns health status', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'doctor',
      args: [],
      options: {},
    }, actor);
    // Daemon running → success, daemon down → error
    expect(['success', 'error', 'info']).toContain(result.status);
  });

  it('generic CliAdapter interface is implemented', () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');
    // Check all required interface members exist
    expect(typeof adapter.name).toBe('string');
    expect(typeof adapter.getSocketPath).toBe('function');
    expect(typeof adapter.resolveActor).toBe('function');
    expect(typeof adapter.execute).toBe('function');
  });
});

describe('ClaudeActorResolver (unit)', () => {
  it('derives actorId from context', async () => {
    const resolver = new ClaudeActorResolver('/home/bamn/Reactor');
    const actor = await resolver.resolve();
    expect(actor.actorId).toBeTruthy();
    expect(actor.actorId).toMatch(/@.*:/);
  });

  it('returns consistent actor across calls', async () => {
    const resolver = new ClaudeActorResolver('/home/bamn/Reactor');
    const actor1 = resolver.resolve();
    resolver.reset();
    const actor2 = resolver.resolve();
    expect(actor1).toEqual(actor2);
  });
});
