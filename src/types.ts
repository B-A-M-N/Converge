export type JobState = 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  /** @deprecated use id instead - kept for compatibility */
  jobId?: string;
  id: string;
  name: string | null;
  cli: string;
  cwd: string;
  task: string;
  interval_spec: string;
  timezone: string | null;
  session_id: string | null;
  actor?: string | null;
  state: JobState;
  stop_condition_json: string | null;
  max_iterations: number | null;
  max_failures: number;
  expires_at: string | null;
  created_at: string;
  updated_at?: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  deleted_at?: string | null;
  recovery_required?: number;
  spec_hash?: string;
  interval_ms?: number;
}

export interface Run {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  exit_code: number | null;
  output: string | null;
  stdout_path: string | null;
  stderr_path: string | null;
  summary_json: string | null;
  should_continue: boolean | null;
  reason: string | null;
  pid: number | null;
  output_hash: string | null;
  provenance_json: string | null;
  is_ambiguous: number;
}

export interface StopCondition {
  type: string;
  [key: string]: any;
}

export interface Actor {
  actorId: string;
  [key: string]: any;
}

export interface CaptureMetadata {
  jobId?: string;
  runId?: string;
  [key: string]: any;
}

export interface TimeoutMetadata {
  wallTimeoutMs?: number;
  [key: string]: any;
}

export type NormalizedRunOutput = {
  rawExitCode: number | null;
  stdout: string;
  stderr: string;
  assistantSummary: string;
  sessionId: string | null;
  markers: string[];
  filesChanged: string[];
  retrySuggested: boolean;
  successSuggested: boolean;
};

export interface AgentAdapter {
  name: string;
  supportsContinuation?: boolean;
  detect(): Promise<AdapterHealth>;
  startRun(input: StartRunInput): Promise<any>;
  resumeRun(input: ResumeRunInput): Promise<any>;
  cancelRun(input: CancelRunInput): Promise<CancelRunResult>;
  normalizeOutput?(input: NormalizeOutputInput): Promise<NormalizedRunOutput>;
}

export interface AdapterHealth {
  isAvailable: boolean;
  error?: string;
  version?: string;
}

export interface StartRunInput {
  task: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
  sessionId?: string;
}

export type StartRunResult = { pid: number; [key: string]: any };

export interface ResumeRunInput {
  task: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
  sessionId?: string;
}

export type ResumeRunResult = { pid: number; [key: string]: any };

export interface CancelRunInput {
  jobId: string;
  pid?: number;
  [key: string]: any;
}

export interface CancelRunResult {
  success: boolean;
}

export interface NormalizeOutputInput {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  [key: string]: any;
}
