import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import type { JobSpec, Job, RunResult, ValidationResult, ConvergenceState, Lease } from './types';
import { DaemonUnavailableError, ValidationError, ProtocolError } from './errors';

export interface ConvergeClientOptions {
  socketPath?: string;
  timeout?: number;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  autoConnect?: boolean;
  onEvent?: (event: { type: string; data: any }) => void;
}

interface Frame {
  id: number;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}

function encodeFrame(frame: { id: number; method: string; params: any }): Buffer {
  const json = JSON.stringify(frame);
  const body = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}

function decodeFrame(buffer: Buffer): { frame: Frame; remaining: Buffer } | null {
  const headerLength = 4;
  if (buffer.length < headerLength) return null;
  const bodyLength = buffer.readUInt32BE(0);
  if (buffer.length < headerLength + bodyLength) return null;
  const body = buffer.subarray(headerLength, headerLength + bodyLength);
  const frame = JSON.parse(body.toString()) as Frame;
  return { frame, remaining: buffer.subarray(headerLength + bodyLength) };
}

export class ConvergeClient {
  private options: ConvergeClientOptions & { socketPath: string; timeout: number; reconnectDelay: number; maxReconnectAttempts: number };
  public isConnected: boolean = false;
  private socket: net.Socket | null = null;
  private pendingRequests = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private checkpoints = new Map<string, any>();
  private connectPromise: Promise<void> | null = null;

  /** Event handler - override or set via constructor options */
  public onEvent(event: { type: string; data: any }): void {}

  constructor(options: ConvergeClientOptions = {}) {
    this.options = {
      socketPath: options.socketPath ?? path.join(os.homedir(), '.converge', 'converge.sock'),
      timeout: options.timeout ?? 10000,
      reconnectDelay: options.reconnectDelay ?? 2000,
      maxReconnectAttempts: options.maxReconnectAttempts ?? 5,
      autoConnect: options.autoConnect,
      onEvent: options.onEvent,
    };

    if (this.options.onEvent) {
      this.onEvent = this.options.onEvent;
    }
  }

