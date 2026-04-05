import { AgentAdapter, AdapterHealth, StartRunInput, StartRunResult, ResumeRunInput, CancelRunInput, CancelRunResult, NormalizeOutputInput, NormalizedRunOutput } from '../types';

export const testAdapter: AgentAdapter = {
  name: 'test',
  supportsContinuation: false,

  async detect(): Promise<AdapterHealth> {
    return { isAvailable: true, version: '1.0' };
  },

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    return { pid: process.pid };
  },

  async resumeRun(_input: ResumeRunInput): Promise<StartRunResult> {
    throw new Error('Test adapter does not support continuation');
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
  }
};
