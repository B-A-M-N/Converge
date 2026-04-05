import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const cancelCommand = new Command('cancel')
  .description('Cancel (delete) a job, preserving run history')
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    try {
      await CommandDispatcher.rm(jobId);
      console.log(`Job ${jobId} cancelled — run history preserved`);
    } catch (e: any) {
      console.error(`Cannot cancel: ${e.message}`);
      process.exit(1);
    }
  });