  connect(): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        this.connectPromise = null;
        reject(new DaemonUnavailableError('Connection timed out'));
      }, this.options.timeout);

      this.socket = net.connect({ path: this.options.socketPath });
      this.socket.on('connect', () => {
        // Send handshake before resolving
        const handshake = JSON.stringify({ type: 'handshake', version: '1.0.0' });
        const hdr = Buffer.alloc(4);
        hdr.writeUInt32BE(handshake.length);
        this.socket!.write(Buffer.concat([hdr, Buffer.from(handshake)]));
        // Handshake response will come via 'data' below with id=0
        this.pendingRequests.set(0, {
          resolve: () => {
            clearTimeout(timeout);
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.connectPromise = null;
            resolve();
          },
          reject: (err) => {
            clearTimeout(timeout);
            this.isConnected = false;
            this.connectPromise = null;
            reject(err);
          },
        });
      });
      this.socket.on('error', (err: any) => {
        clearTimeout(timeout);
        this.isConnected = false;
        this.connectPromise = null;
        reject(new DaemonUnavailableError(`Cannot connect: ${err.message}`));
      });
      this.socket.on('data', (data: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (true) {
          const decoded = decodeFrame(this.buffer);
          if (!decoded) break;
          this.buffer = decoded.remaining as unknown as Buffer;
          const { frame } = decoded;
          const pending = this.pendingRequests.get(frame.id);
          if (pending) {
            this.pendingRequests.delete(frame.id);
            if (frame.error) {
              pending.reject(new Error(frame.error.message || JSON.stringify(frame.error)));
            } else {
              // Support both {result: ...} (jsonrpc) and {params: ...} (legacy) formats
              // Use 'in' check so explicit null results are preserved rather than
              // falling through to frame.params.
              pending.resolve('result' in frame ? frame.result : frame.params);
            }
          }
        }
      });
      this.socket.on('close', () => {
        this.isConnected = false;
        this.attemptReconnect();
      });
    });
    return this.connectPromise;
  }

  disconnect(): void {
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new DaemonUnavailableError('Connection closed'));
    }
    this.pendingRequests.clear();
    this.socket?.destroy();
    this.socket = null;
    this.isConnected = false;
    this.connectPromise = null;
    this.reconnectAttempts = this.options.maxReconnectAttempts; // prevent reconnect
  }

  async createJob(spec: any, actorId?: string): Promise<Job & { jobId?: string }> {
    return this.request('job.create', { spec, actorId });
  }

  async deleteJob(jobId: string): Promise<void> {
    return this.request('job.delete', { jobId });
  }

  async getJob(jobId: string, _actorId?: string): Promise<Job> {
    return this.request('job.get', { jobId });
  }

  async getRun(runId: string, _actorId?: string): Promise<any> {
    return this.request('run.get', { runId });
  }

  async cancelJob(jobId: string, actorId?: string): Promise<void> {
    return this.request('job.cancel', { jobId, actorId });
  }

  async addJob(params: any, actorId?: string): Promise<Job & { jobId?: string }> {
    return this.request('job.create', { spec: params, actorId });
  }

  async subscribe(topic: string, _handler: (...args: any[]) => void): Promise<void> {
    return this.request('subscribe', { topic });
  }

  async replay(fromEventId: number): Promise<any> {
    return this.request('daemon.replay', { fromEventId });
  }

  /** Synchronous local-cache checkpoint get — returns null if not set */
  getCheckpoint(id: string): any {
    return this.checkpoints.get(id) ?? null;
  }

  /** Synchronous local-cache checkpoint set */
  setCheckpoint(id: string, data: any): void {
    this.checkpoints.set(id, data);
  }

  async getActiveLease(jobId: string, _actorId?: string): Promise<any> {
    return this.request('lease.active', { jobId });
  }

  async getCapabilities(): Promise<string[]> {
    return this.request('daemon.capabilities', {});
  }

  async isGloballyPaused(): Promise<boolean> {
    return this.request('daemon.paused', {});
  }

  /** Event handler - override or set via constructor options */
  protected _onEvent(event: { type: string; data: any }): void {
    this.onEvent(event);
  }

  close(): void {
    this.disconnect();
  }

  async listJobs(): Promise<Job[]> {
    return this.request('job.list', {});
  }

  async pauseJob(jobId: string, actorId?: string): Promise<void> {
    return this.request('job.pause', { jobId, actorId });
  }

  async resumeJob(jobId: string, _actorId?: string): Promise<void> {
    void(_actorId);
    return this.request('job.resume', { jobId });
  }

  async runNow(jobId: string, _actorId?: string): Promise<RunResult> {
    void(_actorId);
    return this.request('job.runNow', { jobId });
  }

  async daemonDoctor(_actorId?: string): Promise<any> {
    return this.request('daemon.doctor', {});
  }

  async daemonLogs(jobId: string, _actorId?: string): Promise<any> {
    return this.request('daemon.logs', { jobId });
  }

  /** Send raw frames - used by extensions */
  async sendRawRequest(method: string, params: Record<string, any>): Promise<any> {
    return this.request(method, params);
  }

  private async request<T>(method: string, params: Record<string, any>): Promise<T> {
    if (this.options.autoConnect && !this.isConnected) {
      await this.connect();
    }
    if (!this.isConnected || !this.socket) {
      return Promise.reject(new DaemonUnavailableError('Not connected'));
    }
    const id = this.nextId++;
    const frame = { id, method, params };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.options.timeout);
      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });
      this.socket!.write(encodeFrame(frame));
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch {
        this.reconnectTimer = null;
        this.attemptReconnect();
      }
    }, this.options.reconnectDelay * this.reconnectAttempts);
  }
}
