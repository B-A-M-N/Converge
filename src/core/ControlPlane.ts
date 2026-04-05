import { Job, Run, JobState, Actor, TriggerEnvelope } from '../types';
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
