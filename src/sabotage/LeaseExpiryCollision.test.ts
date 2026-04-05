import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { JobRepository } from '../repositories/JobRepository';
import { RunRepository } from '../repositories/RunRepository';
import { LeaseRepository } from '../repositories/LeaseRepository';
import { EventRepository } from '../repositories/EventRepository';
import { spawn } from 'child_process';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { db } from '../db/sqlite';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('LeaseExpiryCollision', () => {
  let jobId: string | null = null;
  let barrierPath: string = '';

  beforeAll(() => {
    EventRepository.init();
  });

  beforeEach(() => {
    // Clear relevant tables
    db.exec('DELETE FROM jobs');
    db.exec('DELETE FROM runs');
    db.exec('DELETE FROM leases');
  });

  afterEach(async () => {
    // Cleanup barrier file if exists
    try {
      if (barrierPath && fs.existsSync(barrierPath)) {
        fs.unlinkSync(barrierPath);
      }
    } catch {}
    // Delete the job if created
    if (jobId) {
      try {
        JobRepository.delete(jobId);
      } catch {}
      jobId = null;
    }
  });

  it('prevents duplicate execution when lease expires during job', async () => {
    jobId = `job-${Date.now()}-${Math.random().toString(36).substring(2)}`;
    barrierPath = join(tmpdir(), `barrier-${jobId}.txt`);

    // Create the job with the slow-contestant adapter, active state
    const now = new Date().toISOString();
    JobRepository.create({
      id: jobId,
      name: 'Collision Test Job',
      cli: 'slow-contestant',
      cwd: process.cwd(),
      task: 'sleep 15',
      interval_spec: '*/5 * * * *', // every 5 minutes
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
      next_run_at: now,
    });

    // Spawn two contestant processes
    const child1 = spawn('node', ['-r', 'ts-node/register/transpile-only', 'src/sabotage/helpers/collision-contestant.ts', jobId, barrierPath, '2'], {
      shell: true,
      stdio: 'pipe',
    });
    const child2 = spawn('node', ['-r', 'ts-node/register/transpile-only', 'src/sabotage/helpers/collision-contestant.ts', jobId, barrierPath, '2'], {
      shell: true,
      stdio: 'pipe',
    });

    let out1 = '', err1 = '', out2 = '', err2 = '';
    child1.stdout.on('data', (data) => { out1 += data.toString(); });
    child1.stderr.on('data', (data) => { err1 += data.toString(); });
    child2.stdout.on('data', (data) => { out2 += data.toString(); });
    child2.stderr.on('data', (data) => { err2 += data.toString(); });

    child1.on('exit', (code) => console.log(`child1 exited ${code}`));
    child2.on('exit', (code) => console.log(`child2 exited ${code}`));

    // Wait a bit for both to start and hit barrier, then release barrier
    await sleep(1000);
    fs.writeFileSync(barrierPath, 'go'); // release both

    // Wait for both to exit with timeout
    const timeout = 60000; // 60s overall timeout
    const start = Date.now();
    let exited1 = false, exited2 = false;
    while (!exited1 || !exited2) {
      if (Date.now() - start > timeout) {
        child1.kill('SIGKILL');
        child2.kill('SIGKILL');
        throw new Error('Timeout waiting for contestant processes');
      }
      await sleep(200);
      if (!exited1 && child1.exitCode !== null) {
        exited1 = true;
      }
      if (!exited2 && child2.exitCode !== null) {
        exited2 = true;
      }
    }

    // Debug output
    console.log('child1 exit:', child1.exitCode, 'stderr:', err1);
    console.log('child2 exit:', child2.exitCode, 'stderr:', err2);

    // Parse outputs
    let result1, result2;
    try { result1 = out1 ? JSON.parse(out1) : null; } catch (e) { result1 = null; }
    try { result2 = out2 ? JSON.parse(out2) : null; } catch (e) { result2 = null; }

    // Assertions:
    // 1. Exactly one success (exit code 0 and success===true)
    const exit1 = child1.exitCode!;
    const exit2 = child2.exitCode!;
    expect([exit1, exit2]).toContain(0); // at least one exited 0
    const successResults = [result1, result2].filter(r => r && r.success);
    expect(successResults.length).toBe(1);

    // 2. Exactly one run record exists for the job with status in ('running','success','failed')
    const runs = RunRepository.getByJob(jobId!);
    expect(runs.length).toBe(1);
    expect(['running', 'success', 'failed']).toContain(runs[0].status);

    // 3. The skipping daemon's stderr contains "collision" or "skipping"
    const stderrCombined = err1 + err2;
    const hasCollisionLog = stderrCombined.toLowerCase().includes('collision') || stderrCombined.toLowerCase().includes('skipping');
    expect(hasCollisionLog).toBe(true);
  });
});
