import { Job, Run, JobState, Actor, TriggerEnvelope, NormalizedRunOutput, StopCondition } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { executeJobInternal } from '../daemon/executor';
import {
  LEASE_DURATION_MS,
  LEASE_RENEWAL_INTERVAL_MS,
  LEASE_RENEWAL_EXTENSION_MS,
} from '../config';
import { LeaseRepository } from '../repositories/LeaseRepository';
import { JobRepository } from '../repositories/JobRepository';
import { RunRepository } from '../repositories/RunRepository';
import { EventRepository } from '../repositories/EventRepository';
import { validateIntervalFloor, intervalSpecToMs, MINIMUM_INTERVAL_FLOOR_MS } from '../conditions/interval-validator';
import { getAdapter } from '../extensions';
import { evaluateStopCondition, detectConvergence } from '../conditions/evaluate';
import { getNextRunTime } from '../utils/time';
import { TriggerRouter } from './TriggerRouter';
import { sendNotification } from '../notifications';

interface ActorInfo {
  actorId: string;
  [key: string]: any;
}

export class ControlPlane {
  private static daemonId = uuidv4();

  // In-memory guard to prevent concurrent runs
  static activeRunFlag = new Set<string>();

  static async initialize(): Promise<void> {
    // Tables are created by SchemaManager migration
  }

  // ─── LEASE MANAGEMENT ───

  static acquireLease(jobId: string, durationMs: number, isRenewal: boolean = false): boolean {
    return LeaseRepository.acquire(jobId, this.daemonId, durationMs, isRenewal);
  }

  static releaseLease(jobId: string): void {
    LeaseRepository.release(jobId, this.daemonId);
  }

  // ─── SCHEDULER ENGINE (Spec 1.2) ───

  static getDueJobs(now: string = new Date().toISOString()): Job[] {
    return JobRepository.getDueJobs(now);
  }

  // ─── DISPATCH (Spec 1.4) ───

  static async dispatch(jobId: string): Promise<void> {
    const job = JobRepository.get(jobId);
    if (!job) return;

    const leaseAcquired = this.acquireLease(jobId, LEASE_DURATION_MS);
    if (!leaseAcquired) return;

    try {
      await executeJobInternal(jobId);
    } finally {
      this.releaseLease(jobId);
    }
  }

  // ─── CANCELLATION (Spec 3.4) ───

  static cancelRun(runId: string): boolean {
    let killed = false;
    const run = RunRepository.get(runId);
    if (run && run.pid != null && run.pid > 0) {
      try {
        process.kill(run.pid, 'SIGTERM');
        killed = true;
      } catch {
        killed = false;
      }
    }
    return killed;
  }

  // ─── JOB STATE TRANSITIONS ───

