import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IPCRouter } from '../../src/daemon/IPCRouter';

// Helper to create a mock socket
function createMockSocket() {
  const socket: any = {
    on: vi.fn(),
    destroy: vi.fn(),
    write: vi.fn(() => true),
    end: vi.fn()
  };
  return socket;
}

describe('IPCRouter uncovered paths', () => {
  let router: IPCRouter;
  let socket: any;

  beforeEach(() => {
    socket = createMockSocket();
    router = new IPCRouter({
      socket,
      serverVersion: '1.0.0',
      serverCapabilities: [],
      onClose: vi.fn()
    });
  });

  it('setHandlers replaces the handlers map', () => {
    const newHandlers = new Map<string, any>([['test.method', vi.fn()]]);
    (router as any).handlers = newHandlers;
    // Access private field via any cast
    const anyRouter = router as any;
    expect(anyRouter.handlers).toBe(newHandlers);
  });

  it('shutdown destroys the socket', () => {
    router.shutdown();
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('processMessage with empty method returns PROTOCOL_ERROR', async () => {
    const anyRouter = router as any;
    anyRouter.handshakeComplete = true;
    anyRouter.processMessage({ jsonrpc: '2.0', id: 1, method: '', params: {} });
    expect(socket.write).toHaveBeenCalled();
    // Parse the written frame to verify it's an error response
    const frame = socket.write.mock.calls[0][0] as Buffer;
    const len = frame.readUInt32BE(0);
    const body = JSON.parse(frame.subarray(4, 4 + len).toString());
    expect(body.error.code).toBe('PROTOCOL_ERROR');
  });
});
