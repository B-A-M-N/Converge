import { AgentAdapter, AdapterHealth, StartRunInput, StartRunResult, ResumeRunInput, ResumeRunResult, CancelRunInput, CancelRunResult, NormalizeOutputInput, NormalizedRunOutput } from '../types';

/**
 * Session-cooperative adapter.
 * Jobs with cli=claude-session are NOT auto-executed by the daemon scheduler.
 * The running Claude Code session detects due jobs via SessionStart/UserPromptSubmit
 * hooks, executes them inline using its own tools, then calls `converge run-now`
 * to record completion and advance the schedule.
 *
 * When `run-now` is called by the session, startRun here is a no-op — the session
 * already did the work. We just return success so Converge records the run and
 * schedules the next one.
 */
export const claudeSessionAdapter: AgentAdapter = {
  name: 'claude-session',
  supportsContinuation: false,

  async detect(): Promise<AdapterHealth> {
    return { isAvailable: true, version: 'session-cooperative' };
  },

  async startRun(_input: StartRunInput): Promise<StartRunResult> {
    // The session executed the task before calling run-now. Nothing to do here.
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
      assistantSummary: 'executed by session',
      sessionId: null,
      markers: [],
      filesChanged: [],
      retrySuggested: false,
      successSuggested: true,
    };
  },
};
