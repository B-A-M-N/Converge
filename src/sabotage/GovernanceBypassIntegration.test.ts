import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { JobRepository } from '../repositories/JobRepository';
import { RunRepository } from '../repositories/RunRepository';
import { EventRepository } from '../repositories/EventRepository';
import { ControlPlane } from '../core/ControlPlane';
import { v4 as uuidv4 } from 'uuid';
import type { Actor } from '../types';

describe('Governance Integration: Bypass Prohibition', () => {
  const createdIds: string[] = [];

  beforeAll(() => {
    EventRepository.init();
  });

  afterEach(() => {
    for (const id of createdIds.splice(0)) {
      try { JobRepository.delete(id); } catch { /* ignore */ }
    }
  });

  function createActiveJob(): string {
    const id = uuidv4();
    const now = new Date().toISOString();
    JobRepository.create({
      id,
      name: 'Integration Bypass Test',
      cli: 'test',
      cwd: '/tmp',
      task: 'test',
      interval_spec: '*/5 * * * *',
      timezone: null,
      session_id: null,
      state: 'active',
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

  it('JobRepository.updateState does NOT emit events (silent bypass risk)', () => {
    const jobId = createActiveJob();
    const before = EventRepository.getByJob(jobId).length;
    expect(() => {
      JobRepository.updateState(jobId, 'paused');
    }).not.toThrow();
    const after = EventRepository.getByJob(jobId).length;
    expect(after).toBe(before); // no STATE_CHANGED event — this is why ControlPlane must be the sole path
    expect(JobRepository.get(jobId)!.state).toBe('paused');
  });

  it('ControlPlane.transitionJob requires a valid actor', () => {
    const jobId = createActiveJob();
    expect(() => {
      ControlPlane.transitionJob(jobId, 'paused', { actorId: null } as any, 'test');
    }).toThrow(/require attributed actor/);
    expect(JobRepository.get(jobId)!.state).toBe('active'); // state unchanged
  });

  it('ControlPlane.transitionJob enforces DAG even with valid actor', () => {
    const jobId = createActiveJob();
    const actor: Actor = { actorId: 'integration-test', actorType: 'cli' };
    expect(() => {
      ControlPlane.transitionJob(jobId, 'invalid-state' as any, { actorId: actor } as any, 'test');
    }).toThrow(/Invalid state transition/);
    expect(JobRepository.get(jobId)!.state).toBe('active');
  });

  it('direct RunRepository access produces no governance events', () => {
    // Demonstrates that only ControlPlane.dispatch creates governed Run records.
    // Any code path that creates runs via RunRepository directly bypasses event tracking.
    const jobId = createActiveJob();
    const runId = uuidv4();
    const now = new Date().toISOString();
    RunRepository.create({
      id: runId,
      job_id: jobId,
      should_continue: true,
      started_at: now,
      finished_at: null,
      exit_code: null,
      stdout_path: null,
      stderr_path: null,
      reason: 'test',
      pid: null,
      status: 'running',
      output: null,
      summary_json: null,
      output_hash: null,
      provenance_json: null,
      is_ambiguous: 0,
    } as any);
    // No RUN_STARTED event was emitted — this is the bypass risk ControlPlane.dispatch prevents
    const events = EventRepository.getByJob(jobId);
    const runStarted = events.find(e => (e as any).type === 'RUN_STARTED');
    expect(runStarted).toBeUndefined();
  });

  it('path traversal is blocked by sanitizeLogPath', () => {
    const sanitize = (ControlPlane as any).sanitizeLogPath.bind(ControlPlane);
    expect(() => sanitize('/tmp/logs', '../../../etc/passwd')).toThrow(/escapes base directory/);
    expect(() => sanitize('/tmp/logs', 'sub/../../etc')).toThrow(/escapes base directory/);
    expect(() => sanitize('/tmp/logs', 'valid/subdir')).not.toThrow();
  });
});
