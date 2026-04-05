import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const logsCommand = new Command('logs')
  .description('Show run history for a job')
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    const runs = CommandDispatcher.logs(jobId);

    if (runs.length === 0) {
      console.log('No runs found for this job.');
      return;
    }

    console.log('─'.repeat(80));
    console.log(`Run ID (short) | Status   | Started               | Finished              | Exit | Artifact`);
    console.log('─'.repeat(80));

    for (const run of runs) {
      const shortId = (run.id || '').substring(0, 8);
      const status = (run.status || '').padEnd(10);
      const started = run.started_at ? new Date(run.started_at).toLocaleString() : '—';
      const finished = run.finished_at ? new Date(run.finished_at).toLocaleString() : '—';
      const exit = run.exit_code != null ? String(run.exit_code) : '—';
      const artifact = run.artifact_path || '—';
      console.log(`${shortId.padEnd(14)} | ${status} | ${started.padEnd(20)} | ${finished.padEnd(20)} | ${exit.padEnd(4)} | ${artifact}`);
    }

    console.log('─'.repeat(80));
  });
