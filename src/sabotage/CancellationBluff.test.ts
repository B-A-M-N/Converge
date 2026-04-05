/**
 * SABOTAGE TEST #15: The Cancellation Bluff
 *
 * Verifies that cancel() sends real OS signals (SIGTERM/SIGKILL) to subprocesses.
 * A "bluff" cancel — one that only changes state without signaling — must not pass.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RunRepository } from '../repositories/RunRepository';
import { JobRepository } from '../repositories/JobRepository';
import { ControlPlane } from '../core/ControlPlane';
import { db } from '../db/sqlite';
import { v4 as uuidv4 } from 'uuid';
import { spawn } from 'child_process';

describe('CancellationBluff Sabotage Test (Test #15)', () => {
  let jobId: string;

  beforeEach(() => {
    jobId = `cancel-test-${uuidv4()}`;
    db.exec('DELETE FROM runs');
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM leases');
    db.exec('DELETE FROM events');

    // Create job in 'active' state for cancellation
    db.prepare(`
      INSERT INTO jobs (id, name, cli, cwd, task, interval_spec, state, max_failures, created_at, updated_at)
      VALUES (?, 'cancel-test', 'shell', ?, 'sleep 60', '@every 1m', 'active', 3, ?, ?)
    `).run(jobId, process.cwd(), new Date().toISOString(), new Date().toISOString());
  });

  afterEach(() => {
    db.exec('DELETE FROM runs');
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM leases');
    db.exec('DELETE FROM events');
  });

  it('sends SIGTERM/SIGKILL to a running subprocess and the process is no longer alive', async () => {
    // Spawn a real long-running process
    const proc = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
    const pid = proc.pid!;

    // Verify process is alive
    expect(() => process.kill(pid, 0)).not.toThrow();

    // Create a Run record linking to this job with the real PID stored
    const runId = uuidv4();
    const run = {
      id: runId,
      job_id: jobId,
      started_at: new Date().toISOString(),
      finished_at: null,
      status: 'running' as const,
      exit_code: null,
      stdout_path: null,
      stderr_path: null,
      summary_json: null, output: null, pid: null, output_hash: null, provenance_json: null, is_ambiguous: 0,
      should_continue: true,
      reason: null,
    };
    RunRepository.create(run);
    RunRepository.setPid(runId, pid);

    // Verify PID was stored
    const storedPid = RunRepository.getPid(runId);
    expect(storedPid).toBe(pid);

    // Cancel via ControlPlane — must send real OS signals
    const result = await ControlPlane.cancelRun(jobId);
    expect(result).toBe(true);

    // Verify the process is no longer alive (ESRCH = no such process)
    let processStillAlive = true;
    try {
      process.kill(pid, 0);
    } catch (e: any) {
      if (e.code === 'ESRCH') {
        processStillAlive = false;
      }
    }
    expect(processStillAlive).toBe(false);

    // Verify job transitioned to 'cancelled'
    const job = JobRepository.get(jobId);
    expect(job?.state).toBe('cancelled');

    // Verify run was updated
    const updatedRun = RunRepository.get(runId);
    expect(updatedRun?.status).toBe('cancelled');
  }, 15000); // 15s timeout: grace period (5s) + SIGKILL wait (2s) + buffer

  it('returns false when no running run exists for the job', async () => {
    // No runs for this job
    const result = await ControlPlane.cancelRun(jobId);
    expect(result).toBe(false);
  });

  it('returns false when running run has no PID stored', async () => {
    const runId = uuidv4();
    const run = {
      id: runId,
      job_id: jobId,
      started_at: new Date().toISOString(),
      finished_at: null,
      status: 'running' as const,
      exit_code: null,
      stdout_path: null,
      stderr_path: null,
      summary_json: null, output: null, pid: null, output_hash: null, provenance_json: null, is_ambiguous: 0,
      should_continue: true,
      reason: null,
    };
    RunRepository.create(run);
    // Deliberately do NOT call RunRepository.setPid — pid remains null

    const result = await ControlPlane.cancelRun(jobId);
    expect(result).toBe(false);
  });
});
