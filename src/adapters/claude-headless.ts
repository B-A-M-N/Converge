import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { AgentAdapter, AdapterHealth, StartRunInput, StartRunResult, ResumeRunInput, ResumeRunResult, CancelRunInput, CancelRunResult, NormalizeOutputInput, NormalizedRunOutput } from '../types';

/**
 * Daemon-owned subprocess adapter.
 * Spawns `claude --print <task>` as a child process.
 * Use when no interactive Claude Code session is available.
 */
export const claudeHeadlessAdapter: AgentAdapter = {
  name: 'claude-headless',
  supportsContinuation: false,

  async detect(): Promise<AdapterHealth> {
    try {
      const result = spawnSync('claude', ['--version'], { encoding: 'utf8' });
      if (result.status === 0) {
        return { isAvailable: true, version: (result.stdout || '').trim() };
      }
      return { isAvailable: false, error: `claude exited with code ${result.status}` };
    } catch (e: any) {
      return { isAvailable: false, error: e.message };
    }
  },

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    const args = ['--print', '--dangerously-skip-permissions', input.task];
    const opts: Record<string, any> = {
      cwd: input.cwd ?? process.cwd(),
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    };
    if (input.stdoutPath || input.stderrPath) {
      const result = spawnSync('claude', args, {
        ...opts,
        stdio: [
          'ignore',
          input.stdoutPath ? fs.openSync(input.stdoutPath, 'w') : 'pipe',
          input.stderrPath ? fs.openSync(input.stderrPath, 'w') : 'pipe',
        ],
      });
      return { pid: process.pid, exitCode: result.status ?? 1 };
    }
    const result = spawnSync('claude', args, opts);
    return { pid: process.pid, exitCode: result.status ?? 1 };
  },

  async resumeRun(_input: ResumeRunInput): Promise<ResumeRunResult> {
    return { pid: process.pid };
  },

  async cancelRun(input: CancelRunInput): Promise<CancelRunResult> {
    if (input.pid) {
      try {
        process.kill(input.pid, 'SIGTERM');
        return { success: true };
      } catch {
        return { success: false };
      }
    }
    return { success: false };
  },

  async normalizeOutput(input: NormalizeOutputInput): Promise<NormalizedRunOutput> {
    return {
      rawExitCode: input.exitCode ?? null,
      stdout: input.stdout ?? '',
      stderr: input.stderr ?? '',
      assistantSummary: 'unknown',
      sessionId: null,
      markers: [],
      filesChanged: [],
      retrySuggested: false,
      successSuggested: false,
    };
  },
};
