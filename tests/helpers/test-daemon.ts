/// <reference types="node" />
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export class TestDaemon {
  private homeDir: string;
  private socketPath: string;

  constructor(homeDir?: string) {
    this.homeDir = homeDir || fs.mkdtempSync(path.join(os.tmpdir(), 'converge-test-'));
    this.socketPath = path.join(this.homeDir, 'converge.sock');
    fs.mkdirSync(this.homeDir, { recursive: true });
  }

  async start(): Promise<void> {
    // Stub — in production this would spawn the daemon process
  }

  async stop(): Promise<void> {
    // Stub
    try {
      fs.rmSync(this.homeDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  getHomeDir(): string {
    return this.homeDir;
  }

  getDbPath(): string {
    return path.join(this.homeDir, '.converge', 'converge.db');
  }
}
