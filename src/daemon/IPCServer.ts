import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { IPCRouter } from './IPCRouter';
import * as os from 'os';

interface IPCServerOptions {
  socketPath?: string;
  version?: string;
  capabilities?: string[];
  handlers?: Map<string, (params: any, socket: net.Socket) => Promise<any> | any>;
}

export class IPCServer {
  private socketPath: string;
  private version: string;
  private capabilities: string[];
  private handlers: Map<string, (params: any, socket: net.Socket) => Promise<any> | any>;
  public server: net.Server | null = null;
  private routers: any[] = [];
  public closed: boolean = false;

  constructor(options: IPCServerOptions = {}) {
    this.socketPath = options.socketPath ?? getDefaultSocketPath();
    this.version = options.version ?? '1.0.0';
    this.capabilities = options.capabilities ?? [];
    this.handlers = options.handlers ?? new Map();
  }

  async start(): Promise<void> {
    if (this.closed) {
      throw new Error('Server is closed');
    }

    // Ensure directory exists
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Remove existing socket
    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    this.server = net.createServer((socket) => {
      const router = new IPCRouter({
        socket,
        serverVersion: this.version,
        serverCapabilities: this.capabilities,
        handlers: new Map(this.handlers),
        onClose: () => this.removeRouter(router),
      });
      this.routers.push(router);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.socketPath, () => {
        resolve();
      });
      this.server!.on('error', reject);
    });

    // Set restrictive permissions
    try {
      fs.chmodSync(this.socketPath, 0o600);
    } catch {
      // Best effort
    }
  }

  stop(): Promise<void> {
    this.closed = true;

    // Shut down all routers
    for (const router of this.routers) {
      try {
        if (typeof router.shutdown === 'function') {
          router.shutdown();
        }
      } catch {
        // Continue shutting down other routers
      }
    }
    this.routers = [];

    // Close server
    if (this.server) {
      return new Promise<void>((resolve) => {
        this.server!.close(() => {
          this.server = null;
          // Remove socket file
          try {
            fs.unlinkSync(this.socketPath);
          } catch {
            // Socket may not exist; ignore
          }
          resolve();
        });
      });
    }

    // If no server, just clean up file
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Ignore
    }
    return Promise.resolve();
  }

  private removeRouter(router: any): void {
    const idx = this.routers.indexOf(router);
    if (idx >= 0) {
      this.routers.splice(idx, 1);
    }
  }
}

function getDefaultSocketPath(): string {
  const home = os.homedir();
  return path.join(home, '.converge', 'converge.sock');
}
