import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

export interface RunProcessOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
}

export function runProcess(
  commandOrOptions: string | RunProcessOptions,
  args?: string[],
  cwd?: string,
  _timeoutMs?: number,
  extraOptions?: { env?: Record<string, string>; stdoutPath?: string; stderrPath?: string },
): ChildProcess {
  let options: RunProcessOptions;
  if (typeof commandOrOptions === 'string') {
    options = { command: commandOrOptions, args: args || [], cwd: cwd || process.cwd(), ...extraOptions };
  } else {
    options = commandOrOptions;
  }
  const { command, args: procArgs = [], cwd: procCwd = process.cwd(), env: procEnv = process.env as Record<string, string> } = options;

  const proc = spawn(command, procArgs, {
    cwd: procCwd,
    env: procEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (options.stdoutPath) {
    const stdout = fs.createWriteStream(options.stdoutPath);
    proc.stdout?.pipe(stdout);
  }
  if (options.stderrPath) {
    const stderr = fs.createWriteStream(options.stderrPath);
    proc.stderr?.pipe(stderr);
  }

  return proc;
}
