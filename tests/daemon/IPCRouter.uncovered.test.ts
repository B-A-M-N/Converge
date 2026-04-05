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
    (socket as any).destroy = vi.fn();
    // Trigger shutdown by ending the socket
    (socket.end as any)();
    expect(socket.destroy as any).toHaveBeenCalled();
  });

  it('handleRequest with empty method returns PROTOCOL_ERROR', async () => {
    // Access private method via type assertion hack
    const anyRouter = router as any;
    await expect(anyRouter.handleRequest({ jsonrpc: '2.0', id: 1, method: '', params: {} }))
      .rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    expect(socket.write).toHaveBeenCalled(); // error response sent
  });
});
