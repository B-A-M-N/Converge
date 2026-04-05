import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

export function getConvergeHome(): string {
  return path.join(os.homedir(), '.converge');
}

export function getJobLogDir(jobId: string): string {
  const logsDir = path.join(getConvergeHome(), 'logs', jobId);
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  return logsDir;
}

export function getJobLogFile(jobId: string, runId: string): string {
  return path.join(getJobLogDir(jobId), `${runId}.log`);
}

export function getDaemonLogPath(): string {
  return path.join(getConvergeHome(), 'daemon.log');
}
