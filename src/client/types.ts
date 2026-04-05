export interface JobSpec {
  cli: string;
  task?: string;
  command?: string;
  args?: string;
  interval_spec?: string;
  interval?: number | string;
  name?: string;
  cwd?: string;
  timezone?: string;
  stopCondition?: any;
}

export interface Job {
  id: string;
  state: string;
  name: string | null;
  cli: string;
  task: string;
  interval_spec: string;
  created_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
}

export interface Lease {
  job_id: string;
  owner_id: string;
  acquired_at: string;
  expires_at: string;
}

export interface RunResult {
  runId: string;
  exitCode: number;
  output: string;
  started_at: string;
  finished_at: string;
}

export interface ValidationResult {
  ok: boolean;
  errors?: string[];
}

export interface ConvergenceState {
  job_id: string;
  active_runs: number;
  pending_runs: number;
  last_run_at: string | null;
  next_run_at: string | null;
  lease_held: boolean;
}

export class DaemonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DaemonUnavailableError';
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ProtocolError extends Error {
  code: number;
  constructor(message: string, code: number = 1) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
  }
}
