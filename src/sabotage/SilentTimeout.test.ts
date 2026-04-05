import { describe, it, expect } from 'vitest';
import { runProcess } from '../utils/process';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('Silent Timeout Sabotage Test (#14)', () => {
  it('process exceeding timeout is killed with SIGTERM→SIGKILL and metadata recorded', async () => {
    // Create temporary directory for logs
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactor-silent-timeout-'));
    const stdoutPath = path.join(tmpDir, 'stdout.log');
    const stderrPath = path.join(tmpDir, 'stderr.log');

    // Command that ignores SIGTERM and sleeps for 60 seconds
    const command = 'node';
    const args = [
      '-e',
      `process.on('SIGTERM', () => {}); setTimeout(() => {}, 60000);`
    ];
    const cwd = process.cwd();
    const timeoutMs = 2000; // 2 seconds

    const result = await runProcess(command, args, cwd, timeoutMs, {
      stdoutPath,
      stderrPath,
    });

    // Verify metadata
    expect(result.timeoutMetadata).toBeDefined();
    expect(result.timeoutMetadata?.killedBySignal).toBe('SIGKILL');
    expect(result.timeoutMetadata?.signalsSent.map((s: any) => s.signal)).toEqual(['SIGTERM', 'SIGKILL']);

    // Verify stderr contains the timeout warning
    const stderrContent = fs.readFileSync(stderrPath, 'utf-8');
    expect(stderrContent).toContain('[Timeout Exceeded]');
    expect(stderrContent).toContain('SIGKILL');

    // Verify process is dead (pid should not exist)
    if (result.pid) {
      let alive = false;
      try {
        process.kill(result.pid, 0);
        alive = true; // still alive
      } catch (e: any) {
        if (e.code !== 'ESRCH') {
          // other error means maybe still alive or permission issue, but ESRCH means no such process
          alive = true;
        }
      }
      expect(alive).toBe(false);
    }

    // Cleanup
    fs.unlinkSync(stdoutPath);
    fs.unlinkSync(stderrPath);
    fs.rmdirSync(tmpDir);
  });

  it('process that exits before timeout does not trigger enforcement', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactor-silent-timeout-ok-'));
    const stdoutPath = path.join(tmpDir, 'stdout.log');
    const stderrPath = path.join(tmpDir, 'stderr.log');

    const command = 'node';
    const args = ['-e', 'setTimeout(() => console.log("done"), 100);'];
    const cwd = process.cwd();
    const timeoutMs = 5000; // 5 seconds, process will exit quickly

    const result = await runProcess(command, args, cwd, timeoutMs, {
      stdoutPath,
      stderrPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.timeoutMetadata).toBeUndefined();

    // Cleanup
    fs.unlinkSync(stdoutPath);
    fs.unlinkSync(stderrPath);
    fs.rmdirSync(tmpDir);
  });
});
