import { JobRepository } from '../repositories/JobRepository';
import { RunRepository } from '../repositories/RunRepository';
import { ControlPlane } from '../core/ControlPlane';
import { TriggerRouter } from '../core/TriggerRouter';
import { SubprocessLauncher } from '../execution/SubprocessLauncher';
import { getAdapter } from '../adapters/registry';
import { Run, NormalizedRunOutput, StopCondition } from '../types';
import { evaluateStopCondition, detectConvergence } from '../conditions/evaluate';
import { getNextRunTime } from '../utils/time';
import { sendNotification } from '../notifications';
import * as fs from 'fs';
import * as path from 'path';
import { getJobLogDir } from '../utils/paths';
import { v4 as uuidv4 } from 'uuid';

export const launcher = new SubprocessLauncher();

const LEASE_RENEWAL_INTERVAL_MS = 60 * 1000; // 1 minute heartbeat

const RUNNABLE_STATES = new Set(['active', 'repeat_detected', 'convergence_candidate']);

export async function executeJobInternal(jobId: string, existingRun?: Run): Promise<void> {
  const job = JobRepository.get(jobId);
  if (!job || !RUNNABLE_STATES.has(job.state)) return;

  const adapter = getAdapter(job.cli);
  if (!adapter) {
    await ControlPlane.transitionJob(job.id, 'failed', { actorId: 'system' }, `Adapter not found for CLI ${job.cli}`);
    return;
  }

  let run: Run;
  let runId: string;
  let stdoutPath: string | null = null;
  let stderrPath: string | null = null;

  if (existingRun) {
    // Dispatcher created the run; use it directly
    run = existingRun;
    runId = run.id;
    stdoutPath = run.stdout_path ?? null;
    stderrPath = run.stderr_path ?? null;
  } else {
    runId = uuidv4();
    const startedAt = new Date().toISOString();
    const jobLogDir = getJobLogDir(job.id);
    if (!fs.existsSync(jobLogDir)) {
      fs.mkdirSync(jobLogDir, { recursive: true });
    }
    stdoutPath = path.join(jobLogDir, `${runId}.stdout.log`);
    stderrPath = path.join(jobLogDir, `${runId}.stderr.log`);
    run = {
      id: runId,
      job_id: job.id,
      started_at: startedAt,
      finished_at: null,
      status: 'running',
      exit_code: null,
      output: null,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      summary_json: null,
      should_continue: true,
      reason: null,
      pid: null,
      output_hash: null,
      provenance_json: null,
      is_ambiguous: 0,
    };
    RunRepository.create(run);
  }

  // LEASE RENEWAL HEARTBEAT (Spec 1.3)
  const renewalInterval = setInterval(() => {
    console.log(`[Executor] Renewing lease for job ${job.id}...`);
    ControlPlane.acquireLease(job.id, 5 * 60 * 1000); // Extend by 5m
  }, LEASE_RENEWAL_INTERVAL_MS);

  let rawResult;
  try {
    if (job.session_id) {
      rawResult = await adapter.resumeRun({
        cwd: job.cwd,
        task: job.task,
        sessionId: job.session_id,
        timeoutMs: 60 * 60 * 1000,
        stdoutPath: stdoutPath ?? undefined,
        stderrPath: stderrPath ?? undefined,
      });
    } else {
      rawResult = await adapter.startRun({
        cwd: job.cwd,
        task: job.task,
        timeoutMs: 60 * 60 * 1000,
        stdoutPath: stdoutPath ?? undefined,
        stderrPath: stderrPath ?? undefined,
      });
    }
  } catch (e: any) {
    rawResult = {
      exitCode: 1,
      stdout: '',
      stderr: e.message || String(e)
    };
  } finally {
    clearInterval(renewalInterval);
  }

  // PID Persistence (Spec 3.4): store subprocess PID for cancellation
  RunRepository.setPid(runId, rawResult?.pid ?? null);

  const finishedAt = new Date().toISOString();

  // Normalization - ensure we read artifacts from disk
  const finalStdout = (stdoutPath && fs.existsSync(stdoutPath)) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  const finalStderr = (stderrPath && fs.existsSync(stderrPath)) ? fs.readFileSync(stderrPath, 'utf8') : '';

  let normalizedOutput: NormalizedRunOutput;
  try {
    normalizedOutput = await adapter.normalizeOutput!({
      stdout: finalStdout,
      stderr: finalStderr,
      exitCode: rawResult.exitCode
    });
  } catch (e: any) {
    normalizedOutput = {
      rawExitCode: rawResult.exitCode,
      stdout: finalStdout,
      stderr: finalStderr + `\n[Normalization Error]: ${e.message}`,
      assistantSummary: 'unknown',
      sessionId: null,
      markers: [],
      filesChanged: [],
      retrySuggested: false,
      successSuggested: false,
    };
  }

  // Evaluate conditions
  const previousRunsRecords = RunRepository.getByJob(job.id).filter(r => r.id !== runId);
  const previousRuns: NormalizedRunOutput[] = previousRunsRecords.map(r => {
    return r.summary_json ? JSON.parse(r.summary_json) : { rawExitCode: r.exit_code, stdout: '', stderr: '' };
  });

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
    } catch (e: any) {
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
      if (convResult.nextState === 'paused') {
        shouldStop = true;
      }
    }
  }

  if (!shouldStop && job.max_iterations && previousRuns.length + 1 >= job.max_iterations) {
    shouldStop = true;
    stopReason = `Reached max iterations (${job.max_iterations})`;
    newState = 'completed';
  }

  run.finished_at = finishedAt;
  run.status = rawResult.exitCode === 0 ? 'success' : 'failed';
  run.exit_code = rawResult.exitCode;
  run.summary_json = JSON.stringify(normalizedOutput);
  run.should_continue = !shouldStop;
  run.reason = stopReason;

  RunRepository.update(run);

  // Apply state transition and notify when state changes
  if (newState !== job.state) {
    sendNotification(job, run, job.state, newState, stopReason);
    await ControlPlane.transitionJob(job.id, newState, { actorId: 'system' }, stopReason);
  }

  if (!shouldStop) {
    // Job continues — schedule next run (preserves repeat_detected / convergence_candidate state)
    const nextRun = getNextRunTime(job.interval_spec, new Date(finishedAt), job.timezone || undefined);
    JobRepository.updateNextRun(job.id, nextRun ? nextRun.toISOString() : null, finishedAt, rawResult.sessionId || job.session_id);
  }

  // Fan out to downstream subscribers — fire-and-forget, never blocks upstream
  TriggerRouter.onRunComplete(job, run, normalizedOutput, newState, stopReason);
}