  static async transitionJob(
    jobId: string,
    newState: JobState,
    actor: Actor,
    reason: string
  ): Promise<void> {
    const job = JobRepository.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found for transition to ${newState}`);
    }
    JobRepository.updateState(jobId, newState);

    EventRepository.insert({
      job_id: jobId,
      event_type: 'state_transition',
      actor_id: actor.actorId,
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({ from: job.state, to: newState, reason }),
    });
  }

  // ─── RUN-NOW (Orchestration) ───

  static async runNow(jobId: string, actor: Actor, provenance?: TriggerEnvelope): Promise<any> {
    void(actor); // Actor parameter reserved for future audit trail

    // In-memory guard to prevent concurrent runs
    if (ControlPlane.activeRunFlag.has(jobId)) {
      throw new Error(`Job ${jobId} has an active run — wait for it to finish`);
    }
    ControlPlane.activeRunFlag.add(jobId);

    let leaseAcquired = false;
    let renewalInterval: NodeJS.Timeout | null = null;
    let runId: string;

    try {
      // Pre-lease active run check (TOCTOU prevention)
      const existingRunPreLease = RunRepository.getActiveRun(jobId);
      if (existingRunPreLease) {
        throw new Error(`Job ${jobId} has an active run — wait for it to finish`);
      }

      // Acquire lease for exclusive execution rights
      leaseAcquired = this.acquireLease(jobId, LEASE_DURATION_MS);
      if (!leaseAcquired) {
        throw new Error(`Job ${jobId} could not acquire lease — another daemon may hold it`);
      }

      // Post-lease TOCTOU guard
      const existingRunPostAcquire = RunRepository.getActiveRun(jobId);
      if (existingRunPostAcquire) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Job ${jobId} has an active run — lease collision detected`);
      }

      // Validate job exists and is in runnable state
      const job = JobRepository.get(jobId);
      if (!job) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Job ${jobId} not found`);
      }

      const runnableStates = new Set(['active', 'repeat_detected', 'convergence_candidate']);
      // If job is pending, activate it
      if (job.state === 'pending') {
        await this.transitionJob(jobId, 'active', this.getSystemActor(), 'Operator: run-now activation');
      } else if (!runnableStates.has(job.state)) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Job ${jobId} is not in a runnable state (current: ${job.state})`);
      }

      // Validate adapter exists
      const adapter = getAdapter(job.cli);
      if (!adapter) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`No adapter found for CLI: ${job.cli}`);
      }

      // Create run record
      runId = uuidv4();
      const run: Run = {
        id: runId,
        job_id: jobId,
        started_at: new Date().toISOString(),
        finished_at: null,
        status: 'running',
        exit_code: null,
        output: null,
        stdout_path: null,
        stderr_path: null,
        summary_json: null,
        should_continue: null,
        reason: null,
        pid: null,
        output_hash: null,
        provenance_json: provenance ? JSON.stringify(provenance) : null,
        is_ambiguous: 0,
      };
      RunRepository.create(run);

      // Set in-memory guard ONLY after successful lease acquisition and run creation
      // Lease renewal heartbeat
      renewalInterval = setInterval(() => {
        try {
          const renewalSuccess = this.acquireLease(jobId, LEASE_RENEWAL_EXTENSION_MS, true);
          if (!renewalSuccess) {
            console.error(`[ControlPlane.runNow] Lease renewal FAILED jobId=${jobId}`);
          }
        } catch (e) {
          console.error(`[ControlPlane.runNow] Lease renewal error jobId=${jobId}:`, e);
        }
      }, LEASE_RENEWAL_INTERVAL_MS);

      // Execute the job — pass the run we created so executor doesn't create a second one
      await executeJobInternal(jobId, run);

      // Fetch finalized run details
      const finalRun = RunRepository.get(runId);
      return {
        runId: finalRun!.id,
        exitCode: finalRun!.exit_code ?? 0,
        output: finalRun!.output as string,
        started_at: finalRun!.started_at,
        finished_at: finalRun!.finished_at,
      };
    } finally {
      if (renewalInterval) {
        clearInterval(renewalInterval);
      }
      if (leaseAcquired) {
        this.releaseLease(jobId);
      }
      this.activeRunFlag.delete(jobId);
    }
  }

  // ─── SESSION-OWNED EXECUTION (claimRunNow / completeRun) ───

  /**
   * Session-owned claim path.
   *
   * The session calls claimRunNow to:
   *   1. Acquire the lease (persisted in SQLite — survives process boundaries)
   *   2. Create the Run record (status: 'running')
   *   3. Return { runId, job } so the session can execute the task itself
   *
   * The session must call completeRun when done, passing actual output.
   * The lease is 30 minutes by default (SESSION_CLAIM_LEASE_MS) to cover
   * long-running tasks without requiring an in-process heartbeat.
   */
  static readonly SESSION_CLAIM_LEASE_MS = 30 * 60 * 1000; // 30 min

  static async claimRunNow(
    jobId: string,
    actor: Actor,
    provenance?: TriggerEnvelope
  ): Promise<{ runId: string; job: Job }> {
    void(actor); // Reserved for future audit trail
    if (ControlPlane.activeRunFlag.has(jobId)) {
      throw new Error(`Job ${jobId} has an active run — wait for it to finish`);
    }
    ControlPlane.activeRunFlag.add(jobId);

    let leaseAcquired = false;

    try {
      const existingRunPreLease = RunRepository.getActiveRun(jobId);
      if (existingRunPreLease) {
        throw new Error(`Job ${jobId} has an active run — wait for it to finish`);
      }

      leaseAcquired = this.acquireLease(jobId, ControlPlane.SESSION_CLAIM_LEASE_MS);
      if (!leaseAcquired) {
        throw new Error(`Job ${jobId} could not acquire lease — another process may hold it`);
      }

      const existingRunPostAcquire = RunRepository.getActiveRun(jobId);
      if (existingRunPostAcquire) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Job ${jobId} has an active run — lease collision detected`);
      }

      const job = JobRepository.get(jobId);
      if (!job) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Job ${jobId} not found`);
      }

      const runnableStates = new Set(['active', 'repeat_detected', 'convergence_candidate']);
      if (job.state === 'pending') {
        await this.transitionJob(jobId, 'active', this.getSystemActor(), 'Session claim: activation');
      } else if (!runnableStates.has(job.state)) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Job ${jobId} is not in a runnable state (current: ${job.state})`);
      }

      const adapter = getAdapter(job.cli);
      if (!adapter) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`No adapter found for CLI: ${job.cli}`);
      }
      if (!adapter.isSessionOwned) {
        this.releaseLease(jobId);
        leaseAcquired = false;
        throw new Error(`Adapter '${job.cli}' is not session-owned — use runNow instead`);
      }

      const runId = uuidv4();
      const run: Run = {
        id: runId,
        job_id: jobId,
        started_at: new Date().toISOString(),
        finished_at: null,
        status: 'running',
        exit_code: null,
        output: null,
        stdout_path: null,
        stderr_path: null,
        summary_json: null,
        should_continue: null,
        reason: null,
        pid: null,
        output_hash: null,
        provenance_json: provenance ? JSON.stringify(provenance) : null,
        is_ambiguous: 0,
      };
      RunRepository.create(run);

      // activeRunFlag is intentionally kept set until completeRun clears it
      return { runId, job };
    } catch (e) {
      // Only clear the flag on failure — success leaves it set until completeRun
      if (!leaseAcquired) {
        ControlPlane.activeRunFlag.delete(jobId);
      }
      throw e;
    }
  }

  /**
   * Session-owned completion path.
   *
   * The session calls completeRun after executing the task, providing the
   * actual stdout/stderr/exitCode. This method:
   *   - Normalizes output through the adapter
   *   - Evaluates stop conditions and convergence
   *   - Persists the finalized Run record
   *   - Advances next_run_at
   *   - Releases the lease
   */
  static async completeRun(
    runId: string,
    result: {
      stdout: string;
      stderr: string;
      exitCode: number;
      sessionId?: string;
      summary?: string;
    }
  ): Promise<{ jobId: string; exitCode: number; shouldContinue: boolean; reason: string }> {
    const run = RunRepository.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status !== 'running') throw new Error(`Run ${runId} is not in running state (current: ${run.status})`);

    const job = JobRepository.get(run.job_id);
    if (!job) throw new Error(`Job ${run.job_id} not found for run ${runId}`);

    const adapter = getAdapter(job.cli);
    if (!adapter) throw new Error(`No adapter found for CLI: ${job.cli}`);

    const finishedAt = new Date().toISOString();

    let normalizedOutput: NormalizedRunOutput;
    try {
      normalizedOutput = adapter.normalizeOutput
        ? await adapter.normalizeOutput({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode })
        : {
            rawExitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            assistantSummary: result.summary ?? 'executed by session',
            sessionId: result.sessionId ?? null,
            markers: [],
            filesChanged: [],
            retrySuggested: false,
            successSuggested: result.exitCode === 0,
          };
    } catch (e: any) {
      normalizedOutput = {
        rawExitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr + `\n[Normalization Error]: ${e.message}`,
        assistantSummary: 'unknown',
        sessionId: null,
        markers: [],
        filesChanged: [],
        retrySuggested: false,
        successSuggested: false,
      };
    }

    const previousRunsRecords = RunRepository.getByJob(job.id).filter(r => r.id !== runId);
    const previousRuns: NormalizedRunOutput[] = previousRunsRecords.map(r =>
      r.summary_json ? JSON.parse(r.summary_json) : { rawExitCode: r.exit_code, stdout: '', stderr: '' }
    );

    let shouldStop = false;
    let stopReason = 'Job completed normally';
    let newState: any = 'active';

    if (job.stop_condition_json) {
      try {
        const condition: StopCondition = JSON.parse(job.stop_condition_json);
        const evalResult = evaluateStopCondition(condition, normalizedOutput, previousRuns);
        if (evalResult.shouldStop) {
          shouldStop = true;
          stopReason = evalResult.reason;
          newState = 'completed';
        }
      } catch {
        shouldStop = true;
        stopReason = 'Invalid stop condition JSON';
        newState = 'failed';
      }
    }

    if (!shouldStop) {
      const convResult = detectConvergence(job.state as any, normalizedOutput, previousRuns, {
        mode: (job.convergence_mode ?? 'normal') as any,
        kind: (job.execution_kind ?? 'general') as any,
      });
      if (convResult.nextState !== null) {
        newState = convResult.nextState;
        stopReason = convResult.reason;
        if (convResult.nextState === 'paused') shouldStop = true;
      }
    }

    if (!shouldStop && job.max_iterations && previousRuns.length + 1 >= job.max_iterations) {
      shouldStop = true;
      stopReason = `Reached max iterations (${job.max_iterations})`;
      newState = 'completed';
    }

    run.finished_at = finishedAt;
    run.status = result.exitCode === 0 ? 'success' : 'failed';
    run.exit_code = result.exitCode;
    run.summary_json = JSON.stringify(normalizedOutput);
    run.should_continue = !shouldStop;
    run.reason = stopReason;
    RunRepository.update(run);

    if (newState !== job.state) {
      sendNotification(job, run, job.state, newState, stopReason);
      await this.transitionJob(job.id, newState, this.getSystemActor(), stopReason);
    }

    if (!shouldStop) {
      const nextRun = getNextRunTime(job.interval_spec, new Date(finishedAt), job.timezone || undefined);
      JobRepository.updateNextRun(
        job.id,
        nextRun ? nextRun.toISOString() : null,
        finishedAt,
        result.sessionId ?? job.session_id
      );
    }

    TriggerRouter.onRunComplete(job, run, normalizedOutput, newState, stopReason);

    this.releaseLease(job.id);
    ControlPlane.activeRunFlag.delete(job.id);

    return {
      jobId: job.id,
      exitCode: result.exitCode,
      shouldContinue: !shouldStop,
      reason: stopReason,
    };
  }

  // ─── JOB CREATION ───

  static async createJob(spec: any, actor: Actor): Promise<Job> {
    // Validate spec.cli
    if (!spec.cli || typeof spec.cli !== 'string') {
      throw new Error('spec.cli is required and must be a non-empty string');
    }

    const triggers: any[] = spec.triggers ?? [];
    const hasTriggers = triggers.length > 0;
    const hasInterval = !!spec.interval_spec;

    if (!hasInterval && !hasTriggers) {
      throw new Error('Either interval_spec or at least one trigger is required');
    }

    // Normalize interval_spec (empty string = trigger-only, skip scheduling)
    const normalizedInterval = hasInterval ? String(intervalSpecToMs(spec.interval_spec)) : '';

    // Enforce minimum interval floor only for scheduled jobs
    if (hasInterval) {
      const validationResult = validateIntervalFloor(spec.interval_spec);
      if (!validationResult.ok) {
        throw new Error(`Interval floor violation: ${validationResult.error}`);
      }
    }

    // Identity guard: deduplication
    const specHash = this.hashJobSpec(spec, actor);
    if (this.recentlyCreatedJobs.has(specHash)) {
      throw new Error(`Job with identical spec already created in this batch`);
    }
    this.recentlyCreatedJobs.add(specHash);
    this.scheduleDedupClear();

    const jobId = uuidv4();
    const now = new Date().toISOString();
    const intervalMs = hasInterval ? intervalSpecToMs(spec.interval_spec) : 0;
    const nextRunAt = hasInterval ? new Date(Date.now() + intervalMs).toISOString() : null;

    const job: Job = {
      id: jobId,
      name: spec.name ?? null,
      cli: spec.cli,
      cwd: spec.cwd ?? process.cwd(),
      task: spec.args ?? spec.task ?? spec.command,
      interval_spec: normalizedInterval,
      timezone: spec.timezone ?? null,
      session_id: null,
      actor: null,
      state: 'pending',
      stop_condition_json: spec.stopCondition ? JSON.stringify(spec.stopCondition) : null,
      max_iterations: null,
      max_failures: 0,
      expires_at: null,
      convergence_mode: spec.convergence_mode ?? 'normal',
      execution_kind: spec.execution_kind ?? 'general',
      triggers: triggers.length > 0 ? triggers : null,
      trigger_mode: spec.trigger_mode ?? 'enqueue',
      debounce_ms: spec.debounce_ms ?? 0,
      created_at: now,
      updated_at: now,
      last_run_at: null,
      next_run_at: nextRunAt,
    };

    JobRepository.create(job);

    return job;
  }

  // ─── JOB LIFECYCLE (pause, resume, delete) ───

  static async pauseJob(jobId: string, actor: Actor): Promise<void> {
    const job = JobRepository.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    const pausableStates = new Set(['active', 'repeat_detected', 'convergence_candidate']);
    if (!pausableStates.has(job.state)) throw new Error(`Job ${jobId} cannot be paused from state: ${job.state}`);

    await this.transitionJob(jobId, 'paused', actor, 'Operator: pause');
  }

  static async resumeJob(jobId: string, actor: Actor): Promise<void> {
    const job = JobRepository.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.state !== 'paused') throw new Error(`Job ${jobId} is not paused (current: ${job.state})`);

    await this.transitionJob(jobId, 'active', actor, 'Operator: resume');
  }

  static async deleteJob(jobId: string, actor: Actor): Promise<void> {
    const job = JobRepository.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    JobRepository.delete(jobId);

    EventRepository.insert({
      job_id: jobId,
      event_type: 'job_deleted',
      actor_id: actor.actorId,
      timestamp: new Date().toISOString(),
      metadata: JSON.stringify({ reason: 'Operator: delete' }),
    });
  }

  // ─── INTERNAL HELPERS ───

  private static getSystemActor(): Actor {
    return { actorId: 'system' } as Actor;
  }

  /** Spec identity guard: prevents duplicate jobs from concurrent createJob calls. */
  private static recentlyCreatedJobs = new Set<string>();
  private static dedupTimer: ReturnType<typeof setTimeout> | null = null;

  private static scheduleDedupClear(): void {
    if (this.dedupTimer !== null) clearTimeout(this.dedupTimer);
    this.dedupTimer = setTimeout(() => {
      this.recentlyCreatedJobs.clear();
      this.dedupTimer = null;
    }, 200);
  }

  private static hashJobSpec(spec: any, _actor: Actor): string {
    const { createHash } = require('crypto');
    const key = JSON.stringify({
      cli: spec.cli,
      command: spec.args ?? spec.task ?? spec.command,
      interval: spec.interval_spec,
    });
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 8);
    return `job-${hash}`;
  }
}
