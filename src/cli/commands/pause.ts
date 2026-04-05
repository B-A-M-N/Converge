import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const pauseCommand = new Command('pause')
  .description('Pause a job (non-destructive to current run)')
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    try {
      await CommandDispatcher.pause(jobId);
      console.log(`Job ${jobId} paused — current run (if any) will finish`);
    } catch (e: any) {
      console.error(`Cannot pause: ${e.message}`);
      process.exit(1);
    }
  });
