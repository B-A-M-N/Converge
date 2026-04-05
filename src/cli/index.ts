#!/usr/bin/env node
import { Command } from 'commander';
import { SchemaManager } from '../db/SchemaManager';
import { addCommand } from './commands/add';
import { lsCommand } from './commands/ls';
import { rmCommand } from './commands/rm';
import { pauseCommand } from './commands/pause';
import { resumeCommand } from './commands/resume';
import { logsCommand } from './commands/logs';
import { runNowCommand } from './commands/run-now';
import { doctorCommand } from './commands/doctor';
import { daemonCommand } from './commands/daemon';
import { getCommand } from './commands/get';
import { explainCommand } from './commands/explain';
import { cancelCommand } from './commands/cancel';

async function main() {
  await SchemaManager.initialize();

  const program = new Command();

  program
    .name('converge')
    .description('Recurring task engine for CLI AI agents')
    .version('2.0.0');

  program.addCommand(addCommand);
  program.addCommand(lsCommand);
  program.addCommand(rmCommand);
  program.addCommand(cancelCommand);
  program.addCommand(pauseCommand);
  program.addCommand(resumeCommand);
  program.addCommand(logsCommand);
  program.addCommand(runNowCommand);
  program.addCommand(doctorCommand);
  program.addCommand(daemonCommand);
  program.addCommand(getCommand);
  program.addCommand(explainCommand);

  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
