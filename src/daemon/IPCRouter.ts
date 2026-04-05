import * as net from 'net';
import { DaemonUnavailableError, ProtocolError, IncompatibleVersionError } from '../client/errors';

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: string; message?: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, any>;
}

interface IPCRouterOptions {
  socket: net.Socket;
  serverVersion?: string;
  serverCapabilities?: string[];
  onClose?: () => void;
  handlers?: Map<string, (params: any, socket: net.Socket) => Promise<any> | any>;
}

function encodeFrame(payload: JsonRpcResponse | JsonRpcNotification): Buffer {
  const json = JSON.stringify(payload);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length);
  return Buffer.concat([header, Buffer.from(json)]);
}

function encodeErrorFrame(id: number, code: string, message?: string): Buffer {
  const error: JsonRpcResponse = {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
  return encodeFrame(error);
}

export class IPCRouter {
  private socket: net.Socket;
  private buffer: Buffer = Buffer.alloc(0);
  private serverVersion: string;
  private serverCapabilities: string[];
  private onClose: () => void;
  private handlers: Map<string, (params: any, socket: net.Socket) => Promise<any> | any>;
  private handshakeComplete: boolean = false;

  constructor(options: IPCRouterOptions) {
    this.socket = options.socket;
    this.serverVersion = options.serverVersion ?? '1.0.0';
    this.serverCapabilities = options.serverCapabilities ?? [];
    this.onClose = options.onClose ?? (() => {});
    this.handlers = options.handlers ?? new Map();
    this.socket.on('data', (data: Buffer) => this.handleData(data));
    this.socket.on('close', () => this.handleClose());
    this.socket.on('error', () => this.handleClose());
  }

  registerHandler(method: string, handler: (params: any, socket: net.Socket) => Promise<any> | any): void {
    this.handlers.set(method, handler);
  }

  private handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (true) {
      if (this.buffer.length < 4) return; // Not enough bytes for length header

      const bodyLength = this.buffer.readUInt32BE(0);
      if (bodyLength === 0) {
        this.destroySocket(encodeErrorFrame(0, 'PROTOCOL_ERROR', 'Zero-length frame'));
        return;
      }
      if (this.buffer.length < 4 + bodyLength) return; // Incomplete frame

      const body = this.buffer.subarray(4, 4 + bodyLength);
      this.buffer = this.buffer.subarray(4 + bodyLength);

      let msg: any;
      try {
        msg = JSON.parse(body.toString());
      } catch {
        this.destroySocket(encodeErrorFrame(0, 'PROTOCOL_ERROR', 'Invalid JSON'));
        return;
      }

      if (!this.handshakeComplete) {
        this._handleHandshake(msg);
        return;
      }

      if (!msg.method) {
        this.sendError(msg.id || 0, 'PROTOCOL_ERROR');
        continue;
      }
      if (typeof msg.method !== 'string') {
        this.sendError(msg.id || 0, 'PROTOCOL_ERROR');
        continue;
      }

      const handler = this.handlers.get(msg.method);
      if (!handler) {
        this.sendError(msg.id, 'METHOD_NOT_FOUND', `Unknown method: ${msg.method}`);
        continue;
      }

      Promise.resolve(handler(msg.params || {}, this.socket))
        .then((result: any) => {
          this.sendResult(msg.id, result);
        })
        .catch((e: Error) => {
          if (e instanceof IncompatibleVersionError) {
            this.sendError(msg.id, 'INCOMPATIBLE_VERSION', e.message);
          } else if (e instanceof ProtocolError) {
            this.sendError(msg.id, 'PROTOCOL_ERROR', e.message);
          } else if (e instanceof DaemonUnavailableError) {
            this.sendError(msg.id, 'DAEMON_UNAVAILABLE', e.message);
          } else {
            this.sendError(msg.id, 'INTERNAL_ERROR', e.message);
          }
        });
    }
  }

  private _handleHandshake(msg: any): void {
    if (!msg || typeof msg !== 'object') {
      this.destroySocket(encodeErrorFrame(0, 'PROTOCOL_ERROR', 'Invalid handshake'));
      return;
    }
    if (msg.type !== 'handshake') {
      this.destroySocket(encodeErrorFrame(0, 'PROTOCOL_ERROR', 'Expected handshake'));
      return;
    }
    const clientVersion = msg.version || '0.0.0';
    if (this.serverVersion !== clientVersion) {
      this.socket.write(encodeFrame({
        jsonrpc: '2.0',
        id: msg.id || 0,
        error: { code: 'INCOMPATIBLE_VERSION', message: `Server v${this.serverVersion}, client v${clientVersion}` },
      }));
      this.socket.end();
      return;
    }
    this.handshakeComplete = true;
    this.socket.write(encodeFrame({
      jsonrpc: '2.0',
      id: msg.id || 0,
      result: { status: 'ok', version: this.serverVersion, capabilities: this.serverCapabilities },
    }));
  }

  private sendError(id: number, code: string, message?: string): void {
    this.socket.write(encodeErrorFrame(id, code, message));
  }

  private sendResult(id: number, result: any): void {
    this.socket.write(encodeFrame({ jsonrpc: '2.0', id, result }));
  }

  private handleClose(): void {
    this.onClose();
  }

  private destroySocket(errorPayload: Buffer): void {
    this.socket.write(errorPayload);
    this.socket.destroy();
  }
}
