import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const resumeCommand = new Command('resume')
  .description('Resume a paused job')
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    try {
      await CommandDispatcher.resume(jobId);
      console.log(`Job ${jobId} resumed`);
    } catch (e: any) {
      console.error(`Cannot resume: ${e.message}`);
      process.exit(1);
    }
  });
