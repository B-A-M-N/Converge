import { AgentAdapter, AdapterHealth, StartRunInput, StartRunResult, ResumeRunInput, ResumeRunResult, CancelRunInput, CancelRunResult, NormalizeOutputInput, NormalizedRunOutput } from '../types';

/**
 * Session-cooperative adapter for Codex CLI.
 *
 * Jobs with cli=codex-session are NOT auto-executed by the daemon scheduler.
 * The running Codex session detects due jobs (via hooks or skill), claims them
 * with `converge claim-run`, executes the task using its own tools, then submits
 * results with `converge complete-run`.
 *
 * startRun / resumeRun are intentional no-ops here — the adapter exists so that:
 *   1. The scheduler knows to skip these jobs (isSessionOwned: true)
 *   2. normalizeOutput normalizes session-submitted results consistently
 */
export const codexSessionAdapter: AgentAdapter = {
  name: 'codex-session',
  supportsContinuation: false,
  isSessionOwned: true,

  async detect(): Promise<AdapterHealth> {
    return { isAvailable: true, version: 'session-cooperative' };
  },

  async startRun(_input: StartRunInput): Promise<StartRunResult> {
    // Session executes the task before calling complete-run. Nothing to do here.
    return { pid: process.pid, exitCode: 0 };
  },

  async resumeRun(_input: ResumeRunInput): Promise<ResumeRunResult> {
    return { pid: process.pid, exitCode: 0 };
  },

  async cancelRun(_input: CancelRunInput): Promise<CancelRunResult> {
    return { success: true };
  },

  async normalizeOutput(input: NormalizeOutputInput): Promise<NormalizedRunOutput> {
    return {
      rawExitCode: input.exitCode ?? 0,
      stdout: input.stdout ?? '',
      stderr: input.stderr ?? '',
      assistantSummary: 'executed by codex session',
      sessionId: null,
      markers: [],
      filesChanged: [],
      retrySuggested: false,
      successSuggested: (input.exitCode ?? 0) === 0,
    };
  },
};
