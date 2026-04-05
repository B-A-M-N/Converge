import { ControlPlane } from '../core/ControlPlane';
import { executeJobInternal } from './executor';
import { LEASE_DURATION_MS } from '../config';

export let MAX_JOBS_PER_TICK = 100; // Test hook: can override in tests

export async function runSchedulerTick() {
  const now = new Date();
  const dueJobs = ControlPlane.getDueJobs(now.toISOString());

  if (dueJobs.length === 0) return;

  const jobsToProcess = dueJobs.slice(0, MAX_JOBS_PER_TICK);

  for (const job of jobsToProcess) {
    // claude-session jobs are session-owned: an active Claude Code session claims
    // and executes them via hooks, then calls run-now to record completion.
    // The daemon scheduler must not auto-execute them.
    if (job.cli === 'claude-session') continue;

    if (ControlPlane.acquireLease(job.id, LEASE_DURATION_MS)) {
      try {
        await executeJobInternal(job.id);
      } catch (e) {
        console.error(`[Scheduler] Error executing job ${job.id}`, e);
      } finally {
        ControlPlane.releaseLease(job.id);
      }
    }
  }

  if (dueJobs.length > MAX_JOBS_PER_TICK) {
    console.warn(
      `[Scheduler] Truncated ${dueJobs.length - MAX_JOBS_PER_TICK} due jobs; remaining will be processed in subsequent ticks.`
    );
  }
}

let schedulerTimer: NodeJS.Timeout | null = null;
let schedulerRunning = false;

export function startScheduler(intervalMs: number = 5000): void {
  if (schedulerRunning) return;
  schedulerRunning = true;
  schedulerTimer = setInterval(async () => {
    try {
      await runSchedulerTick();
    } catch (e) {
      console.error('[Scheduler] Unhandled tick error:', e);
    }
  }, intervalMs);
}

export function stopScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  schedulerRunning = false;
}

export function isSchedulerRunning(): boolean {
  return schedulerRunning;
}
