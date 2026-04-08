import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IPCRouter } from './IPCRouter';
import { DaemonUnavailableError } from '../client/errors';

// Mock the event emitter helper
vi.mock('./helpers/event-emitter', () => ({
  createEventEmitter: () => ({
    emit: vi.fn(),
  }),
}));

describe('IPCRouter Branch Coverage', () => {
  let mockSocket: any;
  let router: IPCRouter;
  let onCloseMock: (() => void);

  const createRouter = (options: Partial<IPCRouter['socket']> = {}) => {
    mockSocket = {
      write: vi.fn().mockReturnValue(true),
      destroy: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      // Allow any other properties
      ...options,
    };
    onCloseMock = vi.fn();
    router = new IPCRouter({
      socket: mockSocket,
      serverVersion: '1.0.0',
      serverCapabilities: [],
      onClose: onCloseMock,
      handlers: new Map(),
    });
    // Access private via cast
    (router as any).handshakeComplete = true;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processMessage (post-handshake)', () => {
    beforeEach(() => {
      createRouter();
    });

    it('sends PROTOCOL_ERROR for empty method', () => {
      const routerAny = router as any;
      routerAny.handlers = new Map(); // no handlers needed
      // msg with empty method
      routerAny.processMessage({ jsonrpc: '2.0', id: 1, method: '', params: {} });
      // Should have called sendError via send
      expect(mockSocket.write).toHaveBeenCalled();
      const writtenPayload = parseWrittenPayload(mockSocket.write.mock.calls[0][0]);
      const response = JSON.parse(writtenPayload);
      expect(response.error.code).toBe('PROTOCOL_ERROR');
    });

    it('sends PROTOCOL_ERROR for non-string method', () => {
      const routerAny = router as any;
      routerAny.handlers = new Map();
      routerAny.processMessage({ jsonrpc: '2.0', id: 1, method: 123 as any, params: {} });
      expect(mockSocket.write).toHaveBeenCalled();
      const writtenPayload = parseWrittenPayload(mockSocket.write.mock.calls[0][0]);
      const response = JSON.parse(writtenPayload);
      expect(response.error.code).toBe('PROTOCOL_ERROR');
    });

    it('sends PROTOCOL_ERROR for unknown method', () => {
      const routerAny = router as any;
      routerAny.handlers = new Map(); // empty -> unknown
      routerAny.processMessage({ jsonrpc: '2.0', id: 2, method: 'unknown.method', params: {} });
      expect(mockSocket.write).toHaveBeenCalled();
      const writtenPayload = parseWrittenPayload(mockSocket.write.mock.calls[0][0]);
      const response = JSON.parse(writtenPayload);
      expect(response.error.code).toBe('METHOD_NOT_FOUND');
      expect(response.error.message).toContain('Unknown method');
    });

    it('executes handler and sends result for valid request', async () => {
      const mockHandler = vi.fn().mockResolvedValue({ result: 'ok' });
      const handlers = new Map<string, any>([['test.method', mockHandler]]);
      const routerAny = router as any;
      routerAny.handlers = handlers;
      routerAny.processMessage({ jsonrpc: '2.0', id: 3, method: 'test.method', params: { foo: 'bar' } });
      // new Promise(r => r(thenable)) needs 3 ticks: assimilation + resolution + then-callback
      for (let i = 0; i < 3; i++) await Promise.resolve();
      expect(mockHandler).toHaveBeenCalledWith({ foo: 'bar' }, expect.any(Object));
      // sendResponse called
      const writtenPayload = parseWrittenPayload(mockSocket.write.mock.calls[0][0]);
      const response = JSON.parse(writtenPayload);
      expect(response.result).toEqual({ result: 'ok' });
    });

    it('sends INTERNAL_ERROR when handler throws plain Error', async () => {
      const mockHandler = vi.fn().mockRejectedValue(new Error('boom'));
      const handlers = new Map<string, any>([['fail.method', mockHandler]]);
      const routerAny = router as any;
      routerAny.handlers = handlers;
      routerAny.processMessage({ jsonrpc: '2.0', id: 4, method: 'fail.method', params: {} });
      for (let i = 0; i < 8; i++) await Promise.resolve();
      expect(mockSocket.write).toHaveBeenCalled();
      const writtenPayload = parseWrittenPayload(mockSocket.write.mock.calls[0][0]);
      const response = JSON.parse(writtenPayload);
      expect(response.error.code).toBe('INTERNAL_ERROR');
      expect(response.error.message).toBe('boom');
    });

    it('forwards error code when handler throws object with code', async () => {
      const mockHandler = vi.fn().mockRejectedValue({ code: 'VALIDATION_FAILED', message: 'bad input' });
      const handlers = new Map<string, any>([['valid.method', mockHandler]]);
      const routerAny = router as any;
      routerAny.handlers = handlers;
      routerAny.processMessage({ jsonrpc: '2.0', id: 5, method: 'valid.method', params: {} });
      for (let i = 0; i < 8; i++) await Promise.resolve();
      const writtenPayload = parseWrittenPayload(mockSocket.write.mock.calls[0][0]);
      const response = JSON.parse(writtenPayload);
      expect(response.error.code).toBe('VALIDATION_FAILED');
      expect(response.error.message).toBe('bad input');
    });

    it('ignores notification (no id) without sending response', () => {
      const routerAny = router as any;
      routerAny.handlers = new Map();
      // message without id is notification
      routerAny.processMessage({ jsonrpc: '2.0', method: 'event', params: { eventType: 'TEST' } });
      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  describe('handleClose', () => {
    it('calls onClose callback', () => {
      createRouter();
      (router as any).handleClose();
      expect(onCloseMock).toHaveBeenCalled();
    });

    it('can be triggered via socket close event', () => {
      createRouter();
      // The constructor registers socket.on('close', handleClose)
      // Since mockSocket.on is a vi.fn(), simulate the close handler being called
      const closeHandler = mockSocket.on.mock.calls.find((c: any[]) => c[0] === 'close')?.[1];
      if (closeHandler) closeHandler();
      expect(onCloseMock).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('destroys socket', () => {
      createRouter();
      (router as any).shutdown();
      expect(mockSocket.destroy).toHaveBeenCalled();
    });
  });

  // Helper to parse a frame's payload (4-byte BE length prefix)
  function parseWrittenPayload(frame: Buffer): string {
    if (frame.length < 4) throw new Error('Invalid frame');
    const length = frame.readUInt32BE(0);
    const payload = frame.slice(4);
    return payload.toString('utf-8');
  }
});
