import { Job, Run, NormalizedRunOutput, TriggerEnvelope, JobEventName } from '../types';
import { JobRepository } from '../repositories/JobRepository';
import { EventRepository } from '../repositories/EventRepository';
import { DispatchGateway } from './DispatchGateway';

/**
 * TriggerRouter — post-run lifecycle event fan-out.
 *
 * After a job run completes, onRunComplete() scans all jobs for job_event
 * triggers that subscribe to this job's lifecycle. For each match it builds a
 * TriggerEnvelope (with upstream context and extended ancestry) and submits it
 * through the DispatchGateway. Routing decisions are recorded in the event log.
 *
 * This is deliberately fire-and-forget from the caller's perspective: upstream
 * execution is not delayed waiting for downstream dispatch results.
 */
export class TriggerRouter {
  /**
   * Called at the end of executeJobInternal after state transitions are applied.
   *
   * @param job             The job that just ran.
   * @param run             The completed run record.
   * @param normalizedOutput The normalized output from the run.
   * @param finalState      The state the job transitioned to (or its current state if unchanged).
   * @param stopReason      The reason string from the stop/convergence decision.
   */
  static onRunComplete(
    job: Job,
    run: Run,
    normalizedOutput: NormalizedRunOutput,
    finalState: string,
    stopReason: string
  ): void {
    // Determine which event names this run completion matches
    const matchingEvents = new Set<JobEventName>();
    matchingEvents.add('run.any');

    const succeeded = (run.exit_code ?? 1) === 0;
    if (succeeded) {
      matchingEvents.add('run.completed');
    } else {
      matchingEvents.add('run.failed');
    }

    if (finalState === 'paused') {
      matchingEvents.add('state.paused');
      // Convergence-driven pauses carry a recognizable reason prefix
      if (stopReason.includes('Convergence')) {
        matchingEvents.add('state.converged');
      }
    }

    // Build the outgoing ancestry: extend the incoming chain with this job
    let incomingAncestry: string[] = [];
    if (run.provenance_json) {
      try {
        const provenance = JSON.parse(run.provenance_json) as Partial<TriggerEnvelope>;
        incomingAncestry = provenance.ancestry ?? [];
      } catch {
        // Malformed provenance — start fresh
      }
    }
    const outgoingAncestry = [...incomingAncestry, job.id];

    // Upstream context passed as context on every downstream envelope
    const upstreamContext = {
      source_job_id: job.id,
      source_job_name: job.name ?? undefined,
      source_run_id: run.id,
      exit_code: run.exit_code,
      final_state: finalState,
      assistant_summary: normalizedOutput.assistantSummary || undefined,
    };

    // Scan all jobs for matching job_event subscribers
    let allJobs: Job[];
    try {
      allJobs = JobRepository.list();
    } catch {
      return; // DB unavailable — skip fan-out silently
    }

    for (const subscriber of allJobs) {
      if (!subscriber.triggers || subscriber.triggers.length === 0) continue;
      // Skip the source job itself (prevents accidental self-trigger)
      if (subscriber.id === job.id) continue;

      for (const trigger of subscriber.triggers) {
        if (trigger.type !== 'job_event') continue;
        if (!trigger.source_job) continue;

        // Match source_job by ID or by name
        const matchesSource =
          trigger.source_job === job.id ||
          (job.name !== null && trigger.source_job === job.name);
        if (!matchesSource) continue;

        const eventName: JobEventName = trigger.on ?? 'run.completed';
        if (!matchingEvents.has(eventName)) continue;

        const envelope: TriggerEnvelope = {
          job_id: subscriber.id,
          source: `job:${job.id}`,
          event_type: eventName,
          triggered_at: new Date().toISOString(),
          ancestry: outgoingAncestry,
          context: upstreamContext,
        };

        // Fire through the dispatch gate — non-blocking, record the decision
        DispatchGateway.submit(envelope).then((result) => {
          try {
            EventRepository.insert({
              job_id: subscriber.id,
              event_type: 'trigger.routed',
              actor_id: `job:${job.id}`,
              timestamp: new Date().toISOString(),
              metadata: JSON.stringify({
                source_job_id: job.id,
                source_run_id: run.id,
                event: eventName,
                dispatch_status: result.status,
                reason: result.reason,
                run_id: result.runId ?? null,
              }),
            });
          } catch {
            // Never let event logging failures surface to the caller
          }
        }).catch(() => {
          // Dispatch failure — already recorded inside DispatchGateway; swallow here
        });
      }
    }
  }
}
