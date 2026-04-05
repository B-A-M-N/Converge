import { JobRepository } from '../repositories/JobRepository';
import { ControlPlane } from './ControlPlane';
import { TriggerEnvelope, TriggerMode } from '../types';

export interface DispatchResult {
  status: 'dispatched' | 'debounced' | 'dropped' | 'blocked';
  reason: string;
  runId?: string;
  exitCode?: number;
}

const BLOCKED_STATES = new Set(['paused', 'completed', 'failed', 'cancelled']);

/**
 * Maximum causal depth for chained job_event triggers.
 * Protects against accidental fan-out loops and misconfigured pipelines.
 */
const MAX_ANCESTRY_DEPTH = 10;

/**
 * Unified dispatch gateway for all trigger sources.
 *
 * Every path that wants to fire a job — IPC trigger, webhook, file watcher,
 * Claude hook — normalizes its event into a TriggerEnvelope and calls submit().
 *
 * submit() enforces:
 *   - job existence and trigger eligibility
 *   - state gate (blocked states reject immediately)
 *   - per-job trigger mode policy (debounce, coalesce, drop-if-running)
 *
 * Only after passing all gates does it delegate to ControlPlane.runNow, which
 * enforces lease, single-flight, and execution.
 */
export class DispatchGateway {
  /** debounce_key -> active debounce timer */
  private static debounceTimers = new Map<string, NodeJS.Timeout>();

  static async submit(envelope: TriggerEnvelope): Promise<DispatchResult> {
    const job = JobRepository.get(envelope.job_id);
    if (!job) {
      return { status: 'blocked', reason: `Job ${envelope.job_id} not found` };
    }

    // Blocked states: job is in a terminal or paused state
    if (BLOCKED_STATES.has(job.state)) {
      return { status: 'blocked', reason: `Job is ${job.state} — trigger rejected` };
    }

    // Ancestry guards: cycle detection and hop-count ceiling
    const ancestry = envelope.ancestry ?? [];
    if (ancestry.includes(envelope.job_id)) {
      return {
        status: 'blocked',
        reason: `Cycle detected: job ${envelope.job_id} is already in the causal chain [${ancestry.join(' → ')}]`,
      };
    }
    if (ancestry.length >= MAX_ANCESTRY_DEPTH) {
      return {
        status: 'blocked',
        reason: `Causal depth limit reached (${ancestry.length}/${MAX_ANCESTRY_DEPTH}) — pipeline too deep`,
      };
    }

    const triggerMode: TriggerMode = job.trigger_mode ?? 'enqueue';
    const debounceMs = job.debounce_ms ?? 0;
    const debounceKey = envelope.debounce_key ?? envelope.job_id;

    // drop_if_running: check in-memory active run guard
    if (triggerMode === 'drop_if_running') {
      if (ControlPlane.activeRunFlag.has(envelope.job_id)) {
        return { status: 'dropped', reason: 'Job has an active run (drop_if_running)' };
      }
    }

    // Debounce handling
    if (debounceMs > 0) {
      const hasActivTimer = DispatchGateway.debounceTimers.has(debounceKey);

      if (triggerMode === 'coalesce' && hasActivTimer) {
        // Keep first — drop the new trigger
        return { status: 'debounced', reason: `Coalesced: window active for key ${debounceKey}` };
      }

      if (triggerMode === 'replace_pending' && hasActivTimer) {
        // Keep last — reset the timer
        clearTimeout(DispatchGateway.debounceTimers.get(debounceKey)!);
        DispatchGateway.debounceTimers.delete(debounceKey);
      }

      // For coalesce (no active timer), replace_pending (after reset), and enqueue with debounce:
      // arm a new timer and return 'debounced' immediately.
      // The caller gets back control; execution happens after the window expires.
      if (!DispatchGateway.debounceTimers.has(debounceKey)) {
        return new Promise<DispatchResult>((resolve) => {
          const timer = setTimeout(() => {
            DispatchGateway.debounceTimers.delete(debounceKey);
            DispatchGateway._execute(envelope).then(resolve).catch((e) => {
              resolve({ status: 'blocked', reason: e.message });
            });
          }, debounceMs);
          DispatchGateway.debounceTimers.set(debounceKey, timer);
          resolve({ status: 'debounced', reason: `Will fire after ${debounceMs}ms debounce` });
        });
      }
    }

    return DispatchGateway._execute(envelope);
  }

  private static async _execute(envelope: TriggerEnvelope): Promise<DispatchResult> {
    try {
      const actor = { actorId: `trigger:${envelope.source}` };
      const result = await ControlPlane.runNow(envelope.job_id, actor, envelope);
      return {
        status: 'dispatched',
        reason: 'Execution completed',
        runId: result.runId,
        exitCode: result.exitCode,
      };
    } catch (e: any) {
      return { status: 'blocked', reason: e.message };
    }
  }
}
