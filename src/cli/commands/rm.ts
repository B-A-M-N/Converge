import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const rmCommand = new Command('rm')
  .description('Delete a job (soft delete, preserve runs)')
  .argument('<jobId>', 'Job ID')
  .action(async (jobId: string) => {
    try {
      await CommandDispatcher.rm(jobId);
      console.log(`Job ${jobId} deleted — runs preserved for audit`);
    } catch (e: any) {
      console.error(`Cannot delete: ${e.message}`);
      process.exit(1);
    }
  });
