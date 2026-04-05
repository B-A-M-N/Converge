import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const addCommand = new Command('add')
  .description('Create a new recurring job')
  .option('--task <task>', 'Task command to run')
  .option('--every <interval>', 'Interval (e.g. 5m, 1h, 30s)')
  .option('--stop <json>', 'Stop condition JSON')
  .option('--cli <name>', 'Adapter CLI name', 'claude')
  // Legacy positional support
  .argument('[task]', 'Task (positional, legacy)')
  .argument('[interval]', 'Interval (positional, legacy)')
  .action(async (
    positionalTask: string | undefined,
    positionalInterval: string | undefined,
    options: { task?: string; every?: string; stop?: string; cli?: string }
  ) => {
    const task = options.task ?? positionalTask;
    const interval = options.every ?? positionalInterval;

    if (!task || !interval) {
      console.error('Error: --task and --every are required');
      console.error('Usage: converge add --task "<command>" --every <interval>');
      process.exit(1);
    }

    let stopCondition: any = undefined;
    if (options.stop) {
      try { stopCondition = JSON.parse(options.stop); } catch {
        console.error('Invalid JSON for --stop'); process.exit(1);
      }
    }

    const result = await CommandDispatcher.add({
      task,
      interval,
      stopCondition,
      cli: options.cli ?? 'claude',
    });

    if (result.status === 'error') {
      console.error(`Cannot add job: ${result.reason}`); process.exit(1);
    }
    console.log(`Job ${result.jobId} created with ${interval} schedule`);
  });
