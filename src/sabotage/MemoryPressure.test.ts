import { describe, it, expect, vi } from 'vitest';
import { runProcess } from '../utils/process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Set a longer timeout for these tests (default 30s)
vi.setConfig({ testTimeout: 120000 });

describe('Memory Pressure Sabotage Test', () => {
  it('large output is truncated and flagged without OOM', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactor-mem-pressure-'));
    const stdoutPath = path.join(tmpDir, 'stdout.log');
    const stderrPath = path.join(tmpDir, 'stderr.log');

    // Command that writes >100MB to stdout
    const command = 'node';
    const args = [
      '-e',
      `const s = 'x'.repeat(1024); for(let i=0;i<200*1024;i++) process.stdout.write(s);`
    ];
    const cwd = process.cwd();
    const timeoutMs = 30000;

    const result = await runProcess(command, args, cwd, timeoutMs, {
      stdoutPath,
      stderrPath,
    });

    // Check truncation metadata
    expect(result.captureMetadata).toBeDefined();
    expect(result.captureMetadata?.truncated).toBe(true);

    // Stat stdout file: size should be less than ~100MB (some leeway)
    const stats = fs.statSync(stdoutPath);
    const maxBytes = 100 * 1024 * 1024;
    expect(stats.size).toBeLessThan(maxBytes + 10 * 1024 * 1024);
    expect(stats.size).toBeGreaterThan(50 * 1024 * 1024);

    // Stderr should contain truncation warning
    const stderrContent = fs.readFileSync(stderrPath, 'utf-8');
    expect(stderrContent).toContain('[OutputCapture]');
    expect(stderrContent).toContain('truncated');

    // Cleanup
    fs.unlinkSync(stdoutPath);
    fs.unlinkSync(stderrPath);
    fs.rmdirSync(tmpDir);
  });

  it('small output is captured fully without truncation', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reactor-mem-pressure-ok-'));
    const stdoutPath = path.join(tmpDir, 'stdout.log');
    const stderrPath = path.join(tmpDir, 'stderr.log');

    const command = 'node';
    const args = ['-e', 'console.log("Hello");'];
    const cwd = process.cwd();
    const timeoutMs = 5000;

    const result = await runProcess(command, args, cwd, timeoutMs, {
      stdoutPath,
      stderrPath,
    });

    expect(result.exitCode).toBe(0);
    expect(result.captureMetadata).toBeDefined();
    expect(result.captureMetadata?.truncated).toBe(false);

    const stdoutContent = fs.readFileSync(stdoutPath, 'utf-8');
    expect(stdoutContent).toContain('Hello');

    // Cleanup
    fs.unlinkSync(stdoutPath);
    fs.unlinkSync(stderrPath);
    fs.rmdirSync(tmpDir);
  });
});
