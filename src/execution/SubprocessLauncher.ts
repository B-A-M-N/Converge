import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';

export interface LaunchOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdoutPath?: string;
  stderrPath?: string;
}

export interface LaunchResult {
  pid: number;
  process: ChildProcess;
}

export class SubprocessLauncher {
  launch(options: LaunchOptions): LaunchResult {
    const { command, args = [], cwd = process.cwd(), env = process.env as Record<string, string>, stdoutPath, stderrPath } = options;

    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (stdoutPath) {
      const stdout = fs.createWriteStream(stdoutPath);
      proc.stdout?.pipe(stdout);
    }
    if (stderrPath) {
      const stderr = fs.createWriteStream(stderrPath);
      proc.stderr?.pipe(stderr);
    }

    return { pid: proc.pid!, process: proc };
  }
}
