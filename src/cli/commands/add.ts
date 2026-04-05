import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const addCommand = new Command('add')
  .description('Create a new recurring or event-triggered job')
  .option('--task <task>', 'Task command to run')
  .option('--every <interval>', 'Schedule interval (e.g. 5m, 1h, 30s). Optional if --trigger is set.')
  .option('--stop <json>', 'Stop condition JSON')
  .option('--cli <name>', 'Adapter CLI name', 'claude')
  .option('--convergence-mode <mode>', 'Convergence policy: aggressive|normal|conservative|disabled', 'normal')
  .option('--execution-kind <kind>', 'Execution semantics: deterministic|polling|external-stateful|general', 'general')
  .option('--trigger <type>', 'Add a trigger source (ipc|webhook|file|hook). Repeatable.', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option('--after <job>', 'Run after another job completes successfully (shorthand for --on-job <job>:run.completed). Repeatable.', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option('--on-job <job:event>', 'Subscribe to a job lifecycle event, e.g. job-id:run.any (repeatable)', (v, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
  .option('--trigger-mode <mode>', 'How concurrent triggers are handled: enqueue|coalesce|replace_pending|drop_if_running', 'enqueue')
  .option('--debounce-ms <ms>', 'Debounce window in milliseconds', parseInt)
  // Legacy positional support
  .argument('[task]', 'Task (positional, legacy)')
  .argument('[interval]', 'Interval (positional, legacy)')
  .action(async (
    positionalTask: string | undefined,
    positionalInterval: string | undefined,
    options: {
      task?: string; every?: string; stop?: string; cli?: string;
      convergenceMode?: string; executionKind?: string;
      trigger: string[]; triggerMode: string; debounceMs?: number;
      after: string[]; onJob: string[];
    }
  ) => {
    const task = options.task ?? positionalTask;
    const interval = options.every ?? positionalInterval;
    const triggerTypes = options.trigger ?? [];
    const afterJobs = options.after ?? [];
    const onJobSpecs = options.onJob ?? [];

    if (!task) {
      console.error('Error: --task is required');
      process.exit(1);
    }

    if (!interval && triggerTypes.length === 0 && afterJobs.length === 0 && onJobSpecs.length === 0) {
      console.error('Error: either --every (schedule), --trigger, --after, or --on-job is required');
      console.error('Usage: converge add --task "<command>" --every <interval>');
      console.error('       converge add --task "<command>" --after <job-id>');
      console.error('       converge add --task "<command>" --trigger ipc');
      process.exit(1);
    }

    let stopCondition: any = undefined;
    if (options.stop) {
      try { stopCondition = JSON.parse(options.stop); } catch {
        console.error('Invalid JSON for --stop'); process.exit(1);
      }
    }

    // Build trigger specs from all sources
    const triggers: any[] = [
      ...triggerTypes.map((t) => ({ type: t })),
      // --after <job> → job_event:run.completed shorthand
      ...afterJobs.map((sourceJob) => ({ type: 'job_event', source_job: sourceJob, on: 'run.completed' })),
      // --on-job <job>:<event> or <job> (defaults to run.completed)
      ...onJobSpecs.map((spec) => {
        const colonIdx = spec.lastIndexOf(':');
        if (colonIdx > 0) {
          return { type: 'job_event', source_job: spec.slice(0, colonIdx), on: spec.slice(colonIdx + 1) };
        }
        return { type: 'job_event', source_job: spec, on: 'run.completed' };
      }),
    ];

    const result = await CommandDispatcher.add({
      task,
      interval,
      stopCondition,
      cli: options.cli ?? 'claude',
      convergence_mode: options.convergenceMode as any,
      execution_kind: options.executionKind as any,
      triggers: triggers.length > 0 ? triggers : undefined,
      trigger_mode: options.triggerMode,
      debounce_ms: options.debounceMs,
    });

    if (result.status === 'error') {
      console.error(`Cannot add job: ${result.reason}`); process.exit(1);
    }

    const parts: string[] = [];
    if (interval) parts.push(`schedule: every ${interval}`);
    if (triggerTypes.length > 0) parts.push(`ipc triggers: ${triggerTypes.join(', ')}`);
    if (afterJobs.length > 0) parts.push(`after: ${afterJobs.join(', ')}`);
    if (onJobSpecs.length > 0) parts.push(`on-job: ${onJobSpecs.join(', ')}`);
    console.log(`Job ${result.jobId} created (${parts.join('; ')})`);
  });
