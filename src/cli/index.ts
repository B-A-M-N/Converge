#!/usr/bin/env node
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
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

const SOCKET_PATH = process.env.CONVERGE_SOCKET_PATH
  ?? path.join(os.homedir(), '.converge', 'converge.sock');

const DAEMON_LOG = path.join(os.homedir(), '.converge', 'daemon.log');
const AUTOSTART_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 200;

function isDaemonAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!fs.existsSync(SOCKET_PATH)) return resolve(false);
    const sock = net.connect(SOCKET_PATH);
    sock.once('connect', () => { sock.destroy(); resolve(true); });
    sock.once('error', () => resolve(false));
  });
}

async function ensureDaemon(): Promise<void> {
  if (await isDaemonAlive()) return;

  process.stderr.write('[converge] daemon not running — starting...\n');

  fs.mkdirSync(path.dirname(DAEMON_LOG), { recursive: true });
  const logFd = fs.openSync(DAEMON_LOG, 'a');

  const child = spawn(process.execPath, [__filename, 'daemon'], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env },
  });
  child.unref();
  fs.closeSync(logFd);

  // Poll until socket answers or timeout
  const deadline = Date.now() + AUTOSTART_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    if (await isDaemonAlive()) {
      process.stderr.write('[converge] daemon ready\n');
      return;
    }
  }

  process.stderr.write('[converge] warning: daemon did not start within timeout — continuing anyway\n');
}

async function main() {
  await SchemaManager.initialize();

  // Auto-launch daemon for any command except `daemon` itself
  const subcommand = process.argv[2];
  if (subcommand && subcommand !== 'daemon') {
    await ensureDaemon();
  }

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
