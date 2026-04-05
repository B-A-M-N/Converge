import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeAdapter } from '../../../src/extensions/claude/adapter';
import { ClaudeActorResolver } from '../../../src/extensions/claude/actor-resolver';

/**
 * CLA-08: Mutating operations attempted without an explicit Actor are rejected
 * at the adapter layer with UNAUTHORIZED_TRANSITION error, never reaching the daemon.
 */
describe('CLA-08: Missing Actor', () => {
  it('ActorResolver always produces an actor (fails closed)', async () => {
    const resolver = new ClaudeActorResolver('/home/bamn/Reactor');
    const actor = await resolver.resolve();

    // Actor should have a meaningful identity
    expect(actor.actorId).toBeTruthy();
    expect(actor.actorType).toBe('cli');
  });

  it('pauseJob rejects when actor is empty string', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');

    // Mock resolveActor to return an actor with empty actorId
    const originalResolve = adapter.resolveActor.bind(adapter);
    adapter.resolveActor = async () => ({
      actorId: '',
      actorType: 'cli',
    });

    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'pause',
      args: ['some-job-id'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
    expect(result.message).toContain('Actor');

    // Restore
    adapter.resolveActor = originalResolve;
  });

  it('cancelJob rejects when actor is empty string', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');

    adapter.resolveActor = async () => ({
      actorId: '',
      actorType: 'cli',
    });

    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'cancel',
      args: ['some-job-id'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('resumeJob rejects when actor is empty string', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');

    adapter.resolveActor = async () => ({
      actorId: '',
      actorType: 'cli',
    });

    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'resume',
      args: ['some-job-id'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });

  it('runNow rejects when actor is empty string', async () => {
    const adapter = new ClaudeAdapter('/home/bamn/Reactor');

    adapter.resolveActor = async () => ({
      actorId: '',
      actorType: 'cli',
    });

    const actor = await adapter.resolveActor();
    const result = await adapter.execute(adapter.getClient(), {
      name: 'run-now',
      args: ['some-job-id'],
      options: {},
    }, actor);

    expect(result.status).toBe('error');
  });
});
