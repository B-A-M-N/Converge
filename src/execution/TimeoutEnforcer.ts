import { ChildProcess } from 'child_process';
import process from 'process';
import { TimeoutMetadata } from '../types';

export type KillFunction = (pid: number, signal: string) => Promise<boolean> | boolean;

export class TimeoutEnforcer {
  private killedBySignal: string | null = null;
  private timeoutId: NodeJS.Timeout | null = null;
  private killTimeoutId: NodeJS.Timeout | null = null;
  private isProcessExited = false;
  private readonly startTime: number;
  private readonly pid: number | undefined;
  private readonly kill: (pid: number, signal: string) => void;
  private signalsSent: Array<{ signal: string; timestamp: string }> = [];

  // Default kill implementation: kills entire process tree
  private static defaultKill(pid: number, signal: string): void {
    if (pid === undefined) return;
    try {
      if (process.platform === 'win32') {
        // Windows: process.kill with positive PID
        process.kill(pid, signal as NodeJS.Signals);
      } else {
        // Unix: negative PID kills process group
        process.kill(-pid, signal as NodeJS.Signals);
      }
    } catch {
      // Ignore errors (e.g., ESRCH)
    }
  }

  constructor(
    private proc: ChildProcess,
    private timeoutMs: number,
    private gracePeriodMs: number = 10000,
    killFn?: KillFunction
  ) {
    this.startTime = Date.now();
    this.pid = proc.pid;
    this.kill = killFn || TimeoutEnforcer.defaultKill;
  }

  start(): void {
    this.timeoutId = setTimeout(() => this.enforceTimeout(), this.timeoutMs);
  }

  cancel(): void {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    if (this.killTimeoutId) clearTimeout(this.killTimeoutId);
  }

  markExited(): void {
    this.isProcessExited = true;
    this.cancel();
  }

  private enforceTimeout(): void {
    if (this.isProcessExited) return;

    // First: graceful termination (SIGTERM)
    this.killedBySignal = 'SIGTERM';
    const termTime = new Date().toISOString();
    this.signalsSent.push({ signal: 'SIGTERM', timestamp: termTime });
    if (this.pid !== undefined) {
      this.kill(this.pid, 'SIGTERM');
    }

    // Schedule force kill (SIGKILL) after grace period
    this.killTimeoutId = setTimeout(() => {
      if (this.isProcessExited) return;
      this.killedBySignal = 'SIGKILL';
      const killTime = new Date().toISOString();
      this.signalsSent.push({ signal: 'SIGKILL', timestamp: killTime });
      if (this.pid !== undefined) {
        this.kill(this.pid, 'SIGKILL');
      }
    }, this.gracePeriodMs);
  }

  getMetadata(): TimeoutMetadata {
    const enforcedAt = this.signalsSent.length > 0
      ? this.signalsSent[0].timestamp
      : new Date().toISOString();

    return {
      killedBySignal: this.killedBySignal,
      timeoutMs: this.timeoutMs,
      enforcedAt: enforcedAt,
      gracePeriodMs: this.gracePeriodMs,
      signalsSent: this.signalsSent
    };
  }

  isExited(): boolean {
    return this.isProcessExited;
  }
}
