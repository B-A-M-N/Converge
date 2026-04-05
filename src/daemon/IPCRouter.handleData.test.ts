import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPCRouter } from './IPCRouter';
import { DaemonUnavailableError } from '../client/errors';

// Mock the event emitter helper
vi.mock('./helpers/event-emitter', () => ({
  createEventEmitter: () => ({
    emit: vi.fn(),
  }),
}));

describe('IPCRouter handleData branch coverage', () => {
  let mockSocket: any;
  let router: IPCRouter;
  let writeCalls: Buffer[];

  const createRouter = (handlers = new Map<string, any>()) => {
    writeCalls = [];
    mockSocket = {
      write: vi.fn((frame: Buffer) => { writeCalls.push(frame); return true; }),
      destroy: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const onClose = vi.fn();
    router = new IPCRouter({
      socket: mockSocket,
      serverVersion: '1.0.0',
      serverCapabilities: [],
      onClose,
      handlers,
    });
    // Mark handshake complete to bypass handshake processing
    (router as any).handshakeComplete = true;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleData framing branches', () => {
    it('returns when buffer has less than 4 bytes (incomplete length)', () => {
      createRouter();
      // Simulate receiving 3 bytes only
      (router as any).handleData(Buffer.from([0x00, 0x00, 0x00]));
      expect(mockSocket.write).not.toHaveBeenCalled();
      // Internal buffer should have accumulated
      const routerAny = router as any;
      expect(routerAny.buffer.length).toBe(3);
    });

    it('rejects zero-length frame with ProtocolError and destroys socket', () => {
      createRouter();
      // 4-byte length = 0, no payload
      const frame = Buffer.alloc(4);
      frame.writeUInt32BE(0, 0);
      (router as any).handleData(frame);
      expect(mockSocket.destroy).toHaveBeenCalled();
      // Should have sent error response
      expect(mockSocket.write).toHaveBeenCalled();
      const payload = parseFramePayload(mockSocket.write.mock.calls[0][0]);
      const resp = JSON.parse(payload);
      expect(resp.error.code).toBe('PROTOCOL_ERROR');
    });

    it('rejects oversized frame (>1MB) with ProtocolError and destroys socket', () => {
      createRouter();
      const oversizedLength = 2 * 1024 * 1024; // 2MB
      const frame = Buffer.alloc(4 + oversizedLength);
      frame.writeUInt32BE(oversizedLength, 0);
      (router as any).handleData(frame);
      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(mockSocket.write).toHaveBeenCalled();
      const payload = parseFramePayload(mockSocket.write.mock.calls[0][0]);
      const resp = JSON.parse(payload);
      expect(resp.error.code).toBe('PROTOCOL_ERROR');
    });

    it('returns when payload incomplete (waits for more data)', () => {
      createRouter();
      // Send length prefix + partial payload (only 2 bytes of payload)
      const payload = Buffer.from('{"');
      const frame = Buffer.alloc(4 + payload.length);
      frame.writeUInt32BE(payload.length, 0);
      payload.copy(frame, 4);
      (router as any).handleData(frame);
      // Should not have responded yet
      expect(mockSocket.write).not.toHaveBeenCalled();
      const routerAny = router as any;
      expect(routerAny.buffer.length).toBe(4 + payload.length);
    });

    it('processes multiple frames in one packet', () => {
      createRouter();
      // Build two valid frames: handshake then request? But handshake already done, so just simple request
      // We'll create a request for a handler that exists
      const handler = vi.fn().mockResolvedValue({ ok: true });
      const handlers = new Map([['test.method', handler]]);
      createRouter(handlers);

      // First frame: request
      const req1 = { jsonrpc: '2.0', id: 1, method: 'test.method', params: { a: 1 } };
      const frame1 = makeFrame(req1);
      // Second frame: another request
      const req2 = { jsonrpc: '2.0', id: 2, method: 'test.method', params: { b: 2 } };
      const frame2 = makeFrame(req2);
      // Concatenate
      const combined = Buffer.concat([frame1, frame2]);
      (router as any).handleData(combined);
      // Both handlers should have been called (need to wait for async)
      return new Promise<void>((resolve) => {
        // Wait for promises to resolve
        setTimeout(() => {
          expect(handler).toHaveBeenCalledTimes(2);
          resolve();
        }, 10);
      });
    });

    it('handles invalid UTF-8 with ProtocolError', () => {
      createRouter();
      // Create payload with invalid UTF-8 sequence (0x80 0x80 is invalid)
      const length = 2;
      const frame = Buffer.alloc(4 + length);
      frame.writeUInt32BE(length, 0);
      frame.writeUInt16BE(0x8080, 4); // invalid UTF-8
      (router as any).handleData(frame);
      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(mockSocket.write).toHaveBeenCalled();
      const payload = parseFramePayload(mockSocket.write.mock.calls[0][0]);
      const resp = JSON.parse(payload);
      expect(resp.error.code).toBe('PROTOCOL_ERROR');
    });

    it('handles JSON parse error with ProtocolError', () => {
      createRouter();
      // Valid UTF-8 but invalid JSON
      const payload = Buffer.from('{invalid json}');
      const frame = Buffer.alloc(4 + payload.length);
      frame.writeUInt32BE(payload.length, 0);
      payload.copy(frame, 4);
      (router as any).handleData(frame);
      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(mockSocket.write).toHaveBeenCalled();
      const payloadData = parseFramePayload(mockSocket.write.mock.calls[0][0]);
      const resp = JSON.parse(payloadData);
      expect(resp.error.code).toBe('PROTOCOL_ERROR');
    });
  });

  function makeFrame(obj: any): Buffer {
    const payload = JSON.stringify(obj);
    const buf = Buffer.alloc(4 + Buffer.byteLength(payload, 'utf-8'));
    buf.writeUInt32BE(payload.length, 0);
    buf.write(payload, 4, 'utf-8');
    return buf;
  }

  function parseFramePayload(frame: Buffer): string {
    const length = frame.readUInt32BE(0);
    return frame.slice(4, 4 + length).toString('utf-8');
  }
});
