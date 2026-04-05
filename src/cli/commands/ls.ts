import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const lsCommand = new Command('ls')
  .description('List all jobs (excluding soft-deleted)')
  .action(async () => {
    const jobs = CommandDispatcher.ls();

    if (jobs.length === 0) {
      console.log('No jobs found.');
      return;
    }

    console.log('─'.repeat(80));
    console.log(`${'ID'.padEnd(36)} | Task           | State     | CLI    | Interval      | Next Run`);
    console.log('─'.repeat(80));

    for (const job of jobs) {
      const id = (job.id || '').substring(0, 36);
      const task = (job.task || '').padEnd(12);
      const state = (job.state || '').padEnd(10);
      const cli = (job.cli || '').padEnd(8);
      const interval = (job.interval_spec || '').padEnd(12);
      const nextRun = job.next_run_at ? new Date(job.next_run_at).toLocaleString() : '—';
      console.log(`${id.padEnd(36)} | ${task} | ${state} | ${cli} | ${interval} | ${nextRun}`);
    }

    console.log('─'.repeat(80));
  });
