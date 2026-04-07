export type JobState =
  | 'pending'
  | 'active'
  | 'repeat_detected'       // identical output observed; below candidacy threshold
  | 'convergence_candidate' // streak meets candidacy; one confirming run away from pause
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** How aggressively identical-output runs collapse into a convergence signal. */
export type ConvergenceMode = 'aggressive' | 'normal' | 'conservative' | 'disabled';

/** Supported trigger source types. */
export type TriggerType = 'ipc' | 'webhook' | 'file' | 'hook' | 'job_event';

/**
 * Job lifecycle events a downstream job can subscribe to via a job_event trigger.
 *   run.completed  - upstream run finished with exit code 0
 *   run.failed     - upstream run finished with non-zero exit code
 *   run.any        - any upstream run completion regardless of exit code
 *   state.paused   - upstream job entered paused state (manual or convergence)
 *   state.converged- upstream job auto-paused due to convergence detection
 */
export type JobEventName =
  | 'run.completed'
  | 'run.failed'
  | 'run.any'
  | 'state.paused'
  | 'state.converged';

/** Per-trigger configuration stored in the jobs.triggers column. */
export interface TriggerSpec {
  type: TriggerType;
  /** For 'hook': the Claude Code hook event name, e.g. 'UserPromptSubmit'. */
  event?: string;
  /** For 'file': glob pattern to watch. */
  pattern?: string;
  /** For 'job_event': the source job ID or name to watch. */
  source_job?: string;
  /** For 'job_event': which lifecycle event fires this trigger. Defaults to 'run.completed'. */
  on?: JobEventName;
}

/**
 * Normalized envelope passed from any trigger source into the dispatch gateway.
 * All trigger paths (IPC, webhook, file, hook, job_event) produce one of these.
 */
export interface TriggerEnvelope {
  job_id: string;
  /** Human-readable source identifier, e.g. 'claude-hook', 'git-hook', 'ci', 'job:<id>'. */
  source: string;
  /** Event name within that source, e.g. 'UserPromptSubmit', 'run.completed'. */
  event_type: string;
  triggered_at: string;
  /** If provided, duplicate triggers with the same key within a run window are dropped. */
  idempotency_key?: string;
  /** Groups triggers for debounce/coalescing; defaults to job_id. */
  debounce_key?: string;
  /** Arbitrary source context stored as provenance on the resulting run. */
  context?: Record<string, any>;
  /**
   * Ordered list of job IDs in the causal chain that produced this envelope.
   * Used for cycle detection and hop-count limiting.
   * [ "job-A", "job-B" ] means: job-A triggered job-B which is now triggering this job.
   */
  ancestry?: string[];
}

/**
 * How simultaneous or rapid-fire triggers are handled for a job.
 *   enqueue:         always fire, no deduplication
 *   coalesce:        if a debounce window is active, drop the new trigger (keep first)
 *   replace_pending: if a debounce window is active, reset it (keep last — standard debounce)
 *   drop_if_running: silently drop if the job has an active run
 */
export type TriggerMode = 'enqueue' | 'coalesce' | 'replace_pending' | 'drop_if_running';

/**
 * Hints the scheduler/convergence policy about the job's execution semantics.
 * - deterministic: same inputs always produce same outputs (e.g. echo, build scripts)
 * - polling: samples external state that may change (e.g. API checks, queue depth)
 * - external-stateful: depends on external mutable state; sameness now ≠ sameness later
 * - general: default; applies normal convergence thresholds
 */
export type ExecutionKind = 'deterministic' | 'polling' | 'external-stateful' | 'general';

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
  convergence_mode?: ConvergenceMode | null;
  execution_kind?: ExecutionKind | null;
  /**
   * Trigger sources that may fire this job. Empty array / null = scheduled-only.
   * Serialized as JSON in the jobs.triggers column.
   */
  triggers?: TriggerSpec[] | null;
  /** How concurrent/rapid triggers are resolved. */
  trigger_mode?: TriggerMode | null;
  /** Debounce window in milliseconds (0 = no debounce). */
  debounce_ms?: number | null;
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
  /**
   * When true, the daemon scheduler will not auto-execute jobs for this adapter.
   * The live agent session is responsible for claiming and executing due jobs,
   * then submitting results via claimRunNow / completeRun.
   */
  isSessionOwned?: boolean;
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
