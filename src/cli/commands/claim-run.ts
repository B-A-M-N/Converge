import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const claimRunCommand = new Command('claim-run')
  .description('Claim a session-owned job for execution (returns runId)')
  .argument('<jobId>', 'Job ID to claim')
  .action(async (jobId: string) => {
    try {
      const { runId, job } = await CommandDispatcher.claimRunNow(jobId);
      console.log(JSON.stringify({ runId, jobId: job.id, task: job.task, cwd: job.cwd }));
    } catch (e: any) {
      console.error(`Cannot claim run: ${e.message}`);
      process.exit(1);
    }
  });
