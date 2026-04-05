import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { JobRepository } from '../repositories/JobRepository';
import { ControlPlane } from '../core/ControlPlane';
import { StateTransitionEnforcer } from '../governance/StateTransitionEnforcer';
import { EventRepository } from '../repositories/EventRepository';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../types';

describe('Dead Enforcement Sabotage Test (REQ-3.1 #38)', () => {
  const createdIds: string[] = [];

  beforeAll(() => {
    EventRepository.init();
  });

  afterEach(() => {
    for (const id of createdIds.splice(0)) {
      try { JobRepository.delete(id); } catch { /* ignore */ }
    }
  });

  function createJob(state: string): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    JobRepository.create({
      id,
      name: 'Dead Enforcement Test',
      cli: 'test',
      cwd: '/tmp',
      task: 'test',
      interval_spec: '*/5 * * * *',
      timezone: null,
      session_id: null,
      state: state as any,
      stop_condition_json: null,
      max_iterations: null,
      max_failures: 3,
      expires_at: null,
      created_at: now,
      updated_at: now,
      last_run_at: null,
      next_run_at: null,
    });
    createdIds.push(id);
    return id;
  }

  // Invariant 1: Control Plane Supremacy
  // Demonstrates that raw repo bypasses the DAG — ControlPlane is the sole enforcer
  it('Invariant 1: Direct JobRepository.updateState does NOT enforce DAG', () => {
    const jobId = createJob('completed');
    expect(() => {
      JobRepository.updateState(jobId, 'active');
    }).not.toThrow();
    expect(JobRepository.get(jobId)!.state).toBe('active');
  });

  // Invariant 2: Evidence Over Declaration
  it('Invariant 2: ControlPlane.transitionJob emits STATE_CHANGED event', () => {
    const jobId = createJob('active');
    const before = EventRepository.getByJob(jobId).length;
    const actor: Actor = { actorId: 'inv2', actorType: 'cli' };
    ControlPlane.transitionJob(jobId, 'paused', { actorId: actor } as any, 'test');
    const after = EventRepository.getByJob(jobId).length;
    expect(after).toBe(before + 1);
    const events = EventRepository.getByJob(jobId) as any[];
    const stateChange = events.find(e => e.type === 'STATE_CHANGED');
    expect(stateChange).toBeDefined();
    const payload = JSON.parse(stateChange.payload as string);
    expect(payload.from).toBe('active');
    expect(payload.to).toBe('paused');
    expect(payload.actorId).toBe('inv2');
  });

  // Invariant 4: State Integrity
  it('Invariant 4: StateTransitionEnforcer rejects invalid transitions', () => {
    expect(StateTransitionEnforcer.validate('pending', 'completed')).toBe(false);
    expect(StateTransitionEnforcer.validate('active', 'paused')).toBe(true);
  });

  // Invariant 7: All Transitions Authorized
  it('Invariant 7: transitionJob requires a valid actor', () => {
    const jobId = createJob('active');
    expect(() => {
      ControlPlane.transitionJob(jobId, 'paused', { actorId: null } as any, 'test');
    }).toThrow(/require attributed actor/);
  });

  // Invariant 8: No Silent Mutation
  it('Invariant 8: direct repo changes produce no events', () => {
    const jobId = createJob('active');
    const before = EventRepository.getByJob(jobId).length;
    JobRepository.updateState(jobId, 'paused');
    const after = EventRepository.getByJob(jobId).length;
    expect(after).toBe(before);
  });

  // Invariant 9: No Bypass — ControlPlane rejects invalid target states
  it('Invariant 9: ControlPlane rejects invalid target state', () => {
    const jobId = createJob('active');
    const actor: Actor = { actorId: 'inv9', actorType: 'cli' };
    expect(() => ControlPlane.transitionJob(jobId, 'invalid-state' as any, { actorId: actor } as any, 'test')).toThrow();
    expect(JobRepository.get(jobId)!.state).toBe('active');
  });

  // Invariant 10: Trust Boundary Enforcement
  it('Invariant 10: Path sanitization blocks traversal', () => {
    const sanitize = (ControlPlane as any).sanitizeLogPath.bind(ControlPlane);
    expect(() => sanitize('/tmp/logs', '../../../etc/passwd')).toThrow(/escapes base directory/);
  });
});
