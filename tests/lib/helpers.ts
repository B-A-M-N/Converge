import { ConvergeClient } from '../../src/client/ConvergeClient';

/**
 * Execute the same operation in parallel across N clients connected to the same daemon.
 * Each client gets a unique actor identity.
 */
export class ConcurrentTestClient {
  /**
   * Run fn in parallel with n clients.
   * actorFn maps client index to actor string.
   */
  static async runInParallel<T>(
    socketPath: string,
    n: number,
    fn: (client: ConvergeClient, actorId: string) => Promise<T>
  ): Promise<Array<{ success: boolean; result?: T; error?: string }>> {
    const clients: Array<{ client: ConvergeClient; actorId: string }> = [];
    const results: Array<{ success: boolean; result?: T; error?: string }> = [];

    // Create n clients (auto-connect)
    for (let i = 0; i < n; i++) {
      const actorId = `test-client-${i}`;
      const client = new ConvergeClient({
        socketPath,
        autoConnect: true,
      });
      clients.push({ client, actorId });
    }

    try {
      // Execute fn in parallel
      const promises = clients.map(async ({ client, actorId }, idx) => {
        try {
          const result = await fn(client, actorId);
          results[idx] = { success: true, result };
        } catch (error) {
          results[idx] = { success: false, error: (error as Error).message };
        }
      });

      await Promise.all(promises);
    } finally {
      // Cleanup all clients
      for (const { client } of clients) {
        client.close();
      }
    }

    return results;
  }

  /**
   * Assert exactly 1 success among n parallel attempts.
   */
  static async assertExclusiveRun<T>(
    socketPath: string,
    fn: (client: ConvergeClient, actorId: string) => Promise<T>,
    n: number = 50
  ): Promise<void> {
    const results = await ConcurrentTestClient.runInParallel(socketPath, n, fn);
    const successes = results.filter(r => r.success);
    if (successes.length !== 1) {
      throw new Error(
        `Expected exactly 1 success among ${n} attempts, got ${successes.length}`
      );
    }
  }
}

import * as net from 'net';

/**
 * Malformed IPC client that sends invalid frames to test daemon robustness.
 * Uses raw socket to bypass ConvergeClient framing.
 */
export class MalformedIPCClient {
  private socket: net.Socket | null = null;

  constructor(private socketPath: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath, () => resolve());
      this.socket.on('error', reject);
    });
  }

  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  /**
   * Send a frame with length prefix that claims MORE bytes than payload.
   */
  async sendOversizedFrame(payload: any): Promise<Error | null> {
    if (!this.socket) throw new Error('Not connected');
    const payloadStr = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');
    const fakeLength = payloadBytes * 2;
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeBigInt64BE(BigInt(fakeLength), 0);

    try {
      this.socket.write(Buffer.concat([lengthPrefix, Buffer.from(payloadStr)]));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.socket?.readable) {
        return new Error('Oversized frame did not trigger disconnect');
      }
      return null;
    } catch (err) {
      return err as Error;
    }
  }

  /**
   * Send a frame that is truncated (length prefix > actual bytes).
   */
  async sendTruncatedFrame(payload: any): Promise<Error | null> {
    if (!this.socket) throw new Error('Not connected');
    const payloadStr = JSON.stringify(payload);
    const payloadBytes = Buffer.byteLength(payloadStr, 'utf8');
    const fakeLength = payloadBytes + 10;
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeBigInt64BE(BigInt(fakeLength), 0);
    const partialPayload = payloadStr.substring(0, Math.max(0, payloadBytes - 5));

    try {
      this.socket.write(Buffer.concat([lengthPrefix, Buffer.from(partialPayload)]));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.socket?.readable) {
        return new Error('Truncated frame did not trigger disconnect');
      }
      return null;
    } catch (err) {
      return err as Error;
    }
  }

  /**
   * Send malformed JSON (syntax error).
   */
  async sendMalformedJSON(): Promise<Error | null> {
    if (!this.socket) throw new Error('Not connected');
    const malformed = '{ "json": invalid syntax }';
    const lengthPrefix = Buffer.alloc(4);
    lengthPrefix.writeBigInt64BE(BigInt(Buffer.byteLength(malformed, 'utf8')), 0);

    try {
      this.socket.write(Buffer.concat([lengthPrefix, Buffer.from(malformed)]));
      await new Promise(resolve => setTimeout(resolve, 100));
      if (this.socket?.readable) {
        return new Error('Malformed JSON did not trigger disconnect');
      }
      return null;
    } catch (err) {
      return err as Error;
    }
  }
}
