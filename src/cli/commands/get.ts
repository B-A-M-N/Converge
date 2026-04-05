import { Command } from 'commander';
import { JobRepository } from '../../repositories/JobRepository';

export const getCommand = new Command('get')
  .description('Get full JSON details for a job')
  .argument('<jobId>', 'Job ID')
  .action((jobId: string) => {
    const job = JobRepository.get(jobId);
    if (!job) {
      console.error(`Job ${jobId} not found`);
      process.exit(1);
    }
    console.log(JSON.stringify(job, null, 2));
  });
