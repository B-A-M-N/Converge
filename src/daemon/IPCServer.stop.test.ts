import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { IPCServer } from './IPCServer';

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  chmodSync: vi.fn(),
}));

// Mock net with simple server
vi.mock('net', () => {
  const mockServer = {
    listening: false,
    on: vi.fn(),
    listen: vi.fn((path: string, cb: () => void) => { mockServer.listening = true; cb(); }),
    close: vi.fn((cb: () => void) => { mockServer.listening = false; if (cb) cb(); }),
    destroy: vi.fn(),
  };
  return { createServer: vi.fn(() => mockServer) };
});

describe('IPCServer stop() robustness', () => {
  let server: IPCServer;
  let socketPath: string;

  beforeEach(() => {
    socketPath = `/tmp/test-stop-${Date.now()}.sock`;
    (fs.existsSync as any).mockReturnValue(false);
    (fs.mkdirSync as any).mockClear();
    (fs.unlinkSync as any).mockClear();
    (fs.chmodSync as any).mockClear();
    vi.stubGlobal('process', { env: {}, getuid: () => 1000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('handles unlinkSync throw during stop without crashing', async () => {
    server = new IPCServer({ socketPath });
    await server.start();
    // After start, socket file would exist; simulate existsSync returning true
    (fs.existsSync as any).mockReturnValue(true);
    // Make unlinkSync throw
    (fs.unlinkSync as any).mockImplementation(() => { throw new Error('EACCES'); });
    // Stop should resolve despite error
    await expect(server.stop()).resolves.toBeUndefined();
    // unlinkSync should have been called
    expect(fs.unlinkSync).toHaveBeenCalledWith(socketPath);
  });
});
