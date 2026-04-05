import { ControlPlane } from '../core/ControlPlane';
import { SchemaManager } from '../db/SchemaManager';
import { IPCServer } from './IPCServer';
import { IPCRouter } from './IPCRouter';
import { startScheduler, stopScheduler } from './scheduler';
import * as path from 'path';
import * as os from 'os';

export class DaemonSupervisor {
  private ipcServer: IPCServer | null = null;
  private ipcRouter: IPCRouter | null = null;
  private socketPath: string;

  constructor() {
    this.socketPath = process.env.CONVERGE_SOCKET_PATH ?? path.join(os.homedir(), '.converge', 'converge.sock');
  }

  async start(): Promise<void> {
    console.log('[DaemonSupervisor] Starting Converge daemon...');
    console.log(`[DaemonSupervisor] PID: ${process.pid}`);
    console.log(`[DaemonSupervisor] Socket: ${this.socketPath}`);

    // Initialize database schema
    await SchemaManager.initialize();

    // Initialize ControlPlane
    await ControlPlane.initialize();

    // Set up IPC
    this.ipcServer = new IPCServer({ socketPath: this.socketPath });
    await this.ipcServer.start();

    // Start scheduler
    startScheduler();

    console.log('[DaemonSupervisor] Daemon started successfully');

    // Handle graceful shutdown
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  private async shutdown(signal: string): Promise<void> {
    console.log(`[DaemonSupervisor] Received ${signal}, shutting down...`);
    this.ipcServer?.stop();
    stopScheduler();
    process.exit(0);
  }
}
