import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';

export const triggerCommand = new Command('trigger')
  .description('Fire a trigger-enabled job from an external event source')
  .argument('<jobId>', 'Job ID to trigger')
  .option('--source <name>', 'Event source identifier (e.g. git-hook, ci, claude-hook)', 'cli')
  .option('--event-type <type>', 'Event type within the source (e.g. push, UserPromptSubmit)', 'manual')
  .option('--context <json>', 'Optional JSON context stored as provenance on the run')
  .action(async (
    jobId: string,
    options: { source: string; eventType: string; context?: string }
  ) => {
    let context: Record<string, any> | undefined;
    if (options.context) {
      try {
        context = JSON.parse(options.context);
      } catch {
        console.error('Invalid JSON for --context');
        process.exit(1);
      }
    }

    const result = await CommandDispatcher.trigger(jobId, {
      source: options.source,
      eventType: options.eventType,
      context,
    });

    if (result.status === 'dispatched') {
      console.log(`Dispatched: run ${result.runId} (exit ${result.exitCode})`);
    } else if (result.status === 'debounced') {
      console.log(`Debounced: ${result.reason}`);
    } else if (result.status === 'dropped') {
      console.log(`Dropped: ${result.reason}`);
    } else {
      console.error(`Blocked: ${result.reason}`);
      process.exit(1);
    }
  });
