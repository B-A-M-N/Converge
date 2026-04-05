import { AgentAdapter, AdapterHealth, StartRunInput, StartRunResult, ResumeRunInput, ResumeRunResult, CancelRunInput, CancelRunResult, NormalizeOutputInput, NormalizedRunOutput } from '../types';

export const claudeAdapter: AgentAdapter = {
  name: 'claude',
  supportsContinuation: false,

  async detect(): Promise<AdapterHealth> {
    return { isAvailable: true, version: 'unknown' };
  },

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    return { pid: process.pid };
  },

  async resumeRun(input: ResumeRunInput): Promise<ResumeRunResult> {
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
  }
};
