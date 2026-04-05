import { Command } from 'commander';
import { JobRepository } from '../../repositories/JobRepository';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const explainCommand = new Command('explain')
  .description('Explain why a job is in its current state')
  .argument('<jobId>', 'Job ID')
  .action((jobId: string) => {
    const job = JobRepository.get(jobId);
    if (!job) {
      console.error(`Job ${jobId} not found`);
      process.exit(1);
    }

    console.log(`\nJob: ${job.id}`);
    console.log(`State: ${job.state}`);
    console.log(`Task: ${job.task}`);
    console.log(`Interval: ${job.interval_spec}ms`);
    console.log(`CLI: ${job.cli}`);
    console.log(`Created: ${job.created_at}`);
    console.log(`Last run: ${job.last_run_at ?? '—'}`);
    console.log(`Next run: ${job.next_run_at ?? '—'}`);

    if (job.stop_condition_json) {
      try {
        const cond = JSON.parse(job.stop_condition_json);
        console.log(`Stop condition: ${JSON.stringify(cond)}`);
      } catch {
        console.log(`Stop condition (raw): ${job.stop_condition_json}`);
      }
    }

    const runs = CommandDispatcher.logs(jobId);
    if (runs.length > 0) {
      const recent = runs.slice(-3);
      console.log(`\nRecent runs (last ${recent.length}):`);
      for (const run of recent) {
        const status = run.status ?? 'unknown';
        const started = run.started_at ? new Date(run.started_at).toLocaleString() : '—';
        const exit = run.exit_code != null ? `exit ${run.exit_code}` : 'no exit code';
        console.log(`  ${started} → ${status} (${exit})`);
      }
    } else {
      console.log('\nNo runs recorded yet.');
    }
    console.log();
  });
