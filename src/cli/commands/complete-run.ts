import { Command } from 'commander';
import { CommandDispatcher } from '../../core/CommandDispatcher';
import * as fs from 'fs';

export const completeRunCommand = new Command('complete-run')
  .description('Submit the result of a session-owned run')
  .argument('<runId>', 'Run ID returned by claim-run')
  .requiredOption('--exit-code <n>', 'Exit code of the task', parseInt)
  .option('--stdout <text>', 'Stdout text (or use --stdout-file)')
  .option('--stdout-file <path>', 'Path to file containing stdout')
  .option('--stderr <text>', 'Stderr text (or use --stderr-file)')
  .option('--stderr-file <path>', 'Path to file containing stderr')
  .option('--session-id <id>', 'Session ID for continuation')
  .option('--summary <text>', 'Human-readable summary of what was done')
  .action(async (runId: string, opts: any) => {
    try {
      const stdout = opts.stdoutFile
        ? fs.readFileSync(opts.stdoutFile, 'utf8')
        : (opts.stdout ?? '');
      const stderr = opts.stderrFile
        ? fs.readFileSync(opts.stderrFile, 'utf8')
        : (opts.stderr ?? '');

      const result = await CommandDispatcher.completeRun(runId, {
        stdout,
        stderr,
        exitCode: opts.exitCode,
        sessionId: opts.sessionId,
        summary: opts.summary,
      });
      console.log(JSON.stringify(result));
    } catch (e: any) {
      console.error(`Cannot complete run: ${e.message}`);
      process.exit(1);
    }
  });
