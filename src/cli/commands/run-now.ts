import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const runNowCommand = new Command('run-now')
  .description('Force a job to run immediately')
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    try {
      await CommandDispatcher.runNow(jobId);
      console.log(`Job ${jobId} scheduled for immediate execution by the daemon.`);
    } catch (e: any) {
      console.error(`Cannot schedule: ${e.message}`);
      process.exit(1);
    }
  });
